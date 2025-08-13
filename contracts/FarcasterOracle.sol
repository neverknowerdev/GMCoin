// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import { GMStorage } from './Storage.sol';
import { FarcasterOracleLib } from './FarcasterOracleLib.sol';
import { AccountManagerLib } from './AccountManagerLib.sol';
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

  // Internal storage access - to be provided by main contract
  function _getMintingData() internal view virtual returns (GMStorage.MintingData storage);

  function _getMintingConfig() internal view virtual returns (GMStorage.MintingConfig storage);

  // Request Farcaster verification (called by users)
  function requestFarcasterVerification(uint256 farcasterFid) public {
    GMStorage.MintingData storage mintingData = _getMintingData();
    if (mintingData.farcasterWalletsByFIDs[farcasterFid] != address(0)) revert FarcasterAccountAlreadyLinked();
    if (mintingData.farcasterUsersByWallets[_msgSender()] != 0) revert WalletAlreadyLinkedToFid();

    emit VerifyFarcasterRequested(farcasterFid, _msgSender());
  }

  // Process Farcaster verification error (called by Gelato)
  function farcasterVerificationError(
    uint256 farcasterFid,
    address wallet,
    string calldata errorMsg
  ) public onlyGelato {
    emit FarcasterVerificationResult(farcasterFid, wallet, false, errorMsg);
  }

  // Process successful Farcaster verification (called by Gelato after API verification)
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

    if (mintingData.unifiedUserSystemEnabled) {
      uint256 userId = _createOrLinkUnifiedUser(wallet, '', farcasterFid);
      if (userId > 0) {
        _emitUnifiedUserCreated(userId, wallet, '', farcasterFid);
      }
    }

    emit FarcasterVerificationResult(farcasterFid, wallet, true, '');
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
