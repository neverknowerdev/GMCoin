// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./TwitterOracle.sol";

// Uncomment this line to use console.log
//import "hardhat/console.sol";
import {GMWeb3Functions} from "./GelatoWeb3Functions.sol";
import {GMStorage} from "./Storage.sol";

contract GMCoin is GMStorage, Initializable, OwnableUpgradeable, ERC20Upgradeable, UUPSUpgradeable, GMTwitterOracle
{
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _owner,
        address _feeAddress,
        address _treasuryAddress,
        address _relayServerAddress,
        uint256 coinsMultiplicator,
        uint _epochDays
    ) public initializer {
        feeConfig.feeAddress = _feeAddress;
        feeConfig.treasuryAddress = _treasuryAddress;
        totalHolders = 0;

        feeConfig.feePercentage = 100; // 1% fee of transaction
        feeConfig.treasuryPercentage = 1000; // 10% of minted coins

        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __GelatoWeb3Functions__init(_owner);
        __ERC20_init("GM Coin", "GM");
        __TwitterOracle__init(coinsMultiplicator, dedicatedMsgSender, _relayServerAddress, _epochDays);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
    }

    // disabled Timelock for testing period on Mainnet, then would be turned on
    function scheduleUpgrade(address newImplementation) public onlyOwner {
        require(newImplementation != address(0), "wrong newImplementation address");
        require(timeLockConfig.plannedNewImplementation != newImplementation, "you already planned upgrade with this implementation");

        timeLockConfig.plannedNewImplementation = newImplementation;
        timeLockConfig.plannedNewImplementationTime = block.timestamp + 3 days;
    }

    function upgradeToAndCall(address newImplementation, bytes memory data) public override payable onlyOwner {
        require(newImplementation != address(0), "wrong newImplementation address");
        require(newImplementation == timeLockConfig.plannedNewImplementation, "you should schedule upgrade first");
        require(block.timestamp > timeLockConfig.plannedNewImplementationTime, "timeDelay is not passed to make an upgrade");

        timeLockConfig.plannedNewImplementationTime = 0;
        timeLockConfig.plannedNewImplementation = address(0);

        super.upgradeToAndCall(newImplementation, data);
    }


    function _update(address from, address to, uint256 value) internal override {
        // minting
        if (from == address(0) && to != address(0)) {
            super._update(address(0), feeConfig.treasuryAddress, (value * feeConfig.treasuryPercentage) / 10000);

            // if transfer
        } else if (from != address(0) && to != address(0)) {
            // taking fee only for transfer operation
            uint256 feeAmount = (value * feeConfig.feePercentage) / 10000;
            value = value - feeAmount;

            super._update(from, feeConfig.feeAddress, feeAmount);
        }

        // holders++ if "to" was zero and become > zero (before transaction)
        // holders-- if "from" was not zero and become zero (after transaction)
        if (to != address(0) && balanceOf(to) == 0 && value > 0) { // ++
            totalHolders++;
        }

        super._update(from, to, value);

        if (from != address(0) && balanceOf(from) == 0 && value > 0) { // --
            totalHolders--;
        }
    }

    function _mintForUserByIndex(uint256 userIndex, uint256 amount) internal override {
        address walletAddr = walletByTwitterUserIndex(userIndex);
        require(walletAddr != address(0), "walletAddr shouldn't be zero!");

        _mint(walletAddr, amount);
    }
}