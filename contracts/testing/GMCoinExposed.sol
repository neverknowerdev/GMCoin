// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "../GMCoin.sol";

contract GMCoinExposed is GMCoin
{
    function getWalletByUsername(string calldata username) public view returns (address) {
        return walletByTwitterUsername(username);
    }

    function getAllStakerIndexes() public view returns (uint256[] memory) {
        return stakerIDs;
    }

    function getMintingDayTotalPoints() public view returns (uint256) {
        return mintingDayTotalPoints;
    }

    function getMintingDayPointsFromUsers() public view returns (uint256) {
        return mintingDayPointsFromUsers;
    }

    function getMintingDayTotalCoinsStaked() public view returns (uint256) {
        return mintingDayTotalCoinsStaked;
    }
}