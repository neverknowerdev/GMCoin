// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

//import "hardhat/console.sol";
import "hardhat/console.sol";
import {GMWeb3FunctionsV3} from "./GelatoWeb3FunctionsV3.sol";

contract GMTwitterOracleV3 is Initializable, GMWeb3FunctionsV3 {
    using ECDSA for bytes32;

    address gelatoAddress;
    address serverRelayerAddress;

    modifier onlyGelato() {
        require(msg.sender == gelatoAddress, "only Gelato can call this function");
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

    // twitter users data
    mapping(string => address) internal wallets;
    string[] internal allTwitterUsers;

    uint256 public COINS_MULTIPLICATOR;

    // not using it anymore
    uint256 public constant __NOT_USED__ANYMORE1 = 2;
    uint256 public constant __NOT_USED__ANYMORE2 = 1;
    uint256 public constant __NOT_USED__ANYMORE3 = 4;
    uint256 public constant __NOT_USED__ANYMORE4 = 10;

    uint public EPOCH_DAYS;
    uint32 public epochNumber;

    mapping(address => string) internal usersByWallets;
    mapping(address => bool) internal registeredWallets;

    uint256 public POINTS_PER_TWEET;
    uint256 public POINTS_PER_LIKE;
    uint256 public POINTS_PER_HASHTAG;
    uint256 public POINTS_PER_CASHTAG;

    uint256[251] private __gap;

    function __TwitterOracle__init3(uint _epochDays, uint256 coinsPerTweet) internal onlyInitializing {
        POINTS_PER_TWEET = 1;
        POINTS_PER_LIKE = 1;
        POINTS_PER_HASHTAG = 2;
        POINTS_PER_CASHTAG = 3;

        EPOCH_DAYS = _epochDays;

        COINS_MULTIPLICATOR = coinsPerTweet * 10 ** 18;

        epochStartedAt = uint32(block.timestamp - (block.timestamp % 1 days) - 1 days);

        // pre-yesterday
        lastMintedDay = uint32(block.timestamp - (block.timestamp % 1 days) - 2 days);

        serverRelayerAddress = 0xda5f67A923887181B3848eF4d609D747d9dbBb43;
    }

    function walletByTwitterUser(string calldata username) internal view returns (address) {
        return wallets[username];
    }

    function userByWallet(address wallet) public view returns (string memory) {
        require(msg.sender == wallet, "only wallet owner could call this function");

        return usersByWallets[wallet];
    }

    function walletByTwitterUserIndex(uint256 userIndex) internal view returns (address) {
        return wallets[allTwitterUsers[userIndex]];
    }

    function getTwitterUsers(uint64 start, uint16 count) public view returns (string[] memory) {
        // require(start < allTwitterUsers.length, "Start index out of bounds");

        uint64 end = start + count;
        if (end > allTwitterUsers.length) {
            end = uint64(allTwitterUsers.length);
        }

        require(start <= end, "wrong start index");

        uint16 batchSize = uint16(end - start);
        string[] memory batchArr = new string[](batchSize);
        for (uint16 i = 0; i < batchSize; i++) {
            batchArr[i] = allTwitterUsers[start + i];
        }

        return batchArr;
    }

    function getTwitterUsersByIndexes(uint64[] calldata indexes) public view returns (string[] memory) {
        string[] memory batchArr = new string[](indexes.length);
        for (uint16 i = 0; i < indexes.length; i++) {
            batchArr[i] = allTwitterUsers[i];
        }

        return batchArr;
    }

    event VerifyTwitterRequested(string accessCodeEncrypted, string userID, address indexed wallet);
    event TwitterVerificationResult(string userID, address indexed wallet, bool isSuccess, string errorMsg);

    function requestTwitterVerification(string calldata accessCodeEncrypted, string calldata userID) public {
        require(wallets[userID] == address(0), "wallet already linked for that user");

        emit VerifyTwitterRequested(accessCodeEncrypted, userID, msg.sender);
    }

    function requestTwitterVerificationFromRelayer(string calldata userID, bytes calldata signature, string calldata accessTokenEncrypted) public onlyServerRelayer {
        bytes32 messageHash = keccak256(abi.encodePacked("gmcoin.meme twitter-verification"));

        address signer = MessageHashUtils.toEthSignedMessageHash(messageHash).recover(signature);

        require(signer != address(0), "wrong signer");
        require(wallets[userID] == address(0), "wallet already linked for that user");
        require(!registeredWallets[signer], "wallet already verified and linked to Twitter");

        emit VerifyTwitterRequested(accessTokenEncrypted, userID, signer);
    }

    function twitterVerificationError(address wallet, string calldata userID, string calldata errorMsg) public onlyGelato {
        emit TwitterVerificationResult(userID, wallet, false, errorMsg);
    }

    function verifyTwitter(string calldata userID, address wallet, bool isSubscribed) public onlyGelato {
        usersByWallets[wallet] = userID;
        registeredWallets[wallet] = true;

        if (wallets[userID] == address(0)) {
            wallets[userID] = wallet;
            allTwitterUsers.push(userID);
            if (isSubscribed) {
                _mintForUserByIndex(allTwitterUsers.length, 1 * COINS_MULTIPLICATOR); // mint welcome coins
            }
            emit TwitterVerificationResult(userID, wallet, true, "");
        }
    }

    struct UserTwitterData {
        uint64 userIndex;
        uint16 tweets;
        uint16 hashtagTweets;     // Number of hashtags in the tweet
        uint16 cashtagTweets;     // Number of cashtags in the tweet
        uint16 simpleTweets;      // Number of simple tags in the tweet
        uint32 likes;        // Number of likes for the tweet
    }

    struct Batch {
        uint64 startIndex;
        uint64 endIndex;
        string nextCursor;
        uint8 errorCount;
    }

    event twitterMintingProcessed(uint32 indexed mintingDayTimestamp, Batch[] batches);
    event twitterMintingErrored(uint32 indexed mintingDayTimestamp, Batch[] errorBatches);
    event MintingStarted(uint32 indexed mintingDay);
    event MintingFinished(uint32 indexed mintingDayTimestamp, string runningHash);
    event MintingFinished_TweetsUploadedToIPFS(uint32 indexed mintingDayTimetsamp, string runningHash, string cid);

    event changedComplexity(uint256 newMultiplicator);

    uint32 internal lastMintedDay;

    uint32 public epochStartedAt;
    uint256 public lastEpochPoints;
    uint256 public currentEpochPoints;

    uint256 internal mintingDayPointsFromUsers;

    uint32 mintingInProgressForDay;

    Batch[] private emptyArray;
    uint256[255] private __gap2;

    function startMinting() public onlyGelato {
        // continue minting for not finished day if any
        if (mintingInProgressForDay > 0) {
            emit twitterMintingProcessed(mintingInProgressForDay, emptyArray);
            return;
        }

        uint32 yesterday = getStartOfYesterday();
        uint32 dayToMint = lastMintedDay + 1 days;

        require(dayToMint <= yesterday, "dayToMint should be not further than yesterday");
        require(lastMintedDay < dayToMint, "minting is already started for that day");
        require(mintingInProgressForDay == 0, "minting process already started");

        mintingInProgressForDay = dayToMint;

        mintingDayPointsFromUsers = 0;

        // complexity calculation
        // start new epoch
        if (dayToMint > epochStartedAt && dayToMint - epochStartedAt >= EPOCH_DAYS * 1 days) {
            epochStartedAt = dayToMint;

            if (lastEpochPoints != 0) {
                // more GMs now that in previous epoch
                if (currentEpochPoints > lastEpochPoints) {
                    if (currentEpochPoints / lastEpochPoints >= 5) {
                        // 1/2
                        COINS_MULTIPLICATOR = COINS_MULTIPLICATOR / 5;
                    } else if (currentEpochPoints / lastEpochPoints >= 2) {
                        // 1/2
                        COINS_MULTIPLICATOR = COINS_MULTIPLICATOR / 2;
                    } else {
                        // minus 30%
                        COINS_MULTIPLICATOR = COINS_MULTIPLICATOR * 70 / 100;
                    }
                }
                if (currentEpochPoints < lastEpochPoints) {
                    if (lastEpochPoints / currentEpochPoints >= 3) {
                        COINS_MULTIPLICATOR = COINS_MULTIPLICATOR * 2;
                    } else {
                        // plus 20%
                        COINS_MULTIPLICATOR = COINS_MULTIPLICATOR * 120 / 100;
                    }
                }

                emit changedComplexity(COINS_MULTIPLICATOR);
            }
            epochNumber++;

            lastEpochPoints = currentEpochPoints;
            currentEpochPoints = 0;
        }

        emit MintingStarted(dayToMint);

        emit twitterMintingProcessed(dayToMint, emptyArray);
    }

    // manual calling continue minting for a day if there was any unexpected error
    function continueMintingForADay() public onlyOwner {
        require(mintingInProgressForDay != 0, "not found any in progress minting days");

        emit twitterMintingProcessed(mintingInProgressForDay, emptyArray);
    }

    function finishMinting(uint32 mintingDayTimestamp, string calldata runningHash) public onlyGelato {
        require(mintingDayTimestamp == mintingInProgressForDay, "wrong mintingDay");
        require(lastMintedDay < mintingDayTimestamp, "wrong mintingDayTimestamp");

        currentEpochPoints += mintingDayPointsFromUsers;
        lastMintedDay = mintingDayTimestamp;

        mintingInProgressForDay = 0;

        emit MintingFinished(mintingDayTimestamp, runningHash);

        uint32 yesterday = getStartOfYesterday();
        if (lastMintedDay < yesterday) {
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
        require(mintingInProgressForDay != 0, "no ongoing minting process");
        require(mintingDayTimestamp == mintingInProgressForDay, "wrong mintingDay");

        for (uint256 i = 0; i < userData.length; i++) {
            if (userData[i].userIndex > allTwitterUsers.length) {
                revert("wrong userIndex");
            }

            uint256 points =
                userData[i].simpleTweets * POINTS_PER_TWEET
                + userData[i].likes * POINTS_PER_LIKE
                + userData[i].hashtagTweets * POINTS_PER_HASHTAG
                + userData[i].cashtagTweets * POINTS_PER_CASHTAG;

            if (points == 0) {
                continue;
            }

            mintingDayPointsFromUsers += points;

            uint256 coins = points * COINS_MULTIPLICATOR;

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
}