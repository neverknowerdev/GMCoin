// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "../GMCoin.sol";

contract GMCoinExposed is GMCoin
{
    function getWalletByUserID(string calldata username) public view returns (address) {
        return walletByTwitterUser(username);
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

    function mintForWallet(address wallet, uint value) public onlyOwner {
        _mint(wallet, value);
    }
}