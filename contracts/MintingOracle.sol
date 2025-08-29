// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import { GMStorage } from './Storage.sol';
import { GMWeb3Functions } from './GelatoWeb3Functions.sol';
import { MintingLib } from './MintingLib.sol';
import './Errors.sol';

abstract contract MintingOracle is GMStorage {
  using MintingLib for GMStorage.MintingData;

  // Access control - to be inherited from main contract
  function msgSender() internal view virtual returns (address);

  modifier _onlyOwner() virtual {
    _;
  }

  // Modifiers - to be inherited from main contract
  modifier onlyGelato() virtual {
    _;
  }

  modifier onlyServerRelayer() virtual {
    _;
  }

  modifier onlyGelatoOrOwner() virtual {
    _;
  }

  // Twitter events
  event VerifyTwitterRequested(string accessCodeEncrypted, string userID, address indexed wallet);
  event TwitterVerificationResult(string userID, address indexed wallet, bool isSuccess, string errorMsg);
  event verifyTwitterByAuthCodeRequested(address wallet, string authCode, string tweetID, string userID);

  event twitterMintingProcessed(uint32 indexed mintingDayTimestamp, GMStorage.Batch[] batches);
  event twitterMintingErrored(uint32 indexed mintingDayTimestamp, GMStorage.Batch[] errorBatches);

  event MintingStarted(uint32 indexed mintingDay);

  event MintingFinishedTwitter(uint32 indexed mintingDayTimestamp, string runningHash);
  event MintingFinishedFarcaster(uint32 indexed mintingDayTimestamp, string runningHash);
  event MintingFinished(uint32 indexed mintingDayTimestamp);

  event MintingFinished_TweetsUploadedToIPFS(uint32 indexed mintingDayTimetsamp, string runningHash, string cid);
  event MintingFinished_CastsUploadedToIPFS(uint32 indexed mintingDayTimestamp, string runningHash, string cid);

  event changedComplexity(uint256 newMultiplicator, uint256 previousEpochPoints, uint256 currentEpochPoints);

  event farcasterMintingProcessed(uint32 indexed mintingDayTimestamp, GMStorage.Batch[] batches);
  event farcasterMintingErrored(uint32 indexed mintingDayTimestamp, GMStorage.Batch[] errorBatches);

  // Twitter verification functions

  function requestTwitterVerificationByAuthCode(
    string calldata authCode,
    string calldata userID,
    string calldata tweetID
  ) public {
    if (mintingData.twitterIdToUnifiedUserId[userID] != 0) revert UserAlreadyLinked();
    if (mintingData.registeredWallets[msgSender()]) revert WalletAlreadyLinked();

    emit verifyTwitterByAuthCodeRequested(msgSender(), authCode, tweetID, userID);
  }

  function requestTwitterVerification(string calldata accessCodeEncrypted, string calldata userID) public {
    if (mintingData.twitterIdToUnifiedUserId[userID] != 0) revert WalletAlreadyLinked();
    if (mintingData.walletToUnifiedUserId[msgSender()] != 0) revert WalletAlreadyLinkedToFid();

    emit VerifyTwitterRequested(accessCodeEncrypted, userID, msgSender());
  }

  function twitterVerificationError(
    address wallet,
    string calldata userID,
    string calldata errorMsg
  ) public onlyGelato {
    emit TwitterVerificationResult(userID, wallet, false, errorMsg);
  }

  // Farcaster verification functions
  event VerifyFarcasterRequested(uint256 indexed farcasterFid, address indexed wallet);
  event FarcasterVerificationResult(
    uint256 indexed farcasterFid,
    address indexed wallet,
    bool isSuccess,
    string errorMsg
  );

  function requestFarcasterVerification(uint256 farcasterFid, address wallet) external {
    if (mintingData.farcasterFidToUnifiedUserId[farcasterFid] != 0) revert FarcasterAccountAlreadyLinked();
    if (mintingData.walletToUnifiedUserId[wallet] != 0) revert WalletAlreadyLinkedToFid();

    emit VerifyFarcasterRequested(farcasterFid, wallet);
  }

  function farcasterVerificationError(uint256 farcasterFid, address wallet, string calldata errorMsg) external {
    emit FarcasterVerificationResult(farcasterFid, wallet, false, errorMsg);
  }

  //

  function getUserIdByTwitterId(string calldata twitterId) public view returns (uint256) {
    return mintingData.twitterIdToUnifiedUserId[twitterId];
  }

  function isTwitterUserRegistered(string calldata userID) public view returns (bool) {
    return mintingData.twitterIdToUnifiedUserId[userID] != 0;
  }

  function totalTwitterUsersCount() public view returns (uint256) {
    return mintingData.allTwitterUsers.length;
  }

  function getTwitterUsers(uint16 start, uint16 count) public view returns (string[] memory) {
    uint16 end = start + count;
    if (end > mintingData.allTwitterUsers.length) {
      end = uint16(mintingData.allTwitterUsers.length);
    }

    if (start > end) revert WrongStartIndex();
    return MintingLib.getTwitterUsers(mintingData, start, end);
  }

  function getTwitterUsersByIndexes(uint64[] calldata indexes) public view returns (string[] memory) {
    return MintingLib.getTwitterUsersByIndexes(mintingData, indexes);
  }

  // Twitter minting functions

  function startMinting() public onlyGelatoOrOwner {
    uint32 yesterday = MintingLib.getStartOfYesterday();
    uint32 dayToMint = mintingData.lastMintedDay + 1 days;

    // if minting for previous day is not finished - continue it
    if (mintingData.mintingInProgressForDay > 0 && mintingData.mintingInProgressForDay < yesterday) {
      emit twitterMintingProcessed(mintingData.mintingInProgressForDay, new GMStorage.Batch[](0));
      return;
    }

    require(dayToMint <= yesterday, 'dayToMint should be not further than yesterday');
    require(mintingData.mintingInProgressForDay == 0, 'minting process already started');

    mintingData.mintingInProgressForDay = dayToMint;

    mintingData.isTwitterMintingFinished = false;
    mintingData.isFarcasterMintingFinished = false;

    (bool isNewEpoch, uint256 newMultiplicator, int32 newPointsDeltaStreak) = MintingLib.calculateComplexity(
      mintingData,
      mintingConfig,
      dayToMint,
      pointsDeltaStreak
    );

    if (isNewEpoch) {
      emit changedComplexity(newMultiplicator, mintingData.lastEpochPoints, mintingData.currentEpochPoints);

      mintingConfig.COINS_MULTIPLICATOR = newMultiplicator;
      mintingData.epochStartedAt = dayToMint;
      mintingData.lastEpochPoints = mintingData.currentEpochPoints;
      mintingData.currentEpochPoints = 0;

      pointsDeltaStreak = newPointsDeltaStreak;
      totalPoints += mintingData.currentEpochPoints;
      mintingConfig.epochNumber++;
    }

    emit MintingStarted(dayToMint);

    emit twitterMintingProcessed(dayToMint, new GMStorage.Batch[](0));
    emit farcasterMintingProcessed(dayToMint, new GMStorage.Batch[](0));
  }

  function _onMintingStarted(uint32 dayToMint) internal virtual {}

  // manual calling continue minting for a day if there was any unexpected error
  function continueMintingForADay() public _onlyOwner {
    require(mintingData.mintingInProgressForDay != 0, 'not found any in progress minting days');

    if (!mintingData.isTwitterMintingFinished) {
      emit twitterMintingProcessed(mintingData.mintingInProgressForDay, new GMStorage.Batch[](0));
    }

    if (!mintingData.isFarcasterMintingFinished) {
      emit farcasterMintingProcessed(mintingData.mintingInProgressForDay, new GMStorage.Batch[](0));
    }
  }

  function finishMintingFarcaster(uint32 mintingDayTimestamp, string calldata runningHash) public onlyGelato {
    require(mintingDayTimestamp == mintingData.mintingInProgressForDay, 'wrong mintingDay');
    require(mintingData.lastMintedDay < mintingDayTimestamp, 'wrong mintingDayTimestamp');

    mintingData.isFarcasterMintingFinished = true;

    emit MintingFinishedFarcaster(mintingDayTimestamp, runningHash);

    if (mintingData.isTwitterMintingFinished) {
      _finishMinting(mintingDayTimestamp, runningHash);
    }
  }

  function finishMintingTwitter(uint32 mintingDayTimestamp, string calldata runningHash) public onlyGelato {
    require(mintingDayTimestamp == mintingData.mintingInProgressForDay, 'wrong mintingDay');
    require(mintingData.lastMintedDay < mintingDayTimestamp, 'wrong mintingDayTimestamp');

    mintingData.isTwitterMintingFinished = true;

    emit MintingFinishedTwitter(mintingDayTimestamp, runningHash);

    if (mintingData.isFarcasterMintingFinished) {
      _finishMinting(mintingDayTimestamp, runningHash);
    }
  }

  function _finishMinting(uint32 mintingDayTimestamp, string calldata runningHash) internal virtual {
    require(mintingDayTimestamp == mintingData.mintingInProgressForDay, 'wrong mintingDay');
    require(mintingData.lastMintedDay < mintingDayTimestamp, 'wrong mintingDayTimestamp');

    mintingData.currentEpochPoints += mintingData.mintingDayPointsFromUsers;
    mintingData.lastMintedDay = mintingDayTimestamp;

    mintingData.mintingDayPointsFromUsers = 0;
    mintingData.mintingInProgressForDay = 0;

    emit MintingFinished(mintingDayTimestamp);

    uint32 yesterday = MintingLib.getStartOfYesterday();
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

  function attachIPFSCastsFile(
    uint32 mintingDayTimestamp,
    string calldata finalHash,
    string calldata cid
  ) public onlyServerRelayer {
    emit MintingFinished_CastsUploadedToIPFS(mintingDayTimestamp, finalHash, cid);
  }

  function logErrorBatches(uint32 mintingDayTimestamp, GMStorage.Batch[] calldata batches) public onlyGelato {
    emit twitterMintingErrored(mintingDayTimestamp, batches);
  }

  function _mintCoinsForUsers(
    GMStorage.UserMintingData[] calldata userData,
    function(uint256) returns (bool) checkUserIndex,
    function(uint256, uint256) mintFunc
  ) internal {
    for (uint256 i = 0; i < userData.length; i++) {
      if (!checkUserIndex(userData[i].userIndex)) {
        revert WrongUserIndex();
      }

      uint256 points = MintingLib.calculatePoints(userData[i], mintingConfig);

      if (points == 0) {
        continue;
      }

      mintingData.mintingDayPointsFromUsers += points;

      uint256 coins = points * mintingConfig.COINS_MULTIPLICATOR;

      mintFunc(userData[i].userIndex, coins);
    }
  }

  function mintCoinsForTwitterUsers(
    GMStorage.UserMintingData[] calldata userData,
    uint32 mintingDayTimestamp,
    GMStorage.Batch[] calldata batches
  ) public onlyGelato {
    if (mintingData.mintingInProgressForDay == 0) revert NoOngoingMinting();
    if (mintingDayTimestamp != mintingData.mintingInProgressForDay) revert WrongMintingDay();

    _mintCoinsForUsers(userData, _checkTwitterUserIndex, _mintForUserByTwitterIndex);

    if (batches.length > 0) {
      emit twitterMintingProcessed(mintingDayTimestamp, batches);
    }
  }

  function mintCoinsForFarcasterUsers(
    GMStorage.UserMintingData[] calldata userData,
    uint32 mintingDayTimestamp,
    GMStorage.Batch[] calldata batches
  ) public onlyGelato {
    if (mintingData.mintingInProgressForDay == 0) revert NoOngoingMinting();
    if (mintingDayTimestamp != mintingData.mintingInProgressForDay) revert WrongMintingDay();

    _mintCoinsForUsers(userData, _checkFarcasterUserIndex, _mintForUserByFarcasterIndex);

    if (batches.length > 0) {
      emit farcasterMintingProcessed(mintingDayTimestamp, batches);
    }
  }

  function _checkTwitterUserIndex(uint256 userIndex) internal view returns (bool) {
    return userIndex < mintingData.allTwitterUsers.length;
  }

  function _checkFarcasterUserIndex(uint256 userIndex) internal view returns (bool) {
    return userIndex < mintingData.allFarcasterUsers.length;
  }

  // Abstract functions to be implemented by main contract
  function _mintForUserByTwitterIndex(uint256 userIndex, uint256 amount) internal virtual {}
  function _mintForUserByFarcasterIndex(uint256 userIndex, uint256 amount) internal virtual {}
}
