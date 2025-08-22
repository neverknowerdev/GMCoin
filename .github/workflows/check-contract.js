const { ethers } = require('ethers');
const Interface = ethers.Interface;

/**
 * Daily Smart Contract Check Script
 * 
 * Note: This script has been updated to work with QuickNode's new eth_getLogs limitations.
 * QuickNode now limits eth_getLogs to a maximum of 5 blocks per request.
 * The script processes logs in small chunks to work within these limits.
 */

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

async function getTwitterUsernames(userIds) {
    const userMap = new Map();

    const twitterApiHost = process.env.TWITTER_HOST;
    const twitterApiKey = process.env.TWITTER_API_KEY;
    const twitterServerName = process.env.TWITTER_SERVER_NAME;

    // Filter out null/empty userIds
    const filteredUserIds = userIds.filter(id => id && id !== '');
    if (filteredUserIds.length === 0) {
        console.log('No valid userIds to send to RapidAPI.');
        return userMap;
    }
    console.log('Requesting Twitter usernames for userIds:', filteredUserIds);

    try {
        const response = await fetch(
            `https://${twitterApiHost}/UserResultsByRestIds?user_ids=${encodeURIComponent(filteredUserIds)}`,
            {
                method: 'GET',
                headers: {
                    [`x-${twitterServerName}-host`]: twitterApiHost,
                    [`x-${twitterServerName}-key`]: twitterApiKey,
                },
            }
        );

        console.log('Twitter response code:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Failed to fetch Twitter users for chunk: ${filteredUserIds}, status: ${response.status}`, errorText);
            return userMap;
        }

        const data = await response.json();

        if (data && data.data && data.data.users) {
            for (const user of data.data.users) {
                if (
                    user &&
                    user.rest_id &&
                    user.result &&
                    user.result.core &&
                    user.result.core.screen_name
                ) {
                    userMap.set(user.rest_id, user.result.core.screen_name);
                } else if (user && user.rest_id) {
                    userMap.set(user.rest_id, user.rest_id);
                }
            }
        }
    } catch (error) {
        console.error('Error fetching Twitter users:', error);
    }

    return userMap;
}


async function getTopUsersByTransfers(transferEvents, contractAddress, limit = 10) {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    const contract = new ethers.Contract(contractAddress, [
        'function userByWallet(address wallet) view returns (string)'
    ], provider);

    // Get unique wallets from transfer events (excluding zero address and treasury)
    const wallets = [...new Set(transferEvents
        .map(event => event.args.to)
        .filter(to =>
            to !== '0x0000000000000000000000000000000000000000' &&
            to !== process.env.TREASURY_ADDRESS
        )
    )];

    // Calculate total transfers per wallet
    const walletTransfers = new Map();
    transferEvents.forEach(event => {
        const to = event.args.to;
        if (wallets.includes(to)) {
            const amount = event.args.value;
            const current = walletTransfers.get(to) || 0n;
            walletTransfers.set(to, current + amount);
        }
    });

    // Sort wallets by transfer amount (descending)
    const sortedWallets = Array.from(walletTransfers.entries())
        .sort((a, b) => Number(b[1] - a[1]))
        .slice(0, limit);

    // Get user IDs for each wallet (throttled)
    const userIds = [];
    for (const [wallet] of sortedWallets) {
        try {
            await sleep(100); // Throttle to avoid rate limit
            const userId = await withRetry(() => contract.userByWallet(wallet));
            userIds.push(userId);
        } catch (error) {
            console.error(`Failed to get user ID for wallet ${wallet}:`, error);
            userIds.push(null);
        }
    }

    // Filter out null/empty userIds and log
    const filteredUserIds = userIds.filter(id => id && id !== '');
    console.log('Sending userIds to RapidAPI:', filteredUserIds);
    const userMap = await getTwitterUsernames(filteredUserIds);
    // Map results
    return sortedWallets.map(([wallet, amount], index) => {
        const userId = userIds[index];
        const username = userId && userId !== '' ? userMap.get(userId) : null;
        const shortWallet = wallet.slice(0, 6) + '...' + wallet.slice(-4);

        return {
            wallet: shortWallet,
            displayName: username ? '@' + username : null,
            userId: userId,
            amount: ethers.formatEther(amount)
        };
    });
}

// Helper: get block number for a given timestamp using Basescan API
async function getBlockByTimestamp(targetTimestamp) {
    const apiKey = process.env.BASESCAN_API_KEY;
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
async function getAllDecodedLogs(provider, contractAddress, abi, fromBlock, toBlock, chunkSize = 500) {
    const iface = new Interface(abi);
    let allLogs = [];

    // QuickNode now limits eth_getLogs to 5 blocks, so we need to process in very small chunks
    const totalChunks = Math.ceil((toBlock - fromBlock + 1) / chunkSize);
    let currentChunk = 0;

    // Add timeout protection - if processing takes too long, we'll stop
    const startTime = Date.now();
    const maxProcessingTime = 10 * 60 * 1000; // 10 minutes max

    for (let start = fromBlock; start <= toBlock; start += chunkSize) {
        // Check if we're taking too long
        if (Date.now() - startTime > maxProcessingTime) {
            console.log(`⚠️  Processing timeout reached (${maxProcessingTime / 1000}s). Stopping at block ${start}.`);
            break;
        }

        const end = Math.min(start + chunkSize - 1, toBlock);
        currentChunk++;

        // Show progress every 100 chunks to avoid spam
        if (currentChunk % 100 === 0 || currentChunk === totalChunks) {
            console.log(`Processing chunk ${currentChunk}/${totalChunks} (blocks ${start}-${end})`);
        }

        try {
            const logs = await withRetry(() => provider.getLogs({
                address: contractAddress,
                fromBlock: start,
                toBlock: end
            }));

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

            // Add a small delay between chunks to avoid overwhelming the RPC
            if (start + chunkSize <= toBlock) {
                await sleep(50);
            }
        } catch (error) {
            console.error(`Failed to fetch logs for blocks ${start}-${end}:`, error);

            // Check if it's a QuickNode-specific error
            if (error.message && error.message.includes('eth_getLogs is limited to a 5 range')) {
                console.log(`QuickNode limit hit for blocks ${start}-${end}, continuing with next chunk...`);
            } else if (error.message && error.message.includes('rate limit') || error.message.includes('too many requests')) {
                console.log(`Rate limit hit for blocks ${start}-${end}, waiting longer before next chunk...`);
                await sleep(1000); // Wait 1 second for rate limit
            }

            // Continue with next chunk instead of failing completely
            continue;
        }
    }

    const processingTime = (Date.now() - startTime) / 1000;
    console.log(`Completed processing ${currentChunk}/${totalChunks} chunks in ${processingTime.toFixed(1)}s, found ${allLogs.length} events`);
    return allLogs;
}

// Use the ABI variable as currently defined in the file
const ABI = [
    'event MintingFinished(uint32 indexed mintingDayTimestamp, string runningHash)',
    'event MintingFinished_TweetsUploadedToIPFS(uint32 indexed mintingDayTimestamp, string runningHash, string cid)',
    'event TwitterVerificationResult(string userID, address indexed wallet, bool isSuccess, string errorMsg)',
    'event Transfer(address indexed from, address indexed to, uint256 value)',
    'event changedComplexity(uint256 newMultiplicator, uint256 previousEpochPoints, uint256 currentEpochPoints)',
    'function totalUsersCount() view returns (uint256)',
    'function COINS_MULTIPLICATOR() view returns (uint256)'
];

async function scanContractEvents(contractAddress, treasuryAddress, provider) {
    console.log('Scanning contract:', contractAddress);
    console.log('Treasury address:', treasuryAddress);

    const contract = new ethers.Contract(contractAddress, ABI, provider);

    // Calculate timestamps
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const todayMidnightTs = Math.floor(todayMidnight.getTime() / 1000);

    const today1AM = new Date(todayMidnight.getTime() + 1 * 60 * 55 * 1000); // 1AM - 5mins
    const today1AmTs = Math.floor(today1AM.getTime() / 1000);

    const today2Am = new Date(todayMidnight.getTime() + 2 * 60 * 60 * 1000);
    const today2AmTs = Math.floor(today2Am.getTime() / 1000);

    console.log('today1Am', today1AM.toISOString());
    console.log('today2Am', today2Am.toISOString());

    const today1AmBlock = await getBlockByTimestamp(today1AmTs);
    const today2AmBlock = await getBlockByTimestamp(today2AmTs);

    const blockRange = today2AmBlock - today1AmBlock;
    console.log(`Scanning blocks from ${today1AmBlock} to ${today2AmBlock} (${blockRange} blocks)`);
    console.log('Note: QuickNode limits eth_getLogs to 5 blocks, processing in small chunks...');

    // Warn if the block range is very large (which could take a long time)
    if (blockRange > 10000) {
        console.log(`⚠️  Warning: Large block range (${blockRange} blocks). This may take several minutes to process.`);
    }


    // Batch fetch and decode all logs
    const allEvents = await getAllDecodedLogs(provider, contractAddress, ABI, today1AmBlock, today2AmBlock);

    // Batch and throttle block timestamp lookups
    const uniqueBlockNumbers = [...new Set(allEvents.map(e => e.blockNumber))];
    const blockTimestampCache = {};
    for (const blockNumber of uniqueBlockNumbers) {
        await sleep(100); // Throttle to 10 requests/sec
        const block = await withRetry(() => provider.getBlock(blockNumber));
        blockTimestampCache[blockNumber] = block.timestamp;
    }

    // Group events by type and filter by timestamp
    const mintingEvents = [];
    const tweetsEvents = [];
    const verificationEvents = [];
    const transferEvents = [];
    const complexityEvents = [];

    for (const event of allEvents) {
        const ts = blockTimestampCache[event.blockNumber];
        if (event.name === 'MintingFinished' && ts >= todayMidnightTs) {
            mintingEvents.push(event);
        } else if (event.name === 'MintingFinished_TweetsUploadedToIPFS' && ts >= todayMidnightTs) {
            tweetsEvents.push(event);
        } else if (event.name === 'TwitterVerificationResult' && ts >= yesterdayMidnightTs && ts < todayMidnightTs) {
            verificationEvents.push(event);
        } else if (event.name === 'Transfer' && ts >= todayMidnightTs) {
            transferEvents.push(event);
        } else if (event.name === 'changedComplexity' && ts >= todayMidnightTs) {
            complexityEvents.push(event);
        }
    }

    // Get total users from contract
    const totalUsers = await withRetry(() => contract.totalUsersCount());

    // Get new users in last 24h (from verificationEvents)
    const newUsers24h = verificationEvents
        .filter(event => event.args.isSuccess)
        .map(event => event.args.wallet.toLowerCase())
        .filter((wallet, index, self) => self.indexOf(wallet) === index)
        .length;

    // Get minted amount in last 24h (excluding treasury transfers)
    const minted24h = transferEvents
        .filter(event =>
            event.args.from === '0x0000000000000000000000000000000000000000' &&
            event.args.to !== treasuryAddress
        )
        .reduce((sum, event) => sum + event.args.value, 0n);

    // Filter out treasury transfers
    const filteredTransferEvents = transferEvents.filter(event =>
        event.args.to !== treasuryAddress &&
        event.args.from !== treasuryAddress
    );

    return {
        totalUsers,
        newUsers24h,
        minted24h,
        verificationEvents,
        transferEvents: filteredTransferEvents,
        mintingEvents,
        tweetsEvents,
        complexityEvents
    };
}

// Export the functions for testing
module.exports = {
    scanContractEvents,
    getTopUsersByTransfers
};

async function main() {
    try {
        const contractAddress = process.env.CONTRACT_ADDRESS;
        const treasuryAddress = process.env.TREASURY_ADDRESS;

        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
        const contract = new ethers.Contract(contractAddress, ABI, provider);

        // Get minting difficulty
        const mintingDifficulty = await withRetry(() => contract.COINS_MULTIPLICATOR());

        console.log('Starting contract event scan...');
        const {
            totalUsers,
            verificationEvents,
            minted24h,
            transferEvents,
            mintingEvents,
            tweetsEvents,
            complexityEvents
        } = await scanContractEvents(contractAddress, treasuryAddress, provider);

        // Format test results
        const testStatus = process.env.TEST_STATUS === '0' ? '✅' : '❌';
        const workflowUrl = process.env.WORKFLOW_URL || '';

        const topUsers = await getTopUsersByTransfers(transferEvents, contractAddress, 20);

        // Prepare message
        const message = `
🔍 Daily Smart Contract Check Report

🧪 Test Status: ${testStatus}${process.env.TEST_STATUS !== '0' ? `\n🔗 Workflow URL: ${workflowUrl}` : ''}

👥 Total users(+new users per 24h): 
${totalUsers.toString()} (+${verificationEvents.length})

💰 Minting Statistics:
• Total minted: ${ethers.formatEther(minted24h)} $GM
• Minting difficulty: ${ethers.formatEther(mintingDifficulty)} $GM per tweet/like${complexityEvents.length > 0 ? `\n• Complexity changed: ${complexityEvents[0].args.previousEpochPoints} points prev-last epoch → ${complexityEvents[0].args.currentEpochPoints} points last epoch` : ''}

🏆 Top Users by Transfer Amount:
${topUsers.map((user, index) =>
            `${index + 1}. ${user.displayName ? `<a href="https://x.com/${user.displayName.slice(1)}">${user.displayName}</a>` : user.wallet}: ${user.amount} $GM`
        ).join('\n')}

${mintingEvents.length === 0 ? '⚠️ Warning: No MintingFinished events in last 24h' : '✅ MintingFinished event found'}
${tweetsEvents.length === 0 ? '⚠️ Warning: No TweetsUploadedToIPFS events in last 24h' : `✅ TweetsUploadedToIPFS events found (${tweetsEvents.length} events)`}
    `;

        console.log('Sending Telegram message...');
        // Send to Telegram
        const telegramUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
        const response = await fetch(telegramUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: process.env.TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'HTML'
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to send Telegram message: ${response.status} ${errorText}`);
        }

        console.log('Contract check completed successfully');
    } catch (error) {
        console.error('Error in contract check:', error);
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