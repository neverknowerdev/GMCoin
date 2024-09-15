// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";


// Uncomment this line to use console.log
import "hardhat/console.sol";

contract GMCoin is
    Initializable,
    OwnableUpgradeable,
    ERC20Upgradeable,
    UUPSUpgradeable
{
    address plannedNewImplementation;
    uint256 public plannedNewImplementationTime;

    uint256 feePercentage; // Commission percentage in basis points (100 = 1%)
    address feeAddress;

    mapping (address => string) usernamesByAddress;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _owner,
        address _feeAddress, 
        uint256 _comissionPercentage, 
        uint256 _initialSupply    
    ) public initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ERC20_init("GM Coin", "GM");

        feePercentage = _comissionPercentage;
        feeAddress = _feeAddress;

        _mint(msg.sender, _initialSupply);
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

    function _update(address from, address to, uint256 value) internal override {
        if(from != address(0) && to != address(0)) {
            // taking fee only for transfer operation
            uint256 feeAmount = (value * feePercentage) / 10000;
            value = value - feeAmount;

            super._update(from, feeAddress, feeAmount);
        }

        super._update(from, to, value);
    }
}