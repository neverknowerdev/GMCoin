# GMCoin Farcaster Worker

## Overview

The Farcaster Worker is a Gelato Web3 Function that processes Farcaster casts containing "gm" keywords daily and mints $GM tokens based on user engagement. This worker is built using the proven Twitter worker architecture and integrates with the Neynar API for Farcaster data.

## Architecture

### Core Components

The Farcaster worker follows the same proven architecture as the Twitter worker:

```
farcaster-worker/
├── index.ts              # Main orchestrator (Gelato Web3 Function entry point)
├── farcasterRequester.ts # Neynar API integration and cast fetching
├── batchManager.ts       # FID batch processing and optimization
├── smartContractConnector.ts # Smart contract integration
├── storage.ts            # Web3 Function storage and persistence
├── batchUploader.ts      # Data integrity and IPFS upload
├── consts.ts            # Type definitions and constants
├── schema.json          # Web3 Function configuration schema
└── userArgs.json        # User arguments template
```

### Smart Contract Integration

- **FarcasterOracle.sol**: Core Farcaster verification and minting functions
- **FarcasterOracleLib.sol**: Library containing business logic
- **Storage.sol**: Data structures for Farcaster users and cast processing

## Features

### Cast Processing Rules

Similar to Twitter, the system processes three types of "gm" content:

1. **Simple "gm"**: Base points per cast
2. **"#gm" hashtag**: Higher points, limited to 10/day per user
3. **"$gm" cashtag**: Highest points, limited to 10/day per user

### Engagement Rewards

- **Likes multiplier**: Additional points based on cast likes
- **Recast support**: Future enhancement for recast engagement
- **High-engagement verification**: Casts with 100+ likes get additional verification

### Scaling Features

- **Batch processing**: FIDs processed in batches of 100 (Neynar limit)
- **Concurrency control**: Multiple batches processed in parallel
- **Rate limit compliance**: Respects Neynar API constraints
- **Error handling**: Automatic retry logic for failed batches
- **Storage optimization**: Efficient data management within Web3Function limits

## Daily Operation Flow

1. **Trigger**: Gelato calls `startFarcasterMinting()` daily at 2:00 AM
2. **Batch Creation**: System generates FID batches based on total user count
3. **Cast Fetching**: Parallel Neynar API calls retrieve yesterday's casts
4. **Processing**: Casts analyzed for keywords and engagement
5. **Verification**: High-engagement casts verified (if needed)
6. **Minting**: Smart contract receives processed data and mints tokens
7. **Finalization**: Data uploaded to IPFS, minting cycle completed

## API Integration

### Neynar API

The worker uses the Neynar Feed API to fetch Farcaster casts:

```typescript
// API Endpoint
const NEYNAR_FEED_URL = 'https://api.neynar.com/v2/farcaster/feed/';

// Request Parameters
{
  feed_type: 'filter',
  filter_type: 'fids',
  fids: '969206,3,1234,...', // Up to 100 FIDs per request
  with_recasts: 'true',
  limit: '100',               // Max 100 casts per request
  cursor: 'pagination_token'  // For pagination
}
```

### Rate Limits & Constraints

- **Max FIDs per request**: 100
- **Max casts per response**: 100
- **Pagination**: Cursor-based for large result sets
- **Date filtering**: Client-side filtering for yesterday's casts

## Environment Configuration

### Required Secrets

```bash
# Neynar API Access
NEYNAR_API_KEY=your_neynar_api_key

# Server Integration
SERVER_API_KEY=your_server_api_key

# AWS CloudWatch Logging
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key

# Environment
ENV=local|testnet|mainnet
```

### User Arguments

```json
{
  "contractAddress": "0x...",              // Smart contract address
  "concurrencyLimit": 3,                   // Number of parallel batches
  "serverURLPrefix": "https://api.../",    // Data server URL
  "neynarFeedURL": "https://api.neynar.com/v2/farcaster/feed/"
}
```

## Performance Optimization

### Sub-5 Second Execution

To keep Gelato execution under 5 seconds:

1. **Parallel Processing**: Multiple FID batches processed concurrently
2. **Efficient Filtering**: Client-side "gm" filtering reduces data transfer
3. **Smart Pagination**: Only fetch what's needed for yesterday's casts
4. **Cached Results**: Store intermediate results in Web3Function storage

### Batch Size Optimization

```typescript
// Optimized batch configuration
const MAX_FIDS_PER_BATCH = 100;     // Neynar limit
const CONCURRENCY_LIMIT = 3;         // Parallel batches
const VERIFY_CAST_BATCH_SIZE = 300;  // High-engagement verification
```

## Data Integrity

### Blake2b Hashing

All processed cast data is hashed using Blake2b for integrity verification:

```typescript
function calculateRunningHash(currentHash: string, cast: Cast): string {
  const castString = `${cast.castHash}|${cast.fid}|${cast.castContent}|${cast.likesCount}`;
  const combinedString = currentHash + castString;
  return blake2b(combinedString, null, 32).toString('hex');
}
```

### IPFS Upload

Processed cast data is uploaded to IPFS for public verification:

- **Transparency**: Anyone can verify the processed casts
- **Auditability**: Complete audit trail of daily processing
- **Integrity**: Hash verification ensures data hasn't been tampered with

## Testing & Deployment

### Local Testing

```bash
# Install dependencies
cd web3-functions/farcaster-worker
npm install

# Test locally
npx hardhat w3f-run farcaster-worker --logs
```

### Testnet Deployment

```bash
# Deploy to Base Sepolia
npx hardhat w3f-deploy farcaster-worker --network baseSepolia

# Create Gelato task
npx hardhat run scripts/createFarcasterGelatoTask.ts --network baseSepolia
```

### Mainnet Deployment

```bash
# Deploy to Base Mainnet
npx hardhat w3f-deploy farcaster-worker --network base

# Create production Gelato task
npx hardhat run scripts/createFarcasterGelatoTask.ts --network base
```

## Error Handling & Monitoring

### CloudWatch Integration

All operations are logged to AWS CloudWatch for monitoring:

```typescript
// Log levels
logger.info('Processing batch', batchInfo);
logger.warn('Skipping cast', castDetails);  
logger.error('API error', errorDetails);
```

### Retry Logic

- **Failed batches**: Automatic retry up to 3 times
- **API errors**: Exponential backoff for rate limit errors
- **Network issues**: Robust error handling with fallbacks

### Monitoring Dashboards

- **Daily execution status**: Success/failure rates
- **Performance metrics**: Execution time, cast counts
- **Error tracking**: Failed batches, API issues
- **Cost monitoring**: Gelato execution costs

## Security Considerations

### Access Control

- **Gelato-only execution**: Only Gelato can call minting functions
- **Owner controls**: Emergency functions for owner only
- **Server relay verification**: IPFS uploads require valid API key

### Data Validation

- **FID validation**: All FIDs must exist in registered users
- **Cast verification**: High-engagement casts double-checked
- **Hash integrity**: Running hash prevents data manipulation

## Smart Contract Functions

### Minting Functions

```solidity
// Main minting function called by Gelato
function mintCoinsForFarcasterUsers(
    UserFarcasterData[] calldata userData,
    uint32 mintingDayTimestamp,
    Batch[] calldata batches
) external onlyGelato;

// Start/finish minting cycle
function startFarcasterMinting() external onlyGelato;
function finishFarcasterMinting(uint32 timestamp, string calldata hash) external onlyGelato;

// Error handling
function logFarcasterErrorBatches(uint32 timestamp, Batch[] calldata batches) external onlyGelato;
```

### Query Functions

```solidity
// User queries
function totalFarcasterUsersCount() external view returns (uint256);
function getFarcasterUsers(uint64 start, uint16 count) external view returns (uint256[] memory);
function isFarcasterUserRegistered(uint256 fid) external view returns (bool);

// Wallet-FID mapping
function getWalletByFID(uint256 fid) external view returns (address);
function getFIDByWallet(address wallet) external view returns (uint256);
```

## Development Workflow

### Adding New Features

1. **Update types** in `consts.ts`
2. **Modify processing logic** in main `index.ts`
3. **Update API integration** in `farcasterRequester.ts`
4. **Test thoroughly** with mock data
5. **Deploy to testnet** for integration testing

### Code Structure

```typescript
// Main execution flow in index.ts
async function executeFarcasterWorker(logger, context) {
  // 1. Initialize components
  // 2. Generate batches  
  // 3. Process casts
  // 4. Handle verification
  // 5. Submit to contract
  // 6. Upload to IPFS
}

// Cast processing logic
function calculateCastByKeyword(result, likesCount, keyword) {
  // Apply same rules as Twitter worker
  // Simple/hashtag/cashtag processing
}
```

## Future Enhancements

### Planned Features

1. **Channel-specific rewards**: Different points for different channels
2. **Recast multipliers**: Reward viral content
3. **Time-based bonuses**: Early morning posts get bonus points
4. **Community features**: Guild/community-based rewards
5. **Cross-platform integration**: Unified user rewards across Twitter + Farcaster

### API Improvements

1. **Direct Farcaster Hub integration**: Reduce dependency on Neynar
2. **WebSocket subscriptions**: Real-time cast processing
3. **Advanced filtering**: Server-side "gm" filtering
4. **Batch optimization**: Dynamic batch sizing based on activity

## Troubleshooting

### Common Issues

1. **Neynar API errors**: Check API key and rate limits
2. **Timeout issues**: Reduce concurrency or batch size
3. **Storage errors**: Clear old data if storage is full
4. **Hash mismatches**: Verify cast processing order

### Debug Commands

```bash
# Check Web3Function logs
npx hardhat w3f-logs farcaster-worker

# Verify contract state  
npx hardhat run scripts/checkFarcasterState.ts

# Test API integration
npx hardhat run scripts/testNeynarAPI.ts
```

## Support & Maintenance

For questions or issues:

1. **GitHub Issues**: Report bugs and feature requests
2. **Discord**: Real-time support and discussion
3. **Documentation**: Check latest docs for updates
4. **Contract Verification**: Use Etherscan for contract verification

---

**Built with ❤️ for the GM community** 🌅