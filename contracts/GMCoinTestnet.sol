// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import './GMCoin.sol';
import { TestnetLib } from './libraries/TestnetLib.sol';

contract GMCoinTestnet is GMCoin {
  function clearUser() public onlyOwner {
    TestnetLib.clearUser(mintingData);
  }

  function addTwitterUsername(string calldata userID, address walletAddress) public {
    TestnetLib.addTwitterUsername(mintingData, userID, walletAddress);
  }

  function removeUser(string memory userID, address wallet) public {
    TestnetLib.removeUser(mintingData, userID, wallet);
  }

  function getCurrentComplexity() public view returns (uint256) {
    return mintingConfig.COINS_MULTIPLICATOR;
  }

  function getMintingDayPointsFromUsers() public view returns (uint256) {
    return mintingData.mintingDayPointsFromUsers;
  }

  function getStartOfTheEpoch() public view returns (uint256) {
    return mintingData.epochStartedAt;
  }

  function forceTimeLockUpdateTestnet(address newImplementation) public {
    timeLockConfig.plannedNewImplementation = newImplementation;
    timeLockConfig.plannedNewImplementationTime = block.timestamp - 1 minutes;
  }

  function triggerTwitterVerificationResult(
    string calldata userID,
    address wallet,
    bool isVerified,
    string calldata errorMessage
  ) public onlyOwner {
    emit TwitterVerificationResult(userID, wallet, isVerified, errorMessage);
  }

  function triggerVerifyTwitter(string calldata userID, address wallet) public onlyOwner {
    (bool shouldMint, uint256 mintAmount) = TestnetLib.triggerVerifyTwitter(mintingData, mintingConfig, userID, wallet);
    
    if (shouldMint) {
      _mintForUserByIndex(
        mintingData.allTwitterUsers.length - 1,
        mintAmount
      ); // mint welcome coins
    }
  }
}
