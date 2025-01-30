// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import "hardhat/console.sol";

contract GMTwitterOracle is Initializable {
    using ECDSA for bytes32;

    address gelatoAddress;
    address serverRelayerAddress;

    modifier onlyGelato() {
        require(msg.sender == gelatoAddress, "only Gelato can call this function");
        _;
    }

    modifier onlyServerRelayer() {
        require(msg.sender == serverRelayerAddress, "only relay server can call this function");
        _;
    }

    // twitter users data
    mapping(string => address) internal wallets;
    string[] internal allTwitterUsers;

    uint256 public COINS_MULTIPLICATOR;
    uint256 public constant POINTS_MULTIPLICATOR_PER_TWEET = 2;
    uint256 public constant POINTS_MULTIPLICATOR_PER_LIKE = 1;
    uint256 public constant POINTS_MULTIPLICATOR_PER_HASHTAG = 4;
    uint256 public constant POINTS_MULTIPLICATOR_PER_CASHTAG = 10;

    uint public EPOCH_DAYS;

    mapping(address => string) internal usersByWallets;
    mapping(address => bool) internal registeredWallets;

    uint256[254] private __gap;

    function __TwitterOracle__init(uint256 coinsPerTweet, address _gelatoAddress, address _relayServerAddress, uint _epochDays) public initializer {
        EPOCH_DAYS = _epochDays;

        gelatoAddress = _gelatoAddress;
        serverRelayerAddress = _relayServerAddress;

        COINS_MULTIPLICATOR = coinsPerTweet * 10 ** 18;

        epochStartedAt = uint32(block.timestamp - (block.timestamp % 1 days) - 1 days);

        // pre-yesterday
        lastMintedDay = uint32(block.timestamp - (block.timestamp % 1 days) - 2 days);

        // dayPoints = 0;
        // dayPointsFromStakers = 0;
        // countedUsers = 0;
        // lastMintedDay = 0;
        // lastDaySupply = 0;

        // currentDay = block.timestamp % (SECONDS_IN_A_DAY);
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
    event TwitterVerificationResult(string indexed userID, address indexed wallet, bool isSuccess, string errorMsg);

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
    }

    event twitterMintingProcessed(uint32 mintingDayTimestamp, Batch[] batches);
    event twitterMintingErrored(uint32 mintingDayTimestamp, Batch[] errorBatches);
    event MintingStarted(uint32 mintingDay);
    event MintingFinished(uint32 mintingDayTimestamp, string finalCID);
    event changedComplexity(uint256 newMultiplicator);

    uint32 internal lastMintedDay;

    uint32 public epochStartedAt;
    uint256 public lastEpochPoints;
    uint256 public currentEpochPoints;

    uint256 internal mintingDayPointsFromUsers;

    uint32 mintingInProgressForDay;

    uint256[254] private __gap2;

    function startMinting() public onlyGelato {
        uint32 dayToMint = lastMintedDay + 1 days;

        require(dayToMint < block.timestamp - 1 days, "minting is already started for that day");
        require(lastMintedDay < dayToMint, "minting is already started for that day");
        require(mintingInProgressForDay == 0, "minting process already started");

        mintingInProgressForDay = dayToMint;

        mintingDayPointsFromUsers = 0;

        // complexity calculation
        if (dayToMint > epochStartedAt && dayToMint - epochStartedAt >= EPOCH_DAYS) {
            epochStartedAt = dayToMint;

            // if(currentEpochPoints > lastEpochPoints) {
            COINS_MULTIPLICATOR = COINS_MULTIPLICATOR * 80 / 100;
            // minus 20%
            emit changedComplexity(COINS_MULTIPLICATOR);
            // }
            //  else if(COMPLEXITY_DIVIDER > 1 && lastEpochPoints < currentEpochPoints) {
            //     COMPLEXITY_DIVIDER /= 2;
            // }

            lastEpochPoints = currentEpochPoints;
            currentEpochPoints = 0;
        }

        emit MintingStarted(dayToMint);

        Batch[] memory emptyArray;
        emit twitterMintingProcessed(dayToMint, emptyArray);
    }

    function finishMinting(uint32 mintingDayTimestamp, string calldata finalCID) public onlyGelato {
        require(mintingDayTimestamp == mintingInProgressForDay, "wrong mintingDay");
        require(lastMintedDay < mintingDayTimestamp, "wrong mintingDayTimestamp");

        currentEpochPoints += mintingDayPointsFromUsers;
        lastMintedDay = mintingDayTimestamp;

        mintingInProgressForDay = 0;

        emit MintingFinished(mintingDayTimestamp, finalCID);
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
                userData[i].simpleTweets * POINTS_MULTIPLICATOR_PER_TWEET
                + userData[i].likes * POINTS_MULTIPLICATOR_PER_LIKE
                + userData[i].hashtagTweets * POINTS_MULTIPLICATOR_PER_HASHTAG
                + userData[i].cashtagTweets * POINTS_MULTIPLICATOR_PER_CASHTAG;

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
}