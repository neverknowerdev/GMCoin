// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import { GMStorage } from './Storage.sol';
import { FarcasterOracleLib } from './FarcasterOracleLib.sol';
import './Errors.sol';

abstract contract FarcasterOracle {
  // Farcaster events
  event VerifyFarcasterRequested(uint256 indexed farcasterFid, address indexed wallet);
  event FarcasterVerificationResult(
    uint256 indexed farcasterFid,
    address indexed wallet,
    bool isSuccess,
    string errorMsg
  );
  event farcasterMintingProcessed(uint32 indexed mintingDayTimestamp, GMStorage.Batch[] batches);

  // Access control - to be inherited from main contract
  modifier onlyGelato() virtual {
    _;
  }

  // Internal storage access - to be provided by main contract
  function _getMintingData() internal view virtual returns (GMStorage.MintingData storage);

  function _getMintingConfig() internal view virtual returns (GMStorage.MintingConfig storage);

  function _msgSender() internal view virtual returns (address);

  // Farcaster verification functions

  function requestFarcasterVerification(uint256 farcasterFid) public {
    GMStorage.MintingData storage mintingData = _getMintingData();
    if (mintingData.farcasterWalletsByFIDs[farcasterFid] != address(0)) revert FarcasterAccountAlreadyLinked();
    if (mintingData.farcasterUsersByWallets[_msgSender()] != 0) revert WalletAlreadyLinkedToFid();

    emit VerifyFarcasterRequested(farcasterFid, _msgSender());
  }

  // Alias for better UX - same as requestFarcasterVerification
  function verifyFarcaster(uint256 farcasterFid) public {
    requestFarcasterVerification(farcasterFid);
  }

  // Complex verification function that handles both Twitter and Farcaster
  function verifyBothFarcasterAndTwitter(
    uint256 farcasterFid,
    address wallet,
    string calldata twitterId
  ) public onlyGelato {
    GMStorage.MintingData storage mintingData = _getMintingData();
    GMStorage.MintingConfig storage mintingConfig = _getMintingConfig();

    (bool shouldMint, uint256 userIndex, uint256 mintAmount) = FarcasterOracleLib.verifyBothFarcasterAndTwitter(
      mintingData,
      mintingConfig,
      farcasterFid,
      wallet,
      twitterId
    );

    if (shouldMint) {
      _mintForFarcasterUserByIndex(userIndex, mintAmount);
    }

    // Create unified user linking both accounts
    if (mintingData.unifiedUserSystemEnabled) {
      uint256 userId = _createOrLinkUnifiedUser(wallet, twitterId, farcasterFid);
      if (userId > 0) {
        _emitUnifiedUserCreated(userId, wallet, twitterId, farcasterFid);
      }
    }

    emit FarcasterVerificationResult(farcasterFid, wallet, true, '');
    _emitTwitterVerificationResult(twitterId, wallet, true, '');
  }

  // Function to merge two existing unified accounts
  function mergeUnifiedAccounts(uint256 farcasterFid, string calldata twitterId, address wallet) public onlyGelato {
    GMStorage.MintingData storage mintingData = _getMintingData();
    GMStorage.MintingConfig storage mintingConfig = _getMintingConfig();

    (bool shouldMint, uint256 userIndex, uint256 mintAmount) = FarcasterOracleLib.mergeUnifiedAccounts(
      mintingData,
      mintingConfig,
      farcasterFid,
      twitterId,
      wallet
    );

    if (shouldMint) {
      _mintForFarcasterUserByIndex(userIndex, mintAmount);
    }

    emit FarcasterVerificationResult(farcasterFid, wallet, true, '');
  }

  function verifyFarcaster(uint256 farcasterFid, address wallet) public onlyGelato {
    GMStorage.MintingData storage mintingData = _getMintingData();
    GMStorage.MintingConfig storage mintingConfig = _getMintingConfig();

    (bool shouldMint, uint256 userIndex, uint256 mintAmount) = FarcasterOracleLib.verifyFarcaster(
      mintingData,
      mintingConfig,
      farcasterFid,
      wallet
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

  // Farcaster query functions

  function isFarcasterUserRegistered(uint256 farcasterFid) public view returns (bool) {
    return FarcasterOracleLib.isFarcasterUserRegistered(_getMintingData(), farcasterFid);
  }

  function getWalletByFID(uint256 farcasterFid) public view returns (address) {
    return FarcasterOracleLib.getWalletByFID(_getMintingData(), farcasterFid);
  }

  function getFIDByWallet(address wallet) public view returns (uint256) {
    return FarcasterOracleLib.getFIDByWallet(_getMintingData(), wallet);
  }

  function getFarcasterUsers(uint64 start, uint16 count) public view returns (uint256[] memory) {
    return FarcasterOracleLib.getFarcasterUsers(_getMintingData(), start, count);
  }

  function walletByFarcasterUserIndex(uint256 userIndex) internal view returns (address) {
    return FarcasterOracleLib.walletByFarcasterUserIndex(_getMintingData(), userIndex);
  }

  function totalFarcasterUsersCount() public view returns (uint256) {
    return FarcasterOracleLib.totalFarcasterUsersCount(_getMintingData());
  }

  // Farcaster minting functions

  function mintCoinsForFarcasterUsers(
    GMStorage.UserFarcasterData[] calldata userData,
    uint32 mintingDayTimestamp,
    GMStorage.Batch[] calldata batches
  ) public onlyGelato {
    GMStorage.UserMintingResult[] memory results = FarcasterOracleLib.processFarcasterMinting(
      _getMintingData(),
      _getMintingConfig(),
      userData,
      mintingDayTimestamp
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

  // Enhanced Farcaster verification that creates unified users
  function verifyFarcasterUnified(uint256 farcasterFid, address wallet) public virtual onlyGelato {
    verifyFarcaster(farcasterFid, wallet);

    GMStorage.MintingData storage mintingData = _getMintingData();
    if (mintingData.unifiedUserSystemEnabled) {
      uint256 userId = _createOrLinkUnifiedUser(wallet, '', farcasterFid);
      if (userId > 0) {
        _emitUnifiedUserCreated(userId, wallet, '', farcasterFid);
      }
    }
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

  // Abstract function to emit Twitter verification result (defined in TwitterOracle)
  function _emitTwitterVerificationResult(
    string memory twitterId,
    address wallet,
    bool isSuccess,
    string memory errorMsg
  ) internal virtual {}
}
