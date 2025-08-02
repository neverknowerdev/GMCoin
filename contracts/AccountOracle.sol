// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import '@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol';
import { GMStorage } from './Storage.sol';

library AccountOracleLib {
  using AccountOracleLib for GMStorage.MintingData;

  // Events need to be defined in the contract that uses this library

  function enableUnifiedUserSystem(
    GMStorage.MintingData storage mintingData
  ) external {
    mintingData.unifiedUserSystemEnabled = true;
  }

  function disableUnifiedUserSystem(
    GMStorage.MintingData storage mintingData
  ) external {
    mintingData.unifiedUserSystemEnabled = false;
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
    user.isHumanVerified = true;
    user.createdAt = uint32(block.timestamp);
    user.twitterId = twitterId;
    user.farcasterFid = farcasterFid;

    mintingData.allUnifiedUsers.push(userId);
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
      require(mintingData.twitterIdToUnifiedUserId[twitterId] == 0, "Twitter ID already linked");
      user.twitterId = twitterId;
      mintingData.twitterIdToUnifiedUserId[twitterId] = userId;
    }
    
    if (farcasterFid != 0 && user.farcasterFid == 0) {
      require(mintingData.farcasterFidToUnifiedUserId[farcasterFid] == 0, "Farcaster FID already linked");
      user.farcasterFid = farcasterFid;
      mintingData.farcasterFidToUnifiedUserId[farcasterFid] = userId;
    }

    return userId;
  }

  function linkAdditionalWallet(
    GMStorage.MintingData storage mintingData,
    address sender,
    address newWallet,
    bytes calldata signature
  ) external {
    require(mintingData.unifiedUserSystemEnabled, "System not enabled");
    
    address recoveredSigner = ECDSA.recover(
      MessageHashUtils.toEthSignedMessageHash(bytes('I want to link this wallet to my GMCoin account')),
      signature
    );
    require(recoveredSigner == newWallet, 'Invalid signature');
    require(!mintingData.registeredWallets[newWallet], 'Wallet already registered');
    require(mintingData.walletToUnifiedUserId[newWallet] == 0, 'Wallet already linked');

    uint256 userId = mintingData.walletToUnifiedUserId[sender];
    require(userId != 0, 'Caller not registered');

    mintingData.walletToUnifiedUserId[newWallet] = userId;
    mintingData.unifiedUserWallets[userId].push(newWallet);
    mintingData.registeredWallets[newWallet] = true;
  }

  function setUnifiedUserHumanVerification(
    GMStorage.MintingData storage mintingData,
    uint256 userId,
    bool isVerified
  ) external {
    require(mintingData.unifiedUserSystemEnabled, "System not enabled");
    require(mintingData.unifiedUsers[userId].userId != 0, 'User does not exist');
    
    mintingData.unifiedUsers[userId].isHumanVerified = isVerified;
    
    address[] memory wallets = mintingData.unifiedUserWallets[userId];
    for (uint256 i = 0; i < wallets.length; i++) {
      mintingData.registeredWallets[wallets[i]] = isVerified;
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

  function isWalletRegistered(
    GMStorage.MintingData storage mintingData,
    address wallet
  ) external view returns (bool) {
    return mintingData.registeredWallets[wallet];
  }

  function removeUser(
    GMStorage.MintingData storage mintingData,
    address wallet
  ) external {
    require(mintingData.mintingInProgressForDay == 0, 'cannot remove user while active workers');
    require(mintingData.registeredWallets[wallet], "msgSender's wallet is not registered");

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

  function removeUserByUserId(
    GMStorage.MintingData storage mintingData,
    string memory userID
  ) external {
    uint userIndex = mintingData.userIndexByUserID[userID];
    address wallet = mintingData.walletsByUserIDs[userID];

    delete mintingData.registeredWallets[wallet];
    delete mintingData.walletsByUserIDs[userID];
    delete mintingData.usersByWallets[wallet];

    string memory lastIndexUserID = mintingData.allTwitterUsers[mintingData.allTwitterUsers.length - 1];
    mintingData.allTwitterUsers[userIndex] = lastIndexUserID;
    mintingData.allTwitterUsers.pop();

    mintingData.userIndexByUserID[lastIndexUserID] = userIndex;
  }
}