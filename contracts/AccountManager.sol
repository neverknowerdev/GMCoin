// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import { GMStorage } from './Storage.sol';
import { AccountManagerLib } from './AccountManagerLib.sol';
import '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import '@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol';
import './Errors.sol';

abstract contract AccountManager {
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

  // Access control - to be inherited from main contract
  function _requireOwner() internal view virtual;

  // Internal storage access - to be provided by main contract
  function _getMintingData() internal view virtual returns (GMStorage.MintingData storage);

  function _msgSender() internal view virtual returns (address);

  // Unified User System Functions

  function enableUnifiedUserSystem() public {
    _requireOwner();
    GMStorage.MintingData storage mintingData = _getMintingData();
    mintingData.unifiedUserSystemEnabled = true;
  }

  function disableUnifiedUserSystem() public {
    _requireOwner();
    GMStorage.MintingData storage mintingData = _getMintingData();
    mintingData.unifiedUserSystemEnabled = false;
  }

  function createOrLinkUnifiedUser(
    address wallet,
    string memory twitterId,
    uint256 farcasterFid
  ) internal returns (uint256) {
    return AccountManagerLib.createOrLinkUnifiedUser(_getMintingData(), wallet, twitterId, farcasterFid);
  }

  function linkAdditionalWallet(address newWallet, bytes calldata signature) public {
    GMStorage.MintingData storage mintingData = _getMintingData();
    if (!mintingData.unifiedUserSystemEnabled) revert SystemNotEnabled();

    address recoveredSigner = ECDSA.recover(
      MessageHashUtils.toEthSignedMessageHash(bytes('I want to link this wallet to my GMCoin account')),
      signature
    );
    if (recoveredSigner != newWallet) revert InvalidSignature();
    if (mintingData.registeredWallets[newWallet]) revert WalletAlreadyRegistered();
    if (mintingData.walletToUnifiedUserId[newWallet] != 0) revert WalletAlreadyLinked();

    uint256 userId = mintingData.walletToUnifiedUserId[recoveredSigner];
    if (userId == 0) revert CallerNotRegistered();

    AccountManagerLib.linkAdditionalWallet(_getMintingData(), userId, newWallet);

    emit UnifiedWalletLinked(userId, newWallet);
  }

  function setUnifiedUserHumanVerification(uint256 userId, bool isVerified) public {
    _requireOwner();
    AccountManagerLib.setUnifiedUserHumanVerification(_getMintingData(), userId, isVerified);
    emit UnifiedHumanVerificationUpdated(userId, isVerified);
  }

  function walletByUnifiedUserIndex(uint256 userIndex) internal view returns (address) {
    return AccountManagerLib.walletByUnifiedUserIndex(_getMintingData(), userIndex);
  }

  function isWalletRegistered(address wallet) public view returns (bool) {
    GMStorage.MintingData storage mintingData = _getMintingData();
    return mintingData.registeredWallets[wallet];
  }

  function setPrimaryWallet(uint256 userId, address newPrimaryWallet) public {
    _requireOwner();
    AccountManagerLib.setPrimaryWallet(_getMintingData(), userId, newPrimaryWallet);
  }

  function mergeUsers(uint256 fromUserId, uint256 toUserId) public {
    _requireOwner();
    AccountManagerLib.mergeUsers(_getMintingData(), fromUserId, toUserId);
  }

  function removeUser(address wallet) internal {
    AccountManagerLib.removeUser(_getMintingData(), wallet);
  }

  function removeMe() public {
    removeUser(_msgSender());
  }

  // Query functions for unified users
  function isUnifiedUserSystemEnabled() public view returns (bool) {
    GMStorage.MintingData storage mintingData = _getMintingData();
    return mintingData.unifiedUserSystemEnabled;
  }

  function totalUnifiedUsersCount() public view returns (uint256) {
    GMStorage.MintingData storage mintingData = _getMintingData();
    return mintingData.allUnifiedUsers.length;
  }

  function getUnifiedUserIDByWallet(address wallet) public view returns (uint256) {
    return AccountManagerLib.getUnifiedUserByWallet(_getMintingData(), wallet).userId;
  }

  function getUnifiedUserById(uint256 userId) public view returns (GMStorage.UnifiedUser memory) {
    return AccountManagerLib.getUnifiedUserById(_getMintingData(), userId);
  }

  function getUnifiedUserByWallet(address wallet) public view returns (GMStorage.UnifiedUser memory) {
    return AccountManagerLib.getUnifiedUserByWallet(_getMintingData(), wallet);
  }

  function getUnifiedUserWallets(uint256 userId) public view returns (address[] memory) {
    return AccountManagerLib.getUnifiedUserWallets(_getMintingData(), userId);
  }

  function isUnifiedUserHumanVerified(uint256 userId) public view returns (bool) {
    GMStorage.MintingData storage mintingData = _getMintingData();
    if (!mintingData.unifiedUserSystemEnabled) return false;
    return mintingData.unifiedUsers[userId].isHumanVerified;
  }

  function isWalletLinkedToUnifiedUser(address wallet) public view returns (bool) {
    GMStorage.MintingData storage mintingData = _getMintingData();
    if (!mintingData.unifiedUserSystemEnabled) return false;
    return mintingData.walletToUnifiedUserId[wallet] != 0;
  }
}
