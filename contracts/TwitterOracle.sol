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

  event verifyTwitterThirdwebRequested(address wallet, string userID);
  event verifyTwitterByAuthCodeRequested(address wallet, string authCode, string tweetID, string userID);

  function requestTwitterVerificationThirdweb(string calldata userID) public {
    require(mintingData.walletsByUserIDs[userID] == address(0), 'wallet already linked for that user');
    require(mintingData.registeredWallets[_msgSender()] == false, 'wallet already linked for that user');

    emit verifyTwitterThirdwebRequested(_msgSender(), userID);
  }

  function requestTwitterVerificationByAuthCode(
    string calldata authCode,
    string calldata userID,
    string calldata tweetID
  ) public {
    require(mintingData.walletsByUserIDs[userID] == address(0), 'wallet already linked for that user');
    require(mintingData.registeredWallets[_msgSender()] == false, 'wallet already linked for that user');

    emit verifyTwitterByAuthCodeRequested(_msgSender(), authCode, tweetID, userID);
  }

  function requestTwitterVerification(string calldata accessCodeEncrypted, string calldata userID) public {
    require(mintingData.walletsByUserIDs[userID] == address(0), 'wallet already linked for that user');

    emit VerifyTwitterRequested(accessCodeEncrypted, userID, msg.sender);
  }

  function requestTwitterVerificationFromRelayer(
    string calldata userID,
    address wallet,
    bytes calldata signature,
    string calldata accessTokenEncrypted
  ) public onlyServerRelayer {
    address recoveredSigner = ECDSA.recover(
      MessageHashUtils.toEthSignedMessageHash(bytes('I confirm that I want to verify my Twitter account with GMCoin')),
      signature
    );

    require(recoveredSigner != address(0), 'empty signer');
    require(recoveredSigner == wallet, 'wrong signer or signature');
    require(mintingData.walletsByUserIDs[userID] == address(0), 'wallet already linked for that user');
    require(!mintingData.registeredWallets[recoveredSigner], 'wallet already verified and linked to Twitter');

    emit VerifyTwitterRequested(accessTokenEncrypted, userID, recoveredSigner);
  }

  function twitterVerificationError(
    address wallet,
    string calldata userID,
    string calldata errorMsg
  ) public onlyGelato {
    emit TwitterVerificationResult(userID, wallet, false, errorMsg);
  }

  function verifyTwitter(string calldata userID, address wallet, bool isSubscribed) public onlyGelato {
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
}
