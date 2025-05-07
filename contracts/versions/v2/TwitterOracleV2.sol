// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {GMWeb3FunctionsV2} from "./GelatoWeb3FunctionsV2.sol";
import {GMStorageV2} from "./StorageV2.sol";

contract GMTwitterOracleV2 is GMStorageV2, Initializable, GMWeb3FunctionsV2 {
    using ECDSA for bytes32;

    modifier onlyGelato() {
        require(msg.sender == gelatoConfig.gelatoAddress, "only Gelato can call this function");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    modifier onlyServerRelayer() {
        require(msg.sender == serverRelayerAddress, "only relay server can call this function");
        _;
    }

    function __TwitterOracle__init(uint256 coinsPerTweet, address _gelatoAddress, address _relayServerAddress, uint _epochDays) public onlyInitializing {mintingConfig.POINTS_PER_TWEET = 1;
        mintingConfig.POINTS_PER_TWEET = 1;
        mintingConfig.POINTS_PER_LIKE = 1;
        mintingConfig.POINTS_PER_HASHTAG = 3;
        mintingConfig.POINTS_PER_CASHTAG = 5;

        mintingConfig.EPOCH_DAYS = _epochDays;

        mintingConfig.COINS_MULTIPLICATOR = coinsPerTweet * 10 ** 18;

        mintingData.epochStartedAt = uint32(block.timestamp - (block.timestamp % 1 days) - 1 days);

        // pre-yesterday
        mintingData.lastMintedDay = uint32(block.timestamp - (block.timestamp % 1 days) - 2 days);

        gelatoConfig.gelatoAddress = _gelatoAddress;
        serverRelayerAddress = _relayServerAddress;
    }

    function walletByTwitterUser(string calldata username) internal view returns (address) {
        return mintingData.walletsByUserIDs[username];
    }

    function userByWallet(address wallet) public view returns (string memory) {
        require(_msgSender() == wallet, "only wallet owner could call this function");

        return mintingData.usersByWallets[wallet];
    }

    function walletByTwitterUserIndex(uint256 userIndex) internal view returns (address) {
        return mintingData.walletsByUserIDs[mintingData.allTwitterUsers[userIndex]];
    }

    function getTwitterUsers(uint64 start, uint16 count) public view returns (string[] memory) {
        // require(start < allTwitterUsers.length, "Start index out of bounds");

        uint64 end = start + count;
        if (end > mintingData.allTwitterUsers.length) {
            end = uint64(mintingData.allTwitterUsers.length);
        }

        require(start <= end, "wrong start index");

        uint16 batchSize = uint16(end - start);
        string[] memory batchArr = new string[](batchSize);
        for (uint16 i = 0; i < batchSize; i++) {
            batchArr[i] = mintingData.allTwitterUsers[start + i];
        }

        return batchArr;
    }

    function getTwitterUsersByIndexes(uint64[] calldata indexes) public view returns (string[] memory) {
        string[] memory batchArr = new string[](indexes.length);
        for (uint16 i = 0; i < indexes.length; i++) {
            batchArr[i] = mintingData.allTwitterUsers[i];
        }

        return batchArr;
    }

    event VerifyTwitterRequested(string accessCodeEncrypted, string userID, address indexed wallet);
    event TwitterVerificationResult(string userID, address indexed wallet, bool isSuccess, string errorMsg);

    function requestTwitterVerification(string calldata accessCodeEncrypted, string calldata userID) public {
        require(mintingData.walletsByUserIDs[userID] == address(0), "wallet already linked for that user");

        emit VerifyTwitterRequested(accessCodeEncrypted, userID, msg.sender);
    }

    function requestTwitterVerificationFromRelayer(string calldata userID, address wallet, bytes calldata signature, string calldata accessTokenEncrypted) public onlyServerRelayer {
        bytes32 messageHash = keccak256(abi.encodePacked("I confirm that I want to verify my Twitter account with GMCoin"));

        address signer = MessageHashUtils.toEthSignedMessageHash(messageHash).recover(signature);

        require(signer != address(0), "empty signer");
        require(signer == wallet, "wrong signer or signature");
        require(mintingData.walletsByUserIDs[userID] == address(0), "wallet already linked for that user");
        require(!mintingData.registeredWallets[signer], "wallet already verified and linked to Twitter");

        emit VerifyTwitterRequested(accessTokenEncrypted, userID, signer);
    }

    function twitterVerificationError(address wallet, string calldata userID, string calldata errorMsg) public onlyGelato {
        emit TwitterVerificationResult(userID, wallet, false, errorMsg);
    }

    function verifyTwitter(string calldata userID, address wallet, bool isSubscribed) public onlyGelato {
        mintingData.usersByWallets[wallet] = userID;
        mintingData.registeredWallets[wallet] = true;

        if (mintingData.walletsByUserIDs[userID] == address(0)) {
            mintingData.walletsByUserIDs[userID] = wallet;
            mintingData.allTwitterUsers.push(userID);
            mintingData.userIndexByUserID[userID] = mintingData.allTwitterUsers.length - 1;
            if (isSubscribed) {
                _mintForUserByIndex(mintingData.allTwitterUsers.length, 1 * mintingConfig.COINS_MULTIPLICATOR); // mint welcome coins
            }
            emit TwitterVerificationResult(userID, wallet, true, "");
        }
    }

    event twitterMintingProcessed(uint32 indexed mintingDayTimestamp, Batch[] batches);
    event twitterMintingErrored(uint32 indexed mintingDayTimestamp, Batch[] errorBatches);
    event MintingStarted(uint32 indexed mintingDay);
    event MintingFinished(uint32 indexed mintingDayTimestamp, string runningHash);
    event MintingFinished_TweetsUploadedToIPFS(uint32 indexed mintingDayTimetsamp, string runningHash, string cid);

    event changedComplexity(uint256 newMultiplicator);

    function startMinting() public onlyGelato {
        // continue minting for not finished day if any

        uint32 yesterday = getStartOfYesterday();
        uint32 dayToMint = mintingData.lastMintedDay + 1 days;

        // if minting for previous day is not finished - continue it
        if (mintingData.mintingInProgressForDay > 0 && mintingData.mintingInProgressForDay < yesterday) {
            emit twitterMintingProcessed(mintingData.mintingInProgressForDay, emptyArray);
            return;
        }

        require(dayToMint <= yesterday, "dayToMint should be not further than yesterday");
        require(mintingData.mintingInProgressForDay == 0, "minting process already started");

        mintingData.mintingInProgressForDay = dayToMint;

        mintingData.mintingDayPointsFromUsers = 0;

        // complexity calculation
        // start new epoch
        if (dayToMint > mintingData.epochStartedAt && dayToMint - mintingData.epochStartedAt >= mintingConfig.EPOCH_DAYS * 1 days) {
            mintingData.epochStartedAt = dayToMint;

            uint256 newCoinMultiplicator = changeComplexity(mintingConfig.COINS_MULTIPLICATOR, mintingData.lastEpochPoints, mintingData.currentEpochPoints);
            if (newCoinMultiplicator > 0) {
                mintingConfig.COINS_MULTIPLICATOR = newCoinMultiplicator;
                emit changedComplexity(mintingConfig.COINS_MULTIPLICATOR);
            }
            mintingConfig.epochNumber++;

            mintingData.lastEpochPoints = mintingData.currentEpochPoints;
            mintingData.currentEpochPoints = 0;
        }

        emit MintingStarted(dayToMint);

        emit twitterMintingProcessed(dayToMint, emptyArray);
    }

    // manual calling continue minting for a day if there was any unexpected error
    function continueMintingForADay() public onlyOwner {
        require(mintingData.mintingInProgressForDay != 0, "not found any in progress minting days");

        emit twitterMintingProcessed(mintingData.mintingInProgressForDay, emptyArray);
    }

    function finishMinting(uint32 mintingDayTimestamp, string calldata runningHash) public onlyGelato {
        require(mintingDayTimestamp == mintingData.mintingInProgressForDay, "wrong mintingDay");
        require(mintingData.lastMintedDay < mintingDayTimestamp, "wrong mintingDayTimestamp");

        mintingData.currentEpochPoints += mintingData.mintingDayPointsFromUsers;
        mintingData.lastMintedDay = mintingDayTimestamp;

        mintingData.mintingInProgressForDay = 0;

        emit MintingFinished(mintingDayTimestamp, runningHash);

        uint32 yesterday = getStartOfYesterday();
        if (mintingData.lastMintedDay < yesterday) {
            startMinting();
        }
    }

    function attachIPFSTweetsFile(uint32 mintingDayTimestamp, string calldata finalHash, string calldata cid) public onlyServerRelayer {
        emit MintingFinished_TweetsUploadedToIPFS(mintingDayTimestamp, finalHash, cid);
    }

    // to be defined in main contract
    function _mintForUserByIndex(uint256 userIndex, uint256 amount) internal virtual {

    }

    function logErrorBatches(uint32 mintingDayTimestamp, Batch[] calldata batches) public onlyGelato {
        emit twitterMintingErrored(mintingDayTimestamp, batches);
    }

    function mintCoinsForTwitterUsers(UserTwitterData[] calldata userData, uint32 mintingDayTimestamp, Batch[] calldata batches) public onlyGelato {
        require(mintingData.mintingInProgressForDay != 0, "no ongoing minting process");
        require(mintingDayTimestamp == mintingData.mintingInProgressForDay, "wrong mintingDay");

        for (uint256 i = 0; i < userData.length; i++) {
            if (userData[i].userIndex > mintingData.allTwitterUsers.length) {
                revert("wrong userIndex");
            }

            uint256 points =
                userData[i].simpleTweets * mintingConfig.POINTS_PER_TWEET
                + userData[i].likes * mintingConfig.POINTS_PER_LIKE
                + userData[i].hashtagTweets * mintingConfig.POINTS_PER_HASHTAG
                + userData[i].cashtagTweets * mintingConfig.POINTS_PER_CASHTAG;

            if (points == 0) {
                continue;
            }

            mintingData.mintingDayPointsFromUsers += points;

            uint256 coins = points * mintingConfig.COINS_MULTIPLICATOR;

            _mintForUserByIndex(userData[i].userIndex, coins);
        }

        if (batches.length > 0) {
            emit twitterMintingProcessed(mintingDayTimestamp, batches);
        }
    }

    function getStartOfYesterday() public view returns (uint32) {
        // Calculate the start of today (midnight) by rounding down block.timestamp to the nearest day.
        uint32 startOfToday = uint32((block.timestamp / 1 days) * 1 days);
        // Subtract one day to get the start of yesterday.
        return startOfToday - 1 days;
    }

    function changeComplexity(uint256 currentComplexity, uint256 lastEpochPoints, uint256 currentEpochPoints) internal pure returns (uint256) {
        uint256 newMultiplicator = 0;
        if (lastEpochPoints != 0) {
            // more GMs now that in previous epoch
            if (currentEpochPoints > lastEpochPoints) {
                if (currentEpochPoints / lastEpochPoints >= 5) {
                    // 1/2
                    newMultiplicator = currentComplexity / 5;
                } else if (currentEpochPoints / lastEpochPoints >= 2) {
                    // 1/2
                    newMultiplicator = currentComplexity / 2;
                } else {
                    // minus 30%
                    newMultiplicator = currentComplexity * 70 / 100;
                }
            }
            if (currentEpochPoints < lastEpochPoints) {
                if (lastEpochPoints / currentEpochPoints >= 3) {
                    newMultiplicator = currentComplexity * 2;
                } else {
                    // plus 20%
                    newMultiplicator = currentComplexity * 120 / 100;
                }
            }
        }

        return newMultiplicator;
    }

    function removeMe() public {
        require(mintingData.mintingInProgressForDay == 0, "cannot remove user while active workers, try later");

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
}