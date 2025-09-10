// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

contract GMStorage {
  uint256 __unused;
  address constant gelatoAutomateTaskCreator = 0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0;

  address public serverRelayerAddress;

  Batch[] emptyArray;

  TimeLockConfig public timeLockConfig;
  FeeConfig public feeConfig;

  /// @custom:oz-retyped-from GMStorageV1.GelatoConfig
  GelatoConfig public gelatoConfig;
  MintingConfig public mintingConfig;

  /// @custom:oz-retyped-from GMStorageV1.MintingData
  MintingData internal mintingData;

  // -3 - negative points delta 3 weeks in a row, 3 - positive points delta 3 weeks in a row
  int32 public pointsDeltaStreak;
  uint256 public totalPoints;

  address accountManager;

  uint256[252] __gap;

  struct UserMintingData {
    uint64 userIndex;
    uint16 posts;
    uint16 hashtagPosts;
    uint16 cashtagPosts;
    uint16 simplePosts;
    uint32 likes;
  }

  // Minting result data
  struct UserMintingResult {
    uint64 userIndex;
    uint256 mintAmount;
  }

  struct Batch {
    uint64 startIndex;
    uint64 endIndex;
    string nextCursor;
    uint8 errorCount;
  }

  struct TimeLockConfig {
    address plannedNewImplementation;
    uint256 plannedNewImplementationTime;
    uint256[10] __gap;
  }

  struct FeeConfig {
    uint256 feePercentage; // 1% fee of transaction goes to the team for maintenance
    uint256 treasuryPercentage; // 10% of minted tokens goes to Treasury that locks fund for 3 months
    address feeAddress;
    address treasuryAddress;
    uint256[55] __gap;
  }

  struct GelatoConfig {
    address gelatoAddress;
    bytes32 gelatoTaskId_twitterVerification;
    bytes32 gelatoTaskId_twitterWorker;
    bytes32 gelatoTaskId_dailyTrigger;
    address trustedSigner;
    bytes32 _not_used_gelatoTaskId_twitterVerificationThirdweb;
    bytes32 gelatoTaskId_twitterVerificationAuthcode;
    // Farcaster Gelato tasks
    bytes32 gelatoTaskId_farcasterVerification;
    bytes32 gelatoTaskId_farcasterWorker;
    uint256[51] __gap;
  }

  struct MintingConfig {
    uint256 COINS_MULTIPLICATOR;
    uint EPOCH_DAYS;
    uint256 POINTS_PER_TWEET;
    uint256 POINTS_PER_LIKE;
    uint256 POINTS_PER_HASHTAG;
    uint256 POINTS_PER_CASHTAG;
    uint32 epochNumber;
    uint256[55] __gap;
  }

  // @custom:storage-location
  struct MintingData {
    // Deprecated placeholder to maintain storage layout (slot 0)
    mapping(string => address) __deprecated_wallets; // Previously `wallets`
    //
    string[] allTwitterUsers;
    mapping(address => string) twitterIdByWallet;
    mapping(string => address) walletByTwitterID;
    //
    mapping(address => bool) registeredWallets;
    mapping(string => uint) userIndexByTwitterId;
    uint256 mintingDayPointsFromUsers;
    uint32 mintingInProgressForDay;
    uint32 lastMintedDay;
    uint32 epochStartedAt;
    uint256 lastEpochPoints;
    uint256 currentEpochPoints;
    // deprecated vars - these MUST stay in the exact V1 positions
    bytes32 __deprecated_gelatoTaskId_twitterVerification;
    bytes32 __deprecated_gelatoTaskId_twitterWorker;
    bytes32 __deprecated_gelatoTaskId_dailyTrigger;
    address __deprecated_trustedSigner;
    // NEW: fields added after V1 (consuming gap space)
    mapping(address => uint256) mintedAmountByWallet;
    // Farcaster mappings
    uint256[] allFarcasterUsers; // All Farcaster FIDs
    mapping(uint256 => uint) farcasterUserIndexByFID; // FID -> array index
    mapping(uint256 => address) walletByFarcasterFID;
    // NEW: Unified User Structure (using gap space)

    bool unifiedUserSystemEnabled; // Feature flag for unified system
    bool isTwitterMintingFinished;
    bool isFarcasterMintingFinished;
    uint256[50] __gap; // Gap: V1 had 55, adjusted to maintain exact struct size
  }

  function COINS_MULTIPLICATOR() public view returns (uint256) {
    return mintingConfig.COINS_MULTIPLICATOR;
  }

  function POINTS_PER_TWEET() public view returns (uint256) {
    return mintingConfig.POINTS_PER_TWEET;
  }

  function POINTS_PER_LIKE() public view returns (uint256) {
    return mintingConfig.POINTS_PER_LIKE;
  }

  function POINTS_PER_HASHTAG() public view returns (uint256) {
    return mintingConfig.POINTS_PER_HASHTAG;
  }

  function POINTS_PER_CASHTAG() public view returns (uint256) {
    return mintingConfig.POINTS_PER_CASHTAG;
  }

  function EPOCH_DAYS() public view returns (uint256) {
    return mintingConfig.EPOCH_DAYS;
  }

  function gelatoTaskId_twitterVerification() public view returns (bytes32) {
    return gelatoConfig.gelatoTaskId_twitterVerification;
  }

  function gelatoTaskId_twitterWorker() public view returns (bytes32) {
    return gelatoConfig.gelatoTaskId_twitterWorker;
  }

  function gelatoTaskId_dailyTrigger() public view returns (bytes32) {
    return gelatoConfig.gelatoTaskId_dailyTrigger;
  }

  function epochStartedAt() public view returns (uint32) {
    return mintingData.epochStartedAt;
  }

  function currentEpochPoints() public view returns (uint256) {
    return mintingData.currentEpochPoints;
  }

  function lastEpochPoints() public view returns (uint256) {
    return mintingData.lastEpochPoints;
  }

  function totalUsersCount() public view returns (uint256) {
    return mintingData.allTwitterUsers.length;
  }

  // Farcaster accessor functions
  function gelatoTaskId_farcasterVerification() public view returns (bytes32) {
    return gelatoConfig.gelatoTaskId_farcasterVerification;
  }

  function gelatoTaskId_farcasterWorker() public view returns (bytes32) {
    return gelatoConfig.gelatoTaskId_farcasterWorker;
  }

  function twitterUserExist(string memory twitterId) public view returns (bool) {
    return mintingData.userIndexByTwitterId[twitterId] != 0;
  }

  function farcasterUserExist(uint256 farcasterFid) public view returns (bool) {
    return mintingData.farcasterUserIndexByFID[farcasterFid] != 0;
  }

  function isActiveMintingProcess() public view returns (bool) {
    return mintingData.mintingInProgressForDay != 0;
  }

  // totalFarcasterUsersCount moved to FarcasterOracle

  // =============================================================================
  // NEW: Unified User System Functions
  // =============================================================================

  // Unified user functions moved to AccountManager
}
