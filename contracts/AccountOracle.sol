// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import '@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol';

import 'hardhat/console.sol';
import { GMStorage } from './Storage.sol';
import { GMWeb3Functions } from './GelatoWeb3Functions.sol';

abstract contract GMAccountOracle is GMStorage, Initializable, GMWeb3Functions {

  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
  }

  // =============================================================================
  // Unified User System Functions
  // =============================================================================

  event UnifiedUserCreated(uint256 indexed userId, address indexed primaryWallet, string twitterId, uint256 farcasterFid);
  event UnifiedSocialAccountLinked(uint256 indexed userId, string platform, string platformId);
  event UnifiedWalletLinked(uint256 indexed userId, address indexed wallet);
  event UnifiedHumanVerificationUpdated(uint256 indexed userId, bool isVerified);

  /**
   * @dev Enable the unified user system (owner only)
   */
  function enableUnifiedUserSystem() public onlyOwner {
    mintingData.unifiedUserSystemEnabled = true;
  }

  /**
   * @dev Disable the unified user system (owner only)
   */
  function disableUnifiedUserSystem() public onlyOwner {
    mintingData.unifiedUserSystemEnabled = false;
  }

  /**
   * @dev Create a new unified user or link to existing user during verification
   */
  function _createOrLinkUnifiedUser(
    address wallet,
    string memory twitterId,
    uint256 farcasterFid
  ) internal virtual returns (uint256) {
    if (!mintingData.unifiedUserSystemEnabled) {
      return 0; // Feature disabled, use legacy system
    }

    uint256 existingUserId = mintingData.walletToUnifiedUserId[wallet];
    
    if (existingUserId != 0) {
      // User already exists - link social account
      return _linkSocialAccountToUser(existingUserId, twitterId, farcasterFid);
    } else {
      // Create new user
      return _createNewUnifiedUser(wallet, twitterId, farcasterFid);
    }
  }

  /**
   * @dev Create a new unified user
   */
  function _createNewUnifiedUser(
    address primaryWallet,
    string memory twitterId,
    uint256 farcasterFid
  ) internal returns (uint256) {
    mintingData.nextUserId++;
    uint256 userId = mintingData.nextUserId;

    UnifiedUser storage user = mintingData.unifiedUsers[userId];
    user.userId = userId;
    user.primaryWallet = primaryWallet;
    user.isHumanVerified = true; // New users are human verified
    user.createdAt = uint32(block.timestamp);
    user.twitterId = twitterId;
    user.farcasterFid = farcasterFid;

    // Set up mappings
    mintingData.allUnifiedUsers.push(userId);
    mintingData.walletToUnifiedUserId[primaryWallet] = userId;
    mintingData.unifiedUserWallets[userId].push(primaryWallet);

    // Set up social platform mappings
    if (bytes(twitterId).length > 0) {
      mintingData.twitterIdToUnifiedUserId[twitterId] = userId;
    }
    if (farcasterFid != 0) {
      mintingData.farcasterFidToUnifiedUserId[farcasterFid] = userId;
    }

    emit UnifiedUserCreated(userId, primaryWallet, twitterId, farcasterFid);
    return userId;
  }

  /**
   * @dev Link social account to existing user
   */
  function _linkSocialAccountToUser(
    uint256 userId,
    string memory twitterId,
    uint256 farcasterFid
  ) internal returns (uint256) {
    UnifiedUser storage user = mintingData.unifiedUsers[userId];
    
    // Link Twitter if provided and not already linked
    if (bytes(twitterId).length > 0 && bytes(user.twitterId).length == 0) {
      require(mintingData.twitterIdToUnifiedUserId[twitterId] == 0, "Twitter ID already linked to another user");
      user.twitterId = twitterId;
      mintingData.twitterIdToUnifiedUserId[twitterId] = userId;
      emit UnifiedSocialAccountLinked(userId, "twitter", twitterId);
    }
    
    // Link Farcaster if provided and not already linked
    if (farcasterFid != 0 && user.farcasterFid == 0) {
      require(mintingData.farcasterFidToUnifiedUserId[farcasterFid] == 0, "Farcaster FID already linked to another user");
      user.farcasterFid = farcasterFid;
      mintingData.farcasterFidToUnifiedUserId[farcasterFid] = userId;
      emit UnifiedSocialAccountLinked(userId, "farcaster", "");
    }

    return userId;
  }

  /**
   * @dev Link additional wallet to unified user
   */
  function linkAdditionalWallet(address newWallet, bytes calldata signature) public {
    require(mintingData.unifiedUserSystemEnabled, "Unified user system not enabled");
    
    // Verify signature proves control of new wallet
    address recoveredSigner = ECDSA.recover(
      MessageHashUtils.toEthSignedMessageHash(bytes('I want to link this wallet to my GMCoin account')),
      signature
    );
    require(recoveredSigner == newWallet, 'Invalid signature for new wallet');
    require(!mintingData.registeredWallets[newWallet], 'Wallet already registered');
    require(mintingData.walletToUnifiedUserId[newWallet] == 0, 'Wallet already linked to a user');

    uint256 userId = mintingData.walletToUnifiedUserId[_msgSender()];
    require(userId != 0, 'Caller wallet not registered to any user');

    // Link new wallet to user
    mintingData.walletToUnifiedUserId[newWallet] = userId;
    mintingData.unifiedUserWallets[userId].push(newWallet);
    mintingData.registeredWallets[newWallet] = true;

    emit UnifiedWalletLinked(userId, newWallet);
  }

  /**
   * @dev Set human verification status for unified user
   */
  function setUnifiedUserHumanVerification(uint256 userId, bool isVerified) public onlyOwner {
    require(mintingData.unifiedUserSystemEnabled, "Unified user system not enabled");
    require(mintingData.unifiedUsers[userId].userId != 0, 'User does not exist');
    
    mintingData.unifiedUsers[userId].isHumanVerified = isVerified;
    
    // Update registration status for all user wallets
    address[] memory wallets = mintingData.unifiedUserWallets[userId];
    for (uint256 i = 0; i < wallets.length; i++) {
      mintingData.registeredWallets[wallets[i]] = isVerified;
    }

    emit UnifiedHumanVerificationUpdated(userId, isVerified);
  }

  /**
   * @dev Get wallet address for unified user (for minting) - Essential function only
   */
  function walletByUnifiedUserIndex(uint256 userIndex) internal view returns (address) {
    if (!mintingData.unifiedUserSystemEnabled || userIndex >= mintingData.allUnifiedUsers.length) {
      return address(0);
    }
    uint256 userId = mintingData.allUnifiedUsers[userIndex];
    return mintingData.unifiedUsers[userId].primaryWallet;
  }

  // General wallet/user management functions

  function isWalletRegistered(address wallet) public view returns (bool) {
    return mintingData.registeredWallets[wallet];
  }

  function removeMe() public {
    require(mintingData.mintingInProgressForDay == 0, 'cannot remove user while active workers, try later');

    address wallet = _msgSender();
    require(mintingData.registeredWallets[wallet], "msgSender's wallet is not registered");

    if (mintingData.registeredWallets[wallet]) {
      string memory userID = mintingData.usersByWallets[wallet];
      uint userIndex = mintingData.userIndexByUserID[userID];
      delete mintingData.registeredWallets[wallet];
      delete mintingData.walletsByUserIDs[userID];
      delete mintingData.usersByWallets[wallet];

      // remove from array
      string memory lastIndexUserID = mintingData.allTwitterUsers[mintingData.allTwitterUsers.length - 1];
      mintingData.allTwitterUsers[userIndex] = lastIndexUserID;
      mintingData.allTwitterUsers.pop();

      mintingData.userIndexByUserID[lastIndexUserID] = userIndex;
    }
  }

  function removeUserByUserId(string memory userID) internal {
    uint userIndex = mintingData.userIndexByUserID[userID];
    address wallet = mintingData.walletsByUserIDs[userID];

    delete mintingData.registeredWallets[wallet];
    delete mintingData.walletsByUserIDs[userID];
    delete mintingData.usersByWallets[wallet];

    // remove from array
    string memory lastIndexUserID = mintingData.allTwitterUsers[mintingData.allTwitterUsers.length - 1];
    mintingData.allTwitterUsers[userIndex] = lastIndexUserID;
    mintingData.allTwitterUsers.pop();

    mintingData.userIndexByUserID[lastIndexUserID] = userIndex;
  }
}