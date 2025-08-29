// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import './GMCoin.sol';

contract GMCoinTestnet is GMCoin {
  function addTwitterUsername(string calldata userID, address walletAddress) public {
    mintingData.allTwitterUsers.push(userID);
    mintingData.twitterIdToUnifiedUserId[userID] = mintingData.nextUserId;
    mintingData.unifiedUsers[mintingData.nextUserId].twitterId = userID;
    mintingData.nextUserId++;
  }

  function getCurrentComplexity() public view returns (uint256) {
    return mintingConfig.COINS_MULTIPLICATOR;
  }

  function getMintingDayPointsFromUsers() public view returns (uint256) {
    return mintingData.mintingDayPointsFromUsers;
  }

  function getStartOfTheEpoch() public view returns (uint256) {
    return mintingData.epochStartedAt;
  }

  function forceTimeLockUpdateTestnet(address newImplementation) public {
    timeLockConfig.plannedNewImplementation = newImplementation;
    timeLockConfig.plannedNewImplementationTime = block.timestamp - 1 minutes;
  }

  function triggerTwitterVerificationResult(
    string calldata userID,
    address wallet,
    bool isVerified,
    string calldata errorMessage
  ) public onlyOwner {
    emit TwitterVerificationResult(userID, wallet, isVerified, errorMessage);
  }

  function triggerVerifyTwitter(string calldata userID, address wallet) public onlyOwner {
    emit TwitterVerificationResult(userID, wallet, true, '');
  }
}
