// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract TwitterVerification is Initializable {
    event TwitterVerificationRequested(string username, address wallet);
    event TwitterLinked(string username, address wallet);

    mapping (string => address) walletsByUsernames;

    address gelatoAddress;

    uint256[47] __gap;

    function __TwitterVerification__init(address _gelatoAddress) internal onlyInitializing {
        gelatoAddress = _gelatoAddress;
    }

    function linkTwitter(string calldata username) public {
        require(walletsByUsernames[username] == address(0), "you're already linked twitter");

        emit TwitterVerificationRequested(username, msg.sender);
    }

    function verifyTwitter(string calldata username, address wallet) public {
        require(msg.sender == gelatoAddress, "only Gelato can call this function");

        walletsByUsernames[username] = wallet;
    }

    
}