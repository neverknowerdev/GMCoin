// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
// Uncomment this line to use console.log
import "hardhat/console.sol";

contract GMCoinV2 is 
    Initializable,
    OwnableUpgradeable,
    ERC20Upgradeable,
    UUPSUpgradeable
{

    address plannedNewImplementation;
    uint256 public plannedNewImplementationTime;

    function initializeV2() public reinitializer(2) {
        console.log('init2');
        __ERC20_init("TwitterCoin2", "TWTCOIN");
        _mint(msg.sender, 2000);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
    }
    
    function scheduleUpgrade(address newImplementation) public payable onlyOwner {
        require(newImplementation != address(0), "wrong newImplementation address");
        require(plannedNewImplementation != newImplementation, "you already planned upgrade with this implementation");
        
        plannedNewImplementation = newImplementation;
        plannedNewImplementationTime = block.timestamp + 1 days;
        
    }

    function upgradeToAndCall(address newImplementation, bytes memory data) public override onlyOwner payable {
        require(newImplementation != address(0), "wrong newImplementation address");
        require(newImplementation == plannedNewImplementation, "you should schedule upgrade first");
        require(block.timestamp > plannedNewImplementationTime, "timeDelay is not passed to make an upgrade");

        super.upgradeToAndCall(newImplementation, data);

        plannedNewImplementationTime = 0;
        plannedNewImplementation = address(0);
    }
}