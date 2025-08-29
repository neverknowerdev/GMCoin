// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import { GMStorage } from './Storage.sol';
import './Errors.sol';

library TwitterOracleLib {
  using TwitterOracleLib for GMStorage.MintingData;

  // Events need to be defined in the contract that uses this library

  // Twitter verification functions

  function requestTwitterVerification(
    GMStorage.MintingData storage mintingData,
    string calldata userID,
    address wallet
  ) external view {
    if (mintingData.walletsByUserIDs[userID] != address(0)) revert WalletAlreadyLinked();
    if (mintingData.registeredWallets[wallet]) revert UserAlreadyLinked();
  }

  function verifyTwitter(
    GMStorage.MintingData storage mintingData,
    GMStorage.MintingConfig storage mintingConfig,
    string calldata userID,
    address wallet
  ) external returns (bool shouldMint, uint256 userIndex, uint256 mintAmount) {
    mintingData.usersByWallets[wallet] = userID;
    mintingData.registeredWallets[wallet] = true;

    if (mintingData.walletsByUserIDs[userID] == address(0)) {
      mintingData.walletsByUserIDs[userID] = wallet;
      mintingData.allTwitterUsers.push(userID);
      mintingData.userIndexByUserID[userID] = mintingData.allTwitterUsers.length - 1;

      return (
        true,
        mintingData.allTwitterUsers.length - 1,
        mintingConfig.COINS_MULTIPLICATOR * mintingConfig.POINTS_PER_TWEET
      );
    }
    return (false, 0, 0);
  }

  // Twitter query functions

  function isTwitterUserRegistered(
    GMStorage.MintingData storage mintingData,
    string calldata userID
  ) external view returns (bool) {
    return mintingData.registeredWallets[mintingData.walletsByUserIDs[userID]];
  }

  function getWalletByUserID(
    GMStorage.MintingData storage mintingData,
    string calldata username
  ) external view returns (address) {
    return mintingData.walletsByUserIDs[username];
  }

  function getUserByWallet(
    GMStorage.MintingData storage mintingData,
    address wallet
  ) external view returns (string memory) {
    return mintingData.usersByWallets[wallet];
  }

  function getTwitterUsers(
    GMStorage.MintingData storage mintingData,
    uint64 start,
    uint16 count
  ) external view returns (string[] memory) {
    uint64 end = start + count;
    if (end > mintingData.allTwitterUsers.length) {
      end = uint64(mintingData.allTwitterUsers.length);
    }

    if (start > end) revert WrongStartIndex();

    uint16 batchSize = uint16(end - start);
    string[] memory batchArr = new string[](batchSize);
    for (uint16 i = 0; i < batchSize; i++) {
      batchArr[i] = mintingData.allTwitterUsers[start + i];
    }

    return batchArr;
  }

  function walletByTwitterUserIndex(
    GMStorage.MintingData storage mintingData,
    uint256 userIndex
  ) external view returns (address) {
    return mintingData.walletsByUserIDs[mintingData.allTwitterUsers[userIndex]];
  }

  // Twitter minting functions

  function processTwitterMinting(
    GMStorage.MintingData storage mintingData,
    GMStorage.MintingConfig storage mintingConfig,
    GMStorage.UserTwitterData[] calldata userData,
    uint32 mintingDayTimestamp
  ) external returns (GMStorage.UserMintingResult[] memory results) {
    if (mintingData.mintingInProgressForDay == 0) revert NoOngoingMinting();
    if (mintingDayTimestamp != mintingData.mintingInProgressForDay) revert WrongMintingDay();

    results = new GMStorage.UserMintingResult[](userData.length);

    for (uint256 i = 0; i < userData.length; i++) {
      if (userData[i].userIndex > mintingData.allTwitterUsers.length) {
        revert WrongUserIndex();
      }

      uint256 points = userData[i].simpleTweets *
        mintingConfig.POINTS_PER_TWEET +
        userData[i].likes *
        mintingConfig.POINTS_PER_LIKE +
        userData[i].hashtagTweets *
        mintingConfig.POINTS_PER_HASHTAG +
        userData[i].cashtagTweets *
        mintingConfig.POINTS_PER_CASHTAG;

      if (points > 0) {
        mintingData.mintingDayPointsFromUsers += points;
        uint256 coins = points * mintingConfig.COINS_MULTIPLICATOR;
        results[i] = GMStorage.UserMintingResult({
          userIndex: userData[i].userIndex,
          mintAmount: coins,
          shouldMint: true
        });
      } else {
        results[i] = GMStorage.UserMintingResult({
          userIndex: userData[i].userIndex,
          mintAmount: 0,
          shouldMint: false
        });
      }
    }
  }

  /**
   * @dev Enhanced Twitter verification that creates unified users
   */
  // Unified verification moved to main contract
}
