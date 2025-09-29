// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import { GMStorage } from '../Storage.sol';
import { TwitterOracleLib } from '../TwitterOracleLib.sol';
import { MintingLib } from '../MintingLib.sol';
import '../Errors.sol';

library TwitterMintingLib {
  using MintingLib for GMStorage.MintingData;

  event twitterMintingProcessed(uint32 indexed mintingDayTimestamp, GMStorage.Batch[] batches);
  event twitterMintingErrored(uint32 indexed mintingDayTimestamp, GMStorage.Batch[] errorBatches);
  event MintingStarted(uint32 indexed mintingDay);
  event MintingFinished(uint32 indexed mintingDayTimestamp, string runningHash);
  event MintingFinished_TweetsUploadedToIPFS(uint32 indexed mintingDayTimetsamp, string runningHash, string cid);
  event changedComplexity(uint256 newMultiplicator, uint256 previousEpochPoints, uint256 currentEpochPoints);

  function startMinting(
    GMStorage.MintingData storage mintingData,
    GMStorage.MintingConfig storage mintingConfig,
    int32 pointsDeltaStreak
  ) external returns (uint32 dayToMint, bool shouldReturn, int32 newPointsDeltaStreak, uint256 totalPointsToAdd) {
    bool shouldContinue;
    (dayToMint, shouldContinue, newPointsDeltaStreak) = mintingData.startMintingProcess(
      mintingConfig,
      pointsDeltaStreak
    );

    if (shouldContinue) {
      emit twitterMintingProcessed(dayToMint, new GMStorage.Batch[](0));
      shouldReturn = true;
      return (dayToMint, shouldReturn, newPointsDeltaStreak, 0);
    }

    emit changedComplexity(
      mintingConfig.COINS_MULTIPLICATOR,
      mintingData.lastEpochPoints,
      mintingData.currentEpochPoints
    );

    totalPointsToAdd = mintingData.currentEpochPoints;
    emit MintingStarted(dayToMint);
    emit twitterMintingProcessed(dayToMint, new GMStorage.Batch[](0));
    shouldReturn = false;
  }

  function continueMintingForADay(
    GMStorage.MintingData storage mintingData
  ) external {
    if (mintingData.mintingInProgressForDay == 0) revert NoOngoingMinting();

    emit twitterMintingProcessed(mintingData.mintingInProgressForDay, new GMStorage.Batch[](0));
  }

  function finishMinting(
    GMStorage.MintingData storage mintingData,
    uint32 mintingDayTimestamp,
    string calldata runningHash
  ) external returns (bool shouldStartNext) {
    shouldStartNext = mintingData.finishMintingProcess(mintingDayTimestamp);
    emit MintingFinished(mintingDayTimestamp, runningHash);
  }

  function attachIPFSTweetsFile(
    uint32 mintingDayTimestamp,
    string calldata finalHash,
    string calldata cid
  ) external {
    emit MintingFinished_TweetsUploadedToIPFS(mintingDayTimestamp, finalHash, cid);
  }

  function logErrorBatches(
    uint32 mintingDayTimestamp,
    GMStorage.Batch[] calldata batches
  ) external {
    emit twitterMintingErrored(mintingDayTimestamp, batches);
  }

  function processTwitterMinting(
    GMStorage.MintingData storage mintingData,
    GMStorage.MintingConfig storage mintingConfig,
    GMStorage.UserTwitterData[] calldata userData,
    uint32 mintingDayTimestamp,
    GMStorage.Batch[] calldata batches
  ) external returns (GMStorage.UserMintingResult[] memory results) {
    results = TwitterOracleLib.processTwitterMinting(
      mintingData,
      mintingConfig,
      userData,
      mintingDayTimestamp
    );

    if (batches.length > 0) {
      emit twitterMintingProcessed(mintingDayTimestamp, batches);
    }
  }
}