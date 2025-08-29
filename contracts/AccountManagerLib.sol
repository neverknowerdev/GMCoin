// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import '@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol';
import { GMStorage } from './Storage.sol';
import './Errors.sol';

library AccountManagerLib {
  function _removeTwitterIdFromUser(
    GMStorage.MintingData storage mintingData,
    uint256 userId,
    string memory twitterId
  ) internal {
    if (mintingData.userIndexByTwitterId[twitterId] > 0) {
      mintingData.allTwitterUsers[mintingData.userIndexByTwitterId[twitterId]] = mintingData.allTwitterUsers[
        mintingData.allTwitterUsers.length - 1
      ];
      mintingData.allTwitterUsers.pop();
      mintingData.userIndexByTwitterId[twitterId] = 0;
    }
    delete mintingData.twitterIdToUnifiedUserId[twitterId];
    delete mintingData.userIdToTwitterId[userId];

    mintingData.unifiedUsers[userId].twitterId = '';
  }

  function _removeFarcasterIdFromUser(
    GMStorage.MintingData storage mintingData,
    uint256 userId,
    uint256 farcasterFid
  ) internal {
    if (mintingData.farcasterUserIndexByFID[farcasterFid] > 0) {
      mintingData.allFarcasterUsers[mintingData.farcasterUserIndexByFID[farcasterFid]] = mintingData.allFarcasterUsers[
        mintingData.allFarcasterUsers.length - 1
      ];
      mintingData.allFarcasterUsers.pop();
      delete mintingData.farcasterUserIndexByFID[farcasterFid];
    }
    delete mintingData.farcasterFidToUnifiedUserId[farcasterFid];

    mintingData.unifiedUsers[userId].farcasterFid = 0;
    mintingData.unifiedUsers[userId].farcasterWallet = address(0);
  }

  function mergeUsers(
    GMStorage.MintingData storage mintingData,
    uint256 fromUserId,
    uint256 toUserId,
    bool overrideTwitterId,
    bool overrideFarcasterFid
  ) internal returns (uint256) {
    if (!mintingData.unifiedUserSystemEnabled) revert SystemNotEnabled();
    if (mintingData.unifiedUsers[fromUserId].userId == 0) revert FromUserNotExist();
    if (mintingData.unifiedUsers[toUserId].userId == 0) revert ToUserNotExist();
    if (fromUserId == toUserId) revert CannotMergeSameUser();

    GMStorage.UnifiedUser storage fromUser = mintingData.unifiedUsers[fromUserId];
    GMStorage.UnifiedUser storage toUser = mintingData.unifiedUsers[toUserId];

    // Move social accounts if not already present
    if (bytes(fromUser.twitterId).length > 0 && (bytes(toUser.twitterId).length == 0 || overrideTwitterId)) {
      // delete old twitterId
      if (mintingData.userIndexByTwitterId[toUser.twitterId] > 0) {
        _removeTwitterIdFromUser(mintingData, fromUserId, toUser.twitterId);
      }

      // if no new twitterId addded - add it
      if (mintingData.userIndexByTwitterId[fromUser.twitterId] == 0) {
        linkSocialAccountToUser(mintingData, toUserId, fromUser.primaryWallet, fromUser.twitterId, 0);
      }

      toUser.twitterId = fromUser.twitterId;
    }

    if (fromUser.farcasterFid != 0 && (toUser.farcasterFid == 0 || overrideFarcasterFid)) {
      if (mintingData.farcasterUserIndexByFID[toUser.farcasterFid] > 0) {
        _removeFarcasterIdFromUser(mintingData, fromUserId, toUser.farcasterFid);
      }

      // if no new farcasterFid addded - add it
      if (mintingData.farcasterUserIndexByFID[fromUser.farcasterFid] == 0) {
        linkSocialAccountToUser(mintingData, toUserId, fromUser.primaryWallet, '', fromUser.farcasterFid);
      }

      toUser.farcasterFid = fromUser.farcasterFid;
    }

    // Move all wallets from fromUser to toUser
    address[] memory walletsToMove = mintingData.unifiedUserWallets[fromUserId];
    for (uint256 i = 0; i < walletsToMove.length; i++) {
      mintingData.walletToUnifiedUserId[walletsToMove[i]] = toUserId;
      mintingData.unifiedUserWallets[toUserId].push(walletsToMove[i]);
    }

    toUser.primaryWallet = fromUser.primaryWallet;

    // Clean up fromUser data
    delete mintingData.unifiedUsers[fromUserId];
    delete mintingData.unifiedUserWallets[fromUserId];

    // O(1) remove from allUnifiedUsers via swap-with-last
    uint256 fromUserIndex = mintingData.unifiedUserIndexById[fromUserId];
    uint256 lastIdx = mintingData.allUnifiedUsers.length - 1;
    if (fromUserIndex < lastIdx) {
      uint256 lastUserId = mintingData.allUnifiedUsers[lastIdx];
      mintingData.allUnifiedUsers[fromUserIndex] = lastUserId;
      mintingData.unifiedUserIndexById[lastUserId] = fromUserIndex;
      mintingData.allUnifiedUsers.pop();
      delete mintingData.unifiedUserIndexById[lastUserId];
    }

    return toUserId;
  }

  function linkAdditionalWallet(GMStorage.MintingData storage mintingData, uint256 userId, address newWallet) public {
    if (mintingData.unifiedUsers[userId].userId == 0) revert UserNotExist();

    mintingData.walletToUnifiedUserId[newWallet] = userId;
    mintingData.unifiedUserWallets[userId].push(newWallet);
    mintingData.registeredWallets[newWallet] = true;
  }

  function createOrLinkUnifiedUser(
    GMStorage.MintingData storage mintingData,
    address wallet,
    string memory twitterId,
    uint256 farcasterFid
  ) external returns (uint256) {
    if (!mintingData.unifiedUserSystemEnabled) {
      return 0;
    }

    uint256 existingUserId = mintingData.walletToUnifiedUserId[wallet];

    if (existingUserId != 0) {
      return linkSocialAccountToUser(mintingData, existingUserId, wallet, twitterId, farcasterFid);
    }

    // If wallet has no unified user yet, try to attach to an existing user by social IDs
    uint256 userIdByTwitter = bytes(twitterId).length > 0 ? mintingData.twitterIdToUnifiedUserId[twitterId] : 0;
    uint256 userIdByFarcaster = farcasterFid != 0 ? mintingData.farcasterFidToUnifiedUserId[farcasterFid] : 0;

    if (userIdByTwitter != 0 && userIdByFarcaster != 0 && userIdByTwitter != userIdByFarcaster) {
      return mergeUsers(mintingData, userIdByTwitter, userIdByFarcaster, true, false);
    }

    uint256 targetUserId = userIdByTwitter != 0 ? userIdByTwitter : userIdByFarcaster;
    if (targetUserId != 0) {
      // Link socials to the target user if missing
      linkSocialAccountToUser(mintingData, targetUserId, wallet, twitterId, farcasterFid);

      // Link the wallet to that unified user if not linked yet
      if (mintingData.walletToUnifiedUserId[wallet] == 0) {
        linkAdditionalWallet(mintingData, targetUserId, wallet);
      }

      return targetUserId;
    }

    // Otherwise, create a new unified user
    return createNewUnifiedUser(mintingData, wallet, twitterId, farcasterFid);
  }

  function createNewUnifiedUser(
    GMStorage.MintingData storage mintingData,
    address primaryWallet,
    string memory twitterId,
    uint256 farcasterFid
  ) public returns (uint256) {
    mintingData.nextUserId++;
    uint256 userId = mintingData.nextUserId;

    GMStorage.UnifiedUser storage user = mintingData.unifiedUsers[userId];
    user.userId = userId;
    user.primaryWallet = primaryWallet;
    user.isHumanVerified = false;
    user.createdAt = uint32(block.timestamp);
    user.twitterId = twitterId;
    user.farcasterFid = farcasterFid;

    mintingData.allUnifiedUsers.push(userId);
    mintingData.unifiedUserIndexById[userId] = mintingData.allUnifiedUsers.length - 1;
    mintingData.walletToUnifiedUserId[primaryWallet] = userId;
    mintingData.unifiedUserWallets[userId].push(primaryWallet);

    linkSocialAccountToUser(mintingData, userId, primaryWallet, twitterId, farcasterFid);

    return userId;
  }

  function linkSocialAccountToUser(
    GMStorage.MintingData storage mintingData,
    uint256 userId,
    address wallet,
    string memory twitterId,
    uint256 farcasterFid
  ) public returns (uint256) {
    GMStorage.UnifiedUser storage user = mintingData.unifiedUsers[userId];

    if (bytes(twitterId).length > 0 && bytes(user.twitterId).length == 0) {
      if (mintingData.twitterIdToUnifiedUserId[twitterId] != 0) revert TwitterIdAlreadyLinked();
      user.twitterId = twitterId;
      mintingData.twitterIdToUnifiedUserId[twitterId] = userId;
      mintingData.allTwitterUsers.push(twitterId);
      mintingData.userIndexByTwitterId[twitterId] = mintingData.allTwitterUsers.length - 1;

      mintingData.allTwitterUsers.push(twitterId);
      mintingData.userIndexByTwitterId[twitterId] = mintingData.allTwitterUsers.length - 1;
    }

    if (farcasterFid != 0 && user.farcasterFid == 0) {
      if (mintingData.farcasterFidToUnifiedUserId[farcasterFid] != 0) revert FarcasterFidAlreadyLinked();
      user.farcasterFid = farcasterFid;
      user.farcasterWallet = wallet;
      mintingData.farcasterFidToUnifiedUserId[farcasterFid] = userId;
      mintingData.allFarcasterUsers.push(farcasterFid);
      mintingData.farcasterUserIndexByFID[farcasterFid] = mintingData.allFarcasterUsers.length - 1;

      mintingData.allFarcasterUsers.push(farcasterFid);
      mintingData.farcasterUserIndexByFID[farcasterFid] = mintingData.allFarcasterUsers.length - 1;
    }

    return userId;
  }

  function setUnifiedUserHumanVerification(
    GMStorage.MintingData storage mintingData,
    address ownerWallet,
    uint256 userId,
    bool isVerified
  ) external {
    if (!mintingData.unifiedUserSystemEnabled) revert SystemNotEnabled();
    if (mintingData.unifiedUsers[userId].userId == 0) revert UserNotExist();
    if (mintingData.walletToUnifiedUserId[ownerWallet] != userId) revert WalletNotLinked();

    mintingData.unifiedUsers[userId].isHumanVerified = isVerified;
  }

  function setPrimaryWallet(
    GMStorage.MintingData storage mintingData,
    address ownerWallet,
    uint256 userId,
    address newPrimaryWallet
  ) external {
    if (!mintingData.unifiedUserSystemEnabled) revert SystemNotEnabled();
    if (mintingData.unifiedUsers[userId].userId == 0) revert UserNotExist();
    if (mintingData.walletToUnifiedUserId[newPrimaryWallet] != userId) revert WalletNotLinked();
    if (mintingData.walletToUnifiedUserId[ownerWallet] != userId) revert WalletNotLinked();

    mintingData.unifiedUsers[userId].primaryWallet = newPrimaryWallet;
  }

  function removeUser(GMStorage.MintingData storage mintingData, uint256 userId) external {
    if (mintingData.mintingInProgressForDay != 0) revert CannotRemoveUserActiveWorkers();
    if (mintingData.unifiedUsers[userId].userId == 0) revert UserNotExist();

    _removeTwitterIdFromUser(mintingData, userId, mintingData.unifiedUsers[userId].twitterId);
    _removeFarcasterIdFromUser(mintingData, userId, mintingData.unifiedUsers[userId].farcasterFid);

    for (uint256 i = 0; i < mintingData.unifiedUserWallets[userId].length; i++) {
      delete mintingData.walletToUnifiedUserId[mintingData.unifiedUserWallets[userId][i]];
    }

    // Clean up user index mapping
    delete mintingData.unifiedUsers[userId];
    delete mintingData.unifiedUserWallets[userId];

    if (mintingData.unifiedUserIndexById[userId] > 0) {
      uint256 lastUserId = mintingData.allUnifiedUsers[mintingData.allUnifiedUsers.length - 1];
      uint256 currentUserIndex = mintingData.unifiedUserIndexById[userId];
      mintingData.allUnifiedUsers[currentUserIndex] = lastUserId;
      mintingData.unifiedUserIndexById[lastUserId] = currentUserIndex;
      mintingData.allUnifiedUsers.pop();
      delete mintingData.unifiedUserIndexById[userId];
    }
  }

  function walletByUnifiedUserIndex(
    GMStorage.MintingData storage mintingData,
    uint256 userIndex
  ) external view returns (address) {
    if (!mintingData.unifiedUserSystemEnabled || userIndex >= mintingData.allUnifiedUsers.length) {
      return address(0);
    }
    uint256 userId = mintingData.allUnifiedUsers[userIndex];
    return mintingData.unifiedUsers[userId].primaryWallet;
  }

  function getUnifiedUserById(
    GMStorage.MintingData storage mintingData,
    uint256 userId
  ) external view returns (GMStorage.UnifiedUser memory) {
    require(mintingData.unifiedUserSystemEnabled, 'Unified user system not enabled');
    require(mintingData.unifiedUsers[userId].userId != 0, 'User does not exist');
    return mintingData.unifiedUsers[userId];
  }

  function getUnifiedUserByWallet(
    GMStorage.MintingData storage mintingData,
    address wallet
  ) external view returns (GMStorage.UnifiedUser memory) {
    require(mintingData.unifiedUserSystemEnabled, 'Unified user system not enabled');
    uint256 userId = mintingData.walletToUnifiedUserId[wallet];
    require(userId != 0, 'Wallet not registered to any user');
    return mintingData.unifiedUsers[userId];
  }

  function getUnifiedUserWallets(
    GMStorage.MintingData storage mintingData,
    uint256 userId
  ) external view returns (address[] memory) {
    require(mintingData.unifiedUserSystemEnabled, 'Unified user system not enabled');
    return mintingData.unifiedUserWallets[userId];
  }
}
