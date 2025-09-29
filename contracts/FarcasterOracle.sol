// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import { GMStorage } from './Storage.sol';
import { FarcasterOracleLib } from './FarcasterOracleLib.sol';
import { AccountManagerLib } from './AccountManagerLib.sol';
import { FarcasterVerificationLib } from './libraries/FarcasterVerificationLib.sol';
import { FarcasterMintingLib } from './libraries/FarcasterMintingLib.sol';
import './Errors.sol';

abstract contract FarcasterOracle {
  // Events
  event VerifyFarcasterRequested(uint256 indexed farcasterFid, address indexed wallet);
  event FarcasterVerificationResult(
    uint256 indexed farcasterFid,
    address indexed wallet,
    bool isSuccess,
    string errorMsg
  );

  // Access control - to be inherited from main contract
  function _msgSender() internal view virtual returns (address);

  // Modifiers - to be inherited from main contract
  modifier onlyGelato() virtual {
    _;
  }

  modifier onlyServerRelayer() virtual {
    _;
  }

  // Internal storage access - to be provided by main contract
  function _getMintingData() internal view virtual returns (GMStorage.MintingData storage);

  function _getMintingConfig() internal view virtual returns (GMStorage.MintingConfig storage);

  // Request Farcaster verification (called by users)
  function requestFarcasterVerification(uint256 farcasterFid) public {
    FarcasterVerificationLib.requestFarcasterVerification(_getMintingData(), farcasterFid, _msgSender());
  }

  // Process Farcaster verification error (called by Gelato)
  function farcasterVerificationError(
    uint256 farcasterFid,
    address wallet,
    string calldata errorMsg
  ) public onlyGelato {
    FarcasterVerificationLib.farcasterVerificationError(farcasterFid, wallet, errorMsg);
  }

  // Process successful Farcaster verification (called by Gelato after API verification)
  function verifyFarcaster(uint256 farcasterFid, address wallet) public onlyGelato {
    GMStorage.MintingData storage mintingData = _getMintingData();
    GMStorage.MintingConfig storage mintingConfig = _getMintingConfig();

    (bool shouldMint, uint256 userIndex, uint256 mintAmount) = FarcasterVerificationLib.verifyFarcaster(
      mintingData,
      mintingConfig,
      farcasterFid,
      wallet
    );

    if (shouldMint) {
      _mintForFarcasterUserByIndex(userIndex, mintAmount);
    }

    if (mintingData.unifiedUserSystemEnabled) {
      uint256 userId = _createOrLinkUnifiedUser(wallet, '', farcasterFid);
      if (userId > 0) {
        _emitUnifiedUserCreated(userId, wallet, '', farcasterFid);
      }
    }
  }

  function verifyFarcasterUnified(uint256 farcasterFid, address wallet) public onlyGelato {
    // Same as verifyFarcaster but always creates unified user
    GMStorage.MintingData storage mintingData = _getMintingData();
    GMStorage.MintingConfig storage mintingConfig = _getMintingConfig();

    (bool shouldMint, uint256 userIndex, uint256 mintAmount) = FarcasterVerificationLib.verifyFarcaster(
      mintingData,
      mintingConfig,
      farcasterFid,
      wallet
    );

    if (shouldMint) {
      _mintForFarcasterUserByIndex(userIndex, mintAmount);
    }

    // Always create unified user
    uint256 userId = _createOrLinkUnifiedUser(wallet, '', farcasterFid);
    if (userId > 0) {
      _emitUnifiedUserCreated(userId, wallet, '', farcasterFid);
    }
  }

  function verifyBothFarcasterAndTwitter(
    uint256 farcasterFid,
    address wallet,
    string calldata /* twitterId */
  ) public onlyGelato {
    // Just call verifyFarcasterUnified
    verifyFarcasterUnified(farcasterFid, wallet);
  }

  function verifyFarcasterAndMergeWithTwitter(
    uint256 farcasterFid,
    address wallet,
    string calldata twitterId
  ) public onlyGelato {
    verifyBothFarcasterAndTwitter(farcasterFid, wallet, twitterId);
  }

  function linkFarcasterWalletToUnifiedUser(uint256 userId, address wallet) public onlyGelato {
    FarcasterVerificationLib.linkFarcasterWalletToUnifiedUser(_getMintingData(), userId, wallet);
  }

  // Farcaster query functions

  function isFarcasterUserRegistered(uint256 farcasterFid) public view returns (bool) {
    GMStorage.MintingData storage mintingData = _getMintingData();
    return mintingData.farcasterWalletsByFIDs[farcasterFid] != address(0);
  }

  function getWalletByFID(uint256 farcasterFid) public view returns (address) {
    GMStorage.MintingData storage mintingData = _getMintingData();
    return mintingData.farcasterWalletsByFIDs[farcasterFid];
  }

  function getFIDByWallet(address wallet) public view returns (uint256) {
    GMStorage.MintingData storage mintingData = _getMintingData();
    return mintingData.farcasterUsersByWallets[wallet];
  }

  function totalFarcasterUsersCount() public view returns (uint256) {
    GMStorage.MintingData storage mintingData = _getMintingData();
    return mintingData.allFarcasterUsers.length;
  }

  function walletByFarcasterUserIndex(uint256 userIndex) internal view returns (address) {
    GMStorage.MintingData storage mintingData = _getMintingData();
    if (userIndex >= mintingData.allFarcasterUsers.length) return address(0);
    uint256 fid = mintingData.allFarcasterUsers[userIndex];
    return mintingData.farcasterWalletsByFIDs[fid];
  }

  function getFarcasterUsers(uint64 start, uint16 count) public view returns (uint256[] memory) {
    return FarcasterOracleLib.getFarcasterUsers(_getMintingData(), start, count);
  }

  // Farcaster minting functions

  event farcasterMintingProcessed(uint32 indexed mintingDayTimestamp, GMStorage.Batch[] batches);
  event farcasterMintingErrored(uint32 indexed mintingDayTimestamp, GMStorage.Batch[] errorBatches);
  event FarcasterMintingStarted(uint32 indexed mintingDay);
  event FarcasterMintingFinished(uint32 indexed mintingDayTimestamp, string runningHash);
  event FarcasterMintingFinished_CastsUploadedToIPFS(uint32 indexed mintingDayTimestamp, string runningHash, string cid);


  function startFarcasterMinting() public onlyGelato {
    FarcasterMintingLib.startFarcasterMinting();
  }

  function finishFarcasterMinting(uint32 mintingDayTimestamp, string calldata runningHash) public onlyGelato {
    FarcasterMintingLib.finishFarcasterMinting(mintingDayTimestamp, runningHash);
  }

  function logFarcasterErrorBatches(uint32 mintingDayTimestamp, GMStorage.Batch[] calldata batches) public onlyGelato {
    FarcasterMintingLib.logFarcasterErrorBatches(mintingDayTimestamp, batches);
  }

  function mintCoinsForFarcasterUsers(
    GMStorage.UserFarcasterData[] calldata userData,
    uint32 mintingDayTimestamp,
    GMStorage.Batch[] calldata batches
  ) public onlyGelato {
    GMStorage.MintingData storage mintingData = _getMintingData();
    GMStorage.MintingConfig storage mintingConfig = _getMintingConfig();
    
    GMStorage.UserMintingResult[] memory results = FarcasterMintingLib.processFarcasterMinting(
      mintingData,
      mintingConfig,
      userData,
      mintingDayTimestamp,
      batches
    );

    for (uint256 i = 0; i < results.length; i++) {
      if (results[i].shouldMint) {
        _mintForFarcasterUserByIndex(results[i].userIndex, results[i].mintAmount);
      }
    }
  }

  function attachIPFSCastsFile(
    uint32 mintingDayTimestamp,
    string calldata finalHash,
    string calldata cid
  ) public onlyServerRelayer {
    FarcasterMintingLib.attachIPFSCastsFile(mintingDayTimestamp, finalHash, cid);
  }

  // Abstract functions to be implemented by main contract
  function _mintForFarcasterUserByIndex(uint256 userIndex, uint256 amount) internal virtual {}

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
