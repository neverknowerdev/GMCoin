import {expect, use} from "chai";
import hre from "hardhat";
import isEqual from 'lodash/isEqual';

const {ethers, w3f, upgrades} = hre;
import {
    Web3FunctionUserArgs,
    Web3FunctionResultV2,
} from "@gelatonetwork/web3-functions-sdk";
import {Web3FunctionHardhat} from "@gelatonetwork/web3-functions-sdk/hardhat-plugin";
import {GMCoinExposed} from "../typechain";
import {MockHttpServer} from './tools/mockServer';
import {Provider, HDNodeWallet} from "ethers";
import {generateEventLogFile, writeEventLogFile} from './tools/helpers';
import {time} from "@nomicfoundation/hardhat-network-helpers";
import * as url from 'url';
import fs from "fs";
import {max} from "hardhat/internal/util/bigint";
import path from "path";

describe("GelatoW3F", function () {
    let mockServer: MockHttpServer;

    before(async function () {
        // Initialize and start the mock server
        mockServer = new MockHttpServer(8118);
        mockServer.start();
    });

    after(async function () {
        // Stop the mock server after all tests
        mockServer.stop();
    });

    beforeEach(async function () {
        // Reset mocks before each test
        mockServer.resetMocks();
    });

    it('should post to the mock server and validate the response', async function () {
        mockServer.mock('/api/test', 'GET', {message: 'Mocked GET response'}, 200, 'application/json');
        mockServer.mock('/api/submit', 'POST', {success: true}, 201, 'application/json');

        {
            const response = await fetch('http://localhost:8118/api/test');
            const data = await response.json();

            // Assert the response from the mock server
            expect(data.message).to.equal('Mocked GET response');

            // Optionally, check if the endpoint was called
            mockServer.expectURLToBeCalled('/api/test', 'GET');
        }

        {
            const response = await fetch('http://localhost:8118/api/submit', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({data: 'example'}),
            });
            const data = await response.json();

            // Assert the response from the mock server
            expect(data.success).to.be.true;

            // Optionally, check if the endpoint was called with the correct parameters
            mockServer.expectURLToBeCalled('/api/submit', 'POST', undefined, {data: 'example'});
        }
    });

    it("twitter-verification error /oauth2/token", async function () {
        const [owner, feeAddr, otherAcc1, gelatoAddr] = await ethers.getSigners();

        const TwitterCoin = await ethers.getContractFactory("GMCoinExposed");
        const instance: GMCoinExposed = await upgrades.deployProxy(TwitterCoin, [owner.address, feeAddr.address, 50, 100000, gelatoAddr.address, 100_000], {kind: "uups"}) as GMCoinExposed;

        await instance.waitForDeployment();

        mockServer.mock('/2/oauth2/token', 'POST',
            {
                "error": "invalid_request",
                "error_description": "Value passed for the authorization code was invalid."
            },
            400
        );


        const verifierAddress = await instance.getAddress();
        console.log(`deployed GMCoin to ${verifierAddress}`);

        let oracleW3f: Web3FunctionHardhat = w3f.get("twitter-verification");

        let {result} = await oracleW3f.run("onRun", {
            userArgs: {
                verifierContractAddress: verifierAddress,
                twitterHost: "http://localhost:8118",
            }
        });
        result = result as Web3FunctionResultV2;

        console.log('result', result);
        expect(result.canExec).to.equal(false);
        if (!(result.canExec)) {
            expect(result.message).to.equal('Failed to retrieve access token: {"error":"invalid_request","error_description":"Value passed for the authorization code was invalid."}');
        }

    });

    it('twitter-verification success', async function () {
        const [owner, feeAddr, otherAcc1, gelatoAddr] = await ethers.getSigners();

        const TwitterCoin = await ethers.getContractFactory("GMCoinExposed");
        const instance: GMCoinExposed = await upgrades.deployProxy(TwitterCoin, [owner.address, feeAddr.address, 50, 100000, gelatoAddr.address, 100_000], {kind: "uups"}) as unknown as GMCoinExposed;

        await instance.waitForDeployment();

        mockServer.mock('/2/oauth2/token', 'POST',
            {
                "token_type": "bearer",
                "expires_in": 7200,
                "access_token": "YTc4LXlfTk1tVnRZaUN4YUJSU1QxTTdSNlJXeDRDWUdJWXBTZzBHdmhVU2U1OjE3MzA1Njc2MTY4MjY6MTowOmF0OjE",
                "scope": "users.read tweet.read follows.write"
            }
        )

        mockServer.mock('/2/users/me', 'GET',
            {
                "data": {
                    "id": "1796129942104657921",
                    "name": "NeverKnower",
                    "username": "neverknower_dev"
                }
            }
        )

        mockServer.mock('/2/users/userID/following', 'POST',
            {
                "data": {
                    "following": true,
                    "pending_follow": false
                }
            }
        )

        mockServer.mock('/2/oauth2/revoke', 'POST',
            {
                "revoked": true
            }
        )

        const verifierAddress = await instance.getAddress();
        console.log(`deployed GMCoin to ${verifierAddress}`);

        let oracleW3f: Web3FunctionHardhat = w3f.get("twitter-verification");

        let {result} = await oracleW3f.run("onRun", {
            userArgs: {
                verifierContractAddress: verifierAddress,
                twitterHost: "http://localhost:8118",
            }
        });
        result = result as Web3FunctionResultV2;

        console.log('result', result);
        expect(result.canExec).to.equal(true);

        if (result.canExec) {
            for (let calldata of result.callData) {
                await gelatoAddr.sendTransaction({to: calldata.to, data: calldata.data});
            }
        }

        let resultWallet = await instance.getWalletByUserID("1796129942104657921" as any);
        expect(resultWallet.toLowerCase()).to.equal("0x6794a56583329794f184d50862019ecf7b6d8ba6");
    });

    it('twitter-worker success', async function () {
        /*
          Test case 1:
          start minting: empty Batch[]
          mint for 200 users by batches
          verify by Twitter API
          finish minting
        */

        const [owner, feeAddr, otherAcc1, gelatoAddr] = await ethers.getSigners();

        const coinsMultiplier = 100_000;
        const TwitterCoin = await ethers.getContractFactory("GMCoinExposed");
        const smartContract: GMCoinExposed = await upgrades.deployProxy(TwitterCoin, [owner.address, feeAddr.address, 50, 100000, gelatoAddr.address, coinsMultiplier], {kind: "uups"}) as unknown as GMCoinExposed;

        await smartContract.waitForDeployment();

        const gelatoContract = smartContract.connect(gelatoAddr);

        const smartContractAddress = await smartContract.getAddress();

        const userLimit = 10000;
        const userIDFetchLimit = 3000;
        const concurrencyLimit = 30;

        const generatedWallets: HDNodeWallet[] = generateWallets(ethers.provider, userLimit);

        let walletByUsername: Map<string, string> = new Map();
        for (let i = 0; i < userLimit; i++) {
            const username = String(i + 1)
            await gelatoContract.verifyTwitter(username as any, generatedWallets[i] as any);
            walletByUsername.set(username, generatedWallets[i].address);
        }

        // let allUserTweetsByUser = loadUserTweets('./test/generatedUserTweets_err.json')
        let allUserTweetsByUser = generateUserTweetsMap(userLimit);

        // saveUserTweetsToFile(allUserTweetsByUser, path.join(__dirname, 'generatedUserTweet2.json'));

        let tweetMap: Map<string, Tweet> = new Map();
        for (let [userID, tweets] of allUserTweetsByUser) {
            for (let tweet of tweets) {
                tweetMap.set(tweet.tweet_id, tweet);
            }
        }

        mockServer.mockFunc('/Search', 'GET', (url: url.UrlWithParsedQuery) => {
            const q = url.query["q"] as string;
            const cursor = url.query["cursor"] as string;
            const userIDList = extractUserIDs(q);

            console.log('query', q);
            console.log('cursor', cursor);

            const {filteredTweets, nextCursor} = filterUserTweets(allUserTweetsByUser, userIDList, cursor, 20);

            console.log('nextCursor', nextCursor);
            // console.log('generateResponse', 'nextCursor', nextCursor, userIDList, filteredTweets);

            let response = generateResponse(filteredTweets, nextCursor, cursor == '');
            return response;
        });

        mockServer.mockFunc('/tweet-lookup/', 'GET', (url: url.UrlWithParsedQuery) => {
            const idList = url.query["ids"] as string;
            const tweetIDs = idList.split(',');

            const expansionFields = (url.query["tweet.fields"] as string).split(",");
            expect(expansionFields.indexOf("public_metrics")).to.be.greaterThan(-1);

            return generateResponseForTweetLookup(tweetMap, tweetIDs, 0);
        });

        const verifierAddress = await smartContract.getAddress();
        console.log(`deployed GMCoin to ${verifierAddress}`);


        const userArgs = {
            contractAddress: verifierAddress,
            searchURL: "http://localhost:8118/Search",
            tweetLookupURL: "http://localhost:8118/tweet-lookup/",
            concurrencyLimit: concurrencyLimit,
            userIdFetchLimit: userIDFetchLimit,
        };

        await gelatoContract.startMinting();

        const currentTimestamp = await time.latest();
        const mintingDay = currentTimestamp - (currentTimestamp % time.duration.days(1)) - time.duration.days(1);
        await generateEventLogFile('web3-functions/twitter-worker', 'twitterMintingProcessed', [mintingDay, []]);

        let hasLogsToProcess = true;
        let prevBatches: any = null;
        let actualStorage: any = {};
        let overrideLog: any = null;

        let userTransferLogsCount = 0;
        let feeTransferLogsCount = 0;
        while (hasLogsToProcess) {
            const oracleW3f: Web3FunctionHardhat = w3f.get("twitter-worker");
            let {result, storage} = await oracleW3f.run("onRun", {
                userArgs: userArgs,
                storage: actualStorage,
                log: overrideLog,
            });
            actualStorage = storage.storage;

            expect(result.canExec).to.equal(true);

            if (result.canExec) {
                expect(result.callData.length).to.be.greaterThan(0);

                hasLogsToProcess = false;
                for (let calldata of result.callData) {
                    const tx = await gelatoAddr.sendTransaction({to: calldata.to, data: calldata.data});
                    const receipt = await tx.wait();
                    console.log('receipt.logs', receipt.logs.length);
                    for (const log of receipt.logs) {
                        const decodedLog = smartContract.interface.parseLog(log);
                        if (decodedLog == null) {
                            continue;
                        }

                        if (decodedLog.name == "Transfer") {
                            if (decodedLog.args[1] == smartContractAddress) {
                                feeTransferLogsCount++;
                            } else {
                                userTransferLogsCount++;
                            }
                            continue;
                        }

                        if (decodedLog.name == "MintingFinished") {
                            break;
                        }

                        expect(decodedLog.name).to.be.equal("twitterMintingProcessed");
                        expect(decodedLog.args.mintingDayTimestamp).to.be.equal(mintingDay);

                        const isBatchesTheSame = isEqual(decodedLog.args.batches, prevBatches);
                        if (isBatchesTheSame) {
                            const batches = decodedLog.args.batches.map(result => {
                                return `{${result[0]}-${result[1]},${result[2]}}`
                            });

                            expect(isBatchesTheSame, `current batch and prev are equals: ${batches}`).to.be.false;
                        }

                        hasLogsToProcess = true;
                        prevBatches = decodedLog.args.batches;

                        overrideLog = log;
                    }
                }
            }
        }

        let userPoints: Map<string, number> = new Map();
        let totalEligibleUsers: number = 0;
        allUserTweetsByUser.forEach((tweets, uid) => {
            const calculateTotalPoints = (tweets: Tweet[]): number => {
                return tweets.reduce((totalPoints, tweet) => {
                    const gmCount = (tweet.text.match(/\bgm\b/gi) || []).length; // Matches whole "gm" words
                    const hashtagGmCount = (tweet.text.match(/#gm/gi) || []).length; // Matches "#gm"
                    const dollarGmCount = (tweet.text.match(/\$gm/gi) || []).length; // Matches "$gm"

                    let pointsPerTweet = 0;
                    if (dollarGmCount > 0) {
                        pointsPerTweet += 10;
                    } else if (hashtagGmCount > 0) {
                        pointsPerTweet += 4;
                    } else if (gmCount > 0) {
                        pointsPerTweet += 2;
                    }

                    if (pointsPerTweet > 0) {
                        pointsPerTweet += tweet.likesCount;
                    }

                    return totalPoints + pointsPerTweet;
                }, 0);
            };

            const upoints = calculateTotalPoints(tweets);
            if (upoints > 0) {
                totalEligibleUsers++;
            }
            userPoints.set(uid, upoints);
        })

        for (const [uid, wallet] of walletByUsername) {
            const points = userPoints.get(uid);
            const balance = await smartContract.balanceOf(wallet as any);

            expect(balance / BigInt(coinsMultiplier) / 10n ** 18n, `userIndex ${parseInt(uid) - 1}`).to.be.equal(BigInt(points));
        }
        console.log('minting finished here!!');

        expect(feeTransferLogsCount).to.be.equal(totalEligibleUsers);
        expect(userTransferLogsCount).to.be.equal(totalEligibleUsers);

        // to maintain log.json file the same for git

        // let resultWallet = await instance.getWalletByUserID("1796129942104657921");
        // expect(resultWallet.toLowerCase()).to.equal("0x6794a56583329794f184d50862019ecf7b6d8ba6");
    });

    it('filterUserTweets', async function () {
        let userTweetsMap: UserTweetsMap = new Map();
        userTweetsMap.set("1", [
            {text: "1_1", likesCount: 10, author_id: "", tweet_id: ""},
            {text: "1_2", likesCount: 10, author_id: "", tweet_id: ""},
            {text: "1_3", likesCount: 10, author_id: "", tweet_id: ""},
            {text: "1_4", likesCount: 10, author_id: "", tweet_id: ""},
            {text: "1_5", likesCount: 10, author_id: "", tweet_id: ""},
        ])
        userTweetsMap.set("2", [
            {text: "2_1", likesCount: 20, author_id: "", tweet_id: ""},
            {text: "2_2", likesCount: 20, author_id: "", tweet_id: ""},
            {text: "2_3", likesCount: 20, author_id: "", tweet_id: ""},
        ])
        userTweetsMap.set("3", [
            {text: "3_1", likesCount: 20, author_id: "", tweet_id: ""},
            {text: "3_2", likesCount: 20, author_id: "", tweet_id: ""},
            {text: "3_3", likesCount: 20, author_id: "", tweet_id: ""},
            {text: "3_4", likesCount: 20, author_id: "", tweet_id: ""},
        ])
        let userIDList = ["1", "2", "3", "4", "5"];
        let {filteredTweets, nextCursor} = filterUserTweets(userTweetsMap, userIDList, "", 5);
        // const filteredUserIDs = Array.from(filteredTweets.keys());
        // expect(filteredUserIDs).to.be.equal(['1']);

        expect(JSON.stringify(filteredTweets.get("1"))).to.be.equal(JSON.stringify([
            {text: "1_1", likesCount: 10, author_id: "", tweet_id: ""},
            {text: "1_2", likesCount: 10, author_id: "", tweet_id: ""},
            {text: "1_3", likesCount: 10, author_id: "", tweet_id: ""},
            {text: "1_4", likesCount: 10, author_id: "", tweet_id: ""},
            {text: "1_5", likesCount: 10, author_id: "", tweet_id: ""},
        ]))
        expect(nextCursor).to.be.equal('cursor(1-5):1:5');


        let {
            filteredTweets: filteredTweets2,
            nextCursor: nextCursor2
        } = filterUserTweets(userTweetsMap, userIDList, nextCursor, 5);


        expect(JSON.stringify(filteredTweets2.get("2"))).to.be.equal(JSON.stringify([
            {text: "2_1", likesCount: 20, author_id: "", tweet_id: ""},
            {text: "2_2", likesCount: 20, author_id: "", tweet_id: ""},
            {text: "2_3", likesCount: 20, author_id: "", tweet_id: ""},
        ]));
        expect(JSON.stringify(filteredTweets2.get("3"))).to.be.equal(JSON.stringify([
            {text: "3_1", likesCount: 20, author_id: "", tweet_id: ""},
            {text: "3_2", likesCount: 20, author_id: "", tweet_id: ""},
        ]));

        expect(nextCursor2).to.be.equal('cursor(1-5):3:2');


        let {
            filteredTweets: filteredTweets3,
            nextCursor: nextCursor3
        } = filterUserTweets(userTweetsMap, userIDList, nextCursor2, 5);


        expect(JSON.stringify(filteredTweets3.get("3"))).to.be.equal(JSON.stringify([
            {text: "3_3", likesCount: 20, author_id: "", tweet_id: ""},
            {text: "3_4", likesCount: 20, author_id: "", tweet_id: ""},
        ]));

        expect(nextCursor3).to.be.equal('');

    });

    function extractUserIDs(query: string): string[] {
        const userIDs: string[] = [];
        const regex = /from:([^\s\)]+)/g; // Match 'from:' followed by anything until space or ')'

        let match;
        while ((match = regex.exec(query)) !== null) {
            userIDs.push(match[1]); // Add the captured group (userID) to the array
        }

        return userIDs;
    }

    const loadUserTweets = (filePath: string): UserTweetsMap => {
        // Read the file
        const rawData = fs.readFileSync(filePath, "utf-8");

        // Parse JSON
        const jsonData: Record<string, Tweet[]> = JSON.parse(rawData);

        // Initialize the Map
        const userTweets: UserTweetsMap = new Map();

        // Populate the Map
        for (const userID in jsonData) {
            if (Object.prototype.hasOwnProperty.call(jsonData, userID)) {
                userTweets.set(userID, jsonData[userID]);
            }
        }

        return userTweets;
    };

    function filterUserTweets(
        userTweets: UserTweetsMap,
        userIDList: string[],
        cursor: string,
        limit: number,
    ): { filteredTweets: UserTweetsMap; nextCursor: string } {
        const filteredTweets: UserTweetsMap = new Map();

        let startUserID = '';
        let startTi = 0;
        if (cursor != "") {
            const cursorParts = cursor.split(':');
            startUserID = cursorParts[1];
            startTi = parseInt(cursorParts[2]);
        }
        // Iterate through all user tweets
        let afterCursor: boolean = cursor == '';
        let nextCursor = '';
        let tweetInserted: number = 0;
        for (let i = 0; i < userIDList.length; i++) {
            const userID = userIDList[i];
            if (!afterCursor) {
                if (userID == startUserID) {
                    afterCursor = true;
                } else {
                    continue;
                }
            }

            const tweets = userTweets.get(userID) as Tweet[];
            if (!tweets) {
                continue;
            }

            let tweetsToInsert: Tweet[] = [];
            let ti: number = 0;
            for (; ti < tweets.length; ti++) {
                if (tweetInserted + (ti + 1) > limit) {
                    break
                }
                if (startUserID != '' && userID == startUserID) {
                    if (ti >= startTi) {
                        tweetsToInsert.push(tweets[ti]);
                    }
                    continue;
                }
                tweetsToInsert.push(tweets[ti]);
            }

            if (tweetsToInsert.length > 0) {
                filteredTweets.set(userID, tweetsToInsert);
                tweetInserted += tweetsToInsert.length;
            }

            if (tweetInserted == limit) {
                if (ti < tweets.length || i < userIDList.length) {
                    // create new cursor
                    nextCursor = `cursor(${userIDList[0]}-${userIDList[userIDList.length - 1]}):${userID}:${ti}`
                }
                break;
            }
        }

        return {filteredTweets, nextCursor};
    }

    function generateResponseForTweetLookup(tweetMap: Map<string, Tweet>, tweetIDs: string[], likesDelta: number): any {
        let response: any = {
            "data": []
        }
        for (const tweetID of tweetIDs) {
            const tweet = tweetMap.get(tweetID);
            let likesCount = tweet.likesCount - likesDelta;
            if (likesCount < 0) {
                likesCount = 0;
            }
            const res = {
                "id": `${tweetID}`,
                "text": `${tweet.text}`,
                "author_id": `${tweet.author_id}`,
                "public_metrics": {
                    "like_count": likesCount,
                }
            };

            console.log("lookupTweet", tweet.author_id, tweetID, res);

            response.data.push(res);
        }

        return response;
    }


    function generateResponse(userTweets: Map<string, Tweet[]>, nextCursor: string, isFirstCursorReply: boolean): any {
        const randomString = (length: number) => Math.random().toString(36).substr(2, length);
        const randomNumber = (min: number, max: number) =>
            Math.floor(Math.random() * (max - min + 1)) + min;

        const resultTweets = [];

        for (const [userId, tweets] of userTweets) {
            for (const tweet of tweets) {

                const tweetId = tweet.tweet_id;
                const userName = `${userId}`;
                const userScreenName = `screen${userId}`;

                const tweetObject = {
                    content: {
                        __typename: "TimelineTimelineItem",
                        client_event_info: {
                            component: "result",
                            details: {
                                timelines_details: {
                                    controller_data: randomString(16),
                                },
                            },
                            element: "tweet",
                        },
                        content: {
                            __typename: "TimelineTweet",
                            highlights: {
                                text_highlights: [],
                            },
                            timeline_tweet_display_type: "Tweet",
                            tweet_results: {
                                rest_id: tweetId,
                                result: {
                                    rest_id: tweetId,
                                    __typename: "Tweet",
                                    core: {
                                        user_results: {
                                            rest_id: userId,
                                            result: {
                                                rest_id: userId,
                                                __typename: "User",
                                                profile_bio: {
                                                    description: "test description",
                                                },
                                                action_counts: {
                                                    favorites_count: randomNumber(0, 10000),
                                                },
                                                avatar: {
                                                    image_url: `https://randomuser.me/api/portraits/thumb/men/${randomNumber(
                                                        1,
                                                        99
                                                    )}.jpg`,
                                                },
                                                banner: {
                                                    image_url: `https://picsum.photos/1000/300?random=${userId}`,
                                                },
                                                core: {
                                                    created_at: new Date(
                                                        Date.now() -
                                                        randomNumber(1, 365) * 24 * 60 * 60 * 1000
                                                    ).toUTCString(),
                                                    name: userName,
                                                    screen_name: userScreenName,
                                                },
                                            },
                                        },
                                    },
                                    legacy: {
                                        bookmark_count: 0,
                                        conversation_id_str: tweetId,
                                        created_at: new Date().toUTCString(),
                                        display_text_range: [0, tweet.text.length],
                                        favorite_count: tweet.likesCount,
                                        full_text: tweet.text,
                                        lang: "en",
                                        retweet_count: randomNumber(0, 100),
                                        user_id_str: userId,
                                    },
                                },
                            },
                        },
                    },
                    entry_id: `tweet-${tweetId}`,
                    sort_index: randomString(12),
                };

                resultTweets.push(tweetObject);
            }
        }

        let response;
        if (isFirstCursorReply) {
            resultTweets.push({
                content: {
                    cursor_type: "Bottom",
                    value: nextCursor
                }
            })
            response = {
                data: {
                    search_by_raw_query: {
                        id: `U2VhcmNoUXVlcnk6Z20gc2luY2U6${randomString(16)}`,
                        rest_id: `${randomString(20)}`,
                        search_timeline: {
                            id: `VGltZWxpbmU6DAB+${randomString(16)}`,
                            timeline: {
                                id: "LatestTabSrpProduct-Timeline",
                                instructions: [
                                    {
                                        __typename: "TimelineAddEntries",
                                        entries: resultTweets,
                                    },
                                ],
                            },
                        },
                    },
                },
            };
        } else {
            response = {
                data: {
                    search_by_raw_query: {
                        id: `U2VhcmNoUXVlcnk6Z20gc2luY2U6${randomString(16)}`,
                        rest_id: `${randomString(20)}`,
                        search_timeline: {
                            id: `VGltZWxpbmU6DAB+${randomString(16)}`,
                            timeline: {
                                id: "LatestTabSrpProduct-Timeline",
                                instructions: [
                                    {
                                        __typename: "TimelineAddEntries",
                                        entries: resultTweets,
                                    },
                                    {
                                        entry: {
                                            content: {
                                                cursor_type: "Bottom",
                                                value: nextCursor
                                            }
                                        }
                                    }
                                ],
                            },
                        },
                    },
                },
            };
        }

        return response;
    }

    /*
      Test case 2:
      start minting: empty Batch[]
      mint for 200 users by batches
      few retries because of error
      verify by Twitter API
      finish minting
    */

    /*
      Test case 3:
      start minting: empty Batch[]
      mint for 200 users by batches
      all fails by error
      send failed transaction to blockchain
      finish minting
    */

    /*
      Test case 4:
      start minting: empty Batch[]
      mint for 5000 users by batches - test getTwitterUsers func
      verify by Twitter API
      finish minting
    */

})

type UserTweetsMap = Map<string, Tweet[]>;

// Define the types
interface Tweet {
    text: string;
    likesCount: number;
    author_id: string;
    tweet_id: string;
}

function generateWallets(provider: Provider, count: number = 1000): HDNodeWallet[] {
    const wallets: HDNodeWallet[] = [];

    for (let i = 0; i < count; i++) {
        const wallet = ethers.Wallet.createRandom();
        const connectedWallet = wallet.connect(provider);
        wallets.push(connectedWallet);
    }

    return wallets;
}

function generateRandomLikes(): number {
    // Generate random likes with most values between 0-10
    const isHighLikes = Math.random() < 0.05; // 5% chance for high likes
    return isHighLikes ? Math.floor(Math.random() * 100000) : Math.floor(Math.random() * 11);
}

function generateRandomTweetText(): string {
    const gmWords = ["gm", "#gm", "$gm"];
    const otherGmWords = ["alignment", "fragmental", "judgment", "biomagnetic"];
    const generalWords = [
        "hello world",
        "to the moon",
        "crypto is life",
        "stay positive",
        "just chilling",
        "time to grind",
        "what a beautiful day",
        "let's conquer today",
        "rise and shine",
    ];

    // Decide if the tweet should include a gm-related word
    const includeGm = Math.random() < 0.7; // 70% chance to include gm
    const gmWord = includeGm ? gmWords.concat(otherGmWords)[Math.floor(Math.random() * (gmWords.length + otherGmWords.length))] : "";

    // Create a tweet by combining random general words and possibly a gm-related word
    const tweetParts = [gmWord, generalWords[Math.floor(Math.random() * generalWords.length)]];
    return tweetParts.filter(Boolean).join(" ").trim();
}

function generateUserTweetsMap(limit: number): UserTweetsMap {
    const userTweets: UserTweetsMap = new Map();

    for (let userId = 1; userId <= limit; userId++) {
        const numberOfTweets = Math.floor(Math.random() * 5) + 1; // Each user can have 1-5 tweets
        const tweets: Tweet[] = [];

        for (let i = 0; i < numberOfTweets; i++) {
            const tweet: Tweet = {
                text: generateRandomTweetText(),
                likesCount: generateRandomLikes(),
                author_id: userId.toString(),
                tweet_id: `tweetId${userId}_${i}`,
            };
            tweets.push(tweet);
        }

        userTweets.set(userId.toString(), tweets);
    }

    return userTweets;
}

// Function to save userTweets map to a JSON file
function saveUserTweetsToFile(userTweets: UserTweetsMap, filePath: string): void {
    function mapToJson(map: UserTweetsMap): Record<string, Tweet[]> {
        const obj: Record<string, Tweet[]> = {};
        map.forEach((value, key) => {
            obj[key] = value;
        });
        return obj;
    }

    const jsonObject = mapToJson(userTweets);
    const jsonString = JSON.stringify(jsonObject, null, 2); // Pretty-print JSON with 2 spaces

    fs.writeFileSync(filePath, jsonString, "utf8");
    console.log(`UserTweets have been saved to ${filePath}`);
}

/*
Possible Twitter API responses:
{
    "title": "Too Many Requests",
    "detail": "Too Many Requests",
    "type": "about:blank",
    "status": 429
}


{
    "title": "Unauthorized",
    "type": "about:blank",
    "status": 401,
    "detail": "Unauthorized"
}


{"errors":[{"message":"BadRequest: Unknown request cursor: 9223372036854775807","locations":[{"line":3900,"column":7}],"path":["search_by_raw_query","search_timeline","timeline"],"extensions":{"name":"BadRequestError","source":"Client","code":214,"kind":"Validation","tracing":{"trace_id":"d892ef0b1fbea6b2"}},"code":214,"kind":"Validation","name":"BadRequestError","source":"Client","tracing":{"trace_id":"d892ef0b1fbea6b2"}}],"data":{"search_by_raw_query":{"id":"U2VhcmNoUXVlcnk6Z20gdW50aWw6MjAyNC0xMS0xNw==","rest_id":"gm until:2024-11-17","search_timeline":{"id":"VGltZWxpbmU6DAB+CwABAAAAE2dtIHVudGlsOjIwMjQtMTEtMTcIAAIAAAABAAA="}}}}
*/


