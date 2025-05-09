const { ethers } = require('ethers');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getTwitterUsernames(userIds) {
  // Twitter API has a limit of 100 users per request
  const chunkSize = 100;
  const userIdChunks = [];
  
  // Split userIds into chunks of 100
  for (let i = 0; i < userIds.length; i += chunkSize) {
    userIdChunks.push(userIds.slice(i, i + chunkSize));
  }
  
  const userMap = new Map();
  let retryCount = 0;
  const maxRetries = 3;
  
  // Process each chunk
  for (const chunk of userIdChunks) {
    const ids = chunk.join(',');
    let success = false;
    
    while (!success && retryCount < maxRetries) {
      try {
        const response = await fetch(`https://api.twitter.com/2/users?ids=${ids}&user.fields=username`, {
          headers: {
            'Authorization': `Bearer ${process.env.TWITTER_BEARER_TOKEN}`
          }
        });
        
        if (response.status === 429) {
          // Rate limit hit, wait and retry
          const resetTime = response.headers.get('x-rate-limit-reset');
          const waitTime = resetTime ? (parseInt(resetTime) * 1000) - Date.now() : 900000; // Default to 15 minutes
          console.log(`Rate limit hit, waiting ${waitTime/1000} seconds before retry`);
          await sleep(waitTime);
          retryCount++;
          continue;
        }
        
        if (!response.ok) {
          console.error(`Failed to fetch Twitter users for chunk: ${ids}, status: ${response.status}`);
          // Add failed IDs to map with their original ID as username
          chunk.forEach(id => userMap.set(id, id));
          break;
        }
        
        const data = await response.json();
        if (data.data) {
          data.data.forEach(user => {
            userMap.set(user.id, user.username);
          });
        }
        
        success = true;
        retryCount = 0; // Reset retry count on success
        
        // Check remaining rate limit
        const remaining = response.headers.get('x-rate-limit-remaining');
        if (remaining && parseInt(remaining) < 10) {
          console.log(`Low rate limit remaining: ${remaining}, waiting before next request`);
          await sleep(1000); // Wait 1 second before next request
        }
      } catch (error) {
        console.error(`Error fetching Twitter users: ${error.message}`);
        retryCount++;
        if (retryCount < maxRetries) {
          await sleep(1000 * retryCount); // Exponential backoff
        }
      }
    }
    
    if (!success) {
      console.error(`Failed to fetch Twitter users after ${maxRetries} retries`);
      chunk.forEach(id => userMap.set(id, id));
    }
  }
  
  return userMap;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const contractAddress = process.env.CONTRACT_ADDRESS;
  const treasuryAddress = process.env.TREASURY_ADDRESS;
  
  // Contract ABI for the events we want to check
  const abi = [
    "event MintingFinished(uint32 indexed mintingDayTimestamp, string runningHash)",
    "event MintingFinished_TweetsUploadedToIPFS(uint32 indexed mintingDayTimetsamp, string runningHash, string cid)",
    "event TwitterVerificationResult(string userID, address indexed wallet, bool isSuccess, string errorMsg)",
    "event Transfer(address indexed from, address indexed to, uint256 value)",
    "function totalUsersCount() view returns (uint256)",
    "function userByWallet(address wallet) view returns (string)"
  ];
  
  const contract = new ethers.Contract(contractAddress, abi, provider);
  
  // Get current timestamp and 24 hours ago
  const now = Math.floor(Date.now() / 1000);
  const dayAgo = now - 86400;
  
  // Check MintingFinished event
  const mintingFinishedFilter = contract.filters.MintingFinished();
  const mintingFinishedEvents = await contract.queryFilter(mintingFinishedFilter, dayAgo, now);
  
  // Check MintingFinished_TweetsUploadedToIPFS event
  const tweetsUploadedFilter = contract.filters.MintingFinished_TweetsUploadedToIPFS();
  const tweetsUploadedEvents = await contract.queryFilter(tweetsUploadedFilter, dayAgo, now);
  
  // Get total users count
  const totalUsers = await contract.totalUsersCount();
  
  // Check new users in last 24h
  const verificationFilter = contract.filters.TwitterVerificationResult(null, null, true, "");
  const verificationEvents = await contract.queryFilter(verificationFilter, dayAgo, now);
  
  // Check Transfer events (minting)
  const transferFilter = contract.filters.Transfer(ethers.ZeroAddress);
  const transferEvents = await contract.queryFilter(transferFilter, dayAgo, now);
  
  // Process minting transfers
  const mintingStats = new Map();
  let totalMinted = ethers.parseEther("0");
  
  transferEvents.forEach(event => {
    const to = event.args.to;
    const value = event.args.value;
    
    // Skip treasury transfers
    if (to.toLowerCase() === treasuryAddress.toLowerCase()) {
      return;
    }
    
    // Add to total minted
    totalMinted = totalMinted + value;
    
    // Update wallet stats
    const currentAmount = mintingStats.get(to) || ethers.parseEther("0");
    mintingStats.set(to, currentAmount + value);
  });
  
  // Sort wallets by minted amount
  const sortedWallets = Array.from(mintingStats.entries())
    .sort((a, b) => Number(b[1] - a[1]))
    .slice(0, 10); // Get top 10 wallets
  
  // Get Twitter user IDs for all wallets
  const walletToUserId = new Map();
  const userIds = [];
  
  for (const [wallet] of sortedWallets) {
    try {
      const userId = await contract.userByWallet(wallet);
      walletToUserId.set(wallet, userId);
      userIds.push(userId);
    } catch (error) {
      console.error(`Error fetching Twitter ID for wallet ${wallet}:`, error);
      walletToUserId.set(wallet, 'Unknown');
    }
  }
  
  // Get all usernames in a single batch request
  const userIdToUsername = await getTwitterUsernames(userIds);
  
  // Format minting stats
  const mintingStatsText = sortedWallets
    .map(([wallet, amount], index) => {
      const userId = walletToUserId.get(wallet);
      const username = userIdToUsername.get(userId) || userId;
      return `${index + 1}. @${username} (${wallet}): ${ethers.formatEther(amount)} tokens`;
    })
    .join('\n');
  
  // Format test results
  const testStatus = process.env.TEST_STATUS === '0' ? '✅' : '❌';
  const workflowUrl = process.env.WORKFLOW_URL || '';
  
  // Prepare message
  const message = `
🔍 Daily Smart Contract Check Report

🧪 Test Status: ${testStatus}
${process.env.TEST_STATUS !== '0' ? `🔗 Workflow URL: ${workflowUrl}` : ''}

👥 Total users(+new users per 24h): 
${totalUsers.toString()} (+${verificationEvents.length})

💰 Minting Statistics:
• Total minted: ${ethers.formatEther(totalMinted)} tokens
• Number of minting transfers: ${transferEvents.length}

🏆 Top 10 Users by Minted Amount:
${mintingStatsText}

${mintingFinishedEvents.length === 0 ? '⚠️ Warning: No MintingFinished events in last 24h' : '✅ MintingFinished events found'}
${tweetsUploadedEvents.length === 0 ? '⚠️ Warning: No TweetsUploadedToIPFS events in last 24h' : '✅ TweetsUploadedToIPFS events found'}
  `;
  
  // Send to Telegram
  const telegramUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(telegramUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    })
  });
}

main().catch(console.error); 