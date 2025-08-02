// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import { GMStorage } from './Storage.sol';
import { GMWeb3Functions } from './GelatoWeb3Functions.sol';
import { FarcasterOracleLib } from './FarcasterOracle.sol';
import { AccountOracleLib } from './AccountOracle.sol';
import { MintingLib } from './MintingLib.sol';

contract GMTwitterOracle is GMStorage, Initializable, GMWeb3Functions {
  using FarcasterOracleLib for GMStorage.MintingData;
  using AccountOracleLib for GMStorage.MintingData;
  using MintingLib for GMStorage.MintingData;
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
  
  // Account events
  event UnifiedUserCreated(uint256 indexed userId, address indexed primaryWallet, string twitterId, uint256 farcasterFid);
  event UnifiedSocialAccountLinked(uint256 indexed userId, string platform, string platformId);
  event UnifiedWalletLinked(uint256 indexed userId, address indexed wallet);
  event UnifiedHumanVerificationUpdated(uint256 indexed userId, bool isVerified);

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

  event twitterMintingProcessed(uint32 indexed mintingDayTimestamp, Batch[] batches);
  event twitterMintingErrored(uint32 indexed mintingDayTimestamp, Batch[] errorBatches);
  event MintingStarted(uint32 indexed mintingDay);
  event MintingFinished(uint32 indexed mintingDayTimestamp, string runningHash);
  event MintingFinished_TweetsUploadedToIPFS(uint32 indexed mintingDayTimetsamp, string runningHash, string cid);

  event changedComplexity(uint256 newMultiplicator, uint256 previousEpochPoints, uint256 currentEpochPoints);

  function startMinting() public onlyGelatoOrOwner {
    (uint32 dayToMint, bool shouldContinue) = mintingData.startMintingProcess(mintingConfig);
    
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

  // manual calling continue minting for a day if there was any unexpected error
  function continueMintingForADay() public onlyOwner {
    require(mintingData.mintingInProgressForDay != 0, 'not found any in progress minting days');

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

  // to be defined in main contract
  function _mintForUserByIndex(uint256 userIndex, uint256 amount) internal virtual {}

  // to be defined in main contract (similar to _mintForUserByIndex)
  function _mintForFarcasterUserByIndex(uint256 userIndex, uint256 amount) internal virtual {}

  function logErrorBatches(uint32 mintingDayTimestamp, Batch[] calldata batches) public onlyGelato {
    emit twitterMintingErrored(mintingDayTimestamp, batches);
  }

  function mintCoinsForTwitterUsers(
    UserTwitterData[] calldata userData,
    uint32 mintingDayTimestamp,
    Batch[] calldata batches
  ) public onlyGelato {
    UserMintingResult[] memory results = mintingData.processTwitterMinting(
      mintingConfig, userData, mintingDayTimestamp
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

  // Farcaster functions using library
  function requestFarcasterVerification(uint256 farcasterFid) public {
    mintingData.requestFarcasterVerification(farcasterFid, _msgSender());
    emit VerifyFarcasterRequested(farcasterFid, _msgSender());
  }

  function verifyFarcaster(uint256 farcasterFid, address wallet) public onlyGelato {
    (bool shouldMint, uint256 userIndex, uint256 mintAmount) = mintingData.verifyFarcaster(
      mintingConfig, farcasterFid, wallet
    );
    
    if (shouldMint) {
      _mintForFarcasterUserByIndex(userIndex, mintAmount);
    }
    
    emit FarcasterVerificationResult(farcasterFid, wallet, true, '');
  }

  function farcasterVerificationError(
    address wallet,
    uint256 farcasterFid,
    string calldata errorMsg
  ) public onlyGelato {
    emit FarcasterVerificationResult(farcasterFid, wallet, false, errorMsg);
  }

  function isFarcasterUserRegistered(uint256 farcasterFid) public view returns (bool) {
    return mintingData.isFarcasterUserRegistered(farcasterFid);
  }

  function getWalletByFID(uint256 farcasterFid) public view returns (address) {
    return mintingData.getWalletByFID(farcasterFid);
  }

  function getFIDByWallet(address wallet) public view returns (uint256) {
    return mintingData.getFIDByWallet(wallet);
  }

  function getFarcasterUsers(uint64 start, uint16 count) public view returns (uint256[] memory) {
    return mintingData.getFarcasterUsers(start, count);
  }

  function walletByFarcasterUserIndex(uint256 userIndex) internal view returns (address) {
    return mintingData.walletByFarcasterUserIndex(userIndex);
  }

  function mintCoinsForFarcasterUsers(
    UserFarcasterData[] calldata userData,
    uint32 mintingDayTimestamp,
    Batch[] calldata batches
  ) public onlyGelato {
    UserMintingResult[] memory results = mintingData.processFarcasterMinting(
      mintingConfig, userData, mintingDayTimestamp
    );
    
    for (uint256 i = 0; i < results.length; i++) {
      if (results[i].shouldMint) {
        _mintForFarcasterUserByIndex(results[i].userIndex, results[i].mintAmount);
      }
    }

    if (batches.length > 0) {
      emit farcasterMintingProcessed(mintingDayTimestamp, batches);
    }
  }

  // Account management functions using library
  function enableUnifiedUserSystem() public onlyOwner {
    mintingData.enableUnifiedUserSystem();
  }

  function disableUnifiedUserSystem() public onlyOwner {
    mintingData.disableUnifiedUserSystem();
  }

  function linkAdditionalWallet(address newWallet, bytes calldata signature) public {
    mintingData.linkAdditionalWallet(_msgSender(), newWallet, signature);
    uint256 userId = mintingData.walletToUnifiedUserId[_msgSender()];
    emit UnifiedWalletLinked(userId, newWallet);
  }

  function setUnifiedUserHumanVerification(uint256 userId, bool isVerified) public onlyOwner {
    mintingData.setUnifiedUserHumanVerification(userId, isVerified);
    emit UnifiedHumanVerificationUpdated(userId, isVerified);
  }

  function isWalletRegistered(address wallet) public view returns (bool) {
    return mintingData.isWalletRegistered(wallet);
  }

  function removeMe() public {
    mintingData.removeUser(_msgSender());
  }

  function walletByUnifiedUserIndex(uint256 userIndex) internal view returns (address) {
    return mintingData.walletByUnifiedUserIndex(userIndex);
  }

  function verifyTwitterUnified(string calldata userID, address wallet) public virtual onlyGelato {
    verifyTwitter(userID, wallet);
    
    if (mintingData.unifiedUserSystemEnabled) {
      uint256 userId = mintingData.createOrLinkUnifiedUser(wallet, userID, 0);
      if (userId > 0) {
        emit UnifiedUserCreated(userId, wallet, userID, 0);
      }
    }
  }

  function verifyFarcasterUnified(uint256 farcasterFid, address wallet) public virtual onlyGelato {
    verifyFarcaster(farcasterFid, wallet);
    
    if (mintingData.unifiedUserSystemEnabled) {
      uint256 userId = mintingData.createOrLinkUnifiedUser(wallet, "", farcasterFid);
      if (userId > 0) {
        emit UnifiedUserCreated(userId, wallet, "", farcasterFid);
      }
    }
  }
}
