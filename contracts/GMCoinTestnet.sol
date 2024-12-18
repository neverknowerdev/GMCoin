// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "./GMCoin.sol";

contract GMCoinTestnet is GMCoin
{
    function addTwitterUsername(string calldata userID, address walletAddress) public {
        wallets[userID] = walletAddress;
        allTwitterUsers.push(userID);
        emit TwitterConnected(userID, walletAddress);
    }

    function getWalletByUserID(string calldata username) public view returns (address) {
        return walletByTwitterUser(username);
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