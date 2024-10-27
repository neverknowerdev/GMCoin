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

    uint256 public COMPLEXITY_DIVIDER;

    uint256 public constant COINS_MULTIPLICATOR = 1_000_000*10**18;
    uint256 public constant POINTS_MULTIPLICATOR_PER_TWEET = 2;
    uint256 public constant POINTS_MULTIPLICATOR_PER_LIKE = 1;
    uint256 public constant POINTS_MULTIPLICATOR_PER_HASHTAG = 4;
    uint256 public constant POINTS_MULTIPLICATOR_PER_CASHTAG = 10;

    uint256 public constant SECONDS_IN_A_DAY = 60*60*24;
    uint256 public constant EPOCH_DURATION = 7*1 days;

    uint public constant EPOCH_DAYS = 7 days;

    uint256[] internal stakerIDs; // stakerID => userIndex
    mapping(uint256 => bool) internal isUserIndexStaking;

    uint256[255] private __gap;

     function __TwitterOracle__init(address _gelatoAddress) public initializer  {
        gelatoAddress = _gelatoAddress;

        COMPLEXITY_DIVIDER = 1;

        epochStartedAt = block.timestamp - (block.timestamp % SECONDS_IN_A_DAY);

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
        require(start < allTwitterUsers.length, "Start index out of bounds");
    
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

    function filterStakersForUserIndexRange(uint256 startIndex, uint256 endIndex) public view returns (uint256[] memory) {
        uint256 length = endIndex - startIndex;
        uint resultArraySize = 0;
        for (uint256 i=0; i<=length; i++) {
            if(isUserIndexStaking[startIndex+i]) {
                resultArraySize++;
            }
        }

        uint256[] memory result = new uint256[](resultArraySize);
        for (uint256 i=0; i<=length; i++) {
            if(isUserIndexStaking[startIndex+i]) {
                result[i] = startIndex+i;
            }
        }

        return result;
    }


    event VerifyTwitterRequested(string authCode, string verifier, address wallet, bool autoFollow);

    function requestTwitterVerification(string calldata authCode, string calldata verifier, bool autoFollow) public {
        emit VerifyTwitterRequested(authCode, verifier, msg.sender, autoFollow);
    }

    function verifyTwitter(string calldata userID, address wallet) public onlyGelato {
        wallets[userID] = wallet;
        allTwitterUsers.push(userID);
    }



    function totalStakersCount() public view returns (uint256) {
        return stakerIDs.length;
    }

    function addStakers(uint256[] calldata userIndexes) public onlyGelato {
        for(uint i=0; i<userIndexes.length; i++) {
            if (isUserIndexStaking[userIndexes[i]]) {
                // already staking
                continue;
            }

            stakerIDs.push(userIndexes[i]);
            isUserIndexStaking[userIndexes[i]] = true;
        }
    }

    uint256[] stakersToRemoveSorted;
    function removeStakersDelayed(uint256[] memory userIndexesSorted) public onlyGelato {
        uint a = 0;
        for(uint i=0; i<userIndexesSorted.length; i++) {
            if(i > 0) {
                require(userIndexesSorted[i] > userIndexesSorted[i-1], "userIndexesArray should be sorted");
            }

            isUserIndexStaking[userIndexesSorted[i]] = false;

            if(stakersToRemoveSorted.length == 0) {
                stakersToRemoveSorted.push(userIndexesSorted[i]);
                continue;
            }

            for(; a<stakersToRemoveSorted.length; a++) {
                if(stakersToRemoveSorted[a] <= userIndexesSorted[i]) {
                    stakersToRemoveSorted.push(userIndexesSorted[i]);
                    break;
                }
            }
        }
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

    uint256 internal lastMintedDay;

    uint public epochStartedAt;
    uint256 public lastEpochPoints;
    uint256 public currentEpochPoints;

    bool internal mintingInProgress;
    uint256 internal mintingDayTotalPoints;
    uint256 internal mintingDayPointsFromUsers;

    uint256 internal mintingDayTotalCoinsStaked;

    function startMinting() public onlyGelato {
        require(!mintingInProgress, "minting process already started");
        require(lastMintedDay < block.timestamp % SECONDS_IN_A_DAY, "minting is already started for that day");

        uint256 yesterday = block.timestamp - (block.timestamp % SECONDS_IN_A_DAY) - SECONDS_IN_A_DAY;
        mintingInProgress = true;

        mintingDayTotalPoints = 0;
        mintingDayPointsFromUsers = 0;

        // complexity calculation
        if(yesterday > epochStartedAt && yesterday - epochStartedAt >= EPOCH_DAYS) {
            epochStartedAt = block.timestamp & SECONDS_IN_A_DAY;

            // if(currentEpochPoints > lastEpochPoints) {
                COMPLEXITY_DIVIDER *= 2;
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

        currentEpochPoints += mintingDayTotalPoints;
        mintingInProgress = false;
        lastMintedDay = (block.timestamp - SECONDS_IN_A_DAY) % SECONDS_IN_A_DAY;

        emit MintingFinished();
    }

    function writeTotalGMForDay(uint256 totalTweetsCount) public onlyGelato {
        require(mintingInProgress, "no ongoing minting process");

        mintingDayTotalPoints = totalTweetsCount * POINTS_MULTIPLICATOR_PER_TWEET;
        emit mintingFromTwitter_Progress(0, "");
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

            if(userData[i].hashtagTweets > 0) {
                mintingDayTotalPoints += userData[i].hashtagTweets * (POINTS_MULTIPLICATOR_PER_HASHTAG - POINTS_MULTIPLICATOR_PER_TWEET);
            }
            if(userData[i].cashtagTweets > 0) {
                mintingDayTotalPoints += userData[i].cashtagTweets * (POINTS_MULTIPLICATOR_PER_CASHTAG - POINTS_MULTIPLICATOR_PER_TWEET);
            }
            mintingDayTotalPoints += userData[i].likes * POINTS_MULTIPLICATOR_PER_LIKE;

            uint256 coins = points * COINS_MULTIPLICATOR / COMPLEXITY_DIVIDER;
            _mintForUserByIndex(startIndex+i, coins);

            if(isUserIndexStaking[startIndex+i]) {
                mintingDayTotalCoinsStaked += _balanceOfUserByIndex(startIndex+i);
            }
        }

        if(nextCursor.length > 0) {
            emit mintingFromTwitter_Progress(startIndex, nextCursor);
        } else{ 
            if (endIndex == allTwitterUsers.length-1) {
                startMintingForStakers();
            } else {
                emit mintingFromTwitter_Progress(endIndex, "");
            }
        }
    }

    function _balanceOfUserByIndex(uint256 userID) internal virtual returns (uint256) {

    }

    function startMintingForStakers() internal {
        // remove all stakers
        if(stakersToRemoveSorted.length > 0) {
            for(uint i=stakersToRemoveSorted.length; i>=0; i--) {
                uint indexToRemove = stakersToRemoveSorted[i];

                mintingDayTotalCoinsStaked -= _balanceOfUserByIndex(stakerIDs[indexToRemove]);

                if(indexToRemove < stakerIDs.length-1) {
                    stakerIDs[indexToRemove] = stakerIDs[stakerIDs.length-1];
                }
                stakerIDs.pop();
            }

            delete stakersToRemoveSorted;
        }
        
        emit mintingForStakers_Progress(0);
    }

    function mintCoinsForStakers(uint256 startIndex, uint256 endIndex) public onlyGelato {
        require(mintingInProgress, "no ongoing minting process");
        require(endIndex - startIndex > 0, "empty array");
        require(endIndex < stakerIDs.length, "endIndex is out of range for holderWallets");
        require(mintingDayTotalPoints > mintingDayPointsFromUsers, "totalPoints should be greater that pointsFromUsers for current minting day");

        console.log('mintingDayTotalPoints', mintingDayTotalPoints);
        console.log('mintingDayPointsFromUsers', mintingDayPointsFromUsers);        
        console.log('mintingDayTotalCoinsStaked', mintingDayTotalCoinsStaked);
        uint256 pointsForStakers = mintingDayTotalPoints - mintingDayPointsFromUsers;
        console.log('pointsForStakers', pointsForStakers);
        
        for(uint i=startIndex; i<=endIndex; i++) {
            uint256 holderBalance = _balanceOfUserByIndex(stakerIDs[i]);
            if(holderBalance > 0) {
                console.log('holderBalance', holderBalance / COINS_MULTIPLICATOR);
                uint256 reward = (holderBalance * pointsForStakers) / mintingDayTotalCoinsStaked;
                console.log('reward', reward);
                console.log('newBalance', holderBalance / COINS_MULTIPLICATOR + reward);
                console.log('----');
                reward = reward * COINS_MULTIPLICATOR / COMPLEXITY_DIVIDER;
                _mintForUserByIndex(stakerIDs[i], reward);
            }
        }

        if(endIndex >= stakerIDs.length-1) {
            finishMinting();
        } else {
            emit mintingForStakers_Progress(endIndex);
        }
    }
}