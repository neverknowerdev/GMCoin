const { ethers } = require('ethers');
const Interface = ethers.Interface;

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry(operation, maxRetries = 3, delayMs = 1000) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            if (error.message.includes('rate limit') || error.message.includes('too many requests') || error.message.includes('request limit reached')) {
                console.log(`Attempt ${attempt}/${maxRetries} failed with rate limit, retrying in ${delayMs}ms...`);
                await sleep(delayMs * attempt); // Exponential backoff
                continue;
            }
            throw error; // Re-throw if it's not a rate limit error
        }
    }
    throw lastError; // If all retries failed
}

// Helper: get block number for a given timestamp using Basescan API
async function getBlockByTimestamp(provider, targetTimestamp, startBlock, endBlock) {
    const apiKey = process.env.BASESCAN_API_KEY;
    
    if (!apiKey) {
        // Fallback: estimate block number based on average block time
        const currentBlock = await provider.getBlockNumber();
        const currentBlockInfo = await provider.getBlock(currentBlock);
        const timeDiff = currentBlockInfo.timestamp - targetTimestamp;
        const blocksToSubtract = Math.floor(timeDiff / 2); // Assume 2 seconds per block on Base
        const estimatedBlock = Math.max(0, currentBlock - blocksToSubtract);
        console.log(`Using estimated block ${estimatedBlock} (no BASESCAN_API_KEY provided)`);
        return estimatedBlock;
    }
    
    const url = `https://api.basescan.org/api?module=block&action=getblocknobytime&timestamp=${targetTimestamp}&closest=before&apikey=${apiKey}`;

    const response = await fetch(url);
    const data = await response.json();
    if (data.status === "1") {
        return parseInt(data.result, 10);
    } else {
        throw new Error("Failed to get block by timestamp from Basescan: " + (data.message || JSON.stringify(data)));
    }
}

// Helper: batch fetch all logs and decode with ABI
async function getAllDecodedLogs(provider, contractAddress, abi, fromBlock, toBlock, chunkSize = 9900) {
    const iface = new Interface(abi);
    let allLogs = [];
    for (let start = fromBlock; start <= toBlock; start += chunkSize) {
        const end = Math.min(start + chunkSize - 1, toBlock);
        const logs = await provider.getLogs({
            address: contractAddress,
            fromBlock: start,
            toBlock: end
        });
        for (const log of logs) {
            try {
                const parsed = iface.parseLog(log);
                allLogs.push({
                    ...parsed,
                    blockNumber: log.blockNumber,
                    transactionHash: log.transactionHash,
                    logIndex: log.logIndex
                });
            } catch (e) {
                // Ignore unknown logs
            }
        }
    }
    return allLogs;
}

// Contract ABI
const ABI = [
    'event MintingFinished_TweetsUploadedToIPFS(uint32 indexed mintingDayTimestamp, string runningHash, string cid)',
    'event Transfer(address indexed from, address indexed to, uint256 value)',
    'function userByWallet(address wallet) view returns (string)',
    'function POINTS_PER_TWEET() view returns (uint256)',
    'function POINTS_PER_LIKE() view returns (uint256)',
    'function POINTS_PER_HASHTAG() view returns (uint256)',
    'function POINTS_PER_CASHTAG() view returns (uint256)',
    'function COINS_MULTIPLICATOR() view returns (uint256)'
];

// Download and parse IPFS file
async function downloadIPFSFile(cid) {
    const url = `https://${cid}.ipfs.w3s.link`;
    console.log(`Downloading IPFS file from: ${url}`);
    
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download IPFS file: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log(`Downloaded IPFS file with ${data.tweets?.length || 0} tweets`);
    return data;
}

// Calculate expected points and coins for each user from IPFS data
function calculateExpectedCoins(ipfsData) {
    const userStats = new Map();
    
    if (!ipfsData.tweets || !Array.isArray(ipfsData.tweets)) {
        console.log('No tweets found in IPFS data');
        return userStats;
    }

    const pointsPerTweet = BigInt(ipfsData.coinsPerPoint?.POINTS_PER_TWEET || 1);
    const pointsPerLike = BigInt(ipfsData.coinsPerPoint?.POINTS_PER_LIKE || 1);
    const pointsPerHashtag = BigInt(ipfsData.coinsPerPoint?.POINTS_PER_HASHTAG || 2);
    const pointsPerCashtag = BigInt(ipfsData.coinsPerPoint?.POINTS_PER_CASHTAG || 3);
    const coinsMultiplicator = BigInt(ipfsData.coinsPerPoint?.COINS_MULTIPLICATOR || 1);

    console.log('Points configuration from IPFS:', {
        POINTS_PER_TWEET: pointsPerTweet.toString(),
        POINTS_PER_LIKE: pointsPerLike.toString(),
        POINTS_PER_HASHTAG: pointsPerHashtag.toString(),
        POINTS_PER_CASHTAG: pointsPerCashtag.toString(),
        COINS_MULTIPLICATOR: coinsMultiplicator.toString()
    });

    for (const tweet of ipfsData.tweets) {
        const userIndex = tweet.userIndex;
        const tweetType = tweet.tweetType;
        const likesCount = BigInt(tweet.likesCount || 0);
        
        if (!userStats.has(userIndex)) {
            userStats.set(userIndex, {
                userIndex,
                simpleTweets: 0,
                hashtagTweets: 0,
                cashtagTweets: 0,
                totalLikes: 0n,
                totalPoints: 0n,
                expectedCoins: 0n
            });
        }
        
        const stats = userStats.get(userIndex);
        
        // TweetProcessingType enum: Skipped = 0, Simple = 1, Hashtag = 2, Cashtag = 3
        switch (tweetType) {
            case 1: // Simple
                stats.simpleTweets++;
                stats.totalPoints += pointsPerTweet;
                break;
            case 2: // Hashtag
                stats.hashtagTweets++;
                stats.totalPoints += pointsPerHashtag;
                break;
            case 3: // Cashtag
                stats.cashtagTweets++;
                stats.totalPoints += pointsPerCashtag;
                break;
            default:
                // Skip tweet (type 0)
                continue;
        }
        
        // Add likes points
        stats.totalLikes += likesCount;
        stats.totalPoints += likesCount * pointsPerLike;
        
        // Calculate expected coins
        stats.expectedCoins = stats.totalPoints * coinsMultiplicator;
    }

    console.log(`Calculated expected coins for ${userStats.size} users from IPFS data`);
    return userStats;
}

// Get actual minting transactions from the last 24h
async function getActualMintingTransactions(provider, contractAddress, treasuryAddress) {
    console.log('Getting actual minting transactions from last 24h...');
    
    // Calculate timestamps for last 24h
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayTs = Math.floor(yesterday.getTime() / 1000);
    
    // Get latest block and find block for yesterday
    const latestBlock = await withRetry(() => provider.getBlockNumber());
    const yesterdayBlock = await getBlockByTimestamp(provider, yesterdayTs, 0, latestBlock);
    
    // Get all logs from yesterday to now
    const allEvents = await getAllDecodedLogs(provider, contractAddress, ABI, yesterdayBlock, latestBlock);
    
    // Filter Transfer events for minting (from address(0) to non-treasury addresses)
    const mintingTransfers = allEvents.filter(event => 
        event.name === 'Transfer' && 
        event.args.from === '0x0000000000000000000000000000000000000000' &&
        event.args.to !== treasuryAddress
    );
    
    console.log(`Found ${mintingTransfers.length} minting transactions in last 24h`);
    return mintingTransfers;
}

// Map wallets to user indices and aggregate minting amounts
async function aggregateMintingByUser(provider, contractAddress, mintingTransfers) {
    console.log('Aggregating minting transactions by user...');
    
    const contract = new ethers.Contract(contractAddress, ABI, provider);
    const userMintingMap = new Map();
    
    // Get unique wallets
    const wallets = [...new Set(mintingTransfers.map(event => event.args.to))];
    
    // For each wallet, get user ID and aggregate minting amounts
    for (const wallet of wallets) {
        try {
            await sleep(100); // Throttle to avoid rate limit
            const userId = await withRetry(() => contract.userByWallet(wallet));
            
            if (!userId || userId === '') {
                console.log(`No user ID found for wallet ${wallet}`);
                continue;
            }
            
            // Find all minting transfers for this wallet
            const walletTransfers = mintingTransfers.filter(event => event.args.to === wallet);
            const totalMinted = walletTransfers.reduce((sum, event) => sum + event.args.value, 0n);
            
            if (!userMintingMap.has(userId)) {
                userMintingMap.set(userId, {
                    userId,
                    wallet,
                    totalMinted: 0n,
                    transactionCount: 0
                });
            }
            
            const userStats = userMintingMap.get(userId);
            userStats.totalMinted += totalMinted;
            userStats.transactionCount += walletTransfers.length;
            
        } catch (error) {
            console.error(`Failed to get user ID for wallet ${wallet}:`, error);
        }
    }
    
    console.log(`Aggregated minting for ${userMintingMap.size} users`);
    return userMintingMap;
}

// Get latest IPFS CID from contract events
async function getLatestIPFSCID(provider, contractAddress) {
    console.log('Getting latest IPFS CID from contract events...');
    
    // Look for events in the last 2 days to ensure we catch the latest one
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const twoDaysAgoTs = Math.floor(twoDaysAgo.getTime() / 1000);
    
    const latestBlock = await withRetry(() => provider.getBlockNumber());
    const twoDaysAgoBlock = await getBlockByTimestamp(provider, twoDaysAgoTs, 0, latestBlock);
    
    // Get all events from the last 2 days
    const allEvents = await getAllDecodedLogs(provider, contractAddress, ABI, twoDaysAgoBlock, latestBlock);
    
    // Filter for MintingFinished_TweetsUploadedToIPFS events
    const ipfsEvents = allEvents.filter(event => event.name === 'MintingFinished_TweetsUploadedToIPFS');
    
    if (ipfsEvents.length === 0) {
        throw new Error('No MintingFinished_TweetsUploadedToIPFS events found in the last 2 days');
    }
    
    // Get the latest event (highest block number)
    const latestEvent = ipfsEvents.reduce((latest, current) => 
        current.blockNumber > latest.blockNumber ? current : latest
    );
    
    console.log(`Found latest IPFS event at block ${latestEvent.blockNumber}, CID: ${latestEvent.args.cid}`);
    return {
        cid: latestEvent.args.cid,
        mintingDayTimestamp: latestEvent.args.mintingDayTimestamp,
        runningHash: latestEvent.args.runningHash
    };
}

// Compare expected vs actual results
function compareResults(expectedMap, actualMap) {
    console.log('Comparing expected vs actual results...');
    
    const results = {
        totalUsers: expectedMap.size,
        matchingUsers: 0,
        missingUsers: [],
        extraUsers: [],
        mismatchedUsers: [],
        totalExpectedCoins: 0n,
        totalActualCoins: 0n
    };
    
    // Check each expected user
    for (const [userIndex, expected] of expectedMap) {
        // For simplicity, we'll use userIndex as the key, but in practice we'd need to map userIndex to userId
        // This is a simplified version - in the actual implementation we'd need to get the actual userId mapping
        const userId = userIndex.toString(); // Placeholder - would need actual mapping
        
        if (actualMap.has(userId)) {
            const actual = actualMap.get(userId);
            
            if (expected.expectedCoins === actual.totalMinted) {
                results.matchingUsers++;
            } else {
                results.mismatchedUsers.push({
                    userIndex,
                    userId,
                    expected: expected.expectedCoins,
                    actual: actual.totalMinted,
                    difference: actual.totalMinted - expected.expectedCoins
                });
            }
            
            results.totalExpectedCoins += expected.expectedCoins;
            results.totalActualCoins += actual.totalMinted;
        } else {
            results.missingUsers.push({
                userIndex,
                userId,
                expectedCoins: expected.expectedCoins
            });
            results.totalExpectedCoins += expected.expectedCoins;
        }
    }
    
    // Check for extra users (in actual but not expected)
    for (const [userId, actual] of actualMap) {
        const userIndex = parseInt(userId); // Placeholder - would need actual mapping
        if (!expectedMap.has(userIndex)) {
            results.extraUsers.push({
                userId,
                actualCoins: actual.totalMinted
            });
            results.totalActualCoins += actual.totalMinted;
        }
    }
    
    return results;
}

// Main validation function
async function validateIPFSTweets(contractAddress, treasuryAddress, provider) {
    console.log('Starting IPFS tweets validation...');
    
    try {
        // 1. Get latest IPFS CID
        const { cid, mintingDayTimestamp, runningHash } = await getLatestIPFSCID(provider, contractAddress);
        
        // 2. Download and parse IPFS file
        const ipfsData = await downloadIPFSFile(cid);
        
        // 3. Calculate expected coins from IPFS data
        const expectedMap = calculateExpectedCoins(ipfsData);
        
        // 4. Get actual minting transactions
        const mintingTransfers = await getActualMintingTransactions(provider, contractAddress, treasuryAddress);
        
        // 5. Aggregate by user
        const actualMap = await aggregateMintingByUser(provider, contractAddress, mintingTransfers);
        
        // 6. Compare results
        const comparison = compareResults(expectedMap, actualMap);
        
        // 7. Generate report
        const isValid = comparison.mismatchedUsers.length === 0 && 
                        comparison.missingUsers.length === 0 && 
                        comparison.extraUsers.length === 0;
        
        console.log('Validation Results:');
        console.log(`- Total users in IPFS: ${comparison.totalUsers}`);
        console.log(`- Matching users: ${comparison.matchingUsers}`);
        console.log(`- Mismatched users: ${comparison.mismatchedUsers.length}`);
        console.log(`- Missing users: ${comparison.missingUsers.length}`);
        console.log(`- Extra users: ${comparison.extraUsers.length}`);
        console.log(`- Total expected coins: ${ethers.formatEther(comparison.totalExpectedCoins)} $GM`);
        console.log(`- Total actual coins: ${ethers.formatEther(comparison.totalActualCoins)} $GM`);
        console.log(`- Validation result: ${isValid ? 'PASS' : 'FAIL'}`);
        
        if (!isValid) {
            console.log('\nDetailed mismatches:');
            for (const mismatch of comparison.mismatchedUsers.slice(0, 10)) { // Show first 10 mismatches
                console.log(`  User ${mismatch.userIndex}: expected ${ethers.formatEther(mismatch.expected)} $GM, got ${ethers.formatEther(mismatch.actual)} $GM`);
            }
        }
        
        return {
            isValid,
            cid,
            mintingDayTimestamp,
            runningHash,
            comparison
        };
        
    } catch (error) {
        console.error('Error during IPFS tweets validation:', error);
        throw error;
    }
}

// Export for testing
module.exports = {
    validateIPFSTweets,
    downloadIPFSFile,
    calculateExpectedCoins,
    getActualMintingTransactions,
    aggregateMintingByUser,
    getLatestIPFSCID,
    compareResults
};

// Main execution
async function main() {
    try {
        const contractAddress = process.env.CONTRACT_ADDRESS;
        const treasuryAddress = process.env.TREASURY_ADDRESS;
        
        if (!contractAddress || !treasuryAddress) {
            throw new Error('CONTRACT_ADDRESS and TREASURY_ADDRESS environment variables are required');
        }
        
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
        
        const result = await validateIPFSTweets(contractAddress, treasuryAddress, provider);
        
        console.log('\n=== IPFS Tweets Validation Completed ===');
        console.log(`Result: ${result.isValid ? 'PASS ✅' : 'FAIL ❌'}`);
        console.log(`CID: ${result.cid}`);
        console.log(`Minting Day: ${new Date(result.mintingDayTimestamp * 1000).toISOString()}`);
        console.log(`Running Hash: ${result.runningHash}`);
        
        if (!result.isValid) {
            console.error('Validation failed! Check the logs above for details.');
            process.exit(1);
        }
        
    } catch (error) {
        console.error('Error in IPFS tweets validation:', error);
        process.exit(1);
    }
}

// Only run main if this file is being run directly
if (require.main === module) {
    main().catch(error => {
        console.error('Unhandled error:', error);
        process.exit(1);
    });
}