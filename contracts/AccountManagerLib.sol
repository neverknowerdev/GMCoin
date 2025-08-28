// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import '@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol';
import { GMStorage } from './Storage.sol';
import './Errors.sol';

library AccountManagerLib {
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
      return linkSocialAccountToUser(mintingData, existingUserId, twitterId, farcasterFid);
    } else {
      return createNewUnifiedUser(mintingData, wallet, twitterId, farcasterFid);
    }
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

    if (bytes(twitterId).length > 0) {
      mintingData.twitterIdToUnifiedUserId[twitterId] = userId;
    }
    if (farcasterFid != 0) {
      mintingData.farcasterFidToUnifiedUserId[farcasterFid] = userId;
    }

    return userId;
  }

  function linkSocialAccountToUser(
    GMStorage.MintingData storage mintingData,
    uint256 userId,
    string memory twitterId,
    uint256 farcasterFid
  ) public returns (uint256) {
    GMStorage.UnifiedUser storage user = mintingData.unifiedUsers[userId];

    if (bytes(twitterId).length > 0 && bytes(user.twitterId).length == 0) {
      if (mintingData.twitterIdToUnifiedUserId[twitterId] != 0) revert TwitterIdAlreadyLinked();
      user.twitterId = twitterId;
      mintingData.twitterIdToUnifiedUserId[twitterId] = userId;
    }

    if (farcasterFid != 0 && user.farcasterFid == 0) {
      if (mintingData.farcasterFidToUnifiedUserId[farcasterFid] != 0) revert FarcasterFidAlreadyLinked();
      user.farcasterFid = farcasterFid;
      mintingData.farcasterFidToUnifiedUserId[farcasterFid] = userId;
    }

    return userId;
  }

  function linkAdditionalWallet(
    GMStorage.MintingData storage mintingData,
    address caller,
    address newWallet,
    bytes calldata signature
  ) external {
    if (!mintingData.unifiedUserSystemEnabled) revert SystemNotEnabled();

    address recoveredSigner = ECDSA.recover(
      MessageHashUtils.toEthSignedMessageHash(bytes('I want to link this wallet to my GMCoin account')),
      signature
    );
    if (recoveredSigner != newWallet) revert InvalidSignature();
    if (mintingData.registeredWallets[newWallet]) revert WalletAlreadyRegistered();
    if (mintingData.walletToUnifiedUserId[newWallet] != 0) revert WalletAlreadyLinked();

    uint256 userId = mintingData.walletToUnifiedUserId[caller];
    if (userId == 0) revert CallerNotRegistered();

    mintingData.walletToUnifiedUserId[newWallet] = userId;
    mintingData.unifiedUserWallets[userId].push(newWallet);
    mintingData.registeredWallets[newWallet] = true;
  }

  function setUnifiedUserHumanVerification(
    GMStorage.MintingData storage mintingData,
    uint256 userId,
    bool isVerified
  ) external {
    if (!mintingData.unifiedUserSystemEnabled) revert SystemNotEnabled();
    if (mintingData.unifiedUsers[userId].userId == 0) revert UserNotExist();

    mintingData.unifiedUsers[userId].isHumanVerified = isVerified;
  }

  function setPrimaryWallet(
    GMStorage.MintingData storage mintingData,
    uint256 userId,
    address newPrimaryWallet
  ) external {
    if (!mintingData.unifiedUserSystemEnabled) revert SystemNotEnabled();
    if (mintingData.unifiedUsers[userId].userId == 0) revert UserNotExist();
    if (mintingData.walletToUnifiedUserId[newPrimaryWallet] != userId) revert WalletNotLinked();

    mintingData.unifiedUsers[userId].primaryWallet = newPrimaryWallet;
  }

  function mergeUsers(GMStorage.MintingData storage mintingData, uint256 fromUserId, uint256 toUserId) external {
    if (!mintingData.unifiedUserSystemEnabled) revert SystemNotEnabled();
    if (mintingData.unifiedUsers[fromUserId].userId == 0) revert FromUserNotExist();
    if (mintingData.unifiedUsers[toUserId].userId == 0) revert ToUserNotExist();
    if (fromUserId == toUserId) revert CannotMergeSameUser();

    GMStorage.UnifiedUser storage fromUser = mintingData.unifiedUsers[fromUserId];
    GMStorage.UnifiedUser storage toUser = mintingData.unifiedUsers[toUserId];

    // Move social accounts if not already present
    if (bytes(fromUser.twitterId).length > 0 && bytes(toUser.twitterId).length == 0) {
      toUser.twitterId = fromUser.twitterId;
      mintingData.twitterIdToUnifiedUserId[fromUser.twitterId] = toUserId;
    }

    if (fromUser.farcasterFid != 0 && toUser.farcasterFid == 0) {
      toUser.farcasterFid = fromUser.farcasterFid;
      mintingData.farcasterFidToUnifiedUserId[fromUser.farcasterFid] = toUserId;
    }

    // Move all wallets from fromUser to toUser
    address[] memory walletsToMove = mintingData.unifiedUserWallets[fromUserId];
    for (uint256 i = 0; i < walletsToMove.length; i++) {
      mintingData.walletToUnifiedUserId[walletsToMove[i]] = toUserId;
      mintingData.unifiedUserWallets[toUserId].push(walletsToMove[i]);
    }

    // Clean up fromUser data
    delete mintingData.unifiedUsers[fromUserId];
    delete mintingData.unifiedUserWallets[fromUserId];

    // O(1) remove from allUnifiedUsers via swap-with-last
    uint256 idx = mintingData.unifiedUserIndexById[fromUserId];
    uint256 lastIdx = mintingData.allUnifiedUsers.length - 1;
    if (idx <= lastIdx) {
      uint256 lastId = mintingData.allUnifiedUsers[lastIdx];
      mintingData.allUnifiedUsers[idx] = lastId;
      mintingData.unifiedUserIndexById[lastId] = idx;
      mintingData.allUnifiedUsers.pop();
      delete mintingData.unifiedUserIndexById[fromUserId];
    }
  }

  function removeUser(GMStorage.MintingData storage mintingData, address wallet) external {
    if (mintingData.mintingInProgressForDay != 0) revert CannotRemoveUserActiveWorkers();
    if (!mintingData.registeredWallets[wallet]) revert WalletNotRegistered();

    string memory userID = mintingData.usersByWallets[wallet];
    uint userIndex = mintingData.userIndexByUserID[userID];
    delete mintingData.registeredWallets[wallet];
    delete mintingData.walletsByUserIDs[userID];
    delete mintingData.usersByWallets[wallet];

    string memory lastIndexUserID = mintingData.allTwitterUsers[mintingData.allTwitterUsers.length - 1];
    mintingData.allTwitterUsers[userIndex] = lastIndexUserID;
    mintingData.allTwitterUsers.pop();

    mintingData.userIndexByUserID[lastIndexUserID] = userIndex;
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
