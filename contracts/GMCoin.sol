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

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _owner,
        address _feeAddress, 
        uint256 _comissionPercentage, 
        uint256 _initialSupply,
        address _gelatoOracleAddress    
    ) public initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ERC20_init("GM Coin", "GM");

        feePercentage = _comissionPercentage;
        feeAddress = _feeAddress;
        gelatoAddress = _gelatoOracleAddress;

        _mint(address(this), _initialSupply);
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

/*
    Twitter verification
*/
    event TwitterVerificationRequested(string username, address wallet);
    event TwitterLinked(string username, address wallet);

    mapping (string => address) walletsByUsernames;
    string[] public allTwitterUsernames;

    address gelatoAddress;

    function getTwitterUsernames(uint256 start, uint256 count) external view returns (string[] memory) {
        require(start < allTwitterUsernames.length, "Start index out of bounds");
    
        uint256 end = start + count;
        if (end > allTwitterUsernames.length) {
            end = allTwitterUsernames.length;
        }
        uint256 batchSize = end - start;
        string[] memory batch = new string[](batchSize);
        for (uint256 i = 0; i < batchSize; i++) {
            batch[i] = allTwitterUsernames[start + i];
        }
        return batch;
    }
    
    function linkTwitter(string calldata username, address wallet) public {
        require(walletsByUsernames[username] == address(0), "you're already linked twitter");

        emit TwitterVerificationRequested(username, wallet);
    }

    function verifyTwitter(string calldata username, address wallet) public {
        require(msg.sender == gelatoAddress, "only Gelato can call this function");

        if (walletsByUsernames[username] == address(0)) {
            walletsByUsernames[username] = wallet;
            allTwitterUsernames.push(username);
        }
    }

    function updateTwitterStat(string[] calldata usernames, uint256[] calldata points) public {
        require(msg.sender == gelatoAddress, "only Gelato can call this function");
        require(usernames.length == points.length, "wrong input array lengths");
        require(usernames.length > 0, "empty array");

        for(uint32 i=0; i<usernames.length; i++) {      
            address walletAddr = walletsByUsernames[usernames[i]];
            uint256 amount = points[i] * 10;
            _transfer(address(this), walletAddr, amount);
        }
    }
}