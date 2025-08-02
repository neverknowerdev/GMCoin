// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import { GMStorage } from './Storage.sol';

library FarcasterOracleLib {
  using FarcasterOracleLib for GMStorage.MintingData;

  // Events need to be defined in the contract that uses this library

  // Farcaster verification functions

  function requestFarcasterVerification(
    GMStorage.MintingData storage mintingData,
    uint256 farcasterFid,
    address sender
  ) external {
    require(mintingData.farcasterWalletsByFIDs[farcasterFid] == address(0), 'Farcaster account already linked');
    require(mintingData.farcasterUsersByWallets[sender] == 0, 'wallet already linked to FID');
  }

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

  // Error handling moved to main contract

  // Farcaster query functions

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

  function getFarcasterUsers(
    GMStorage.MintingData storage mintingData,
    uint64 start,
    uint16 count
  ) external view returns (uint256[] memory) {
    uint64 end = start + count;
    if (end > mintingData.allFarcasterUsers.length) {
      end = uint64(mintingData.allFarcasterUsers.length);
    }

    require(start <= end, 'wrong start index');

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

  // Farcaster minting functions

  // Minting functions moved to main contract

  function processFarcasterMinting(
    GMStorage.MintingData storage mintingData,
    GMStorage.MintingConfig storage mintingConfig,
    GMStorage.UserFarcasterData[] calldata userData,
    uint32 mintingDayTimestamp
  ) external returns (GMStorage.UserMintingResult[] memory results) {
    require(mintingData.mintingInProgressForDay != 0, 'no ongoing minting process');
    require(mintingDayTimestamp == mintingData.mintingInProgressForDay, 'wrong mintingDay');

    results = new GMStorage.UserMintingResult[](userData.length);

    for (uint256 i = 0; i < userData.length; i++) {
      if (userData[i].userIndex > mintingData.allFarcasterUsers.length) {
        revert('wrong userIndex');
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

  /**
   * @dev Enhanced Farcaster verification that creates unified users
   */
  // Unified verification moved to main contract
}