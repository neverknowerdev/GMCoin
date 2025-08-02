// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import '@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol';

import 'hardhat/console.sol';
import { GMStorage } from './Storage.sol';
import { GMWeb3Functions } from './GelatoWeb3Functions.sol';

abstract contract GMFarcasterOracle is GMStorage, Initializable, GMWeb3Functions {

  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
  }

  // Farcaster events
  event VerifyFarcasterRequested(uint256 indexed farcasterFid, address indexed wallet);
  event FarcasterVerificationResult(
    uint256 indexed farcasterFid,
    address indexed wallet,
    bool isSuccess,
    string errorMsg
  );
  event farcasterMintingProcessed(uint32 indexed mintingDayTimestamp, Batch[] batches);

  // Farcaster verification functions

  function requestFarcasterVerification(uint256 farcasterFid) public {
    require(mintingData.farcasterWalletsByFIDs[farcasterFid] == address(0), 'Farcaster account already linked');
    require(mintingData.farcasterUsersByWallets[_msgSender()] == 0, 'wallet already linked to FID');

    emit VerifyFarcasterRequested(farcasterFid, _msgSender());
  }

  function verifyFarcaster(uint256 farcasterFid, address wallet) public {
    require(_msgSender() == gelatoConfig.gelatoAddress, 'only Gelato can call this function');
    mintingData.farcasterUsersByWallets[wallet] = farcasterFid;
    mintingData.registeredWallets[wallet] = true;

    if (mintingData.farcasterWalletsByFIDs[farcasterFid] == address(0)) {
      mintingData.farcasterWalletsByFIDs[farcasterFid] = wallet;
      mintingData.allFarcasterUsers.push(farcasterFid);
      mintingData.farcasterUserIndexByFID[farcasterFid] = mintingData.allFarcasterUsers.length - 1;

      // Welcome tokens for Farcaster users
      _mintForFarcasterUserByIndex(
        mintingData.allFarcasterUsers.length - 1,
        mintingConfig.COINS_MULTIPLICATOR * mintingConfig.POINTS_PER_TWEET
      );

      emit FarcasterVerificationResult(farcasterFid, wallet, true, '');
    }
  }

  function farcasterVerificationError(
    address wallet,
    uint256 farcasterFid,
    string calldata errorMsg
  ) public {
    require(_msgSender() == gelatoConfig.gelatoAddress, 'only Gelato can call this function');
    emit FarcasterVerificationResult(farcasterFid, wallet, false, errorMsg);
  }

  // Farcaster query functions

  function isFarcasterUserRegistered(uint256 farcasterFid) public view returns (bool) {
    return mintingData.registeredWallets[mintingData.farcasterWalletsByFIDs[farcasterFid]];
  }

  function getWalletByFID(uint256 farcasterFid) public view returns (address) {
    return mintingData.farcasterWalletsByFIDs[farcasterFid];
  }

  function getFIDByWallet(address wallet) public view returns (uint256) {
    return mintingData.farcasterUsersByWallets[wallet];
  }

  function getFarcasterUsers(uint64 start, uint16 count) public view returns (uint256[] memory) {
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
    return mintingData.farcasterWalletsByFIDs[mintingData.allFarcasterUsers[userIndex]];
  }

  // Farcaster minting functions

  // to be defined in main contract (similar to _mintForUserByIndex)
  function _mintForFarcasterUserByIndex(uint256 userIndex, uint256 amount) internal virtual;

  function mintCoinsForFarcasterUsers(
    UserFarcasterData[] calldata userData,
    uint32 mintingDayTimestamp,
    Batch[] calldata batches
  ) public {
    require(_msgSender() == gelatoConfig.gelatoAddress, 'only Gelato can call this function');
    require(mintingData.mintingInProgressForDay != 0, 'no ongoing minting process');
    require(mintingDayTimestamp == mintingData.mintingInProgressForDay, 'wrong mintingDay');

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

      if (points == 0) {
        continue;
      }

      mintingData.mintingDayPointsFromUsers += points;
      uint256 coins = points * mintingConfig.COINS_MULTIPLICATOR;
      _mintForFarcasterUserByIndex(userData[i].userIndex, coins);
    }

    if (batches.length > 0) {
      emit farcasterMintingProcessed(mintingDayTimestamp, batches);
    }
  }

  /**
   * @dev Enhanced Farcaster verification that creates unified users
   */
  function verifyFarcasterUnified(uint256 farcasterFid, address wallet) public virtual {
    require(_msgSender() == gelatoConfig.gelatoAddress, 'only Gelato can call this function');
    // Always run legacy verification first
    verifyFarcaster(farcasterFid, wallet);
    
    // Then create/link unified user if system is enabled
    if (mintingData.unifiedUserSystemEnabled) {
      _createOrLinkUnifiedUser(wallet, "", farcasterFid);
    }
  }

  // This function will be overridden by inheriting contracts that include AccountOracle
  function _createOrLinkUnifiedUser(
    address wallet,
    string memory twitterId,
    uint256 farcasterFid
  ) internal virtual returns (uint256) {
    // This will be implemented in the AccountOracle or main contract
    return 0;
  }
}