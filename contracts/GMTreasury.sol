// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract GMTreasury is Ownable {
    IERC20 public token;
    uint256 public unlockTime = block.timestamp + 90 days;
    uint8 public withdrawalCount = 0;

    constructor() Ownable(msg.sender) {

    }

    event TokensWithdrawn(address indexed owner, uint256 amount);
    event TokenSet(address indexed token);

    // Withdrawal opens in 90 days after contract deployment, and then closes for another 90 days.
    function withdrawAll() public onlyOwner {
        require(block.timestamp >= unlockTime, "Treasury: Funds are still locked");

        withdrawalCount++;

        // Withdraw GM tokens if any
        uint256 tokenBalance = token.balanceOf(address(this));
        if (tokenBalance > 0) {
            require(token.transfer(owner(), tokenBalance), "Treasury: Token transfer failed");
            emit TokensWithdrawn(owner(), tokenBalance);
        }

        if (withdrawalCount == 1) {
            unlockTime = block.timestamp + 90 days;
        }
    }

    function setToken(IERC20 _token) public onlyOwner {
        require(address(token) == address(0), "Token is already set");

        token = _token;

        emit TokenSet(address(_token));
    }
}