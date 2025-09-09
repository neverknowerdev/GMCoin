// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import '@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol';
import './Errors.sol';
import './IGMCoin.sol';

library AccountManagerLib {
  // Storage structure for AccountManager
  struct AccountStorage {
    IGMCoin gmCoinContract;
    //
    uint256 nextUserId; // Auto-increment user ID counter
    mapping(uint256 => UnifiedUser) unifiedUsers; // User ID -> User data
    uint256[] allUnifiedUsers; // All user IDs for iteration
    mapping(uint256 => uint256) unifiedUserIndexById; // User ID -> index in allUnifiedUsers
    mapping(address => uint256) walletToUnifiedUserId; // Wallet -> User ID
    mapping(uint256 => address[]) unifiedUserWallets; // User ID -> all wallets
    mapping(string => uint256) twitterIdToUnifiedUserId; // Twitter ID -> User ID
    mapping(uint256 => uint256) farcasterFidToUnifiedUserId; // Farcaster FID -> User ID
    mapping(uint256 => string) userIdToTwitterId; // User ID -> Twitter ID
    mapping(address => bool) registeredWallets; // Wallet -> registration status
    bool unifiedUserSystemEnabled; // Feature flag for unified system
    uint256[50] __gap;
  }

  // NEW: Unified User Structure
  struct UnifiedUser {
    uint256 userId; // Unique user identifier
    address primaryWallet; // Primary wallet for minting
    bool isHumanVerified; // Human verification status
    uint32 createdAt; // Creation timestamp
    string twitterId; // Twitter ID (empty if not linked)
    uint256 farcasterFid; // Farcaster FID (0 if not linked)
    address farcasterWallet;
    // Future social platforms can be added here
  }

  function _removeTwitterIdFromUser(
    AccountStorage storage accountStorage,
    uint256 userId,
    string memory twitterId
  ) internal {
    accountStorage.gmCoinContract.removeTwitterUser(twitterId);

    delete accountStorage.twitterIdToUnifiedUserId[twitterId];
    delete accountStorage.userIdToTwitterId[userId];

    accountStorage.unifiedUsers[userId].twitterId = '';
  }

  function _removeFarcasterIdFromUser(
    AccountStorage storage accountStorage,
    uint256 userId,
    uint256 farcasterFid
  ) internal {
    accountStorage.gmCoinContract.removeFarcasterUser(farcasterFid);
    delete accountStorage.farcasterFidToUnifiedUserId[farcasterFid];

    accountStorage.unifiedUsers[userId].farcasterFid = 0;
    accountStorage.unifiedUsers[userId].farcasterWallet = address(0);
  }

  function mergeUsers(
    AccountStorage storage accountStorage,
    uint256 fromUserId,
    uint256 toUserId,
    bool overrideTwitterId,
    bool overrideFarcasterFid
  ) internal returns (uint256) {
    if (!accountStorage.unifiedUserSystemEnabled) revert SystemNotEnabled();
    if (accountStorage.unifiedUsers[fromUserId].userId == 0) revert FromUserNotExist();
    if (accountStorage.unifiedUsers[toUserId].userId == 0) revert ToUserNotExist();
    if (fromUserId == toUserId) revert CannotMergeSameUser();

    UnifiedUser storage fromUser = accountStorage.unifiedUsers[fromUserId];
    UnifiedUser storage toUser = accountStorage.unifiedUsers[toUserId];

    // Move social accounts if not already present
    if (bytes(fromUser.twitterId).length > 0 && (bytes(toUser.twitterId).length == 0 || overrideTwitterId)) {
      // delete old twitterId
      if (accountStorage.gmCoinContract.twitterUserExist(toUser.twitterId)) {
        _removeTwitterIdFromUser(accountStorage, fromUserId, toUser.twitterId);
      }

      // if no new twitterId addded - add it
      if (!accountStorage.gmCoinContract.twitterUserExist(fromUser.twitterId)) {
        linkSocialAccountToUser(accountStorage, toUserId, fromUser.primaryWallet, fromUser.twitterId, 0);
      }

      toUser.twitterId = fromUser.twitterId;
    }

    if (fromUser.farcasterFid != 0 && (toUser.farcasterFid == 0 || overrideFarcasterFid)) {
      if (accountStorage.gmCoinContract.farcasterUserExist(toUser.farcasterFid)) {
        _removeFarcasterIdFromUser(accountStorage, fromUserId, toUser.farcasterFid);
      }

      // if no new farcasterFid addded - add it
      if (!accountStorage.gmCoinContract.farcasterUserExist(fromUser.farcasterFid)) {
        linkSocialAccountToUser(accountStorage, toUserId, fromUser.primaryWallet, '', fromUser.farcasterFid);
      }

      toUser.farcasterFid = fromUser.farcasterFid;
    }

    // Move all wallets from fromUser to toUser
    address[] memory walletsToMove = accountStorage.unifiedUserWallets[fromUserId];
    for (uint256 i = 0; i < walletsToMove.length; i++) {
      accountStorage.walletToUnifiedUserId[walletsToMove[i]] = toUserId;
      accountStorage.unifiedUserWallets[toUserId].push(walletsToMove[i]);
    }

    toUser.primaryWallet = fromUser.primaryWallet;

    // Clean up fromUser data
    delete accountStorage.unifiedUsers[fromUserId];
    delete accountStorage.unifiedUserWallets[fromUserId];

    // O(1) remove from allUnifiedUsers via swap-with-last
    uint256 fromUserIndex = accountStorage.unifiedUserIndexById[fromUserId];
    uint256 lastIdx = accountStorage.allUnifiedUsers.length - 1;
    if (fromUserIndex < lastIdx) {
      uint256 lastUserId = accountStorage.allUnifiedUsers[lastIdx];
      accountStorage.allUnifiedUsers[fromUserIndex] = lastUserId;
      accountStorage.unifiedUserIndexById[lastUserId] = fromUserIndex;
      accountStorage.allUnifiedUsers.pop();
      delete accountStorage.unifiedUserIndexById[lastUserId];
    }

    return toUserId;
  }

  function linkAdditionalWallet(AccountStorage storage accountStorage, uint256 userId, address newWallet) public {
    if (accountStorage.unifiedUsers[userId].userId == 0) revert UserNotExist();

    accountStorage.walletToUnifiedUserId[newWallet] = userId;
    accountStorage.unifiedUserWallets[userId].push(newWallet);
    accountStorage.registeredWallets[newWallet] = true;
  }

  function createOrLinkUnifiedUser(
    AccountStorage storage accountStorage,
    address wallet,
    string memory twitterId,
    uint256 farcasterFid
  ) external returns (uint256) {
    if (!accountStorage.unifiedUserSystemEnabled) {
      return 0;
    }

    uint256 existingUserId = accountStorage.walletToUnifiedUserId[wallet];

    if (existingUserId != 0) {
      return linkSocialAccountToUser(accountStorage, existingUserId, wallet, twitterId, farcasterFid);
    }

    // If wallet has no unified user yet, try to attach to an existing user by social IDs
    uint256 userIdByTwitter = bytes(twitterId).length > 0 ? accountStorage.twitterIdToUnifiedUserId[twitterId] : 0;
    uint256 userIdByFarcaster = farcasterFid != 0 ? accountStorage.farcasterFidToUnifiedUserId[farcasterFid] : 0;

    if (userIdByTwitter != 0 && userIdByFarcaster != 0 && userIdByTwitter != userIdByFarcaster) {
      return mergeUsers(accountStorage, userIdByTwitter, userIdByFarcaster, true, false);
    }

    uint256 targetUserId = userIdByTwitter != 0 ? userIdByTwitter : userIdByFarcaster;
    if (targetUserId != 0) {
      // Link socials to the target user if missing
      linkSocialAccountToUser(accountStorage, targetUserId, wallet, twitterId, farcasterFid);

      // Link the wallet to that unified user if not linked yet
      if (accountStorage.walletToUnifiedUserId[wallet] == 0) {
        linkAdditionalWallet(accountStorage, targetUserId, wallet);
      }

      return targetUserId;
    }

    // Otherwise, create a new unified user
    return createNewUnifiedUser(accountStorage, wallet, twitterId, farcasterFid);
  }

  function createNewUnifiedUser(
    AccountStorage storage accountStorage,
    address primaryWallet,
    string memory twitterId,
    uint256 farcasterFid
  ) public returns (uint256) {
    accountStorage.nextUserId++;
    uint256 userId = accountStorage.nextUserId;

    UnifiedUser storage user = accountStorage.unifiedUsers[userId];
    user.userId = userId;
    user.primaryWallet = primaryWallet;
    user.isHumanVerified = false;
    user.createdAt = uint32(block.timestamp);
    // Do not set social IDs here; let linkSocialAccountToUser handle
    // assigning twitterId/farcasterFid and syncing GMCoin state.

    accountStorage.allUnifiedUsers.push(userId);
    accountStorage.unifiedUserIndexById[userId] = accountStorage.allUnifiedUsers.length - 1;
    accountStorage.walletToUnifiedUserId[primaryWallet] = userId;
    accountStorage.unifiedUserWallets[userId].push(primaryWallet);

    linkSocialAccountToUser(accountStorage, userId, primaryWallet, twitterId, farcasterFid);

    return userId;
  }

  function linkSocialAccountToUser(
    AccountStorage storage accountStorage,
    uint256 userId,
    address wallet,
    string memory twitterId,
    uint256 farcasterFid
  ) public returns (uint256) {
    UnifiedUser storage user = accountStorage.unifiedUsers[userId];

    if (bytes(twitterId).length > 0 && bytes(user.twitterId).length == 0) {
      if (accountStorage.twitterIdToUnifiedUserId[twitterId] != 0) revert TwitterIdAlreadyLinked();
      user.twitterId = twitterId;
      accountStorage.twitterIdToUnifiedUserId[twitterId] = userId;
      accountStorage.gmCoinContract.addTwitterUser(twitterId, wallet);
    }

    if (farcasterFid != 0 && user.farcasterFid == 0) {
      if (accountStorage.farcasterFidToUnifiedUserId[farcasterFid] != 0) revert FarcasterFidAlreadyLinked();
      user.farcasterFid = farcasterFid;
      user.farcasterWallet = wallet;
      accountStorage.farcasterFidToUnifiedUserId[farcasterFid] = userId;
      accountStorage.gmCoinContract.addFarcasterUser(farcasterFid, wallet);
    }

    return userId;
  }

  function setUnifiedUserHumanVerification(
    AccountStorage storage accountStorage,
    address ownerWallet,
    uint256 userId,
    bool isVerified
  ) external {
    if (!accountStorage.unifiedUserSystemEnabled) revert SystemNotEnabled();
    if (accountStorage.unifiedUsers[userId].userId == 0) revert UserNotExist();
    if (accountStorage.walletToUnifiedUserId[ownerWallet] != userId) revert WalletNotLinked();

    accountStorage.unifiedUsers[userId].isHumanVerified = isVerified;
  }

  function setPrimaryWallet(
    AccountStorage storage accountStorage,
    address ownerWallet,
    uint256 userId,
    address newPrimaryWallet
  ) external {
    if (!accountStorage.unifiedUserSystemEnabled) revert SystemNotEnabled();
    if (accountStorage.unifiedUsers[userId].userId == 0) revert UserNotExist();
    if (accountStorage.walletToUnifiedUserId[newPrimaryWallet] != userId) revert WalletNotLinked();
    if (accountStorage.walletToUnifiedUserId[ownerWallet] != userId) revert WalletNotLinked();

    accountStorage.unifiedUsers[userId].primaryWallet = newPrimaryWallet;

    if (bytes(accountStorage.unifiedUsers[userId].twitterId).length > 0) {
      accountStorage.gmCoinContract.changeTwitterUserWallet(
        accountStorage.unifiedUsers[userId].twitterId,
        newPrimaryWallet
      );
    }
    if (accountStorage.unifiedUsers[userId].farcasterFid != 0) {
      accountStorage.gmCoinContract.changeFarcasterUserWallet(
        accountStorage.unifiedUsers[userId].farcasterFid,
        newPrimaryWallet
      );
    }
  }

  function removeUser(AccountStorage storage accountStorage, uint256 userId) external {
    if (accountStorage.gmCoinContract.isActiveMintingProcess()) revert CannotRemoveUserActiveWorkers();
    if (accountStorage.unifiedUsers[userId].userId == 0) revert UserNotExist();

    _removeTwitterIdFromUser(accountStorage, userId, accountStorage.unifiedUsers[userId].twitterId);
    _removeFarcasterIdFromUser(accountStorage, userId, accountStorage.unifiedUsers[userId].farcasterFid);

    for (uint256 i = 0; i < accountStorage.unifiedUserWallets[userId].length; i++) {
      delete accountStorage.walletToUnifiedUserId[accountStorage.unifiedUserWallets[userId][i]];
    }

    // Clean up user index mapping
    delete accountStorage.unifiedUsers[userId];
    delete accountStorage.unifiedUserWallets[userId];

    if (accountStorage.unifiedUserIndexById[userId] > 0) {
      uint256 lastUserId = accountStorage.allUnifiedUsers[accountStorage.allUnifiedUsers.length - 1];
      uint256 currentUserIndex = accountStorage.unifiedUserIndexById[userId];
      accountStorage.allUnifiedUsers[currentUserIndex] = lastUserId;
      accountStorage.unifiedUserIndexById[lastUserId] = currentUserIndex;
      accountStorage.allUnifiedUsers.pop();
      delete accountStorage.unifiedUserIndexById[userId];
    }
  }

  function walletByUnifiedUserIndex(
    AccountStorage storage accountStorage,
    uint256 userIndex
  ) external view returns (address) {
    if (!accountStorage.unifiedUserSystemEnabled || userIndex >= accountStorage.allUnifiedUsers.length) {
      return address(0);
    }
    uint256 userId = accountStorage.allUnifiedUsers[userIndex];
    return accountStorage.unifiedUsers[userId].primaryWallet;
  }

  function getUnifiedUserById(
    AccountStorage storage accountStorage,
    uint256 userId
  ) external view returns (UnifiedUser memory) {
    require(accountStorage.unifiedUserSystemEnabled, 'Unified user system not enabled');
    require(accountStorage.unifiedUsers[userId].userId != 0, 'User does not exist');
    return accountStorage.unifiedUsers[userId];
  }

  function getUnifiedUserByWallet(
    AccountStorage storage accountStorage,
    address wallet
  ) external view returns (UnifiedUser memory) {
    require(accountStorage.unifiedUserSystemEnabled, 'Unified user system not enabled');
    uint256 userId = accountStorage.walletToUnifiedUserId[wallet];
    require(userId != 0, 'Wallet not registered to any user');
    return accountStorage.unifiedUsers[userId];
  }

  function getUnifiedUserWallets(
    AccountStorage storage accountStorage,
    uint256 userId
  ) external view returns (address[] memory) {
    require(accountStorage.unifiedUserSystemEnabled, 'Unified user system not enabled');
    return accountStorage.unifiedUserWallets[userId];
  }
}
