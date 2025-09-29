// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import './GMCoin.sol';

contract GMCoinTestnet is GMCoin {
  function addTwitterUsername(string calldata userID, address walletAddress) public {
    mintingData.allTwitterUsers.push(userID);
    mintingData.userIndexByTwitterId[userID] = mintingData.allTwitterUsers.length - 1;
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
}
