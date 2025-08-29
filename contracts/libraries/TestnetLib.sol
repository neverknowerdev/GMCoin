// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import { GMStorage } from '../Storage.sol';

library TestnetLib {
  event TwitterVerificationResult(string userID, address indexed wallet, bool isSuccess, string errorMsg);

  function clearUser(GMStorage.MintingData storage mintingData) external {
    string memory userID = '1796129942104657921';
    address wallet = mintingData.walletsByUserIDs[userID];

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

  function addTwitterUsername(
    GMStorage.MintingData storage mintingData,
    string calldata userID,
    address walletAddress
  ) external {
    mintingData.walletsByUserIDs[userID] = walletAddress;
    mintingData.allTwitterUsers.push(userID);
    emit TwitterVerificationResult(userID, walletAddress, true, '');
  }

  function removeUser(
    GMStorage.MintingData storage mintingData,
    string memory userID,
    address wallet
  ) external {
    if (mintingData.registeredWallets[wallet]) {
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

  function triggerVerifyTwitter(
    GMStorage.MintingData storage mintingData,
    GMStorage.MintingConfig storage mintingConfig,
    string calldata userID,
    address wallet
  ) external returns (bool shouldMint, uint256 mintAmount) {
    mintingData.usersByWallets[wallet] = userID;
    mintingData.registeredWallets[wallet] = true;

    if (mintingData.walletsByUserIDs[userID] == address(0)) {
      mintingData.walletsByUserIDs[userID] = wallet;
      mintingData.allTwitterUsers.push(userID);
      mintingData.userIndexByUserID[userID] = mintingData.allTwitterUsers.length - 1;

      shouldMint = true;
      mintAmount = mintingConfig.COINS_MULTIPLICATOR * mintingConfig.POINTS_PER_TWEET;

      emit TwitterVerificationResult(userID, wallet, true, '');
    }
  }
}