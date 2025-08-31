// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import '@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol';
import './MintingOracle.sol';
import './Errors.sol';

contract GMCoin is
  GMStorage,
  Initializable,
  OwnableUpgradeable,
  ERC20Upgradeable,
  UUPSUpgradeable,
  MintingOracle,
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
  modifier onlyGelato() override(MintingOracle) {
    if (_msgSender() != gelatoConfig.gelatoAddress) revert OnlyGelato();
    _;
  }

  modifier onlyAccountManager() {
    if (_msgSender() != accountManager) revert OnlyAccountManager();
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

  function msgSender() internal view override(MintingOracle) returns (address) {
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
    address walletAddr = mintingData.walletByTwitterID[mintingData.allTwitterUsers[userIndex]];
    require(walletAddr != address(0), "walletAddr shouldn't be zero!");

    _mint(walletAddr, amount);
    mintingData.mintedAmountByWallet[walletAddr] += amount;
  }

  function _mintForUserByFarcasterIndex(uint256 userIndex, uint256 amount) internal override(MintingOracle) {
    address walletAddr = mintingData.walletByFarcasterFID[mintingData.allFarcasterUsers[userIndex]];
    require(walletAddr != address(0), "walletAddr shouldn't be zero!");

    _mint(walletAddr, amount);
    mintingData.mintedAmountByWallet[walletAddr] += amount;
  }

  // functions to call from AccountManager
  function addTwitterUser(string memory twitterId, address wallet) external onlyAccountManager {
    if (mintingData.userIndexByTwitterId[twitterId] > 0) revert TwitterAccountAlreadyLinked();
    mintingData.allTwitterUsers.push(twitterId);
    mintingData.userIndexByTwitterId[twitterId] = mintingData.allTwitterUsers.length - 1;
    mintingData.walletByTwitterID[twitterId] = wallet;
  }

  function removeTwitterUser(string memory twitterId) external onlyAccountManager {
    if (mintingData.userIndexByTwitterId[twitterId] > 0) {
      mintingData.allTwitterUsers[mintingData.userIndexByTwitterId[twitterId]] = mintingData.allTwitterUsers[
        mintingData.allTwitterUsers.length - 1
      ];
      mintingData.allTwitterUsers.pop();
      delete mintingData.userIndexByTwitterId[twitterId];
      delete mintingData.walletByTwitterID[twitterId];
    }
  }

  function addFarcasterUser(uint256 farcasterFid, address wallet) external onlyAccountManager {
    if (mintingData.farcasterUserIndexByFID[farcasterFid] > 0) revert FarcasterAccountAlreadyLinked();
    mintingData.allFarcasterUsers.push(farcasterFid);
    mintingData.farcasterUserIndexByFID[farcasterFid] = mintingData.allFarcasterUsers.length - 1;
    mintingData.walletByFarcasterFID[farcasterFid] = wallet;
  }

  function removeFarcasterUser(uint256 farcasterFid) external onlyAccountManager {
    if (mintingData.farcasterUserIndexByFID[farcasterFid] > 0) {
      mintingData.allFarcasterUsers[mintingData.farcasterUserIndexByFID[farcasterFid]] = mintingData.allFarcasterUsers[
        mintingData.allFarcasterUsers.length - 1
      ];
      mintingData.allFarcasterUsers.pop();
      delete mintingData.farcasterUserIndexByFID[farcasterFid];
      delete mintingData.walletByFarcasterFID[farcasterFid];
    }
  }

  function changeTwitterUserWallet(string memory twitterId, address wallet) external onlyAccountManager {
    mintingData.walletByTwitterID[twitterId] = wallet;
  }

  function changeFarcasterUserWallet(uint256 farcasterFid, address wallet) external onlyAccountManager {
    mintingData.walletByFarcasterFID[farcasterFid] = wallet;
  }
}
