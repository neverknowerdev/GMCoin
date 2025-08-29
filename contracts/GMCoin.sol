// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import '@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol';
import './TwitterOracle.sol';
import './FarcasterOracle.sol';
import './AccountManager.sol';
import './Errors.sol';

contract GMCoin is
  Initializable,
  OwnableUpgradeable,
  ERC20Upgradeable,
  UUPSUpgradeable,
  TwitterOracle,
  FarcasterOracle,
  AccountManager
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

  // Override modifiers from parent contracts
  modifier onlyGelato() override(TwitterOracle, FarcasterOracle) {
    if (_msgSender() != gelatoConfig.gelatoAddress) revert OnlyGelato();
    _;
  }

  modifier onlyServerRelayer() override(TwitterOracle, FarcasterOracle) {
    if (_msgSender() != serverRelayerAddress) revert OnlyServerRelayer();
    _;
  }

  function _checkOwner() internal view override(OwnableUpgradeable) {
    super._checkOwner();
  }

  function _requireOwner() internal view override {
    _checkOwner();
  }

  // Provide storage access to parent contracts
  function _getMintingData()
    internal
    view
    override(FarcasterOracle, AccountManager)
    returns (GMStorage.MintingData storage)
  {
    return mintingData;
  }

  function _getMintingConfig() internal view override returns (GMStorage.MintingConfig storage) {
    return mintingConfig;
  }

  function _msgSender() internal view override(ContextUpgradeable, FarcasterOracle, AccountManager) returns (address) {
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

  function _mintForUserByIndex(uint256 userIndex, uint256 amount) internal override(TwitterOracle) {
    address walletAddr = walletByTwitterUserIndex(userIndex);
    require(walletAddr != address(0), "walletAddr shouldn't be zero!");

    _mint(walletAddr, amount);
    mintingData.mintedAmountByWallet[walletAddr] += amount;
  }

  function _mintForFarcasterUserByIndex(uint256 userIndex, uint256 amount) internal override {
    address walletAddr = walletByFarcasterUserIndex(userIndex);
    require(walletAddr != address(0), "walletAddr shouldn't be zero!");

    _mint(walletAddr, amount);
    mintingData.mintedAmountByWallet[walletAddr] += amount;
  }

  // =============================================================================
  // Unified User System Implementation
  // =============================================================================

  function _createOrLinkUnifiedUser(
    address wallet,
    string memory twitterId,
    uint256 farcasterFid
  ) internal override(TwitterOracle, FarcasterOracle) returns (uint256) {
    return createOrLinkUnifiedUser(wallet, twitterId, farcasterFid);
  }

  function _emitUnifiedUserCreated(
    uint256 userId,
    address wallet,
    string memory twitterId,
    uint256 farcasterFid
  ) internal override(TwitterOracle, FarcasterOracle) {
    emit UnifiedUserCreated(userId, wallet, twitterId, farcasterFid);
  }

  function _emitTwitterVerificationResult(
    string memory twitterId,
    address wallet,
    bool isSuccess,
    string memory errorMsg
  ) internal {
    emit TwitterVerificationResult(twitterId, wallet, isSuccess, errorMsg);
  }
}
