// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "./TwitterOracle2.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

// Uncomment this line to use console.log
//import "hardhat/console.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

contract GMCoinV2 is Initializable, OwnableUpgradeable, ERC20Upgradeable, UUPSUpgradeable, GMTwitterOracleV2
{
    address public plannedNewImplementation;
    uint256 public plannedNewImplementationTime;

    // Commission percentage in basis points (100 = 1%)
    uint256 public feePercentage; // % fee of transaction goes to the team for maintenance
    uint256 public treasuryPercentage; // % of minted tokens goes to Treasury that locks fund for 3 months
    address feeAddress;
    address treasuryAddress;

    uint256 public totalHolders;

    uint256[255] private __gap;

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
        feeAddress = _feeAddress;
        treasuryAddress = _treasuryAddress;
        totalHolders = 0;

        feePercentage = 100; // 1% fee of transaction
        treasuryPercentage = 500; // 5% of minted coins

        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __GelatoWeb3Functions__init(_owner);
        __ERC20_init("GM Coin", "GM");
        __TwitterOracle__init(coinsMultiplicator, dedicatedMsgSender, _relayServerAddress, _epochDays);
    }

    function initialize2() public reinitializer(2) onlyOwner {
        __TwitterOracle__init2();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
    }

    // disabled Timelock for testing period on Mainnet, then would be turned on
//    function scheduleUpgrade(address newImplementation) public onlyOwner {
//        require(newImplementation != address(0), "wrong newImplementation address");
//        require(plannedNewImplementation != newImplementation, "you already planned upgrade with this implementation");
//
//        plannedNewImplementation = newImplementation;
//        plannedNewImplementationTime = block.timestamp + 3 days;
//    }
//
//    function upgradeToAndCall(address newImplementation, bytes memory data) public override payable onlyOwner {
//        require(newImplementation != address(0), "wrong newImplementation address");
//        require(newImplementation == plannedNewImplementation, "you should schedule upgrade first");
//        require(block.timestamp > plannedNewImplementationTime, "timeDelay is not passed to make an upgrade");
//
//        plannedNewImplementationTime = 0;
//        plannedNewImplementation = address(0);
//
//        super.upgradeToAndCall(newImplementation, data);
//    }


    function _update(address from, address to, uint256 value) internal override {
        // minting
        if (from == address(0) && to != address(0)) {
            super._update(address(0), treasuryAddress, (value * treasuryPercentage) / 10000);

            // if transfer
        } else if (from != address(0) && to != address(0)) {
            // taking fee only for transfer operation
            uint256 feeAmount = (value * feePercentage) / 10000;
            value = value - feeAmount;

            super._update(from, feeAddress, feeAmount);
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