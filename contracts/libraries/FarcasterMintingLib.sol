// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import { GMStorage } from '../Storage.sol';
import { FarcasterOracleLib } from '../FarcasterOracleLib.sol';

library FarcasterMintingLib {
  event farcasterMintingProcessed(uint32 indexed mintingDayTimestamp, GMStorage.Batch[] batches);
  event farcasterMintingErrored(uint32 indexed mintingDayTimestamp, GMStorage.Batch[] errorBatches);
  event FarcasterMintingStarted(uint32 indexed mintingDay);
  event FarcasterMintingFinished(uint32 indexed mintingDayTimestamp, string runningHash);
  event FarcasterMintingFinished_CastsUploadedToIPFS(uint32 indexed mintingDayTimestamp, string runningHash, string cid);

  function startFarcasterMinting() external {
    emit FarcasterMintingStarted(uint32(block.timestamp));
    emit farcasterMintingProcessed(uint32(block.timestamp), new GMStorage.Batch[](0));
  }

  function finishFarcasterMinting(
    uint32 mintingDayTimestamp,
    string calldata runningHash
  ) external {
    emit FarcasterMintingFinished(mintingDayTimestamp, runningHash);
  }

  function logFarcasterErrorBatches(
    uint32 mintingDayTimestamp,
    GMStorage.Batch[] calldata batches
  ) external {
    emit farcasterMintingErrored(mintingDayTimestamp, batches);
  }

  function processFarcasterMinting(
    GMStorage.MintingData storage mintingData,
    GMStorage.MintingConfig storage mintingConfig,
    GMStorage.UserFarcasterData[] calldata userData,
    uint32 mintingDayTimestamp,
    GMStorage.Batch[] calldata batches
  ) external returns (GMStorage.UserMintingResult[] memory results) {
    results = FarcasterOracleLib.processFarcasterMinting(
      mintingData,
      mintingConfig,
      userData,
      mintingDayTimestamp
    );

    if (batches.length > 0) {
      emit farcasterMintingProcessed(mintingDayTimestamp, batches);
    }
  }

  function attachIPFSCastsFile(
    uint32 mintingDayTimestamp,
    string calldata finalHash,
    string calldata cid
  ) external {
    emit FarcasterMintingFinished_CastsUploadedToIPFS(mintingDayTimestamp, finalHash, cid);
  }
}