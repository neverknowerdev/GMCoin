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

    uint256 totalHolders;
    address[] holderWallets;
    mapping(address => uint256) holderWalletToIndex;
    function _update(address from, address to, uint256 value) internal override {
        if(from != address(0) && to != address(0)) {
            // taking fee only for transfer operation
            uint256 feeAmount = (value * feePercentage) / 10000;
            value = value - feeAmount; 

            super._update(from, feeAddress, feeAmount);
        }

        super._update(from, to, value);

        if (balanceOf(from) == 0) { // --
            totalHolders--;

            uint256 fromIndex = holderWalletToIndex[from];
            holderWallets[fromIndex] = holderWallets[holderWallets.length-1];
            holderWalletToIndex[holderWallets[holderWallets.length-1]] = fromIndex;
            holderWallets.pop();

            holderWalletToIndex[from] = 0;
        } 
        if(balanceOf(to)- value == 0) { // ++
            totalHolders++;

            holderWallets.push(to);
            holderWalletToIndex[to] = holderWallets.length;
        }
    }

    mapping (string => address) wallets;
    string[] public allTwitterUsers;
    uint256 public totalUsers = 0;

    address gelatoAddress;
    event VerifyTwitterRequested(string authCode, string verifier, address wallet);

    function getTwitterUsers(uint256 start, uint256 count) external view returns (string[] memory) {
        require(start < allTwitterUsers.length, "Start index out of bounds");
    
        uint256 end = start + count;
        if (end > allTwitterUsers.length) {
            end = allTwitterUsers.length;
        }
        uint256 batchSize = end - start;
        string[] memory batch = new string[](batchSize);
        for (uint256 i = 0; i < batchSize; i++) {
            batch[i] = allTwitterUsers[start + i];
        }
        return batch;
    }

    function verifyTwitterRequest(string calldata authCode, string calldata verifier) public {
        emit VerifyTwitterRequested(authCode, verifier, msg.sender);
    }

    function verifyTwitter(string calldata userEncoded, address wallet) public {
        require(msg.sender == gelatoAddress, "only Gelato can call this function");

        wallets[userEncoded] = wallet;
        allTwitterUsers.push(userEncoded);
    }

    // 1.0 = value / 100_000
    uint256 public COINS_MULTIPLICATOR = 100_000_000;
    uint256 public POINTS_MULTIPLICATOR_PER_TWEET = 1_000_000;
    uint256 public POINTS_MULTIPLICATOR_PER_LIKE = 1_000_000;

    uint256 public dayPoints = 0; // total tweets + likes for usernames
    uint256 public dayPointsFromStakers = 0; // (total tweets - user's tweets) + likes for usernames
    uint256 countedUsers = 0;
    uint256 lastMintedDay = 0;
    uint256 lastDaySupply = 0;

    uint256 public constant SECONDS_IN_A_DAY = 60*60*24;
    uint256 currentDay = block.timestamp % (SECONDS_IN_A_DAY);

    function mintCoinsForTwitterUsers(uint256 startIndex, uint256 endIndex, uint256[] calldata tweets, uint256[] calldata likes) public {
        require(msg.sender == gelatoAddress, "only Gelato can call this function");
        require((endIndex - startIndex == tweets.length) && (tweets.length == likes.length), "wrong input array lengths");
        require(endIndex - startIndex > 0, "empty array");

        // new day?
        if(startIndex == 0) {
            if (block.timestamp % SECONDS_IN_A_DAY == lastMintedDay) {
                revert("minting process already started for this day");
            }

            lastDaySupply = totalSupply();
        }

        for(uint256 i=startIndex; i<endIndex; i++) {
            address walletAddr = wallets[allTwitterUsers[i]];
            // TODO here: convertation from 100_000 
            uint256 amount = tweets[i] * POINTS_MULTIPLICATOR_PER_TWEET+ likes[i] * POINTS_MULTIPLICATOR_PER_LIKE;
            amount *= COINS_MULTIPLICATOR;
            _mint(walletAddr, amount);
        }
    }

    function mintCoinsForSkakers(uint256 startIndex, uint256 endIndex) public {
        require(msg.sender == gelatoAddress, "only Gelato can call this function");
        require(endIndex - startIndex > 0, "empty array");
        require(endIndex < holderWallets.length, "endIndex is out of range for holderWallets");
        require(startIndex > 0, "startIndex should be greater than 0");
        
        
        uint256 pointsToShare = dayPoints - dayPointsFromStakers;
        
        for(uint i=startIndex; i<endIndex; i++) {
            uint256 holderBalance = balanceOf(holderWallets[i]);
            if(holderBalance > 0){
                uint256 reward = (holderBalance * pointsToShare) / lastDaySupply;
                _mint(holderWallets[i], reward);
            }
        }
    }
}