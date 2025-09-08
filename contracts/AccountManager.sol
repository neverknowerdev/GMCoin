// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import { AccountManagerLib } from './AccountManagerLib.sol';
import '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import '@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol';
import './Errors.sol';
import './IGMCoin.sol';

abstract contract AccountManager is Initializable, OwnableUpgradeable, UUPSUpgradeable {
  using AccountManagerLib for AccountManagerLib.AccountStorage;

  IGMCoin gmCoin;
  AccountManagerLib.AccountStorage accountStorage;

  error OnlyGMCoinContract();

  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
  }

  function initialize(address _gmCoin) public virtual initializer {
    __Ownable_init(_gmCoin);
    __UUPSUpgradeable_init();
    gmCoin = IGMCoin(_gmCoin);
    // Wire gmCoin into library storage so lib calls can access GMCoin functions
    accountStorage.gmCoinContract = gmCoin;
  }

  function _authorizeUpgrade(address newImplementation) internal virtual override onlyOwner {}

  // Getter and setter for gmCoin
  function getGmCoin() public view returns (address) {
    return address(gmCoin);
  }

  function setGmCoin(address _gmCoin) public {
    _requireOwner();
    gmCoin = IGMCoin(_gmCoin);
    // Keep library storage in sync
    accountStorage.gmCoinContract = gmCoin;
  }

  // Twitter events
  event VerifyTwitterRequested(string accessCodeEncrypted, string userID, address indexed wallet);
  event TwitterVerificationResult(string userID, address indexed wallet, bool isSuccess, string errorMsg);
  event verifyTwitterByAuthCodeRequested(address wallet, string authCode, string tweetID, string userID);

  event VerifyFarcasterRequested(uint256 indexed farcasterFid, address indexed wallet);
  event FarcasterVerificationResult(
    uint256 indexed farcasterFid,
    address indexed wallet,
    bool isSuccess,
    string errorMsg
  );

  function twitterVerificationError(
    address wallet,
    string calldata userID,
    string calldata errorMsg
  ) public onlyGelato {
    emit TwitterVerificationResult(userID, wallet, false, errorMsg);
  }

  function requestTwitterVerificationByAuthCode(
    string calldata authCode,
    string calldata userID,
    string calldata tweetID
  ) public {
    if (accountStorage.twitterIdToUnifiedUserId[userID] != 0) revert UserAlreadyLinked();
    if (accountStorage.registeredWallets[msgSender()]) revert WalletAlreadyLinked();

    emit verifyTwitterByAuthCodeRequested(msgSender(), authCode, tweetID, userID);
  }

  function requestTwitterVerification(string calldata accessCodeEncrypted, string calldata userID) public {
    if (accountStorage.twitterIdToUnifiedUserId[userID] != 0) revert WalletAlreadyLinked();
    if (accountStorage.walletToUnifiedUserId[msgSender()] != 0) revert WalletAlreadyLinkedToFid();

    emit VerifyTwitterRequested(accessCodeEncrypted, userID, msgSender());
  }

  // Farcaster verification functions
  function requestFarcasterVerification(uint256 farcasterFid, address wallet) external {
    if (accountStorage.farcasterFidToUnifiedUserId[farcasterFid] != 0) revert FarcasterAccountAlreadyLinked();
    if (accountStorage.walletToUnifiedUserId[wallet] != 0) revert WalletAlreadyLinkedToFid();

    emit VerifyFarcasterRequested(farcasterFid, wallet);
  }

  function farcasterVerificationError(uint256 farcasterFid, address wallet, string calldata errorMsg) external {
    emit FarcasterVerificationResult(farcasterFid, wallet, false, errorMsg);
  }

  // Account management events
  event UnifiedUserCreated(
    uint256 indexed userId,
    address indexed primaryWallet,
    string twitterId,
    uint256 farcasterFid
  );
  event UnifiedSocialAccountLinked(uint256 indexed userId, string platform, string platformId);
  event UnifiedWalletLinked(uint256 indexed userId, address indexed wallet);
  event UnifiedHumanVerificationUpdated(uint256 indexed userId, bool isVerified);

  modifier onlyGelato() virtual {
    _;
  }

  // Access control - to be inherited from main contract
  function _requireOwner() internal view virtual;

  function msgSender() internal view virtual returns (address);

  // Unified User System Functions

  function enableUnifiedUserSystem() public {
    _requireOwner();
    accountStorage.unifiedUserSystemEnabled = true;
    accountStorage.unifiedUserSystemEnabled = true;
  }

  function disableUnifiedUserSystem() public {
    _requireOwner();
    accountStorage.unifiedUserSystemEnabled = false;
    accountStorage.unifiedUserSystemEnabled = false;
  }

  function createOrLinkUnifiedUser(
    address wallet,
    string memory twitterId,
    uint256 farcasterFid
  ) public onlyGelato returns (uint256) {
    return AccountManagerLib.createOrLinkUnifiedUser(accountStorage, wallet, twitterId, farcasterFid);
  }

  function createOrLinkUnifiedUser(string memory twitterId, uint256 farcasterFid) public returns (uint256) {
    return AccountManagerLib.createOrLinkUnifiedUser(accountStorage, msgSender(), twitterId, farcasterFid);
  }

  function linkAdditionalWallet(address newWallet, bytes calldata signature) public {
    if (!accountStorage.unifiedUserSystemEnabled) revert SystemNotEnabled();

    address recoveredSigner = ECDSA.recover(
      MessageHashUtils.toEthSignedMessageHash(bytes('I want to link this wallet to my GMCoin account')),
      signature
    );
    if (recoveredSigner != newWallet) revert InvalidSignature();
    if (accountStorage.registeredWallets[newWallet]) revert WalletAlreadyRegistered();
    if (accountStorage.walletToUnifiedUserId[newWallet] != 0) revert WalletAlreadyLinked();

    // The caller must be an existing unified user
    uint256 userId = accountStorage.walletToUnifiedUserId[msgSender()];
    if (userId == 0) revert CallerNotRegistered();

    AccountManagerLib.linkAdditionalWallet(accountStorage, userId, newWallet);

    emit UnifiedWalletLinked(userId, newWallet);
  }

  function setUnifiedUserHumanVerification(uint256 userId, bool isVerified) public {
    AccountManagerLib.setUnifiedUserHumanVerification(accountStorage, msgSender(), userId, isVerified);
    emit UnifiedHumanVerificationUpdated(userId, isVerified);
  }

  function walletByUnifiedUserIndex(uint256 userIndex) internal view returns (address) {
    return AccountManagerLib.walletByUnifiedUserIndex(accountStorage, userIndex);
  }

  function isWalletRegistered(address wallet) public view returns (bool) {
    return accountStorage.registeredWallets[wallet];
  }

  function setPrimaryWallet(uint256 userId, address newPrimaryWallet) public {
    AccountManagerLib.setPrimaryWallet(accountStorage, msgSender(), userId, newPrimaryWallet);
  }

  function mergeUsers(uint256 fromUserId, uint256 toUserId) public {
    _requireOwner();
    AccountManagerLib.mergeUsers(accountStorage, fromUserId, toUserId, false, false);
  }

  function removeUser(uint256 userId) internal {
    AccountManagerLib.removeUser(accountStorage, userId);
  }

  function removeMe() public {
    removeUser(getUnifiedUserIDByWallet(msgSender()));
  }

  // Query functions for unified users
  function isUnifiedUserSystemEnabled() public view returns (bool) {
    return accountStorage.unifiedUserSystemEnabled;
  }

  function totalUnifiedUsersCount() public view returns (uint256) {
    return accountStorage.allUnifiedUsers.length;
  }

  function getUnifiedUserIDByWallet(address wallet) public view returns (uint256) {
    return AccountManagerLib.getUnifiedUserByWallet(accountStorage, wallet).userId;
  }

  function getUnifiedUserById(uint256 userId) public view returns (AccountManagerLib.UnifiedUser memory) {
    return AccountManagerLib.getUnifiedUserById(accountStorage, userId);
  }

  function getUnifiedUserByWallet(address wallet) public view returns (AccountManagerLib.UnifiedUser memory) {
    return AccountManagerLib.getUnifiedUserByWallet(accountStorage, wallet);
  }

  function getUnifiedUserWallets(uint256 userId) public view returns (address[] memory) {
    return AccountManagerLib.getUnifiedUserWallets(accountStorage, userId);
  }

  function isUnifiedUserHumanVerified(uint256 userId) public view returns (bool) {
    if (!accountStorage.unifiedUserSystemEnabled) return false;
    return accountStorage.unifiedUsers[userId].isHumanVerified;
  }

  function isWalletLinkedToUnifiedUser(address wallet) public view returns (bool) {
    if (!accountStorage.unifiedUserSystemEnabled) return false;
    return accountStorage.walletToUnifiedUserId[wallet] != 0;
  }
}
