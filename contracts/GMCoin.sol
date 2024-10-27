// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./parts/TwitterOracle.sol";

// Uncomment this line to use console.log
import "hardhat/console.sol";

contract GMCoin is
    Initializable,
    OwnableUpgradeable,
    ERC20Upgradeable,
    UUPSUpgradeable,
    GMTwitterOracle
{

    address plannedNewImplementation;
    uint256 public plannedNewImplementationTime;

    uint256 feePercentage; // Commission percentage in basis points (100 = 1%)
    address feeAddress;

    uint256 public liquidityPoolCollectedAmount;

    uint256 public totalHolders;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _owner,
        address _feeAddress, 
        uint256 _comissionPercentage, 
        uint256 _initialSupply,
        address _gelatoOracleAddress    ,
        uint256 coinsMultiplicator
    ) public initializer {
        feePercentage = _comissionPercentage;
        feeAddress = _feeAddress;
        gelatoAddress = _gelatoOracleAddress;
        totalHolders = 0;

        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ERC20_init("GM Coin", "GM");
        __TwitterOracle__init(coinsMultiplicator, _gelatoOracleAddress);

        _mint(address(_owner), _initialSupply);
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

        plannedNewImplementationTime = 0;
        plannedNewImplementation = address(0);
        
        super.upgradeToAndCall(newImplementation, data);
    }

    function _update(address from, address to, uint256 value) internal override {
        if(from != address(0) && to != address(0)) {
            // taking fee only for transfer operation
            uint256 feeAmount = (value * feePercentage) / 10000;
            value = value - feeAmount; 

            super._update(from, feeAddress, feeAmount);
        }

        super._update(from, to, value);

        if (from != address(0) && balanceOf(from) == 0) { // --
            totalHolders--;
        } 
        if(to != address(0) && balanceOf(to)- value == 0) { // ++
            totalHolders++;
        }
    }

    function _mintForUserByIndex(uint256 userIndex, uint256 amount) internal override {
        address walletAddr = walletByTwitterUserIndex(userIndex);
        require(walletAddr != address(0), "walletAddr shouldn't be zero!");

        // 50% of amount is going to liquidity pool
        uint256 amountToMintForLiquidityPool = amount * 50 / 100;

        liquidityPoolCollectedAmount += amountToMintForLiquidityPool;

        _mint(address(this), amountToMintForLiquidityPool);
        _mint(walletAddr, amount);
    }
}