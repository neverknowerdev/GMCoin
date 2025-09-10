// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

interface IGMCoin {
  function addTwitterUser(string memory twitterId, address wallet) external;
  function removeTwitterUser(string memory twitterId) external;
  function changeTwitterUserWallet(string memory twitterId, address wallet) external;
  function addFarcasterUser(uint256 farcasterFid, address wallet) external;
  function removeFarcasterUser(uint256 farcasterFid) external;
  function changeFarcasterUserWallet(uint256 farcasterFid, address wallet) external;
  function twitterUserExist(string memory twitterId) external view returns (bool);
  function farcasterUserExist(uint256 farcasterFid) external view returns (bool);
  function isActiveMintingProcess() external view returns (bool);
}
