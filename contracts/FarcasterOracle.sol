// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import { GMStorage } from './Storage.sol';

abstract contract FarcasterOracle {
  // Farcaster events
  event VerifyFarcasterRequested(uint256 indexed farcasterFid, address indexed wallet);
  event FarcasterVerificationResult(
    uint256 indexed farcasterFid,
    address indexed wallet,
    bool isSuccess,
    string errorMsg
  );
  event farcasterMintingProcessed(uint32 indexed mintingDayTimestamp, GMStorage.Batch[] batches);

  // Access control - to be inherited from main contract
  modifier onlyGelato() virtual {
    _;
  }

  // Internal storage access - to be provided by main contract
  function _getMintingData() internal view virtual returns (GMStorage.MintingData storage);

  function _getMintingConfig() internal view virtual returns (GMStorage.MintingConfig storage);

  function _msgSender() internal view virtual returns (address);

  // Farcaster verification functions

  function requestFarcasterVerification(uint256 farcasterFid) public {
    GMStorage.MintingData storage mintingData = _getMintingData();
    require(mintingData.farcasterWalletsByFIDs[farcasterFid] == address(0), 'Farcaster account already linked');
    require(mintingData.farcasterUsersByWallets[_msgSender()] == 0, 'wallet already linked to FID');

    emit VerifyFarcasterRequested(farcasterFid, _msgSender());
  }

  // Alias for better UX - same as requestFarcasterVerification
  function verifyFarcaster(uint256 farcasterFid) public {
    requestFarcasterVerification(farcasterFid);
  }

  // Complex verification function that handles both Twitter and Farcaster
  function verifyBothFarcasterAndTwitter(
    uint256 farcasterFid,
    address wallet,
    string calldata twitterId
  ) public onlyGelato {
    GMStorage.MintingData storage mintingData = _getMintingData();

    // First verify Farcaster internally
    _verifyFarcasterInternal(farcasterFid, wallet);

    // Then verify Twitter for the same wallet (simulating Twitter verification)
    // This assumes the Twitter verification has already been validated by the Web3 Function

    // Register Twitter user if not already exists
    if (mintingData.walletsByUserIDs[twitterId] == address(0)) {
      mintingData.allTwitterUsers.push(twitterId);
      mintingData.userIndexByUserID[twitterId] = mintingData.allTwitterUsers.length - 1;
    }

    mintingData.usersByWallets[wallet] = twitterId;
    mintingData.walletsByUserIDs[twitterId] = wallet;

    // Create unified user linking both accounts
    if (mintingData.unifiedUserSystemEnabled) {
      uint256 userId = _createOrLinkUnifiedUser(wallet, twitterId, farcasterFid);
      if (userId > 0) {
        _emitUnifiedUserCreated(userId, wallet, twitterId, farcasterFid);
      }
    }

    emit FarcasterVerificationResult(farcasterFid, wallet, true, '');
    _emitTwitterVerificationResult(twitterId, wallet, true, '');
  }

  // Function to merge two existing unified accounts
  function mergeUnifiedAccounts(uint256 farcasterFid, string calldata twitterId, address wallet) public onlyGelato {
    GMStorage.MintingData storage mintingData = _getMintingData();
    require(mintingData.unifiedUserSystemEnabled, 'Unified user system not enabled');

    // Get existing user IDs
    uint256 twitterUserId = mintingData.twitterIdToUnifiedUserId[twitterId];
    uint256 walletUserId = mintingData.walletToUnifiedUserId[wallet];

    require(twitterUserId != 0, 'Twitter user not found in unified system');
    require(walletUserId == 0, 'Wallet already has unified user');

    // Verify Farcaster first internally
    _verifyFarcasterInternal(farcasterFid, wallet);

    // Link the wallet and Farcaster to existing Twitter unified account
    mintingData.walletToUnifiedUserId[wallet] = twitterUserId;
    mintingData.unifiedUserWallets[twitterUserId].push(wallet);
    mintingData.unifiedUsers[twitterUserId].farcasterFid = farcasterFid;
    mintingData.farcasterFidToUnifiedUserId[farcasterFid] = twitterUserId;

    emit FarcasterVerificationResult(farcasterFid, wallet, true, '');
  }

  // Internal function to handle Farcaster verification logic
  function _verifyFarcasterInternal(uint256 farcasterFid, address wallet) internal {
    GMStorage.MintingData storage mintingData = _getMintingData();
    GMStorage.MintingConfig storage mintingConfig = _getMintingConfig();

    mintingData.farcasterUsersByWallets[wallet] = farcasterFid;
    mintingData.registeredWallets[wallet] = true;

    bool shouldMint = false;
    uint256 userIndex = 0;
    uint256 mintAmount = 0;

    if (mintingData.farcasterWalletsByFIDs[farcasterFid] == address(0)) {
      mintingData.farcasterWalletsByFIDs[farcasterFid] = wallet;
      mintingData.allFarcasterUsers.push(farcasterFid);
      mintingData.farcasterUserIndexByFID[farcasterFid] = mintingData.allFarcasterUsers.length - 1;

      shouldMint = true;
      userIndex = mintingData.allFarcasterUsers.length - 1;
      mintAmount = mintingConfig.COINS_MULTIPLICATOR * mintingConfig.POINTS_PER_TWEET;
    }

    if (shouldMint) {
      _mintForFarcasterUserByIndex(userIndex, mintAmount);
    }
  }

  function verifyFarcaster(uint256 farcasterFid, address wallet) public onlyGelato {
    _verifyFarcasterInternal(farcasterFid, wallet);
    emit FarcasterVerificationResult(farcasterFid, wallet, true, '');
  }

  function farcasterVerificationError(
    address wallet,
    uint256 farcasterFid,
    string calldata errorMsg
  ) public onlyGelato {
    emit FarcasterVerificationResult(farcasterFid, wallet, false, errorMsg);
  }

  // Farcaster query functions

  function isFarcasterUserRegistered(uint256 farcasterFid) public view returns (bool) {
    GMStorage.MintingData storage mintingData = _getMintingData();
    return mintingData.registeredWallets[mintingData.farcasterWalletsByFIDs[farcasterFid]];
  }

  function getWalletByFID(uint256 farcasterFid) public view returns (address) {
    GMStorage.MintingData storage mintingData = _getMintingData();
    return mintingData.farcasterWalletsByFIDs[farcasterFid];
  }

  function getFIDByWallet(address wallet) public view returns (uint256) {
    GMStorage.MintingData storage mintingData = _getMintingData();
    return mintingData.farcasterUsersByWallets[wallet];
  }

  function getFarcasterUsers(uint64 start, uint16 count) public view returns (uint256[] memory) {
    GMStorage.MintingData storage mintingData = _getMintingData();
    uint64 end = start + count;
    if (end > mintingData.allFarcasterUsers.length) {
      end = uint64(mintingData.allFarcasterUsers.length);
    }

    require(start <= end, 'wrong start index');

    uint16 batchSize = uint16(end - start);
    uint256[] memory batchArr = new uint256[](batchSize);
    for (uint16 i = 0; i < batchSize; i++) {
      batchArr[i] = mintingData.allFarcasterUsers[start + i];
    }

    return batchArr;
  }

  function walletByFarcasterUserIndex(uint256 userIndex) internal view returns (address) {
    GMStorage.MintingData storage mintingData = _getMintingData();
    return mintingData.farcasterWalletsByFIDs[mintingData.allFarcasterUsers[userIndex]];
  }

  function totalFarcasterUsersCount() public view returns (uint256) {
    GMStorage.MintingData storage mintingData = _getMintingData();
    return mintingData.allFarcasterUsers.length;
  }

  // Farcaster minting functions

  function processFarcasterMinting(
    GMStorage.UserFarcasterData[] calldata userData,
    uint32 mintingDayTimestamp
  ) internal returns (GMStorage.UserMintingResult[] memory results) {
    GMStorage.MintingData storage mintingData = _getMintingData();
    GMStorage.MintingConfig storage mintingConfig = _getMintingConfig();

    require(mintingData.mintingInProgressForDay != 0, 'no ongoing minting process');
    require(mintingDayTimestamp == mintingData.mintingInProgressForDay, 'wrong mintingDay');

    results = new GMStorage.UserMintingResult[](userData.length);

    for (uint256 i = 0; i < userData.length; i++) {
      if (userData[i].userIndex > mintingData.allFarcasterUsers.length) {
        revert('wrong userIndex');
      }

      uint256 points = userData[i].simpleCasts *
        mintingConfig.POINTS_PER_TWEET +
        userData[i].likes *
        mintingConfig.POINTS_PER_LIKE +
        userData[i].hashtagCasts *
        mintingConfig.POINTS_PER_HASHTAG +
        userData[i].cashtagCasts *
        mintingConfig.POINTS_PER_CASHTAG;

      if (points > 0) {
        mintingData.mintingDayPointsFromUsers += points;
        uint256 coins = points * mintingConfig.COINS_MULTIPLICATOR;
        results[i] = GMStorage.UserMintingResult({
          userIndex: userData[i].userIndex,
          mintAmount: coins,
          shouldMint: true
        });
      } else {
        results[i] = GMStorage.UserMintingResult({
          userIndex: userData[i].userIndex,
          mintAmount: 0,
          shouldMint: false
        });
      }
    }
  }

  function mintCoinsForFarcasterUsers(
    GMStorage.UserFarcasterData[] calldata userData,
    uint32 mintingDayTimestamp,
    GMStorage.Batch[] calldata batches
  ) public onlyGelato {
    GMStorage.UserMintingResult[] memory results = processFarcasterMinting(userData, mintingDayTimestamp);

    for (uint256 i = 0; i < results.length; i++) {
      if (results[i].shouldMint) {
        _mintForFarcasterUserByIndex(results[i].userIndex, results[i].mintAmount);
      }
    }

    if (batches.length > 0) {
      emit farcasterMintingProcessed(mintingDayTimestamp, batches);
    }
  }

  // Enhanced Farcaster verification that creates unified users
  function verifyFarcasterUnified(uint256 farcasterFid, address wallet) public virtual onlyGelato {
    verifyFarcaster(farcasterFid, wallet);

    GMStorage.MintingData storage mintingData = _getMintingData();
    if (mintingData.unifiedUserSystemEnabled) {
      uint256 userId = _createOrLinkUnifiedUser(wallet, '', farcasterFid);
      if (userId > 0) {
        _emitUnifiedUserCreated(userId, wallet, '', farcasterFid);
      }
    }
  }

  // Abstract functions to be implemented by main contract
  function _mintForFarcasterUserByIndex(uint256 userIndex, uint256 amount) internal virtual {}

  function _createOrLinkUnifiedUser(
    address wallet,
    string memory twitterId,
    uint256 farcasterFid
  ) internal virtual returns (uint256) {}

  function _emitUnifiedUserCreated(
    uint256 userId,
    address wallet,
    string memory twitterId,
    uint256 farcasterFid
  ) internal virtual {}

  // Abstract function to emit Twitter verification result (defined in TwitterOracle)
  function _emitTwitterVerificationResult(
    string memory twitterId,
    address wallet,
    bool isSuccess,
    string memory errorMsg
  ) internal virtual {}
}
