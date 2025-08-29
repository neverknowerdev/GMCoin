// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import { GMStorage } from '../Storage.sol';
import { TwitterOracleLib } from '../TwitterOracleLib.sol';
import '../Errors.sol';

library TwitterVerificationLib {
  event TwitterVerificationResult(string userID, address indexed wallet, bool isSuccess, string errorMsg);
  event VerifyTwitterRequested(string accessCodeEncrypted, string userID, address indexed wallet);
  event verifyTwitterByAuthCodeRequested(address wallet, string authCode, string tweetID, string userID);

  struct VerificationParams {
    string userID;
    address wallet;
  }

  function requestTwitterVerificationByAuthCode(
    GMStorage.MintingData storage mintingData,
    string calldata authCode,
    string calldata userID,
    string calldata tweetID,
    address msgSender
  ) external {
    if (mintingData.walletsByUserIDs[userID] != address(0)) revert UserAlreadyLinked();
    if (mintingData.registeredWallets[msgSender]) revert WalletAlreadyLinked();

    emit verifyTwitterByAuthCodeRequested(msgSender, authCode, tweetID, userID);
  }

  function requestTwitterVerification(
    GMStorage.MintingData storage mintingData,
    string calldata accessCodeEncrypted,
    string calldata userID,
    address msgSender
  ) external {
    if (mintingData.walletsByUserIDs[userID] != address(0)) revert WalletAlreadyLinked();

    emit VerifyTwitterRequested(accessCodeEncrypted, userID, msgSender);
  }

  function twitterVerificationError(
    string calldata userID,
    address wallet,
    string calldata errorMsg
  ) external {
    emit TwitterVerificationResult(userID, wallet, false, errorMsg);
  }

  function verifyTwitter(
    GMStorage.MintingData storage mintingData,
    GMStorage.MintingConfig storage mintingConfig,
    VerificationParams memory params
  ) external returns (bool shouldMint, uint256 userIndex, uint256 mintAmount) {
    if (mintingData.walletsByUserIDs[params.userID] != address(0)) revert WalletAlreadyLinked();
    if (mintingData.registeredWallets[params.wallet]) revert WalletAlreadyLinked();

    (shouldMint, userIndex, mintAmount) = TwitterOracleLib.verifyTwitter(
      mintingData,
      mintingConfig,
      params.userID,
      params.wallet
    );

    emit TwitterVerificationResult(params.userID, params.wallet, true, '');
  }

  function verifyTwitterUnified(
    GMStorage.MintingData storage mintingData,
    GMStorage.MintingConfig storage mintingConfig,
    VerificationParams memory params
  ) external returns (bool shouldMint, uint256 userIndex, uint256 mintAmount) {
    if (mintingData.walletsByUserIDs[params.userID] != address(0)) revert WalletAlreadyLinked();
    if (mintingData.registeredWallets[params.wallet]) revert WalletAlreadyLinked();

    (shouldMint, userIndex, mintAmount) = TwitterOracleLib.verifyTwitter(
      mintingData,
      mintingConfig,
      params.userID,
      params.wallet
    );

    emit TwitterVerificationResult(params.userID, params.wallet, true, '');
  }
}