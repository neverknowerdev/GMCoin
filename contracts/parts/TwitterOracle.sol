// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "hardhat/console.sol";

contract GMTwitterOracle is Initializable {
    address gelatoAddress;

    modifier onlyGelato() {
        require(msg.sender == gelatoAddress, "only Gelato can call this function");
        _;
    }

    // twitter users data
    mapping (string => address) private wallets;
    string[] private allTwitterUsers;

    uint256 public COINS_MULTIPLICATOR;
    uint256 public constant POINTS_MULTIPLICATOR_PER_TWEET = 2;
    uint256 public constant POINTS_MULTIPLICATOR_PER_LIKE = 1;
    uint256 public constant POINTS_MULTIPLICATOR_PER_HASHTAG = 4;
    uint256 public constant POINTS_MULTIPLICATOR_PER_CASHTAG = 10;

    uint256 public constant SECONDS_IN_A_DAY = 60*60*24;
    uint256 public constant EPOCH_DURATION = 7*1 days;

    uint public constant EPOCH_DAYS = 7 days;

    uint256[255] private __gap;

     function __TwitterOracle__init(uint256 coinsPerTweet, address _gelatoAddress) public initializer  {
        gelatoAddress = _gelatoAddress;

        COINS_MULTIPLICATOR = coinsPerTweet*10**18;

        epochStartedAt = block.timestamp - (block.timestamp % 1 days) - 1 days;

        // pre-yesterday
        lastMintedDay = block.timestamp - (block.timestamp % 1 days) - 2 days;

        // dayPoints = 0;
        // dayPointsFromStakers = 0;
        // countedUsers = 0;
        // lastMintedDay = 0;
        // lastDaySupply = 0;

        // currentDay = block.timestamp % (SECONDS_IN_A_DAY);
     }

    function walletByTwitterUsername(string calldata username) internal view returns (address) {
        return wallets[username];
    }

    function walletByTwitterUserIndex(uint256 userIndex) internal view returns (address) {
        return wallets[allTwitterUsers[userIndex]];
    }

    function getTwitterUsers(uint256 start, uint256 count) public view returns (string[] memory) {
        // require(start < allTwitterUsers.length, "Start index out of bounds");
    
        uint256 end = start + count;
        if (end > allTwitterUsers.length) {
            end = allTwitterUsers.length;
        }
        uint256 batchSize = end - start;
        string[] memory batch = new string[](batchSize);
        for (uint256 i = 0; i < batchSize; i++) {
            batch[i] = allTwitterUsers[start + i];
        }
        return batch;
    }

    event VerifyTwitterRequested(string authCode, string verifier, address wallet, bool autoFollow);

    function requestTwitterVerification(string calldata authCode, string calldata verifier, bool autoFollow) public {
        emit VerifyTwitterRequested(authCode, verifier, msg.sender, autoFollow);
    }

    function verifyTwitter(string calldata userID, address wallet) public onlyGelato {
        wallets[userID] = wallet;
        allTwitterUsers.push(userID);
    }


    event mintingFromTwitter_Progress(uint lastProcessedIndex, bytes nextCursor);
    event mintingForStakers_Progress(uint lastProcessedIndex);

    struct UserTwitterData {
        uint256 tweets;
        uint256 hashtagTweets;     // Number of hashtags in the tweet
        uint256 cashtagTweets;    // Number of cashtags in the tweet
        uint256 simpleTweets;       // Number of simple tags in the tweet
        uint256 likes;        // Number of likes for the tweet
    }

    event mintingStarted(uint256 mintingDay);
    event changedComplexity(uint256 newMultiplicator);

    uint256 internal lastMintedDay;

    uint public epochStartedAt;
    uint256 public lastEpochPoints;
    uint256 public currentEpochPoints;

    bool internal mintingInProgress;
    uint256 internal mintingDayPointsFromUsers;

    function startMinting() public onlyGelato {
        require(!mintingInProgress, "minting process already started");
        
        uint256 yesterday = block.timestamp - (block.timestamp % 1 days) - 1 days;
        require(lastMintedDay < yesterday, "minting is already started for that day");

        mintingInProgress = true;

        mintingDayPointsFromUsers = 0;

        // complexity calculation
        if(yesterday > epochStartedAt && yesterday - epochStartedAt >= EPOCH_DAYS) {
            epochStartedAt = yesterday;

            // if(currentEpochPoints > lastEpochPoints) {
            COINS_MULTIPLICATOR = COINS_MULTIPLICATOR * 80 / 100; // minus 20%
            emit changedComplexity(COINS_MULTIPLICATOR);
            // }
            //  else if(COMPLEXITY_DIVIDER > 1 && lastEpochPoints < currentEpochPoints) {
            //     COMPLEXITY_DIVIDER /= 2;
            // }

            lastEpochPoints = currentEpochPoints;
            currentEpochPoints = 0;
        }

        emit mintingStarted(yesterday);
    }

    event MintingFinished();

    function finishMinting() internal {
        require(mintingInProgress, "no ongoing minting process");

        currentEpochPoints += mintingDayPointsFromUsers;
        mintingInProgress = false;
        lastMintedDay += 1 days;

        emit MintingFinished();
    }


    // to be defined in main contract
    function _mintForUserByIndex(uint256 userIndex, uint256 amount) internal virtual {

    }

    function mintCoinsForTwitterUsers(uint256 startIndex, uint256 endIndex, UserTwitterData[] calldata userData, bytes memory nextCursor) public onlyGelato {
        require(mintingInProgress, "no ongoing minting process");
        require(endIndex - startIndex == userData.length -1 , "wrong input array lengths");
        require(userData.length > 0, "empty userData array");

        for(uint256 i=0; i<userData.length; i++) {
            uint256 points = 
                      userData[i].simpleTweets * POINTS_MULTIPLICATOR_PER_TWEET
                    + userData[i].likes * POINTS_MULTIPLICATOR_PER_LIKE
                    + userData[i].hashtagTweets * POINTS_MULTIPLICATOR_PER_HASHTAG
                    + userData[i].cashtagTweets * POINTS_MULTIPLICATOR_PER_CASHTAG;

            if(points == 0) {
                continue;
            }

            mintingDayPointsFromUsers += points;

            uint256 coins = points * COINS_MULTIPLICATOR;
            _mintForUserByIndex(startIndex+i, coins);
        }
        
        if(nextCursor.length > 0) {
            emit mintingFromTwitter_Progress(startIndex, nextCursor);
        } else{ 
            if (endIndex == allTwitterUsers.length-1) {
                finishMinting();
            } else {
                emit mintingFromTwitter_Progress(endIndex, "");
            }
        }
    }
}