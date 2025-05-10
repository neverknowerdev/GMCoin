const {ethers} = require('ethers');
const Interface = ethers.Interface;

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getTwitterUsernames(userIds) {
    const userMap = new Map();
    const maxRetries = 3;

    const rapidApiHost = process.env.RAPIDAPI_HOST;
    const rapidApiKey = process.env.RAPIDAPI_KEY;

    // Filter out null/empty userIds
    const filteredUserIds = userIds.filter(id => id && id !== '');
    if (filteredUserIds.length === 0) {
        console.log('No valid userIds to send to RapidAPI.');
        return userMap;
    }
    console.log('Requesting Twitter usernames for userIds:', filteredUserIds);

    try {
        const response = await fetch(
            `https://${rapidApiHost}/UserResultsByRestIds?user_ids=${encodeURIComponent(filteredUserIds)}`,
            {
                method: 'GET',
                headers: {
                    'x-rapidapi-host': rapidApiHost,
                    'x-rapidapi-key': rapidApiKey,
                },
            }
        );

        console.log('RapidAPI response code:', response.status);

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

async function queryEventsInChunks(contract, filter, startBlock, endBlock, chunkSize = 9900) {
    const events = [];
    for (let fromBlock = startBlock; fromBlock < endBlock; fromBlock += chunkSize) {
        const toBlock = Math.min(fromBlock + chunkSize - 1, endBlock);
        console.log(`Querying events from block ${fromBlock} to ${toBlock}`);
        const chunk = await contract.queryFilter(filter, fromBlock, toBlock);
        events.push(...chunk);
    }
    return events;
}

async function getTopUsersByTransfers(transferEvents, contractAddress) {
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
        .slice(0, 10);

    // Get user IDs for each wallet (throttled)
    const userIds = [];
    for (const [wallet] of sortedWallets) {
        try {
            await sleep(100); // Throttle to avoid rate limit
            userIds.push(await contract.userByWallet(wallet));
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
async function getBlockByTimestamp(provider, targetTimestamp, startBlock, endBlock) {
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

// Use the ABI variable as currently defined in the file
const ABI = [
    'event MintingFinished(uint32 indexed mintingDayTimestamp, string runningHash)',
    'event MintingFinished_TweetsUploadedToIPFS(uint32 indexed mintingDayTimestamp, string runningHash, string cid)',
    'event TwitterVerificationResult(string userID, address indexed wallet, bool isSuccess, string errorMsg)',
    'event Transfer(address indexed from, address indexed to, uint256 value)',
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
    const yesterdayMidnight = new Date(todayMidnight.getTime() - 24 * 60 * 60 * 1000);
    const todayMidnightTs = Math.floor(todayMidnight.getTime() / 1000);
    const yesterdayMidnightTs = Math.floor(yesterdayMidnight.getTime() / 1000);
    const nowTs = Math.floor(Date.now() / 1000);

    // Get latest block and its timestamp
    const latestBlock = await provider.getBlockNumber();
    // Find block numbers for these timestamps
    const earliestBlock = 0;
    const yesterdayMidnightBlock = await getBlockByTimestamp(provider, yesterdayMidnightTs, earliestBlock, latestBlock);

    // Batch fetch and decode all logs
    const allEvents = await getAllDecodedLogs(provider, contractAddress, ABI, yesterdayMidnightBlock, latestBlock);

    // Batch and throttle block timestamp lookups
    const uniqueBlockNumbers = [...new Set(allEvents.map(e => e.blockNumber))];
    const blockTimestampCache = {};
    for (const blockNumber of uniqueBlockNumbers) {
        await sleep(100); // Throttle to 10 requests/sec
        const block = await provider.getBlock(blockNumber);
        blockTimestampCache[blockNumber] = block.timestamp;
    }

    // Group events by type and filter by timestamp
    const mintingEvents = [];
    const tweetsEvents = [];
    const verificationEvents = [];
    const transferEvents = [];

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
        }
    }

    // Get total users from contract
    const totalUsers = await contract.totalUsersCount();

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
        tweetsEvents
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
        const mintingDifficulty = await contract.COINS_MULTIPLICATOR();

        const {
            totalUsers,
            verificationEvents,
            minted24h,
            transferEvents,
            mintingEvents,
            tweetsEvents
        } = await scanContractEvents(contractAddress, treasuryAddress, provider);

        // Format test results
        const testStatus = process.env.TEST_STATUS === '0' ? '✅' : '❌';
        const workflowUrl = process.env.WORKFLOW_URL || '';

        const topUsers = await getTopUsersByTransfers(transferEvents, contractAddress);

        // Prepare message
        const message = `
🔍 Daily Smart Contract Check Report

🧪 Test Status: ${testStatus}
${process.env.TEST_STATUS !== '0' ? `🔗 Workflow URL: ${workflowUrl}` : ''}

👥 Total users(+new users per 24h): 
${totalUsers.toString()} (+${verificationEvents.length})

💰 Minting Statistics:
• Total minted: ${ethers.formatEther(minted24h)} $GM
• Minting difficulty: ${ethers.formatEther(mintingDifficulty)} $GM per tweet/like

🏆 Top Users by Transfer Amount:
${topUsers.map((user, index) => 
    `${index + 1}. ${user.displayName || user.wallet}: ${user.amount} $GM`
).join('\n')}

${mintingEvents.length === 0 ? '⚠️ Warning: No MintingFinished events in last 24h' : '✅ MintingFinished events found'}
${tweetsEvents.length === 0 ? '⚠️ Warning: No TweetsUploadedToIPFS events in last 24h' : '✅ TweetsUploadedToIPFS events found'}
    `;

        console.log('Sending Telegram message...');
        // Send to Telegram
        const telegramUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
        const response = await fetch(telegramUrl, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
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