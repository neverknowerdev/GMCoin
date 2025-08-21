// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import { GMStorage } from '../Storage.sol';
import { FarcasterOracleLib } from '../FarcasterOracleLib.sol';
import { AccountManagerLib } from '../AccountManagerLib.sol';
import '../Errors.sol';

library FarcasterVerificationLib {
  event VerifyFarcasterRequested(uint256 indexed farcasterFid, address indexed wallet);
  event FarcasterVerificationResult(
    uint256 indexed farcasterFid,
    address indexed wallet,
    bool isSuccess,
    string errorMsg
  );

  function requestFarcasterVerification(
    GMStorage.MintingData storage mintingData,
    uint256 farcasterFid,
    address msgSender
  ) external {
    if (mintingData.farcasterWalletsByFIDs[farcasterFid] != address(0)) revert FarcasterAccountAlreadyLinked();
    if (mintingData.farcasterUsersByWallets[msgSender] != 0) revert WalletAlreadyLinkedToFid();

    emit VerifyFarcasterRequested(farcasterFid, msgSender);
  }

  function farcasterVerificationError(
    uint256 farcasterFid,
    address wallet,
    string calldata errorMsg
  ) external {
    emit FarcasterVerificationResult(farcasterFid, wallet, false, errorMsg);
  }

  function verifyFarcaster(
    GMStorage.MintingData storage mintingData,
    GMStorage.MintingConfig storage mintingConfig,
    uint256 farcasterFid,
    address wallet
  ) external returns (bool shouldMint, uint256 userIndex, uint256 mintAmount) {
    if (mintingData.farcasterWalletsByFIDs[farcasterFid] != address(0)) revert FarcasterAccountAlreadyLinked();
    if (mintingData.farcasterUsersByWallets[wallet] != 0) revert WalletAlreadyLinkedToFid();

    (shouldMint, userIndex, mintAmount) = FarcasterOracleLib.verifyFarcaster(
      mintingData,
      mintingConfig,
      farcasterFid,
      wallet
    );

    emit FarcasterVerificationResult(farcasterFid, wallet, true, '');
  }

  function linkFarcasterWalletToUnifiedUser(
    GMStorage.MintingData storage mintingData,
    uint256 userId,
    address wallet
  ) external {
    if (mintingData.unifiedUsers[userId].userId == 0) revert UserNotExist();
    AccountManagerLib.linkAdditionalWallet(mintingData, userId, wallet);
  }
}