// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import { GMStorage } from './Storage.sol';
import './Errors.sol';

library FarcasterOracleLib {
  function verifyFarcaster(
    GMStorage.MintingData storage mintingData,
    GMStorage.MintingConfig storage mintingConfig,
    uint256 farcasterFid,
    address wallet
  ) external returns (bool shouldMint, uint256 userIndex, uint256 mintAmount) {
    mintingData.farcasterUsersByWallets[wallet] = farcasterFid;
    mintingData.registeredWallets[wallet] = true;

    if (mintingData.farcasterWalletsByFIDs[farcasterFid] == address(0)) {
      mintingData.farcasterWalletsByFIDs[farcasterFid] = wallet;
      mintingData.allFarcasterUsers.push(farcasterFid);
      mintingData.farcasterUserIndexByFID[farcasterFid] = mintingData.allFarcasterUsers.length - 1;

      return (
        true,
        mintingData.allFarcasterUsers.length - 1,
        mintingConfig.COINS_MULTIPLICATOR * mintingConfig.POINTS_PER_TWEET
      );
    }
    return (false, 0, 0);
  }

  function verifyBothFarcasterAndTwitter(
    GMStorage.MintingData storage mintingData,
    GMStorage.MintingConfig storage mintingConfig,
    uint256 farcasterFid,
    address wallet,
    string calldata twitterId
  ) external returns (bool shouldMintFarcaster, uint256 farcasterUserIndex, uint256 farcasterMintAmount) {
    // First verify Farcaster - inline the logic
    mintingData.farcasterUsersByWallets[wallet] = farcasterFid;
    mintingData.registeredWallets[wallet] = true;

    if (mintingData.farcasterWalletsByFIDs[farcasterFid] == address(0)) {
      mintingData.farcasterWalletsByFIDs[farcasterFid] = wallet;
      mintingData.allFarcasterUsers.push(farcasterFid);
      mintingData.farcasterUserIndexByFID[farcasterFid] = mintingData.allFarcasterUsers.length - 1;

      shouldMintFarcaster = true;
      farcasterUserIndex = mintingData.allFarcasterUsers.length - 1;
      farcasterMintAmount = mintingConfig.COINS_MULTIPLICATOR * mintingConfig.POINTS_PER_TWEET;
    }

    // Register Twitter user if not already exists
    if (mintingData.walletsByUserIDs[twitterId] == address(0)) {
      mintingData.allTwitterUsers.push(twitterId);
      mintingData.userIndexByUserID[twitterId] = mintingData.allTwitterUsers.length - 1;
    }

    mintingData.usersByWallets[wallet] = twitterId;
    mintingData.walletsByUserIDs[twitterId] = wallet;
  }

  function mergeUnifiedAccounts(
    GMStorage.MintingData storage mintingData,
    GMStorage.MintingConfig storage mintingConfig,
    uint256 farcasterFid,
    string calldata twitterId,
    address wallet
  ) external returns (bool shouldMint, uint256 userIndex, uint256 mintAmount) {
    if (!mintingData.unifiedUserSystemEnabled) revert SystemNotEnabled();

    // Get existing user IDs
    uint256 twitterUserId = mintingData.twitterIdToUnifiedUserId[twitterId];
    uint256 walletUserId = mintingData.walletToUnifiedUserId[wallet];

    if (twitterUserId == 0) revert UserNotFoundInUnifiedSystem();
    if (walletUserId != 0) revert WalletAlreadyHasUnifiedUser();

    // Verify Farcaster first - inline the logic
    mintingData.farcasterUsersByWallets[wallet] = farcasterFid;
    mintingData.registeredWallets[wallet] = true;

    if (mintingData.farcasterWalletsByFIDs[farcasterFid] == address(0)) {
      mintingData.farcasterWalletsByFIDs[farcasterFid] = wallet;
      mintingData.allFarcasterUsers.push(farcasterFid);
      mintingData.farcasterUserIndexByFID[farcasterFid] = mintingData.allFarcasterUsers.length - 1;

      shouldMint = true;
      userIndex = mintingData.allFarcasterUsers.length - 1;
      mintAmount = mintingConfig.COINS_MULTIPLICATOR * mintingConfig.POINTS_PER_TWEET;
    }

    // Link the wallet and Farcaster to existing Twitter unified account
    mintingData.walletToUnifiedUserId[wallet] = twitterUserId;
    mintingData.unifiedUserWallets[twitterUserId].push(wallet);
    mintingData.unifiedUsers[twitterUserId].farcasterFid = farcasterFid;
    mintingData.farcasterFidToUnifiedUserId[farcasterFid] = twitterUserId;
  }

  function processFarcasterMinting(
    GMStorage.MintingData storage mintingData,
    GMStorage.MintingConfig storage mintingConfig,
    GMStorage.UserFarcasterData[] calldata userData,
    uint32 mintingDayTimestamp
  ) external returns (GMStorage.UserMintingResult[] memory results) {
    if (mintingData.mintingInProgressForDay == 0) revert NoOngoingMinting();
    if (mintingDayTimestamp != mintingData.mintingInProgressForDay) revert WrongMintingDay();

    results = new GMStorage.UserMintingResult[](userData.length);

    for (uint256 i = 0; i < userData.length; i++) {
      if (userData[i].userIndex > mintingData.allFarcasterUsers.length) {
        revert WrongUserIndex();
      }

      uint256 points = userData[i].simpleCasts *
        mintingConfig.POINTS_PER_TWEET +
        userData[i].likes *
        mintingConfig.POINTS_PER_LIKE +
        userData[i].hashtagCasts *
        mintingConfig.POINTS_PER_HASHTAG +
        userData[i].cashtagCasts *
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

  function getFarcasterUsers(
    GMStorage.MintingData storage mintingData,
    uint64 start,
    uint16 count
  ) external view returns (uint256[] memory) {
    uint64 end = start + count;
    if (end > mintingData.allFarcasterUsers.length) {
      end = uint64(mintingData.allFarcasterUsers.length);
    }

    if (start > end) revert WrongStartIndex();

    uint16 batchSize = uint16(end - start);
    uint256[] memory batchArr = new uint256[](batchSize);
    for (uint16 i = 0; i < batchSize; i++) {
      batchArr[i] = mintingData.allFarcasterUsers[start + i];
    }

    return batchArr;
  }

  function walletByFarcasterUserIndex(
    GMStorage.MintingData storage mintingData,
    uint256 userIndex
  ) external view returns (address) {
    return mintingData.farcasterWalletsByFIDs[mintingData.allFarcasterUsers[userIndex]];
  }

  function isFarcasterUserRegistered(
    GMStorage.MintingData storage mintingData,
    uint256 farcasterFid
  ) external view returns (bool) {
    return mintingData.registeredWallets[mintingData.farcasterWalletsByFIDs[farcasterFid]];
  }

  function getWalletByFID(
    GMStorage.MintingData storage mintingData,
    uint256 farcasterFid
  ) external view returns (address) {
    return mintingData.farcasterWalletsByFIDs[farcasterFid];
  }

  function getFIDByWallet(
    GMStorage.MintingData storage mintingData,
    address wallet
  ) external view returns (uint256) {
    return mintingData.farcasterUsersByWallets[wallet];
  }

  function totalFarcasterUsersCount(
    GMStorage.MintingData storage mintingData
  ) external view returns (uint256) {
    return mintingData.allFarcasterUsers.length;
  }
}