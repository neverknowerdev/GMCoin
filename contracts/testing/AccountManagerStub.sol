// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import '../AccountManager.sol';
import '../IGMCoin.sol';

contract AccountManagerStub is AccountManager {
  address private _owner;
  address private _gelatoAddress;

  constructor() {
    _disableInitializers();
  }

  // Implement abstract functions
  function _requireOwner() internal view override {
    require(msg.sender == _owner, "Ownable: caller is not the owner");
  }

  function msgSender() internal view override returns (address) {
    return msg.sender;
  }

  // Add verifyTwitterUnified for tests (calls createOrLinkUnifiedUser)
  function verifyTwitter(string calldata twitterId, address wallet) external {
    verifyTwitterUnified(twitterId, wallet);
  }

  function verifyTwitterUnified(string calldata twitterId, address wallet) public {
    // Only allow gelato or owner for testing
    require(msg.sender == _owner || msg.sender == _gelatoAddress, "Only owner or gelato");
    
    // Create or link unified user with Twitter ID
    uint256 userId = createOrLinkUnifiedUser(wallet, twitterId, 0);
    
    // The wallet mappings are already handled by createOrLinkUnifiedUser
    
    emit UnifiedUserCreated(userId, wallet, twitterId, 0);
  }

  // Add verifyFarcasterUnified for consistency
  function verifyFarcasterUnified(uint256 farcasterFid, address wallet) public {
    require(msg.sender == _owner || msg.sender == _gelatoAddress, "Only owner or gelato");
    
    uint256 userId = createOrLinkUnifiedUser(wallet, "", farcasterFid);
    
    // The wallet mappings are already handled by createOrLinkUnifiedUser
    
    emit UnifiedUserCreated(userId, wallet, "", farcasterFid);
  }

  // Add verifyFarcaster as an alias for verifyFarcasterUnified
  function verifyFarcaster(uint256 farcasterFid, address wallet) external {
    verifyFarcasterUnified(farcasterFid, wallet);
  }
  
  // Helper functions for test scenarios
  function verifyBothFarcasterAndTwitter(uint256 farcasterFid, address wallet, string calldata twitterId) external {
    require(msg.sender == _owner || msg.sender == _gelatoAddress, "Only owner or gelato");
    uint256 userId = createOrLinkUnifiedUser(wallet, twitterId, farcasterFid);
    emit UnifiedUserCreated(userId, wallet, twitterId, farcasterFid);
  }
  
  function verifyFarcasterAndMergeWithTwitter(uint256 farcasterFid, address wallet, string calldata twitterId) external {
    require(msg.sender == _owner || msg.sender == _gelatoAddress, "Only owner or gelato");
    uint256 userId = createOrLinkUnifiedUser(wallet, twitterId, farcasterFid);
    emit UnifiedUserCreated(userId, wallet, twitterId, farcasterFid);
  }

  // Override initialize to set owner
  function initialize(address _gmCoin) public override initializer {
    super.initialize(_gmCoin);
    _owner = msg.sender;
  }

  // Add function to set gelato address for testing
  function setGelatoAddress(address _gelato) external {
    require(msg.sender == _owner, "Only owner");
    _gelatoAddress = _gelato;
  }
}