// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import { GMStorage } from './Storage.sol';
import { GMWeb3Functions } from './GelatoWeb3Functions.sol';
import { TwitterOracleLib } from './TwitterOracleLib.sol';
import { MintingLib } from './MintingLib.sol';
import './Errors.sol';

abstract contract TwitterOracle is GMStorage, Initializable, GMWeb3Functions {
  using TwitterOracleLib for GMStorage.MintingData;
  using MintingLib for GMStorage.MintingData;

  modifier onlyGelato() virtual {
    if (_msgSender() != gelatoConfig.gelatoAddress) revert OnlyGelato();
    _;
  }

  modifier onlyGelatoOrOwner() {
    require(
      _msgSender() == gelatoConfig.gelatoAddress || _msgSender() == owner(),
      'only Gelato or owner can call this function'
    );
    _;
  }

  modifier onlyServerRelayer() virtual {
    if (_msgSender() != serverRelayerAddress) revert OnlyServerRelayer();
    _;
  }

  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
  }

  // Twitter events
  event VerifyTwitterRequested(string accessCodeEncrypted, string userID, address indexed wallet);
  event TwitterVerificationResult(string userID, address indexed wallet, bool isSuccess, string errorMsg);
  event verifyTwitterByAuthCodeRequested(address wallet, string authCode, string tweetID, string userID);
  event twitterMintingProcessed(uint32 indexed mintingDayTimestamp, Batch[] batches);
  event twitterMintingErrored(uint32 indexed mintingDayTimestamp, Batch[] errorBatches);
  event MintingStarted(uint32 indexed mintingDay);
  event MintingFinished(uint32 indexed mintingDayTimestamp, string runningHash);
  event MintingFinished_TweetsUploadedToIPFS(uint32 indexed mintingDayTimetsamp, string runningHash, string cid);
  event changedComplexity(uint256 newMultiplicator, uint256 previousEpochPoints, uint256 currentEpochPoints);

  // Twitter verification functions

  function requestTwitterVerificationByAuthCode(
    string calldata authCode,
    string calldata userID,
    string calldata tweetID
  ) public {
    if (mintingData.walletsByUserIDs[userID] != address(0)) revert UserAlreadyLinked();
    if (mintingData.registeredWallets[_msgSender()]) revert WalletAlreadyLinked();

    emit verifyTwitterByAuthCodeRequested(_msgSender(), authCode, tweetID, userID);
  }

  function requestTwitterVerification(string calldata accessCodeEncrypted, string calldata userID) public {
    if (mintingData.walletsByUserIDs[userID] != address(0)) revert WalletAlreadyLinked();

    emit VerifyTwitterRequested(accessCodeEncrypted, userID, _msgSender());
  }

  function twitterVerificationError(
    address wallet,
    string calldata userID,
    string calldata errorMsg
  ) public onlyGelato {
    emit TwitterVerificationResult(userID, wallet, false, errorMsg);
  }

  function verifyTwitter(string calldata userID, address wallet) public onlyGelato {
    if (mintingData.walletsByUserIDs[userID] != address(0)) revert WalletAlreadyLinked();
    if (mintingData.registeredWallets[wallet]) revert WalletAlreadyLinked();

    (bool shouldMint, uint256 userIndex, uint256 mintAmount) = TwitterOracleLib.verifyTwitter(
      mintingData,
      mintingConfig,
      userID,
      wallet
    );

    if (shouldMint) {
      _mintForUserByIndex(userIndex, mintAmount);
    }

    if (mintingData.unifiedUserSystemEnabled) {
      uint256 userId = _createOrLinkUnifiedUser(wallet, userID, 0);
      if (userId > 0) {
        _emitUnifiedUserCreated(userId, wallet, userID, 0);
      }
    }

    emit TwitterVerificationResult(userID, wallet, true, '');
  }

  function verifyTwitterUnified(string calldata userID, address wallet) public onlyGelato {
    // Same as verifyTwitter but always creates unified user
    if (mintingData.walletsByUserIDs[userID] != address(0)) revert WalletAlreadyLinked();
    if (mintingData.registeredWallets[wallet]) revert WalletAlreadyLinked();

    (bool shouldMint, uint256 userIndex, uint256 mintAmount) = TwitterOracleLib.verifyTwitter(
      mintingData,
      mintingConfig,
      userID,
      wallet
    );

    if (shouldMint) {
      _mintForUserByIndex(userIndex, mintAmount);
    }

    // Always create unified user
    uint256 userId = _createOrLinkUnifiedUser(wallet, userID, 0);
    if (userId > 0) {
      _emitUnifiedUserCreated(userId, wallet, userID, 0);
    }

    emit TwitterVerificationResult(userID, wallet, true, '');
  }

  // Twitter query functions

  function isTwitterUserRegistered(string calldata userID) public view returns (bool) {
    return TwitterOracleLib.isTwitterUserRegistered(mintingData, userID);
  }

  function getWalletByUserID(string calldata userID) public view returns (address) {
    return TwitterOracleLib.getWalletByUserID(mintingData, userID);
  }

  function userByWallet(address wallet) public view returns (string memory) {
    return TwitterOracleLib.getUserByWallet(mintingData, wallet);
  }

  function totalTwitterUsersCount() public view returns (uint256) {
    return mintingData.allTwitterUsers.length;
  }

  function walletByTwitterUserIndex(uint256 userIndex) internal view returns (address) {
    return TwitterOracleLib.walletByTwitterUserIndex(mintingData, userIndex);
  }

  function getTwitterUsers(uint64 start, uint16 count) public view returns (string[] memory) {
    return TwitterOracleLib.getTwitterUsers(mintingData, start, count);
  }

  function getTwitterUsersByIndexes(uint64[] calldata indexes) public view returns (string[] memory) {
    string[] memory batchArr = new string[](indexes.length);
    for (uint16 i = 0; i < indexes.length; i++) {
      batchArr[i] = mintingData.allTwitterUsers[i];
    }

    return batchArr;
  }

  // Twitter minting functions

  function startMinting() public onlyGelatoOrOwner {
    (uint32 dayToMint, bool shouldContinue, int32 newPointsDeltaStreak) = mintingData.startMintingProcess(
      mintingConfig,
      pointsDeltaStreak
    );
    pointsDeltaStreak = newPointsDeltaStreak;

    if (shouldContinue) {
      emit twitterMintingProcessed(dayToMint, emptyArray);
      return;
    }

    emit changedComplexity(
      mintingConfig.COINS_MULTIPLICATOR,
      mintingData.lastEpochPoints,
      mintingData.currentEpochPoints
    );

    totalPoints += mintingData.currentEpochPoints;
    emit MintingStarted(dayToMint);
    emit twitterMintingProcessed(dayToMint, emptyArray);
  }

  function continueMintingForADay() public onlyOwner {
    if (mintingData.mintingInProgressForDay == 0) revert NoOngoingMinting();

    emit twitterMintingProcessed(mintingData.mintingInProgressForDay, emptyArray);
  }

  function finishMinting(uint32 mintingDayTimestamp, string calldata runningHash) public onlyGelato {
    bool shouldStartNext = mintingData.finishMintingProcess(mintingDayTimestamp);

    emit MintingFinished(mintingDayTimestamp, runningHash);

    if (shouldStartNext) {
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

  function logErrorBatches(uint32 mintingDayTimestamp, Batch[] calldata batches) public onlyGelato {
    emit twitterMintingErrored(mintingDayTimestamp, batches);
  }

  function mintCoinsForTwitterUsers(
    UserTwitterData[] calldata userData,
    uint32 mintingDayTimestamp,
    Batch[] calldata batches
  ) public onlyGelato {
    UserMintingResult[] memory results = TwitterOracleLib.processTwitterMinting(
      mintingData,
      mintingConfig,
      userData,
      mintingDayTimestamp
    );

    for (uint256 i = 0; i < results.length; i++) {
      if (results[i].shouldMint) {
        _mintForUserByIndex(results[i].userIndex, results[i].mintAmount);
      }
    }

    if (batches.length > 0) {
      emit twitterMintingProcessed(mintingDayTimestamp, batches);
    }
  }

  function getStartOfYesterday() public view returns (uint32) {
    return MintingLib.getStartOfYesterday();
  }

  // Abstract functions to be implemented by main contract
  function _mintForUserByIndex(uint256 userIndex, uint256 amount) internal virtual {}

  function _createOrLinkUnifiedUser(
    address wallet,
    string memory twitterId,
    uint256 farcasterFid
  ) internal virtual returns (uint256) {}

  function _emitUnifiedUserCreated(
    uint256 userId,
    address wallet,
    string memory twitterId,
    uint256 farcasterFid
  ) internal virtual {}
}
