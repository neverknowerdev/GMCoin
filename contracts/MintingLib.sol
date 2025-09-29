// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import { GMStorage } from './GMStorage.sol';
import './Errors.sol';

library MintingLib {
  using MintingLib for GMStorage.MintingData;

  function getStartOfYesterday() public view returns (uint32) {
    uint32 startOfToday = uint32((block.timestamp / 1 days) * 1 days);
    return startOfToday - 1 days;
  }

  function calculateComplexity(
    GMStorage.MintingData storage mintingData,
    GMStorage.MintingConfig storage mintingConfig,
    uint32 dayToMint,
    int32 pointsDeltaStreak
  ) internal view returns (bool isNewEpoch, uint256 newMultiplicator, int32 newPointsDeltaStreak) {
    if (
      dayToMint > mintingData.epochStartedAt &&
      dayToMint - mintingData.epochStartedAt >= mintingConfig.EPOCH_DAYS * 1 days
    ) {
      isNewEpoch = true;
      newPointsDeltaStreak = MintingLib.adjustPointsStreak(
        mintingData.lastEpochPoints,
        mintingData.currentEpochPoints,
        pointsDeltaStreak
      );

      newMultiplicator = MintingLib.changeComplexity(
        mintingConfig.COINS_MULTIPLICATOR,
        mintingData.lastEpochPoints,
        mintingData.currentEpochPoints,
        pointsDeltaStreak
      );

      return (isNewEpoch, newMultiplicator, newPointsDeltaStreak);
    }

    return (false, mintingConfig.COINS_MULTIPLICATOR, pointsDeltaStreak);
  }

  function changeComplexity(
    uint256 currentComplexity,
    uint256 lastEpochPoints,
    uint256 currentEpochPoints,
    int32 epochPointsDeltaStreak
  ) internal pure returns (uint256) {
    if (lastEpochPoints == 0) {
      return currentComplexity;
    }

    if (currentEpochPoints > lastEpochPoints) {
      return (currentComplexity * 70) / 100;
    }

    if (currentEpochPoints <= lastEpochPoints) {
      if (epochPointsDeltaStreak <= -3) {
        return (currentComplexity * 130) / 100;
      } else if (epochPointsDeltaStreak == -2) {
        return (currentComplexity * 120) / 100;
      } else {
        return currentComplexity;
      }
    }

    return currentComplexity;
  }

  function adjustPointsStreak(
    uint256 lastEpochPoints,
    uint256 currentEpochPoints,
    int32 currentPointsDeltaStreak
  ) internal pure returns (int32) {
    if (currentEpochPoints > lastEpochPoints && currentPointsDeltaStreak <= 0) {
      return 1;
    }
    if (currentEpochPoints < lastEpochPoints && currentPointsDeltaStreak >= 0) {
      return -1;
    }

    if (currentEpochPoints > lastEpochPoints) {
      return currentPointsDeltaStreak + 1;
    } else if (currentEpochPoints < lastEpochPoints) {
      return currentPointsDeltaStreak - 1;
    }

    return currentPointsDeltaStreak;
  }

  function getTwitterUsers(
    GMStorage.MintingData storage mintingData,
    uint16 start,
    uint16 end
  ) external view returns (string[] memory) {
    uint16 batchSize = uint16(end - start);
    string[] memory batchArr = new string[](batchSize);
    for (uint16 i = 0; i < batchSize; i++) {
      batchArr[i] = mintingData.allTwitterUsers[start + i];
    }

    return batchArr;
  }

  function getTwitterUsersByIndexes(
    GMStorage.MintingData storage mintingData,
    uint64[] calldata indexes
  ) external view returns (string[] memory) {
    string[] memory batchArr = new string[](indexes.length);
    for (uint16 i = 0; i < indexes.length; i++) {
      batchArr[i] = mintingData.allTwitterUsers[i];
    }

    return batchArr;
  }

  function calculatePoints(
    GMStorage.UserMintingData calldata userData,
    GMStorage.MintingConfig storage mintingConfig
  ) internal view returns (uint256) {
    return
      userData.simplePosts *
      mintingConfig.POINTS_PER_TWEET +
      userData.likes *
      mintingConfig.POINTS_PER_LIKE +
      userData.hashtagPosts *
      mintingConfig.POINTS_PER_HASHTAG +
      userData.cashtagPosts *
      mintingConfig.POINTS_PER_CASHTAG;
  }
}
