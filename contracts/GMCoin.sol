// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import '@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol';
import './TwitterOracle.sol';

import { GMWeb3Functions } from './GelatoWeb3Functions.sol';
import { GMStorage } from './Storage.sol';

contract GMCoin is GMStorage, Initializable, OwnableUpgradeable, ERC20Upgradeable, UUPSUpgradeable, GMTwitterOracle {
  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
  }

  function initialize(
    address _owner,
    address _feeAddress,
    address _treasuryAddress,
    address _gelatoAddress,
    address _relayServerAddress
  ) public initializer {
    feeConfig.feeAddress = _feeAddress;
    feeConfig.treasuryAddress = _treasuryAddress;

    feeConfig.feePercentage = 100; // 1% fee of transaction
    feeConfig.treasuryPercentage = 1000; // 10% of minted coins

    __Ownable_init(_owner);
    __UUPSUpgradeable_init();
    __ERC20_init('GM Coin', 'GM');

    // Initialize Gelato config
    gelatoConfig.gelatoAddress = _gelatoAddress;
    serverRelayerAddress = _relayServerAddress;

    // Initialize minting config with default values
    mintingConfig.COINS_MULTIPLICATOR = 1_000_000;
    mintingConfig.EPOCH_DAYS = 2;
    mintingConfig.POINTS_PER_TWEET = 1;
    mintingConfig.POINTS_PER_LIKE = 1;
    mintingConfig.POINTS_PER_HASHTAG = 2;
    mintingConfig.POINTS_PER_CASHTAG = 4;
    mintingConfig.epochNumber = 1;

    mintingData.epochStartedAt = uint32(block.timestamp);
  }

  function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

  event UpgradePlanned(uint256 plannedTime, address newImplementation);
  event UpgradeApplied(uint256 time, address newImplementation);

  // function clearThirdwebGelatoFunc() public reinitializer(4) onlyOwner {
  //   deleteThirdwebGelatoFunc();
  // }

  // disabled Timelock for testing period on Mainnet, then would be turned on
  //    function scheduleUpgrade(address newImplementation) public onlyOwner {
  //        require(newImplementation != address(0), "wrong newImplementation address");
  //        require(timeLockConfig.plannedNewImplementation != newImplementation, "you already planned upgrade with this implementation");
  //
  //        timeLockConfig.plannedNewImplementation = newImplementation;
  //        timeLockConfig.plannedNewImplementationTime = block.timestamp + 3 days;
  //
  //        emit UpgradePlanned(timeLockConfig.plannedNewImplementationTime, newImplementation);
  //    }
  //
  //    function upgradeToAndCall(address newImplementation, bytes memory data) public override payable onlyOwner {
  //        require(newImplementation != address(0), "wrong newImplementation address");
  //        require(newImplementation == timeLockConfig.plannedNewImplementation, "you should schedule upgrade first");
  //        require(block.timestamp > timeLockConfig.plannedNewImplementationTime, "timeDelay is not passed to make an upgrade");
  //
  //        timeLockConfig.plannedNewImplementationTime = 0;
  //        timeLockConfig.plannedNewImplementation = address(0);
  //
  //        super.upgradeToAndCall(newImplementation, data);
  //
  //        emit UpgradeApplied(block.timestamp, newImplementation);
  //    }

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

    super._update(from, to, value);
  }

  function _mintForUserByIndex(uint256 userIndex, uint256 amount) internal override {
    address walletAddr = walletByTwitterUserIndex(userIndex);
    require(walletAddr != address(0), "walletAddr shouldn't be zero!");

    _mint(walletAddr, amount);
    mintingData.mintedAmountByWallet[walletAddr] += amount;
  }

  // Implement Farcaster minting function
  function _mintForFarcasterUserByIndex(uint256 userIndex, uint256 amount) internal override {
    address walletAddr = walletByFarcasterUserIndex(userIndex);
    require(walletAddr != address(0), "walletAddr shouldn't be zero!");

    _mint(walletAddr, amount);
    mintingData.mintedAmountByWallet[walletAddr] += amount;
  }

  // =============================================================================
  // NEW: Unified User System Functions
  // =============================================================================

  /**
   * @dev Mint tokens directly to a unified user by user ID
   */
  function mintForUnifiedUser(uint256 userId, uint256 amount) public onlyGelato {
    require(mintingData.unifiedUserSystemEnabled, "Unified user system not enabled");
    require(mintingData.unifiedUsers[userId].userId != 0, "User does not exist");
    
    address walletAddr = mintingData.unifiedUsers[userId].primaryWallet;
    require(walletAddr != address(0), "Primary wallet not set");

    _mint(walletAddr, amount);
    mintingData.mintedAmountByWallet[walletAddr] += amount;
  }

  /**
   * @dev Mint for unified user by index (for compatibility with existing minting process)
   */
  function _mintForUnifiedUserByIndex(uint256 userIndex, uint256 amount) internal {
    address walletAddr = walletByUnifiedUserIndex(userIndex);
    if (walletAddr == address(0)) return; // Skip if no unified user found
    
    _mint(walletAddr, amount);
    mintingData.mintedAmountByWallet[walletAddr] += amount;
  }

  /**
   * @dev Enhanced Twitter verification that also creates unified user
   */
  function verifyTwitterUnified(string calldata userID, address wallet) public override onlyGelato {
    // Call the enhanced verification from TwitterOracle
    super.verifyTwitterUnified(userID, wallet);
    
    // Give welcome bonus if unified user was created
    if (mintingData.unifiedUserSystemEnabled) {
      uint256 userId = mintingData.walletToUnifiedUserId[wallet];
      if (userId != 0) {
        _mintWelcomeBonusForUnifiedUser(userId);
      }
    }
  }

  /**
   * @dev Enhanced Farcaster verification that also creates unified user
   */
  function verifyFarcasterUnified(uint256 farcasterFid, address wallet) public override onlyGelato {
    // Call the enhanced verification from TwitterOracle
    super.verifyFarcasterUnified(farcasterFid, wallet);
    
    // Give welcome bonus if unified user was created
    if (mintingData.unifiedUserSystemEnabled) {
      uint256 userId = mintingData.walletToUnifiedUserId[wallet];
      if (userId != 0) {
        _mintWelcomeBonusForUnifiedUser(userId);
      }
    }
  }

  /**
   * @dev Mint welcome bonus for unified user
   */
  function _mintWelcomeBonusForUnifiedUser(uint256 userId) internal {
    require(mintingData.unifiedUsers[userId].userId != 0, "User does not exist");
    
    uint256 welcomeAmount = mintingConfig.COINS_MULTIPLICATOR * mintingConfig.POINTS_PER_TWEET;
    address walletAddr = mintingData.unifiedUsers[userId].primaryWallet;
    
    _mint(walletAddr, welcomeAmount);
    mintingData.mintedAmountByWallet[walletAddr] += welcomeAmount;
  }

  // =============================================================================
  // Essential Query Functions Only (Size Optimized)
  // =============================================================================

  /**
   * @dev Get basic unified user information
   */
  function getUnifiedUserInfo(uint256 userId) external view returns (
    address primaryWallet,
    string memory twitterId,
    uint256 farcasterFid,
    bool isHumanVerified
  ) {
    require(mintingData.unifiedUserSystemEnabled, "Unified user system not enabled");
    require(mintingData.unifiedUsers[userId].userId != 0, "User does not exist");
    
    UnifiedUser memory user = mintingData.unifiedUsers[userId];
    return (user.primaryWallet, user.twitterId, user.farcasterFid, user.isHumanVerified);
  }
}
