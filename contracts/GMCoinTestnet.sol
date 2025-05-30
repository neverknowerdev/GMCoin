// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "./GMCoin.sol";

contract GMCoinTestnet is GMCoin
{
    function clearUser() public onlyOwner {
        string memory userID = "1796129942104657921";
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

    function addTwitterUsername(string calldata userID, address walletAddress) public {
        mintingData.walletsByUserIDs[userID] = walletAddress;
        mintingData.allTwitterUsers.push(userID);
        emit TwitterVerificationResult(userID, walletAddress, true, "");
    }

    function removeUser(string memory userID, address wallet) public {
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

    function forceTimeLockUpdateTestnet(address newImplementation) public {
        timeLockConfig.plannedNewImplementation = newImplementation;
        timeLockConfig.plannedNewImplementationTime = block.timestamp - 1 minutes;
    }
}

