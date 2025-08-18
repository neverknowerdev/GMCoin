import {expect, use} from "chai";
import hre from "hardhat";
import isEqual from 'lodash/isEqual';
import {gcm} from '@noble/ciphers/aes';
import {utf8ToBytes, bytesToUtf8, bytesToHex, hexToBytes} from "@noble/ciphers/utils";
import {randomBytes} from '@noble/ciphers/webcrypto';

import dotenv from 'dotenv';

const {ethers, w3f, upgrades} = hre;
import {
    Web3FunctionUserArgs,
    Web3FunctionResultV2,
} from "@gelatonetwork/web3-functions-sdk";
import {Web3FunctionHardhat} from "@gelatonetwork/web3-functions-sdk/hardhat-plugin";
import {GMCoinExposed} from "../typechain";
import {MockHttpServer} from './tools/mockServer';
import {Provider, HDNodeWallet, EventLog, Contract, JsonRpcProvider} from "ethers";
import {generateEventLog} from './tools/helpers';
import {deployGMCoinWithProxy} from "./tools/deployContract";
import {loadFixture, time} from "@nomicfoundation/hardhat-network-helpers";
import * as url from 'url';
import fs from "fs";
import {HardhatEthersSigner} from "@nomicfoundation/hardhat-ethers/signers";
import {IncomingHttpHeaders} from "http";
import {blake2b} from "blakejs";
import axios from "axios";
import {loadEnvVariables} from "../scripts/prod/utils";


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

    it('twitter-worker success', async function () {
        /*
          Test case 1:
          start minting: empty Batch[]
          mint for 200 users by batches
          verify by Twitter API
          finish minting
        */

        const {
            coinContract: smartContract,
            owner,
            feeAddr,
            treasuryAddr,
            gelatoAddr,
            coinsMultiplicator
        } = await loadFixture(deployGMCoinWithProxy);

        const gelatoContract = smartContract.connect(gelatoAddr);

        const userLimit = 10000;
        const concurrencyLimit = 50;

        const generatedWallets: HDNodeWallet[] = generateWallets(ethers.provider, userLimit);

        let walletByUsername: Map<string, string> = new Map();
        let usernameByWallet: Map<string, string> = new Map();
        for (let i = 0; i < userLimit; i++) {
            const userID = String(i + 1)
            await gelatoContract.verifyTwitter(userID as any, generatedWallets[i] as any);
            walletByUsername.set(userID, generatedWallets[i].address);
            usernameByWallet.set(generatedWallets[i].address, userID);

            expect(await gelatoContract.getWalletByUserID(userID as any)).to.be.equal(generatedWallets[i]);
        }

        // let allUserTweetsByUsername = loadUserTweets('./test/generatedUserTweets_error.json')
        let allUserTweetsByUsername = generateUserTweetsMap(userLimit, true);

        // adding more than 10 hashtags for some user

        // saveUserTweetsToFile(allUserTweetsByUsername, './test/generatedUserTweets_error.json');

        let tweetMap: Map<string, Tweet> = new Map();
        for (let [userID, tweets] of allUserTweetsByUsername) {
            for (let tweet of tweets) {
                tweetMap.set(tweet.tweet_id, tweet);
            }
        }

        let queryCount = 0;
        let queryErrorCount: Map<string, number> = new Map();
        mockServer.mockFunc('/Search', 'GET', (url: url.UrlWithParsedQuery) => {
            queryCount++;

            const q = url.query["q"] as string;
            const cursor = url.query["cursor"] as string;
            const usernamesList = extractUserIDs(q);

            const alreadyErroredCount = queryErrorCount.get(q) || 0;
            if (alreadyErroredCount < 2) {
                if (queryCount % 5 == 0) {
                    queryErrorCount.set(q, alreadyErroredCount + 1);
                    throw new Error("some random error");
                }
            }


            // console.log('query', q);
            // console.log('cursor', cursor);

            const {filteredTweets, nextCursor} = filterUserTweets(allUserTweetsByUsername, usernamesList, cursor, 20);

            // console.log('nextCursor', nextCursor);
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

        mockServer.mockFunc('/UserResultsByRestIds', 'GET', (url: url.UrlWithParsedQuery) => {
            const idList = url.query["user_ids"] as string;
            const userIDs = idList.split(',');

            let response = {data: {users: []}};
            for (const userID of userIDs) {
                response.data.users.push({
                    result: {
                        core: {
                            screen_name: `user${userID}`
                        },
                    },
                    rest_id: userID,
                })
            }

            return response;
        });

        mockServer.mock('/SaveTweets', 'POST', {success: true});

        mockServer.mockFunc('/UploadTweetsToIPFS', 'POST', (url: url.UrlWithParsedQuery, headers: IncomingHttpHeaders, body: any) => {
            const receivedJSON = JSON.parse(body);
            const apiKey = headers.authorization;
            expect(apiKey?.indexOf('sN') === 0).to.be.true;

            expect(receivedJSON.mintingDayTimestamp).to.be.equal(mintingDay);

            return {
                success: true
            }
        });

        const verifierAddress = await smartContract.getAddress();
        console.log(`deployed GMCoin to ${verifierAddress}`);

        const userArgs = {
            contractAddress: verifierAddress,
            concurrencyLimit: concurrencyLimit,
            twitterOptimizedServerHost: "http://localhost:8118",
            serverURLPrefix: 'http://localhost:8118/',
            tweetLookupURL: "http://localhost:8118/tweet-lookup/",
        };
        //
        // const currentTimestamp = await time.latest();
        // const mintingDay = currentTimestamp - (currentTimestamp % time.duration.days(1)) - time.duration.days(1);

        let today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const mintingDay = today.setDate(today.getDate() - 1) / 1000;

        const {
            userMintCount,
            treasuryMintCount,
            finalRunningHash
        } = await mintUntilEnd(smartContract, gelatoAddr, treasuryAddr, userArgs, mintingDay, {
            AWS_ACCESS_KEY_ID: 'test',
            AWS_SECRET_ACCESS_KEY: 'test',
            ENV: 'local',
            TWITTER_BEARER: 'test',
            TWITTER_OPTIMIZED_SERVER_KEY: 'test',
            TWITTER_OPTIMIZED_SERVER_AUTH_HEADER_NAME: 'Authorization',
            TWITTER_OPTIMIZED_SERVER_HOST: 'http://localhost:8118',
            SERVER_API_KEY: 'sN-test'
        })

        let userPoints: Map<string, number> = new Map();
        let totalEligibleUsers: number = 0;

        const perTweet = Number(await smartContract.POINTS_PER_TWEET());
        const perLike = Number(await smartContract.POINTS_PER_LIKE());
        const perHashtag = Number(await smartContract.POINTS_PER_HASHTAG());
        const perCashtag = Number(await smartContract.POINTS_PER_CASHTAG());

        let mintUserUIDs: string[] = [];
        allUserTweetsByUsername.forEach((tweets, uid) => {
            let totalHashtagsCount = 0;
            let totalCashtagCount = 0;
            const calculateTotalPoints = (tweets: Tweet[]): number => {
                return tweets.reduce((totalPoints, tweet) => {
                    const gmCount = (tweet.text.match(/\bgm\b/gi) || []).length; // Matches whole "gm" words
                    const hashtagGmCount = (tweet.text.match(/#gm\b/gi) || []).length; // Matches "#gm"
                    const dollarGmCount = (tweet.text.match(/\$gm\b/gi) || []).length; // Matches "$gm"

                    let pointsPerTweet = 0;
                    if (dollarGmCount > 0) {
                        totalCashtagCount++;

                        if (totalCashtagCount <= 10) {
                            pointsPerTweet = perCashtag;
                        }
                    } else if (hashtagGmCount > 0) {
                        totalHashtagsCount++;

                        if (totalHashtagsCount <= 10) {
                            pointsPerTweet = perHashtag;
                        }
                    } else if (gmCount > 0) {
                        pointsPerTweet = perTweet;
                    }

                    if (pointsPerTweet > 0) {
                        pointsPerTweet += tweet.likesCount * perLike;
                    }

                    // console.log('pointsPerTweet', pointsPerTweet, tweet.text, tweet.likesCount, tweet.tweet_id);

                    return totalPoints + pointsPerTweet;
                }, 0);
            };


            let upoints = calculateTotalPoints(tweets);
            if (upoints > 0) {
                totalEligibleUsers++;
            }

            userPoints.set(uid, upoints);
        })

        // console.log('test mintedUserIDs', mintUserUIDs.length);
        // console.log(JSON.stringify(mintUserUIDs));
        // console.log('coinsMultiplicator', coinsMultiplicator);

        for (const [uid, wallet] of walletByUsername) {
            const points = userPoints.get(`user${uid}`) || 0;
            const balance = await smartContract.balanceOf(wallet as any);
            const actualPoints = balance / BigInt(coinsMultiplicator) / 10n ** 18n

            // points per tweets/likes + welcomePoints
            const expectedPoints = points + perTweet;

            expect(actualPoints, `userIndex ${parseInt(uid) - 1}`).to.be.equal(BigInt(expectedPoints));
        }
        console.log('minting finished here!!');

        console.log('treasuryMintCount', treasuryMintCount);
        console.log('eligibleUsersCount', totalEligibleUsers);
        expect(userMintCount).to.be.equal(totalEligibleUsers);
        expect(treasuryMintCount).to.be.equal(totalEligibleUsers);
    });

    it('twitter-worker runningHash', async function () {
        const {
            coinContract: smartContract,
            owner,
            feeAddr,
            gelatoAddr,
            treasuryAddr,
            coinsMultiplicator
        } = await loadFixture(deployGMCoinWithProxy);

        const gelatoContract = smartContract.connect(gelatoAddr);

        const userLimit = 100;
        const concurrencyLimit = 5;

        const generatedWallets: HDNodeWallet[] = generateWallets(ethers.provider, userLimit);

        let walletByUsername: Map<string, string> = new Map();
        for (let i = 0; i < userLimit; i++) {
            const userID = String(i + 1)
            await gelatoContract.verifyTwitter(userID as any, generatedWallets[i] as any);
            walletByUsername.set(userID, generatedWallets[i].address);

            expect(await gelatoContract.getWalletByUserID(userID as any)).to.be.equal(generatedWallets[i]);
        }

        // let allUserTweetsByUsername = loadUserTweets('./test/generatedUserTweets_err.json')
        let allUserTweetsByUsername = generateUserTweetsMap(userLimit);

        let tweetMap: Map<string, Tweet> = new Map();
        for (let [userID, tweets] of allUserTweetsByUsername) {
            for (let tweet of tweets) {
                if (tweet.likesCount > 100) {
                    tweet.likesCount = 99;
                }
                tweetMap.set(tweet.tweet_id, tweet);
            }
        }


        mockServer.mockFunc('/Search', 'GET', (url: url.UrlWithParsedQuery) => {
            const q = url.query["q"] as string;
            const cursor = url.query["cursor"] as string;
            const usernamesList = extractUserIDs(q);

            const {filteredTweets, nextCursor} = filterUserTweets(allUserTweetsByUsername, usernamesList, cursor, 20);

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

        mockServer.mockFunc('/UserResultsByRestIds', 'GET', (url: url.UrlWithParsedQuery) => {
            const idList = url.query["user_ids"] as string;
            const userIDs = idList.split(',');

            let response = {data: {users: []}};
            for (const userID of userIDs) {
                response.data.users.push({
                    result: {
                        core: {
                            screen_name: `user${userID}`
                        },
                    },
                    rest_id: userID,
                })
            }

            return response;
        });

        let savedTweets = [];
        mockServer.mockFunc('/SaveTweets', 'POST', (url: url.UrlWithParsedQuery, headers: IncomingHttpHeaders, body: any) => {
            const receivedJSON = JSON.parse(body);
            const apiKey = headers.authorization;
            expect(apiKey?.indexOf('sN') === 0).to.be.true;

            expect(receivedJSON.mintingDayTimestamp).to.be.equal(mintingDay);
            savedTweets.push(...receivedJSON.tweets);

            return {
                success: true
            }
        });

        mockServer.mockFunc('/UploadTweetsToIPFS', 'POST', (url: url.UrlWithParsedQuery, headers: IncomingHttpHeaders, body: any) => {
            const receivedJSON = JSON.parse(body);
            const apiKey = headers.authorization;
            expect(apiKey?.indexOf('sN') === 0).to.be.true;

            expect(receivedJSON.mintingDayTimestamp).to.be.equal(mintingDay);

            return {
                success: true
            }
        });


        const verifierAddress = await smartContract.getAddress();
        console.log(`deployed GMCoin to ${verifierAddress}`);


        const userArgs = {
            contractAddress: verifierAddress,
            searchPath: "/Search",
            tweetLookupURL: "http://localhost:8118/tweet-lookup/",
            convertToUsernamesPath: "/convert-ids-to-usernames/",
            concurrencyLimit: concurrencyLimit,
            serverURLPrefix: 'http://localhost:8118/',
            twitterOptimizedServerHost: "",
        };
        //
        // const currentTimestamp = await time.latest();
        // const mintingDay = currentTimestamp - (currentTimestamp % time.duration.days(1)) - time.duration.days(1);

        let today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const mintingDay = today.setDate(today.getDate() - 1) / 1000;
        // const mintingDay = 1743292800;

        const {
            userMintCount,
            treasuryMintCount,
            finalRunningHash
        } = await mintUntilEnd(smartContract, gelatoAddr, treasuryAddr, userArgs, mintingDay, {
            AWS_ACCESS_KEY_ID: 'test',
            AWS_SECRET_ACCESS_KEY: 'test',
            ENV: 'local',
            TWITTER_BEARER: 'test',
            TWITTER_OPTIMIZED_SERVER_KEY: 'test',
            TWITTER_OPTIMIZED_SERVER_AUTH_HEADER_NAME: 'Authorization',
            TWITTER_OPTIMIZED_SERVER_HOST: 'http://localhost:8118',
            SERVER_API_KEY: 'sN-test'
        })

        let runningHash = '';


        for (let i = 0; i < savedTweets.length; i++) {
            if (savedTweets[i].tweetContent.indexOf('gm') === -1) {
                continue;
            }
            runningHash = calculateRunningHash(runningHash, savedTweets[i]);
        }
        console.log('calculated runningHash', runningHash);

        expect(finalRunningHash).to.be.not.empty;
        expect(finalRunningHash).to.be.equal(runningHash);

    });

    it('twitter-worker real-world', async function () {
        const {
            coinContract: smartContract,
            owner,
            treasuryAddr,
            feeAddr,
            gelatoAddr
        } = await loadFixture(deployGMCoinWithProxy);

        const gelatoContract = smartContract.connect(gelatoAddr);

        const smartContractAddress = await smartContract.getAddress();

        dotenv.config({
            path: './test/.env'
        });

        const testnetCcontractAbi = [
            "event MintingFinished_TweetsUploadedToIPFS(uint32 indexed mintingDayTimestamp, string runningHash, string cid)",
            // Add other functions if needed, e.g.:
            "function attachIPFSTweetsFile(uint32 mintingDayTimestamp, string calldata finalHash, string calldata cid) public",
        ];

        const testnetProvider = new JsonRpcProvider("https://base-sepolia.infura.io/v3/" + process.env.INFURA_KEY);
        const testnetContract = new Contract("0x19bD68AD19544FFA043B2c3A5064805682783E91", testnetCcontractAbi, testnetProvider);

        const userLimit = 10;
        const concurrencyLimit = 30;

        const generatedWallets: HDNodeWallet[] = generateWallets(ethers.provider, userLimit);
        const usernames: string[] = [
            'coingecko',
            '0xFigen',
            'Jeremyybtc',
            'SolAndrew_',
            '1Kaiweb3',
            'barkmeta',
            'Zuriell',
            'CenkCrypto',
            'itstylersays',
            'Chaser_Eth'
        ];
        const userIDs: string[] = [
            "2412652615",
            "1628431584905814016",
            "1456163056829046785",
            "1535589727583313921",
            "1460211122263379969",
            "336348053",
            "1227430018445430784",
            "2262884168",
            "2289922827",
            "1213721158450696194"
        ];

        let walletByUsername: Map<string, string> = new Map();
        for (let i = 0; i < userLimit; i++) {
            const userID = userIDs[i];
            await gelatoContract.verifyTwitter(userID as any, generatedWallets[i] as any);
            walletByUsername.set(userID, generatedWallets[i].address);

            expect(await gelatoContract.getWalletByUserID(userID as any)).to.be.equal(generatedWallets[i]);
        }


        let today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const mintingDay = today.setDate(today.getDate() - 1) / 1000;
        // const mintingDay = 1743292800;

        const userArgs = {
            contractAddress: smartContractAddress,
            searchPath: "/Search",
            tweetLookupURL: "https://api.x.com/2/tweets",
            concurrencyLimit: concurrencyLimit,
            serverURLPrefix: "https://ue63semz7f.execute-api.eu-central-1.amazonaws.com/dev/",
            twitterOptimizedServerHost: "",
        };

        // const secrets = {
        //     TWITTER_OPTIMIZED_SERVER_HOST: 'http://localhost:8118'
        // }

        // Skip this test locally if prod env is not available
        let secrets;
        try {
            const secretsProd = loadEnvVariables('twitter-worker', 'prod');
            const secretsDev = loadEnvVariables('twitter-worker', '');
            secrets = secretsProd;
            secrets.SERVER_API_KEY = secretsDev.SERVER_API_KEY;
        } catch (err) {
            this.skip();
            return;
        }

        dotenv.config({
            path: './test/.env'
        });

        const response = await axios.post(
            'https://ue63semz7f.execute-api.eu-central-1.amazonaws.com/dev/DeleteDevTweets',
            null, // No data to send in the body
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': process.env.SERVER_API,
                },
            }
        );

        // Assuming the API returns { success: true } in its JSON body
        expect(response.data.success).to.be.true;


        const {
            userMintCount,
            treasuryMintCount,
            finalRunningHash
        } = await mintUntilEnd(smartContract, gelatoAddr, treasuryAddr, userArgs, mintingDay, secrets)

        expect(userMintCount).to.be.greaterThan(0);
        expect(treasuryMintCount).to.be.greaterThan(0);

        let totalBalance = 0n;
        for (const [uid, wallet] of walletByUsername) {
            const balance = await smartContract.balanceOf(wallet as any);
            console.log('username', uid, 'balance', balance);

            totalBalance += balance;
        }

        expect(totalBalance).to.be.greaterThan(0);

        console.log('mintingDay', mintingDay);
        console.log('finalHash', finalRunningHash);

        console.log('waiting for upload to IPFS..');


        const filter = testnetContract.filters.MintingFinished_TweetsUploadedToIPFS(mintingDay);

        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        let foundEvent: EventLog;
        for (let i = 0; i < 200; i++) {
            const events = await testnetContract.queryFilter(filter);
            if (events.length > 0) {
                let lastEvent = events.reverse()[0] as EventLog;

                const {mintingDayTimestamp, runningHash, cid} = lastEvent.args;
                if (runningHash == finalRunningHash) {
                    foundEvent = lastEvent;
                    break;
                }
            }

            await delay(1000);
        }


        const {mintingDayTimestamp, runningHash, cid} = foundEvent.args;

        const url = `https://${cid}.ipfs.w3s.link/`;

        // Make an HTTP GET request using Axios.
        const ipfsResponse = await axios.get(url, {responseType: 'text'});

        const ipfsContent = JSON.parse(ipfsResponse.data);
        expect(ipfsContent.finalHash).to.be.equal(finalRunningHash);
        expect(ipfsContent.tweets.length).to.be.greaterThan(0);

        let actualRunningHash = '';
        for (let i = 0; i < ipfsContent.tweets.length; i++) {
            const tweet = ipfsContent.tweets[i];
            actualRunningHash = calculateRunningHash(actualRunningHash, {
                tweetID: tweet[2],
                likesCount: tweet[3],
                tweetContent: tweet[4]
            });
        }

        expect(actualRunningHash).to.be.equal(finalRunningHash);
    })

    // it('twitter-worker with specific users', async function () {
    //     const users: TestUser[] = [
    //         {
    //             userID: "303192973",
    //             username: "MickfromEU",
    //             tweets: [
    //                 {
    //                     tweetID: "1923847904717885662",
    //                     text: "@100xDarren GM Darren ! This is the time ! Have a good day.",
    //                     likesCount: 1
    //                 },
    //                 {
    //                     tweetID: "1923817562212626515",
    //                     text: "@WEB3Eliza GM Eliza !",
    //                     likesCount: 0
    //                 },
    //                 {
    //                     tweetID: "1923644280016453716",
    //                     text: "@9FStudioArt @shivst3r @flipdotmeme GM 9FStudio !",
    //                     likesCount: 0
    //                 },
    //                 {
    //                     tweetID: "1923643565009199142",
    //                     text: "@Queenxrypt GM Vee ! Love this picture...",
    //                     likesCount: 1
    //                 },
    //                 {
    //                     tweetID: "1923642931111477457",
    //                     text: "@Queenxrypt @virtuals_io @infinex GM Vee ! Have a good yap day lady ☀️",
    //                     likesCount: 0
    //                 }
    //             ]
    //         },
    //         {
    //             userID: "1796129942104657921",
    //             username: "neverknowerdev",
    //             tweets: [
    //                 {
    //                     tweetID: "1923717196858978732",
    //                     text: "@vainxyz gm gm!",
    //                     likesCount: 0
    //                 },
    //                 {
    //                     tweetID: "1923713450426978332",
    //                     text: "@PLBompard First tweet&amp;mint meme-coin GM 🙌 @say_more_gm",
    //                     likesCount: 0
    //                 },
    //                 {
    //                     tweetID: "1923711816397357356",
    //                     text: "GM! ☀️ So it was a very productive week. I've participated in #BaseBatches. I've learned React and Next.js, and Cursor in 1 week, and built an Account Abstraction sign-up from scratch! Finally! 🥳 The deadline was midnight Friday, but USA time, which is 9 AM Saturday for me..…",
    //                     likesCount: 1
    //                 }
    //             ]
    //         }
    //     ];
    //
    //     // Add other users without tweets
    //     const otherUserIDs = [
    //         "1630283624615378945",
    //         "1884569516673486848",
    //         "1884551708535377920",
    //         "1884545177605324800",
    //         "1754493082505039872",
    //         "1827035033791537152",
    //         "1260869635429326852",
    //         "1556403964123414529",
    //         "1504474755969155073",
    //         "1773562836192509952",
    //         "413535127",
    //         "1142020693581807617",
    //         "1687460261966364674",
    //         "1830701284288028673"
    //     ];
    //
    //     for (const userID of otherUserIDs) {
    //         users.push({userID});
    //     }
    //
    //     await runTwitterWorkerTest(users);
    // });
    //
    // it('twitter-worker with random users', async function () {
    //     await runTwitterWorkerTest([], 100);
    // });


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

});

async function mintUntilEnd(smartContract: GMCoinExposed, gelatoAddr: HardhatEthersSigner, treasuryAddr: HardhatEthersSigner, userArgs, mintingDay: number, secrets?: any, usernameByWallet?: Map<string, string>): Promise<{
    userMintCount: number,
    treasuryMintCount: number,
    finalRunningHash: string
}> {
    const gelatoContract = smartContract.connect(gelatoAddr);
    const smartContractAddress = await smartContract.getAddress();

    await gelatoContract.startMinting();

    let overrideLog = await generateEventLog('twitterMintingProcessed', [mintingDay, []])
    // await writeEventLogFile('web3-functions/twitter-worker', 'twitterMintingProcessed', [mintingDay, []]);

    let hasLogsToProcess = true;
    let prevBatches: any = null;
    let actualStorage: any = {};

    let finalRunningHash = '';

    let mintedUserIDs: string[] = [];

    let userMintsLogsCount = 0;
    let treasuryMintingLogsCount = 0;
    while (hasLogsToProcess) {
        const oracleW3f: Web3FunctionHardhat = w3f.get("twitter-worker");
        let {result, storage} = await oracleW3f.run("onRun", {
            userArgs: userArgs,
            storage: actualStorage,
            log: overrideLog,
            secrets: secrets,
        });
        actualStorage = storage.storage;

        expect(result.canExec, result.message).to.equal(true);

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
                        // checking only minting
                        if (decodedLog.args[0] != 0x0) {
                            continue;
                        }

                        if (decodedLog.args[1] == treasuryAddr.address) {
                            treasuryMintingLogsCount++;
                        } else {
                            const username = usernameByWallet?.get(decodedLog.args[1]);
                            if (username) {
                                mintedUserIDs.push(username);
                            }
                            userMintsLogsCount++;
                        }
                        continue;
                    }

                    if (decodedLog.name == "MintingFinished") {
                        expect(decodedLog.args.mintingDayTimestamp).to.be.equal(mintingDay);
                        finalRunningHash = decodedLog.args.runningHash;
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

    // mintedUserIDs = mintedUserIDs.sort((a, b) => a - b);
    // console.log('smart-contract minted UIDs..', mintedUserIDs.length);
    // console.log(JSON.stringify(mintedUserIDs));

    return {
        userMintCount: userMintsLogsCount,
        treasuryMintCount: treasuryMintingLogsCount,
        finalRunningHash: finalRunningHash
    };
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

function filterUserTweets(
    userTweets: UserTweetsMap,
    usernamesList: string[],
    cursor: string,
    limit: number,
): { filteredTweets: UserTweetsMap; nextCursor: string } {
    const filteredTweets: UserTweetsMap = new Map();

    let startUsername = '';
    let startTi = 0;
    if (cursor != "") {
        const cursorParts = cursor.split(':');
        startUsername = cursorParts[1];
        startTi = parseInt(cursorParts[2]);
    }
    // Iterate through all user tweets
    let afterCursor: boolean = cursor == '';
    let nextCursor = '';
    let tweetInserted: number = 0;
    for (let i = 0; i < usernamesList.length; i++) {
        const username = usernamesList[i];
        if (!afterCursor) {
            if (username == startUsername) {
                afterCursor = true;
            } else {
                continue;
            }
        }

        const tweets = userTweets.get(username) as Tweet[];
        if (!tweets) {
            continue;
        }

        let tweetsToInsert: Tweet[] = [];
        let ti: number = 0;
        for (; ti < tweets.length; ti++) {
            if (tweetInserted + (ti + 1) > limit) {
                break
            }
            if (startUsername != '' && username == startUsername) {
                if (ti >= startTi) {
                    tweetsToInsert.push(tweets[ti]);
                }
                continue;
            }
            tweetsToInsert.push(tweets[ti]);
        }

        if (tweetsToInsert.length > 0) {
            filteredTweets.set(username, tweetsToInsert);
            tweetInserted += tweetsToInsert.length;
        }

        if (tweetInserted == limit) {
            if (ti < tweets.length || i < usernamesList.length) {
                // create new cursor
                nextCursor = `cursor(${usernamesList[0]}-${usernamesList[usernamesList.length - 1]}):${username}:${ti}`
            }
            break;
        }
    }

    return {filteredTweets, nextCursor};
}

function extractUserIDs(query: string): string[] {
    const userIDs: string[] = [];
    const regex = /from:([^\s\)]+)/g; // Match 'from:' followed by anything until space or ')'

    let match;
    while ((match = regex.exec(query)) !== null) {
        userIDs.push(match[1]); // Add the captured group (userID) to the array
    }

    return userIDs;
}

function generateResponseForTweetLookup(tweetMap: Map<string, Tweet>, tweetIDs: string[], likesDelta: number): any {
    let response: any = {
        "data": [],
        "includes": {
            "users": []
        }
    }

    let usersMap: Map<string, string> = new Map();
    for (const tweetID of tweetIDs) {
        const tweet = tweetMap.get(tweetID);
        let likesCount = tweet.likesCount - likesDelta;
        if (likesCount < 0) {
            likesCount = 0;
        }

        usersMap.set(tweet?.author_id as string, `user${tweet?.author_id}`);

        const res = {
            "id": `${tweetID}`,
            "text": `${tweet.text}`,
            "author_id": `${tweet.author_id}`,
            "public_metrics": {
                "like_count": likesCount,
            }
        };

        // console.log("lookupTweet", tweet.author_id, tweetID, res);

        response.data.push(res);
    }

    for (const [userID, username] of usersMap) {
        response.includes.users.push({
            id: userID,
            username: username,
            name: `UserName ${userID}`
        })
    }

    return response;
}


function generateResponse(userTweets: Map<string, Tweet[]>, nextCursor: string, isFirstCursorReply: boolean): any {
    const randomString = (length: number) => Math.random().toString(36).substr(2, length);
    const randomNumber = (min: number, max: number) =>
        Math.floor(Math.random() * (max - min + 1)) + min;

    const resultTweets = [];

    // sometimes API returns not only tweet_results object
    resultTweets.push({
        content: {
            __typename: "TimelineTimelineModule",
            client_event_info: {
                "component": "user_module",
                "element": "module"
            },
            display_type: "Carousel",
            header: {},
            footer: {},
            items: {}
        }
    })

    for (const [username, tweets] of userTweets) {
        for (const tweet of tweets) {

            const tweetId = tweet.tweet_id;
            const userId = username.slice(4);
            const userScreenName = `${username}`;

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
                                        rest_id: username,
                                        result: {
                                            rest_id: username,
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
                                                image_url: `https://picsum.photos/1000/300?random=${username}`,
                                            },
                                            core: {
                                                created_at: new Date(
                                                    Date.now() -
                                                    randomNumber(1, 365) * 24 * 60 * 60 * 1000
                                                ).toUTCString(),
                                                name: userId,
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
                                    user_id_str: username,
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


function calculateRunningHash(prevHash: string, tweet: any): string {
    const prevHashBytes = base64ToArrayBuffer(prevHash);
    const runningHashLength = prevHashBytes.length;
    const encodedTweet = stringToUint8Array(toTweetKey(tweet));
    const combinedArray = new Uint8Array(runningHashLength + encodedTweet.length);
    if (runningHashLength > 0) {
        combinedArray.set(prevHashBytes);
    }
    combinedArray.set(encodedTweet, runningHashLength);

    return arrayBufferToBase64(blake2b(combinedArray, undefined, 20));
}

function toTweetKey(tweet: any): string {
    return `${tweet.tweetID}`
}

function stringToUint8Array(str: string): Uint8Array {
    const encoder = new TextEncoder();
    return encoder.encode(str);
}

function arrayBufferToBase64(bytes: Uint8Array | ArrayBuffer): string {
    let binary = '';
    const byteArray = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const len = byteArray.byteLength;

    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(byteArray[i]);
    }

    return btoa(binary);
}

function base64ToArrayBuffer(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

function generateUserTweetsMap(limit: number, testRulesOf10?: boolean): UserTweetsMap {
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

        userTweets.set(`user${userId}`, tweets);
    }

    if (testRulesOf10) {
        userTweets.set(`user1`, generateTweets(1, [
            "#gm GM!",
            "#gmgmgm should not work",
            "#gm @someUser",
            "hello my sweet #GM",
            "#Gm people",
            "#gm is never going to stop",
            "#gm crypto will take over",
            "#gm #gm #gm",
            "#gm gm GM",
            "#gm",
            "#gm Sun!",
            "@user use hashtag #gm!",
            "#gm 11",
            "#gm 12"
        ]));

        userTweets.set(`user2`, generateTweets(2, [
            "$gm GM!",
            "$gmgmgm should not work",
            "$gm @someUser",
            "hello my sweet $GM",
            "$Gm people",
            "$gm is never going to stop",
            "$gm crypto will take over",
            "$gm #gm #gm",
            "$gm gm GM",
            "$gm",
            "$gm Sun!",
            "@user use cashtag $gm!",
            "$gm 11",
            "$gm 12"
        ]));
    }

    return userTweets;
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

function generateTweets(userId: number, texts: string[]): Tweet[] {
    let result: Tweet[] = [];
    for (let i = 0; i < texts.length; i++) {
        result.push({
            text: texts[i],
            likesCount: 10,
            author_id: `${userId}`,
            tweet_id: `tweetId${userId}_${i}`
        })
    }

    return result;
}