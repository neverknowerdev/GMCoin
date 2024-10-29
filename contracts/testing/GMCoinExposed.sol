// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "../GMCoin.sol";

contract GMCoinExposed is GMCoin
{
    function getWalletByUsername(string calldata username) public view returns (address) {
        return walletByTwitterUsername(username);
    }

    function getCurrentComplexity() public view returns (uint256) {
        return COINS_MULTIPLICATOR;
    }

    function getMintingDayPointsFromUsers() public view returns (uint256) {
        return mintingDayPointsFromUsers;
    }

    function getStartOfTheEpoch() public view returns (uint256) {
        return epochStartedAt;
    }
}