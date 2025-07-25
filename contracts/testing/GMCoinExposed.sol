// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import '../GMCoin.sol';

contract GMCoinExposed is GMCoin {
  function getCurrentComplexity() public view returns (uint256) {
    return mintingConfig.COINS_MULTIPLICATOR;
  }

  function getMintingDayPointsFromUsers() public view returns (uint256) {
    return mintingData.mintingDayPointsFromUsers;
  }

  function getStartOfTheEpoch() public view returns (uint256) {
    return mintingData.epochStartedAt;
  }

  function mintForWallet(address wallet, uint value) public onlyOwner {
    _mint(wallet, value);
  }

  function mintedAmountByCoin(address wallet) public view returns (uint256) {
    return mintingData.mintedAmountByWallet[wallet];
  }
}
