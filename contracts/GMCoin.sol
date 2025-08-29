// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import '@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol';
import './MintingOracle.sol';
import './AccountManager.sol';
import './Errors.sol';

contract GMCoin is
  GMStorage,
  Initializable,
  OwnableUpgradeable,
  ERC20Upgradeable,
  UUPSUpgradeable,
  MintingOracle,
  AccountManager,
  GMWeb3Functions
{
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
    __GelatoWeb3Functions__init(_owner);

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

    // Enable unified user system by default
    mintingData.unifiedUserSystemEnabled = true;
  }

  function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

  event UpgradePlanned(uint256 plannedTime, address newImplementation);
  event UpgradeApplied(uint256 time, address newImplementation);

  modifier _onlyOwner() override(MintingOracle) {
    if (_msgSender() != owner()) revert OnlyOwner();
    _;
  }

  // Override modifiers from parent contracts
  modifier onlyGelato() override(MintingOracle, AccountManager) {
    if (_msgSender() != gelatoConfig.gelatoAddress) revert OnlyGelato();
    _;
  }

  modifier onlyServerRelayer() override(MintingOracle) {
    if (_msgSender() != serverRelayerAddress) revert OnlyServerRelayer();
    _;
  }

  modifier onlyGelatoOrOwner() override(MintingOracle) {
    if (_msgSender() != gelatoConfig.gelatoAddress && _msgSender() != owner()) revert OnlyGelatoOrOwner();
    _;
  }

  function _checkOwner() internal view override(OwnableUpgradeable) {
    super._checkOwner();
  }

  function _requireOwner() internal view override {
    _checkOwner();
  }

  // Provide storage access to parent contracts
  function _getMintingData() internal view override(AccountManager) returns (GMStorage.MintingData storage) {
    return mintingData;
  }

  function msgSender() internal view override(MintingOracle, AccountManager) returns (address) {
    return super._msgSender();
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

    super._update(from, to, value);
  }

  function _mintForUserByTwitterIndex(uint256 userIndex, uint256 amount) internal override(MintingOracle) {
    address walletAddr = mintingData
      .unifiedUsers[mintingData.twitterIdToUnifiedUserId[mintingData.allTwitterUsers[userIndex]]]
      .primaryWallet;
    require(walletAddr != address(0), "walletAddr shouldn't be zero!");

    _mint(walletAddr, amount);
    mintingData.mintedAmountByWallet[walletAddr] += amount;
  }

  function _mintForUserByFarcasterIndex(uint256 userIndex, uint256 amount) internal override(MintingOracle) {
    address walletAddr = mintingData
      .unifiedUsers[mintingData.farcasterFidToUnifiedUserId[mintingData.allFarcasterUsers[userIndex]]]
      .primaryWallet;
    require(walletAddr != address(0), "walletAddr shouldn't be zero!");

    _mint(walletAddr, amount);
    mintingData.mintedAmountByWallet[walletAddr] += amount;
  }
}
