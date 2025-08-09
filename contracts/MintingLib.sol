// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import { GMStorage } from './Storage.sol';

library MintingLib {
  using MintingLib for GMStorage.MintingData;

  function startMintingProcess(
    GMStorage.MintingData storage mintingData,
    GMStorage.MintingConfig storage mintingConfig,
    int32 currentPointsDeltaStreak
  ) external returns (uint32 dayToMint, bool shouldContinue, int32 newPointsDeltaStreak) {
    uint32 yesterday = getStartOfYesterday();
    dayToMint = mintingData.lastMintedDay + 1 days;

    // if minting for previous day is not finished - continue it
    if (mintingData.mintingInProgressForDay > 0 && mintingData.mintingInProgressForDay < yesterday) {
      return (mintingData.mintingInProgressForDay, true, currentPointsDeltaStreak);
    }

    require(dayToMint <= yesterday, 'dayToMint should be not further than yesterday');
    require(mintingData.mintingInProgressForDay == 0, 'minting process already started');

    mintingData.mintingInProgressForDay = dayToMint;

    // complexity calculation - start new epoch
    if (
      dayToMint > mintingData.epochStartedAt &&
      dayToMint - mintingData.epochStartedAt >= mintingConfig.EPOCH_DAYS * 1 days
    ) {
      newPointsDeltaStreak = adjustPointsStreak(
        mintingData.lastEpochPoints,
        mintingData.currentEpochPoints,
        currentPointsDeltaStreak
      );

      uint256 newMultiplicator = changeComplexity(
        mintingConfig.COINS_MULTIPLICATOR,
        mintingData.lastEpochPoints,
        mintingData.currentEpochPoints,
        newPointsDeltaStreak
      );

      mintingConfig.COINS_MULTIPLICATOR = newMultiplicator;
      mintingData.epochStartedAt = dayToMint;
      mintingConfig.epochNumber++;
      mintingData.lastEpochPoints = mintingData.currentEpochPoints;
      mintingData.currentEpochPoints = 0;
    } else {
      newPointsDeltaStreak = currentPointsDeltaStreak;
    }

    return (dayToMint, false, newPointsDeltaStreak);
  }

  function finishMintingProcess(
    GMStorage.MintingData storage mintingData,
    uint32 mintingDayTimestamp
  ) external returns (bool shouldStartNext) {
    require(mintingDayTimestamp == mintingData.mintingInProgressForDay, 'wrong mintingDay');
    require(mintingData.lastMintedDay < mintingDayTimestamp, 'wrong mintingDayTimestamp');

    mintingData.currentEpochPoints += mintingData.mintingDayPointsFromUsers;
    mintingData.lastMintedDay = mintingDayTimestamp;
    mintingData.mintingDayPointsFromUsers = 0;
    mintingData.mintingInProgressForDay = 0;

    uint32 yesterday = getStartOfYesterday();
    return (mintingData.lastMintedDay < yesterday);
  }

  // processTwitterMinting moved to TwitterOracleLib for proper separation of concerns

  function getStartOfYesterday() public view returns (uint32) {
    uint32 startOfToday = uint32((block.timestamp / 1 days) * 1 days);
    return startOfToday - 1 days;
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
}
