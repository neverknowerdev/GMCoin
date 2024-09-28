// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "../GMCoin.sol";

contract GMCoinExposed is GMCoin
{
    function getWalletByUsername(string calldata username) public view returns (address) {
        return wallets[username];
    }
}