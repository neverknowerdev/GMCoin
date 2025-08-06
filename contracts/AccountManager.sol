// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import '@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol';
import { GMStorage } from './Storage.sol';

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
  modifier onlyOwner() virtual {
    _;
  }

  // Internal storage access - to be provided by main contract
  function _getMintingData() internal view virtual returns (GMStorage.MintingData storage);

  function _msgSender() internal view virtual returns (address);

  // Unified User System Functions

  function enableUnifiedUserSystem() public onlyOwner {
    GMStorage.MintingData storage mintingData = _getMintingData();
    mintingData.unifiedUserSystemEnabled = true;
  }

  function disableUnifiedUserSystem() public onlyOwner {
    GMStorage.MintingData storage mintingData = _getMintingData();
    mintingData.unifiedUserSystemEnabled = false;
  }

  function createOrLinkUnifiedUser(
    address wallet,
    string memory twitterId,
    uint256 farcasterFid
  ) internal returns (uint256) {
    GMStorage.MintingData storage mintingData = _getMintingData();
    if (!mintingData.unifiedUserSystemEnabled) {
      return 0;
    }

    uint256 existingUserId = mintingData.walletToUnifiedUserId[wallet];

    if (existingUserId != 0) {
      return linkSocialAccountToUser(existingUserId, twitterId, farcasterFid);
    } else {
      return createNewUnifiedUser(wallet, twitterId, farcasterFid);
    }
  }

  function createNewUnifiedUser(
    address primaryWallet,
    string memory twitterId,
    uint256 farcasterFid
  ) internal returns (uint256) {
    GMStorage.MintingData storage mintingData = _getMintingData();
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
    uint256 userId,
    string memory twitterId,
    uint256 farcasterFid
  ) internal returns (uint256) {
    GMStorage.MintingData storage mintingData = _getMintingData();
    GMStorage.UnifiedUser storage user = mintingData.unifiedUsers[userId];

    if (bytes(twitterId).length > 0 && bytes(user.twitterId).length == 0) {
      require(mintingData.twitterIdToUnifiedUserId[twitterId] == 0, 'Twitter ID already linked');
      user.twitterId = twitterId;
      mintingData.twitterIdToUnifiedUserId[twitterId] = userId;
    }

    if (farcasterFid != 0 && user.farcasterFid == 0) {
      require(mintingData.farcasterFidToUnifiedUserId[farcasterFid] == 0, 'Farcaster FID already linked');
      user.farcasterFid = farcasterFid;
      mintingData.farcasterFidToUnifiedUserId[farcasterFid] = userId;
    }

    return userId;
  }

  function linkAdditionalWallet(address newWallet, bytes calldata signature) public {
    GMStorage.MintingData storage mintingData = _getMintingData();
    require(mintingData.unifiedUserSystemEnabled, 'System not enabled');

    address recoveredSigner = ECDSA.recover(
      MessageHashUtils.toEthSignedMessageHash(bytes('I want to link this wallet to my GMCoin account')),
      signature
    );
    require(recoveredSigner == newWallet, 'Invalid signature');
    require(!mintingData.registeredWallets[newWallet], 'Wallet already registered');
    require(mintingData.walletToUnifiedUserId[newWallet] == 0, 'Wallet already linked');

    uint256 userId = mintingData.walletToUnifiedUserId[_msgSender()];
    require(userId != 0, 'Caller not registered');

    mintingData.walletToUnifiedUserId[newWallet] = userId;
    mintingData.unifiedUserWallets[userId].push(newWallet);
    mintingData.registeredWallets[newWallet] = true;

    emit UnifiedWalletLinked(userId, newWallet);
  }

  function setUnifiedUserHumanVerification(uint256 userId, bool isVerified) public onlyOwner {
    GMStorage.MintingData storage mintingData = _getMintingData();
    require(mintingData.unifiedUserSystemEnabled, 'System not enabled');
    require(mintingData.unifiedUsers[userId].userId != 0, 'User does not exist');

    mintingData.unifiedUsers[userId].isHumanVerified = isVerified;

    address[] memory wallets = mintingData.unifiedUserWallets[userId];
    for (uint256 i = 0; i < wallets.length; i++) {
      mintingData.registeredWallets[wallets[i]] = isVerified;
    }

    emit UnifiedHumanVerificationUpdated(userId, isVerified);
  }

  function walletByUnifiedUserIndex(uint256 userIndex) internal view returns (address) {
    GMStorage.MintingData storage mintingData = _getMintingData();
    if (!mintingData.unifiedUserSystemEnabled || userIndex >= mintingData.allUnifiedUsers.length) {
      return address(0);
    }
    uint256 userId = mintingData.allUnifiedUsers[userIndex];
    return mintingData.unifiedUsers[userId].primaryWallet;
  }

  function isWalletRegistered(address wallet) public view returns (bool) {
    GMStorage.MintingData storage mintingData = _getMintingData();
    return mintingData.registeredWallets[wallet];
  }

  function removeUser(address wallet) internal {
    GMStorage.MintingData storage mintingData = _getMintingData();
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

  function getUnifiedUserById(uint256 userId) public view returns (GMStorage.UnifiedUser memory) {
    GMStorage.MintingData storage mintingData = _getMintingData();
    require(mintingData.unifiedUserSystemEnabled, 'Unified user system not enabled');
    require(mintingData.unifiedUsers[userId].userId != 0, 'User does not exist');
    return mintingData.unifiedUsers[userId];
  }

  function getUnifiedUserByWallet(address wallet) public view returns (GMStorage.UnifiedUser memory) {
    GMStorage.MintingData storage mintingData = _getMintingData();
    require(mintingData.unifiedUserSystemEnabled, 'Unified user system not enabled');
    uint256 userId = mintingData.walletToUnifiedUserId[wallet];
    require(userId != 0, 'Wallet not registered to any user');
    return mintingData.unifiedUsers[userId];
  }

  function getUnifiedUserWallets(uint256 userId) public view returns (address[] memory) {
    GMStorage.MintingData storage mintingData = _getMintingData();
    require(mintingData.unifiedUserSystemEnabled, 'Unified user system not enabled');
    return mintingData.unifiedUserWallets[userId];
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
