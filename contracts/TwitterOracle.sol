// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import '@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol';

import 'hardhat/console.sol';
import { GMStorage } from './Storage.sol';
import { GMWeb3Functions } from './GelatoWeb3Functions.sol';

contract GMTwitterOracle is GMStorage, Initializable, GMWeb3Functions {
  modifier onlyGelato() {
    require(_msgSender() == gelatoConfig.gelatoAddress, 'only Gelato can call this function');
    _;
  }

  modifier onlyGelatoOrOwner() {
    require(
      _msgSender() == gelatoConfig.gelatoAddress || _msgSender() == owner(),
      'only Gelato or owner can call this function'
    );
    _;
  }

  modifier onlyServerRelayer() {
    require(_msgSender() == serverRelayerAddress, 'only relay server can call this function');
    _;
  }

  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
  }

  function isTwitterUserRegistered(string calldata userID) public view returns (bool) {
    return mintingData.registeredWallets[mintingData.walletsByUserIDs[userID]];
  }

  function isWalletRegistered(address wallet) public view returns (bool) {
    return mintingData.registeredWallets[wallet];
  }

  function getWalletByUserID(string calldata username) public view returns (address) {
    return walletByTwitterUser(username);
  }

  function walletByTwitterUser(string calldata username) internal view returns (address) {
    return mintingData.walletsByUserIDs[username];
  }

  function userByWallet(address wallet) public view returns (string memory) {
    //        require(_msgSender() == wallet, "only wallet owner could call this function");

    return mintingData.usersByWallets[wallet];
  }

  function walletByTwitterUserIndex(uint256 userIndex) internal view returns (address) {
    return mintingData.walletsByUserIDs[mintingData.allTwitterUsers[userIndex]];
  }

  function getTwitterUsers(uint64 start, uint16 count) public view returns (string[] memory) {
    uint64 end = start + count;
    if (end > mintingData.allTwitterUsers.length) {
      end = uint64(mintingData.allTwitterUsers.length);
    }

    require(start <= end, 'wrong start index');

    uint16 batchSize = uint16(end - start);
    string[] memory batchArr = new string[](batchSize);
    for (uint16 i = 0; i < batchSize; i++) {
      batchArr[i] = mintingData.allTwitterUsers[start + i];
    }

    return batchArr;
  }

  function getTwitterUsersByIndexes(uint64[] calldata indexes) public view returns (string[] memory) {
    string[] memory batchArr = new string[](indexes.length);
    for (uint16 i = 0; i < indexes.length; i++) {
      batchArr[i] = mintingData.allTwitterUsers[i];
    }

    return batchArr;
  }

  event VerifyTwitterRequested(string accessCodeEncrypted, string userID, address indexed wallet);
  event TwitterVerificationResult(string userID, address indexed wallet, bool isSuccess, string errorMsg);

  event verifyTwitterByAuthCodeRequested(address wallet, string authCode, string tweetID, string userID);

  // Farcaster events
  event VerifyFarcasterRequested(uint256 indexed farcasterFid, address indexed wallet);
  event FarcasterVerificationResult(
    uint256 indexed farcasterFid,
    address indexed wallet,
    bool isSuccess,
    string errorMsg
  );
  event farcasterMintingProcessed(uint32 indexed mintingDayTimestamp, Batch[] batches);

  function requestTwitterVerificationByAuthCode(
    string calldata authCode,
    string calldata userID,
    string calldata tweetID
  ) public {
    require(mintingData.walletsByUserIDs[userID] == address(0), 'user has different wallet linked');
    require(mintingData.registeredWallets[_msgSender()] == false, 'wallet already linked for that user');

    emit verifyTwitterByAuthCodeRequested(_msgSender(), authCode, tweetID, userID);
  }

  function requestTwitterVerification(string calldata accessCodeEncrypted, string calldata userID) public {
    require(mintingData.walletsByUserIDs[userID] == address(0), 'wallet already linked for that user');

    emit VerifyTwitterRequested(accessCodeEncrypted, userID, _msgSender());
  }

  //    function requestTwitterVerificationFromRelayer(
  //        string calldata userID,
  //        address wallet,
  //        bytes calldata signature,
  //        string calldata accessTokenEncrypted
  //    ) public onlyServerRelayer {
  //        address recoveredSigner = ECDSA.recover(
  //            MessageHashUtils.toEthSignedMessageHash(bytes('I confirm that I want to verify my Twitter account with GMCoin')),
  //            signature
  //        );
  //
  //        require(recoveredSigner != address(0), 'empty signer');
  //        require(recoveredSigner == wallet, 'wrong signer or signature');
  //        require(mintingData.walletsByUserIDs[userID] == address(0), 'wallet already linked for that user');
  //        require(!mintingData.registeredWallets[recoveredSigner], 'wallet already verified and linked to Twitter');
  //
  //        emit VerifyTwitterRequested(accessTokenEncrypted, userID, recoveredSigner);
  //    }

  function twitterVerificationError(
    address wallet,
    string calldata userID,
    string calldata errorMsg
  ) public onlyGelato {
    emit TwitterVerificationResult(userID, wallet, false, errorMsg);
  }

  function verifyTwitter(string calldata userID, address wallet) public onlyGelato {
    mintingData.usersByWallets[wallet] = userID;
    mintingData.registeredWallets[wallet] = true;

    if (mintingData.walletsByUserIDs[userID] == address(0)) {
      mintingData.walletsByUserIDs[userID] = wallet;
      mintingData.allTwitterUsers.push(userID);
      mintingData.userIndexByUserID[userID] = mintingData.allTwitterUsers.length - 1;

      _mintForUserByIndex(
        mintingData.allTwitterUsers.length - 1,
        mintingConfig.COINS_MULTIPLICATOR * mintingConfig.POINTS_PER_TWEET
      ); // mint welcome coins

      emit TwitterVerificationResult(userID, wallet, true, '');
    }
  }

  // Farcaster verification functions

  function requestFarcasterVerification(uint256 farcasterFid) public {
    require(mintingData.farcasterWalletsByFIDs[farcasterFid] == address(0), 'Farcaster account already linked');
    require(mintingData.farcasterUsersByWallets[_msgSender()] == 0, 'wallet already linked to FID');

    emit VerifyFarcasterRequested(farcasterFid, _msgSender());
  }

  function verifyFarcaster(uint256 farcasterFid, address wallet) public onlyGelato {
    mintingData.farcasterUsersByWallets[wallet] = farcasterFid;
    mintingData.registeredWallets[wallet] = true;

    if (mintingData.farcasterWalletsByFIDs[farcasterFid] == address(0)) {
      mintingData.farcasterWalletsByFIDs[farcasterFid] = wallet;
      mintingData.allFarcasterUsers.push(farcasterFid);
      mintingData.farcasterUserIndexByFID[farcasterFid] = mintingData.allFarcasterUsers.length - 1;

      // Welcome tokens for Farcaster users
      _mintForFarcasterUserByIndex(
        mintingData.allFarcasterUsers.length - 1,
        mintingConfig.COINS_MULTIPLICATOR * mintingConfig.POINTS_PER_TWEET
      );

      emit FarcasterVerificationResult(farcasterFid, wallet, true, '');
    }
  }

  function farcasterVerificationError(
    address wallet,
    uint256 farcasterFid,
    string calldata errorMsg
  ) public onlyGelato {
    emit FarcasterVerificationResult(farcasterFid, wallet, false, errorMsg);
  }

  // Farcaster query functions

  function isFarcasterUserRegistered(uint256 farcasterFid) public view returns (bool) {
    return mintingData.registeredWallets[mintingData.farcasterWalletsByFIDs[farcasterFid]];
  }

  function getWalletByFID(uint256 farcasterFid) public view returns (address) {
    return mintingData.farcasterWalletsByFIDs[farcasterFid];
  }

  function getFIDByWallet(address wallet) public view returns (uint256) {
    return mintingData.farcasterUsersByWallets[wallet];
  }

  function getFarcasterUsers(uint64 start, uint16 count) public view returns (uint256[] memory) {
    uint64 end = start + count;
    if (end > mintingData.allFarcasterUsers.length) {
      end = uint64(mintingData.allFarcasterUsers.length);
    }

    require(start <= end, 'wrong start index');

    uint16 batchSize = uint16(end - start);
    uint256[] memory batchArr = new uint256[](batchSize);
    for (uint16 i = 0; i < batchSize; i++) {
      batchArr[i] = mintingData.allFarcasterUsers[start + i];
    }

    return batchArr;
  }

  function walletByFarcasterUserIndex(uint256 userIndex) internal view returns (address) {
    return mintingData.farcasterWalletsByFIDs[mintingData.allFarcasterUsers[userIndex]];
  }

  event twitterMintingProcessed(uint32 indexed mintingDayTimestamp, Batch[] batches);
  event twitterMintingErrored(uint32 indexed mintingDayTimestamp, Batch[] errorBatches);
  event MintingStarted(uint32 indexed mintingDay);
  event MintingFinished(uint32 indexed mintingDayTimestamp, string runningHash);
  event MintingFinished_TweetsUploadedToIPFS(uint32 indexed mintingDayTimetsamp, string runningHash, string cid);

  event changedComplexity(uint256 newMultiplicator, uint256 previousEpochPoints, uint256 currentEpochPoints);

  function startMinting() public onlyGelatoOrOwner {
    uint32 yesterday = getStartOfYesterday();
    uint32 dayToMint = mintingData.lastMintedDay + 1 days;

    // if minting for previous day is not finished - continue it
    if (mintingData.mintingInProgressForDay > 0 && mintingData.mintingInProgressForDay < yesterday) {
      emit twitterMintingProcessed(mintingData.mintingInProgressForDay, emptyArray);
      emit farcasterMintingProcessed(mintingData.mintingInProgressForDay, emptyArray); // Also continue Farcaster
      return;
    }

    require(dayToMint <= yesterday, 'dayToMint should be not further than yesterday');
    require(mintingData.mintingInProgressForDay == 0, 'minting process already started');

    mintingData.mintingInProgressForDay = dayToMint;

    // complexity calculation
    // start new epoch
    if (
      dayToMint > mintingData.epochStartedAt &&
      dayToMint - mintingData.epochStartedAt >= mintingConfig.EPOCH_DAYS * 1 days
    ) {
      pointsDeltaStreak = adjustPointsStreak(
        mintingData.lastEpochPoints,
        mintingData.currentEpochPoints,
        pointsDeltaStreak
      );
      mintingConfig.COINS_MULTIPLICATOR = changeComplexity(
        mintingConfig.COINS_MULTIPLICATOR,
        mintingData.lastEpochPoints,
        mintingData.currentEpochPoints,
        pointsDeltaStreak
      );

      emit changedComplexity(
        mintingConfig.COINS_MULTIPLICATOR,
        mintingData.lastEpochPoints,
        mintingData.currentEpochPoints
      );

      mintingData.epochStartedAt = dayToMint;
      totalPoints += mintingData.currentEpochPoints;
      mintingConfig.epochNumber++;
      mintingData.lastEpochPoints = mintingData.currentEpochPoints;
      mintingData.currentEpochPoints = 0;
    }

    emit MintingStarted(dayToMint);

    emit twitterMintingProcessed(dayToMint, emptyArray);
    emit farcasterMintingProcessed(dayToMint, emptyArray); // Also trigger Farcaster processing
  }

  // manual calling continue minting for a day if there was any unexpected error
  function continueMintingForADay() public onlyOwner {
    require(mintingData.mintingInProgressForDay != 0, 'not found any in progress minting days');

    emit twitterMintingProcessed(mintingData.mintingInProgressForDay, emptyArray);
  }

  function finishMinting(uint32 mintingDayTimestamp, string calldata runningHash) public onlyGelato {
    require(mintingDayTimestamp == mintingData.mintingInProgressForDay, 'wrong mintingDay');
    require(mintingData.lastMintedDay < mintingDayTimestamp, 'wrong mintingDayTimestamp');

    mintingData.currentEpochPoints += mintingData.mintingDayPointsFromUsers;
    mintingData.lastMintedDay = mintingDayTimestamp;

    mintingData.mintingDayPointsFromUsers = 0;
    mintingData.mintingInProgressForDay = 0;

    emit MintingFinished(mintingDayTimestamp, runningHash);

    uint32 yesterday = getStartOfYesterday();
    if (mintingData.lastMintedDay < yesterday) {
      startMinting();
    }
  }

  function attachIPFSTweetsFile(
    uint32 mintingDayTimestamp,
    string calldata finalHash,
    string calldata cid
  ) public onlyServerRelayer {
    emit MintingFinished_TweetsUploadedToIPFS(mintingDayTimestamp, finalHash, cid);
  }

  // to be defined in main contract
  function _mintForUserByIndex(uint256 userIndex, uint256 amount) internal virtual {}

  function logErrorBatches(uint32 mintingDayTimestamp, Batch[] calldata batches) public onlyGelato {
    emit twitterMintingErrored(mintingDayTimestamp, batches);
  }

  function mintCoinsForTwitterUsers(
    UserTwitterData[] calldata userData,
    uint32 mintingDayTimestamp,
    Batch[] calldata batches
  ) public onlyGelato {
    require(mintingData.mintingInProgressForDay != 0, 'no ongoing minting process');
    require(mintingDayTimestamp == mintingData.mintingInProgressForDay, 'wrong mintingDay');

    for (uint256 i = 0; i < userData.length; i++) {
      if (userData[i].userIndex > mintingData.allTwitterUsers.length) {
        revert('wrong userIndex');
      }

      uint256 points = userData[i].simpleTweets *
        mintingConfig.POINTS_PER_TWEET +
        userData[i].likes *
        mintingConfig.POINTS_PER_LIKE +
        userData[i].hashtagTweets *
        mintingConfig.POINTS_PER_HASHTAG +
        userData[i].cashtagTweets *
        mintingConfig.POINTS_PER_CASHTAG;

      if (points == 0) {
        continue;
      }

      //            console.log('userIndex', userData[i].userIndex, points);
      mintingData.mintingDayPointsFromUsers += points;

      uint256 coins = points * mintingConfig.COINS_MULTIPLICATOR;

      _mintForUserByIndex(userData[i].userIndex, coins);
    }

    if (batches.length > 0) {
      emit twitterMintingProcessed(mintingDayTimestamp, batches);
    }
  }

  // Farcaster minting functions

  // to be defined in main contract (similar to _mintForUserByIndex)
  function _mintForFarcasterUserByIndex(uint256 userIndex, uint256 amount) internal virtual {}

  function mintCoinsForFarcasterUsers(
    UserFarcasterData[] calldata userData,
    uint32 mintingDayTimestamp,
    Batch[] calldata batches
  ) public onlyGelato {
    require(mintingData.mintingInProgressForDay != 0, 'no ongoing minting process');
    require(mintingDayTimestamp == mintingData.mintingInProgressForDay, 'wrong mintingDay');

    for (uint256 i = 0; i < userData.length; i++) {
      if (userData[i].userIndex > mintingData.allFarcasterUsers.length) {
        revert('wrong userIndex');
      }

      uint256 points = userData[i].simpleCasts *
        mintingConfig.POINTS_PER_TWEET +
        userData[i].likes *
        mintingConfig.POINTS_PER_LIKE +
        userData[i].hashtagCasts *
        mintingConfig.POINTS_PER_HASHTAG +
        userData[i].cashtagCasts *
        mintingConfig.POINTS_PER_CASHTAG;

      if (points == 0) {
        continue;
      }

      mintingData.mintingDayPointsFromUsers += points;
      uint256 coins = points * mintingConfig.COINS_MULTIPLICATOR;
      _mintForFarcasterUserByIndex(userData[i].userIndex, coins);
    }

    if (batches.length > 0) {
      emit farcasterMintingProcessed(mintingDayTimestamp, batches);
    }
  }

  function getStartOfYesterday() public view returns (uint32) {
    // Calculate the start of today (midnight) by rounding down block.timestamp to the nearest day.
    uint32 startOfToday = uint32((block.timestamp / 1 days) * 1 days);
    // Subtract one day to get the start of yesterday.
    return startOfToday - 1 days;
  }

  function changeComplexity(
    uint256 currentComplexity,
    uint256 lastEpochPoints,
    uint256 currentEpochPoints,
    int32 epochPointsDeltaStreak
  ) internal pure returns (uint256) {
    if (lastEpochPoints == 0) {
      return currentComplexity;
    }

    if (currentEpochPoints > lastEpochPoints) {
      // minus 30%
      return (currentComplexity * 70) / 100;
    }

    if (currentEpochPoints <= lastEpochPoints) {
      if (epochPointsDeltaStreak <= -3) {
        // plus 30%
        return (currentComplexity * 130) / 100;
      } else if (epochPointsDeltaStreak == -2) {
        // plus 20%
        return (currentComplexity * 120) / 100;
      } else {
        return currentComplexity;
      }
    }

    return currentComplexity;
  }

  function adjustPointsStreak(
    uint256 lastEpochPoints,
    uint256 currentEpochPoints,
    int32 currentPointsDeltaStreak
  ) internal pure returns (int32) {
    if (currentEpochPoints > lastEpochPoints && currentPointsDeltaStreak <= 0) {
      return 1;
    }
    if (currentEpochPoints < lastEpochPoints && currentPointsDeltaStreak >= 0) {
      return -1;
    }

    if (currentEpochPoints > lastEpochPoints) {
      return currentPointsDeltaStreak + 1;
    } else if (currentEpochPoints < lastEpochPoints) {
      return currentPointsDeltaStreak - 1;
    }

    return currentPointsDeltaStreak;
  }

  function removeMe() public {
    require(mintingData.mintingInProgressForDay == 0, 'cannot remove user while active workers, try later');

    address wallet = _msgSender();
    require(mintingData.registeredWallets[wallet], "msgSender's wallet is not registered");

    if (mintingData.registeredWallets[wallet]) {
      string memory userID = mintingData.usersByWallets[wallet];
      uint userIndex = mintingData.userIndexByUserID[userID];
      delete mintingData.registeredWallets[wallet];
      delete mintingData.walletsByUserIDs[userID];
      delete mintingData.usersByWallets[wallet];

      // remove from array
      string memory lastIndexUserID = mintingData.allTwitterUsers[mintingData.allTwitterUsers.length - 1];
      mintingData.allTwitterUsers[userIndex] = lastIndexUserID;
      mintingData.allTwitterUsers.pop();

      mintingData.userIndexByUserID[lastIndexUserID] = userIndex;
    }
  }

  function removeUserByUserId(string memory userID) internal {
    uint userIndex = mintingData.userIndexByUserID[userID];
    address wallet = mintingData.walletsByUserIDs[userID];

    delete mintingData.registeredWallets[wallet];
    delete mintingData.walletsByUserIDs[userID];
    delete mintingData.usersByWallets[wallet];

    // remove from array
    string memory lastIndexUserID = mintingData.allTwitterUsers[mintingData.allTwitterUsers.length - 1];
    mintingData.allTwitterUsers[userIndex] = lastIndexUserID;
    mintingData.allTwitterUsers.pop();

    mintingData.userIndexByUserID[lastIndexUserID] = userIndex;
  }

  // =============================================================================
  // NEW: Unified User System Functions
  // =============================================================================

  event UnifiedUserCreated(uint256 indexed userId, address indexed primaryWallet, string twitterId, uint256 farcasterFid);
  event UnifiedSocialAccountLinked(uint256 indexed userId, string platform, string platformId);
  event UnifiedWalletLinked(uint256 indexed userId, address indexed wallet);
  event UnifiedHumanVerificationUpdated(uint256 indexed userId, bool isVerified);

  /**
   * @dev Enable the unified user system (owner only)
   */
  function enableUnifiedUserSystem() public onlyOwner {
    mintingData.unifiedUserSystemEnabled = true;
  }

  /**
   * @dev Disable the unified user system (owner only)
   */
  function disableUnifiedUserSystem() public onlyOwner {
    mintingData.unifiedUserSystemEnabled = false;
  }

  /**
   * @dev Create a new unified user or link to existing user during verification
   */
  function _createOrLinkUnifiedUser(
    address wallet,
    string memory twitterId,
    uint256 farcasterFid
  ) internal returns (uint256) {
    if (!mintingData.unifiedUserSystemEnabled) {
      return 0; // Feature disabled, use legacy system
    }

    uint256 existingUserId = mintingData.walletToUnifiedUserId[wallet];
    
    if (existingUserId != 0) {
      // User already exists - link social account
      return _linkSocialAccountToUser(existingUserId, twitterId, farcasterFid);
    } else {
      // Create new user
      return _createNewUnifiedUser(wallet, twitterId, farcasterFid);
    }
  }

  /**
   * @dev Create a new unified user
   */
  function _createNewUnifiedUser(
    address primaryWallet,
    string memory twitterId,
    uint256 farcasterFid
  ) internal returns (uint256) {
    mintingData.nextUserId++;
    uint256 userId = mintingData.nextUserId;

    UnifiedUser storage user = mintingData.unifiedUsers[userId];
    user.userId = userId;
    user.primaryWallet = primaryWallet;
    user.isHumanVerified = true; // New users are human verified
    user.createdAt = uint32(block.timestamp);
    user.twitterId = twitterId;
    user.farcasterFid = farcasterFid;

    // Set up mappings
    mintingData.allUnifiedUsers.push(userId);
    mintingData.walletToUnifiedUserId[primaryWallet] = userId;
    mintingData.unifiedUserWallets[userId].push(primaryWallet);

    // Set up social platform mappings
    if (bytes(twitterId).length > 0) {
      mintingData.twitterIdToUnifiedUserId[twitterId] = userId;
    }
    if (farcasterFid != 0) {
      mintingData.farcasterFidToUnifiedUserId[farcasterFid] = userId;
    }

    emit UnifiedUserCreated(userId, primaryWallet, twitterId, farcasterFid);
    return userId;
  }

  /**
   * @dev Link social account to existing user
   */
  function _linkSocialAccountToUser(
    uint256 userId,
    string memory twitterId,
    uint256 farcasterFid
  ) internal returns (uint256) {
    UnifiedUser storage user = mintingData.unifiedUsers[userId];
    
    // Link Twitter if provided and not already linked
    if (bytes(twitterId).length > 0 && bytes(user.twitterId).length == 0) {
      require(mintingData.twitterIdToUnifiedUserId[twitterId] == 0, "Twitter ID already linked to another user");
      user.twitterId = twitterId;
      mintingData.twitterIdToUnifiedUserId[twitterId] = userId;
      emit UnifiedSocialAccountLinked(userId, "twitter", twitterId);
    }
    
    // Link Farcaster if provided and not already linked
    if (farcasterFid != 0 && user.farcasterFid == 0) {
      require(mintingData.farcasterFidToUnifiedUserId[farcasterFid] == 0, "Farcaster FID already linked to another user");
      user.farcasterFid = farcasterFid;
      mintingData.farcasterFidToUnifiedUserId[farcasterFid] = userId;
      emit UnifiedSocialAccountLinked(userId, "farcaster", "");
    }

    return userId;
  }

  /**
   * @dev Enhanced verification that creates unified users
   */
  function verifyTwitterUnified(string calldata userID, address wallet) public virtual onlyGelato {
    // Always run legacy verification first
    verifyTwitter(userID, wallet);
    
    // Then create/link unified user if system is enabled
    if (mintingData.unifiedUserSystemEnabled) {
      _createOrLinkUnifiedUser(wallet, userID, 0);
    }
  }

  /**
   * @dev Enhanced Farcaster verification that creates unified users
   */
  function verifyFarcasterUnified(uint256 farcasterFid, address wallet) public virtual onlyGelato {
    // Always run legacy verification first
    verifyFarcaster(farcasterFid, wallet);
    
    // Then create/link unified user if system is enabled
    if (mintingData.unifiedUserSystemEnabled) {
      _createOrLinkUnifiedUser(wallet, "", farcasterFid);
    }
  }

  /**
   * @dev Link additional wallet to unified user
   */
  function linkAdditionalWallet(address newWallet, bytes calldata signature) public {
    require(mintingData.unifiedUserSystemEnabled, "Unified user system not enabled");
    
    // Verify signature proves control of new wallet
    address recoveredSigner = ECDSA.recover(
      MessageHashUtils.toEthSignedMessageHash(bytes('I want to link this wallet to my GMCoin account')),
      signature
    );
    require(recoveredSigner == newWallet, 'Invalid signature for new wallet');
    require(!mintingData.registeredWallets[newWallet], 'Wallet already registered');
    require(mintingData.walletToUnifiedUserId[newWallet] == 0, 'Wallet already linked to a user');

    uint256 userId = mintingData.walletToUnifiedUserId[_msgSender()];
    require(userId != 0, 'Caller wallet not registered to any user');

    // Link new wallet to user
    mintingData.walletToUnifiedUserId[newWallet] = userId;
    mintingData.unifiedUserWallets[userId].push(newWallet);
    mintingData.registeredWallets[newWallet] = true;

    emit UnifiedWalletLinked(userId, newWallet);
  }

  /**
   * @dev Set human verification status for unified user
   */
  function setUnifiedUserHumanVerification(uint256 userId, bool isVerified) public onlyOwner {
    require(mintingData.unifiedUserSystemEnabled, "Unified user system not enabled");
    require(mintingData.unifiedUsers[userId].userId != 0, 'User does not exist');
    
    mintingData.unifiedUsers[userId].isHumanVerified = isVerified;
    
    // Update registration status for all user wallets
    address[] memory wallets = mintingData.unifiedUserWallets[userId];
    for (uint256 i = 0; i < wallets.length; i++) {
      mintingData.registeredWallets[wallets[i]] = isVerified;
    }

    emit UnifiedHumanVerificationUpdated(userId, isVerified);
  }

  /**
   * @dev Get wallet address for unified user (for minting) - Essential function only
   */
  function walletByUnifiedUserIndex(uint256 userIndex) internal view returns (address) {
    if (!mintingData.unifiedUserSystemEnabled || userIndex >= mintingData.allUnifiedUsers.length) {
      return address(0);
    }
    uint256 userId = mintingData.allUnifiedUsers[userIndex];
    return mintingData.unifiedUsers[userId].primaryWallet;
  }
}
