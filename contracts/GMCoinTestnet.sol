// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "./GMCoin.sol";

contract GMCoinTestnet is GMCoin
{
    function addTwitterUsername(string calldata userID, address walletAddress) public onlyOwner {
        mintingData.wallets[userID] = walletAddress;
        mintingData.allTwitterUsers.push(userID);
        emit TwitterVerificationResult(userID, walletAddress, true, "");
    }

    function removeUser(string calldata userID, address wallet) public onlyOwner {
        if (mintingData.registeredWallets[wallet]) {
            mintingData.wallets[userID] = address(0);
            uint userIndex = mintingData.userIndexByUserID[userID];
            mintingData.registeredWallets[wallet] = false;
            mintingData.walletsByUserIDs[userID] = address(0);
            mintingData.usersByWallets[wallet] = "";

            removeUserIndex(userIndex);
        }
    }

    function getWalletByUserID(string calldata username) public view returns (address) {
        return walletByTwitterUser(username);
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

    function removeUserIndex(uint index) internal {
        require(index < mintingData.allTwitterUsers.length, "Index out of bounds");

        // Shift elements to the left
        for (uint i = index; i < mintingData.allTwitterUsers.length - 1; i++) {
            mintingData.allTwitterUsers[i] = mintingData.allTwitterUsers[i + 1];
        }

        // Reduce the array length by 1
        mintingData.allTwitterUsers.pop(); // Removes the last element
    }

    function forceTimeLockUpdateTestnet(address newImplementation) public {
        timeLockConfig.plannedNewImplementation = newImplementation;
        timeLockConfig.plannedNewImplementationTime = block.timestamp - 1 minutes;
    }
}

