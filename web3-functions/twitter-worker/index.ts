import {Interface} from "@ethersproject/abi";
import {
    Web3Function,
    Web3FunctionEventContext,
    Web3FunctionStorage,
    Web3FunctionResult
} from "@gelatonetwork/web3-functions-sdk";
import {Contract, ContractRunner, getBytes} from "ethers";
import ky from "ky";
import pLimit from 'p-limit';
import {Web3FunctionResultCallData} from "@gelatonetwork/web3-functions-sdk/dist/lib/types/Web3FunctionResult";
import {use} from "chai";

const ContractABI = [
    {
        "inputs": [
            {
                "components": [
                    {
                        "internalType": "uint64",
                        "name": "userIndex",
                        "type": "uint64"
                    },
                    {
                        "internalType": "uint16",
                        "name": "tweets",
                        "type": "uint16"
                    },
                    {
                        "internalType": "uint16",
                        "name": "hashtagTweets",
                        "type": "uint16"
                    },
                    {
                        "internalType": "uint16",
                        "name": "cashtagTweets",
                        "type": "uint16"
                    },
                    {
                        "internalType": "uint16",
                        "name": "simpleTweets",
                        "type": "uint16"
                    },
                    {
                        "internalType": "uint32",
                        "name": "likes",
                        "type": "uint32"
                    }
                ],
                "internalType": "struct GMTwitterOracle.UserTwitterData[]",
                "name": "userData",
                "type": "tuple[]"
            },
            {
                "internalType": "uint32",
                "name": "mintingDayTimestamp",
                "type": "uint32"
            },
            {
                "components": [
                    {
                        "internalType": "uint64",
                        "name": "startIndex",
                        "type": "uint64"
                    },
                    {
                        "internalType": "uint64",
                        "name": "endIndex",
                        "type": "uint64"
                    },
                    {
                        "internalType": "string",
                        "name": "nextCursor",
                        "type": "string"
                    }
                ],
                "internalType": "struct GMTwitterOracle.Batch[]",
                "name": "batches",
                "type": "tuple[]"
            }
        ],
        "name": "mintCoinsForTwitterUsers",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint64",
                "name": "start",
                "type": "uint64"
            },
            {
                "internalType": "uint16",
                "name": "count",
                "type": "uint16"
            }
        ],
        "name": "getTwitterUsers",
        "outputs": [
            {
                "internalType": "string[]",
                "name": "",
                "type": "string[]"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "uint32",
                "name": "mintingDayTimestamp",
                "type": "uint32"
            },
            {
                "components": [
                    {
                        "internalType": "uint64",
                        "name": "startIndex",
                        "type": "uint64"
                    },
                    {
                        "internalType": "uint64",
                        "name": "endIndex",
                        "type": "uint64"
                    },
                    {
                        "internalType": "string",
                        "name": "nextCursor",
                        "type": "string"
                    }
                ],
                "indexed": false,
                "internalType": "struct GMTwitterOracle.Batch[]",
                "name": "batches",
                "type": "tuple[]"
            }
        ],
        "name": "twitterMintingProcessed",
        "type": "event"
    },
    {
        "inputs": [
            {
                "internalType": "uint32",
                "name": "mintingDayTimestamp",
                "type": "uint32"
            },
            {
                "components": [
                    {
                        "internalType": "uint64",
                        "name": "startIndex",
                        "type": "uint64"
                    },
                    {
                        "internalType": "uint64",
                        "name": "endIndex",
                        "type": "uint64"
                    },
                    {
                        "internalType": "string",
                        "name": "nextCursor",
                        "type": "string"
                    }
                ],
                "internalType": "struct GMTwitterOracle.Batch[]",
                "name": "batches",
                "type": "tuple[]"
            }
        ],
        "name": "logErrorBatches",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getTotalUserCount",
        "outputs": [
            {
                "internalType": "uint64",
                "name": "",
                "type": "uint64"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint32",
                "name": "mintingDayTimestamp",
                "type": "uint32"
            }
        ],
        "name": "finishMinting",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },

];

const userIDFetchLimit = 4000;
const MAX_TWITTER_SEARCH_QUERY_LENGTH = 512;
const KEYWORD = "gm";

Web3Function.onRun(async (context: Web3FunctionEventContext): Promise<Web3FunctionResult> => {
    // Get event log from Web3FunctionEventContext
    const {log, userArgs, multiChainProvider, storage} = context;

    const SearchURL = userArgs.searchURL as string;
    const CONCURRENCY_LIMIT = userArgs.concurrencyLimit as number;

    const bearerToken = await context.secrets.get("TWITTER_BEARER");
    if (!bearerToken)
        return {canExec: false, message: `TWITTER_BEARER not set in secrets`};

    const secretKey = await context.secrets.get("TWITTER_RAPIDAPI_KEY");
    if (!secretKey) {
        throw new Error('Missing TWITTER_RAPIDAPI_KEY environment variable');
    }

    try {
        const provider = multiChainProvider.default() as ContractRunner;

        const smartContract = new Contract(
            userArgs.contractAddress as string,
            ContractABI,
            provider
        );

        const contract = new Interface(ContractABI);
        const event = contract.parseLog(log);


        const {mintingDayTimestamp, batches: initBatches} = event.args;

        console.log('initBatches', initBatches);

        let batches = initBatches.map(item => ({
            startIndex: item.startIndex.toNumber(),
            endIndex: item.endIndex.toNumber(),
            nextCursor: item.nextCursor
        }));

        console.log('');
        console.log('onRun!', mintingDayTimestamp);
        console.log('initStorage', await storage.getKeys());
        console.log('received batches', batches);

        const maxUserIndex = await getMaxUserIndex(smartContract, mintingDayTimestamp, storage);
        const isMintingFinished = await checkMintedLastUserIndex(mintingDayTimestamp, initBatches, maxUserIndex, storage);
        console.log('maxUserIndex', maxUserIndex);
        console.log('isMintingFinished', isMintingFinished);

        if (isMintingFinished) {
            const transactions = await verifyMostLikedTweets(storage, mintingDayTimestamp, smartContract, userArgs.tweetLookupURL as string, bearerToken);
            return {
                canExec: true,
                callData: transactions
            }
        }

        batches = batches.filter(batch => batch.nextCursor != '')
            .sort((a, b) => Number(a.startIndex - b.startIndex));

        console.log('actual batches', batches);

        let {UserIDs, indexOffset} = await syncUserIDs(mintingDayTimestamp, smartContract, storage, batches)
        console.log('indexOffset', indexOffset);

        let queryList: string[] = [];
        for (let i = 0; i < batches.length; i++) {
            const cur = batches[i];
            const localStartIndex = cur.startIndex - indexOffset;
            const localEndIndex = cur.endIndex - indexOffset;

            queryList.push(createUserQueryStringStatic(UserIDs.slice(Number(localStartIndex), Number(localEndIndex)), mintingDayTimestamp, KEYWORD));
        }

        if (batches.length < CONCURRENCY_LIMIT) {
            console.log('generating new batches..');
            const newCursorsCount = CONCURRENCY_LIMIT - batches.length;

            let index = indexOffset;
            for (let i = 0; i < newCursorsCount; i++) {
                const {
                    queryString,
                    lastIndexUsed
                } = createUserQueryString(UserIDs, mintingDayTimestamp, MAX_TWITTER_SEARCH_QUERY_LENGTH, KEYWORD);

                queryList.push(queryString);

                const newBatch: Batch = {
                    startIndex: index,
                    endIndex: index + lastIndexUsed,
                    nextCursor: ''
                }

                index += lastIndexUsed;

                batches.push(newBatch);

                if (UserIDs.length - 1 == lastIndexUsed) {
                    break;
                }
            }
        }

        let userTweetCount: Map<number, number> = new Map<number, number>;

        let tweetsToVerify: Tweet[] = await getTweetsToVerify(mintingDayTimestamp, storage);

        let isNewTweetsToVerify = false;
        const limit = pLimit(CONCURRENCY_LIMIT);
        let errorBatches: any[] = [];
        console.log('batches', batches);
        const results = await Promise.all(
            batches.map((cur, index) =>
                limit(async () => {
                    try {
                        let {
                            tweets,
                            nextCursor
                        } = await fetchTweets(SearchURL, secretKey, queryList[index], cur.nextCursor);

                        console.log('tweets', tweets.length, 'cursor', nextCursor);

                        // we need to verify tweets with >100 likes through official Twitter API
                        let newi = 0;
                        const minLikesCount = tweetsToVerify.length > 0 ? tweetsToVerify[tweetsToVerify.length - 1].likesCount : 0;
                        for (let i = 0; i < tweets.length; i++) {
                            if (tweets[i].likesCount > 100 && tweets[i].likesCount > minLikesCount) {
                                tweetsToVerify.push(tweets[i]);
                                isNewTweetsToVerify = true;


                                // tweets[i].userID
                                tweetsToVerify.sort((a, b) => b.likesCount - a.likesCount);
                                if (tweetsToVerify.length > 300) {
                                    tweets.push(tweetsToVerify[tweetsToVerify.length - 1]);
                                    tweetsToVerify = tweetsToVerify.slice(0, 300);
                                }
                                continue;
                            }

                            tweets[newi] = tweets[i];
                            newi++;
                        }

                        tweets = tweets.slice(0, newi);

                        let results: Result[] = processTweets(indexOffset, UserIDs, tweets);
                        results = results.filter((res): res is Result => res.tweets > 0);

                        batches[index].nextCursor = nextCursor ? nextCursor : '';

                        // Clearing user results with tweets more than 1000 per day - bots or wrong data source
                        newi = 0;
                        for (let i = 0; i < results.length; i++) {
                            const dailyTweetCount = (userTweetCount.get(results[i].userIndex) || 0) + results[i].tweets;
                            userTweetCount.set(results[i].userIndex, dailyTweetCount);
                            if (dailyTweetCount > 2500) {
                                continue;
                            }
                            results[newi] = results[i];
                            newi++;
                        }
                        results = results.slice(0, newi);

                        return results;
                    } catch (error) {
                        errorBatches.push(cur);
                        console.error('error fetching and processing tweets: ', error);
                        return null;
                    }
                })
            )
        );

        if (isNewTweetsToVerify) {
            await saveTweetsToVerify(mintingDayTimestamp, storage, tweetsToVerify);
        }

        const flattenedResults = results.flat().filter((res): res is Result => res !== null);
        const sortedResults = flattenedResults.sort((a, b) => Number(a.userIndex - b.userIndex));

        console.log('sortedResults', sortedResults);

        let transactions: any[] = [];
        if (sortedResults.length > 0) {
            transactions.push({
                to: userArgs.contractAddress as string,
                data: smartContract.interface.encodeFunctionData("mintCoinsForTwitterUsers", [
                    sortedResults,
                    BigInt(mintingDayTimestamp),
                    batches,
                ]),
            })
        }

        if (errorBatches.length > 0) {
            transactions.push({
                to: userArgs.contractAddress as string,
                data: smartContract.interface.encodeFunctionData("logErrorBatches", [
                    BigInt(mintingDayTimestamp),
                    errorBatches,
                ]),
            })
        }

        console.log('sending txs..', transactions.length);
        if (transactions.length > 0) {
            return {
                canExec: true,
                callData: transactions,
            };
        }

        return {
            canExec: false,
            message: 'unexpected behavior',
        };

    } catch (error: any) {
        if (error.code === 'CALL_EXCEPTION' && error.reason) {
            console.log(error);
            console.error(`transaction reverted: ${error.reason}`);
        }

        console.error('Error in twitter-worker:', error);
        return {
            canExec: false,
            message: 'Unexpected error in twitter-worker: ' + error.message,
        };
    }
});

async function verifyMostLikedTweets(storage: w3fStorage, mintingDayTimestamp: number, smartContract: Contract, tweetLookupURL: string, bearerToken: string): Promise<Web3FunctionResultCallData[]> {
    const tweetsToVerify = await getTweetsToVerify(mintingDayTimestamp, storage)
    if (tweetsToVerify.length == 0) {
        // finish minting at all
        const keys = await storage.getKeys();
        for (let i = 0; i < keys.length; i++) {
            if (keys[i].startsWith(`${mintingDayTimestamp}`)) {
                await storage.delete(keys[i]);
            }
        }


        return [
            {
                to: await smartContract.getAddress() as string,
                data: smartContract.interface.encodeFunctionData("finishMinting", [
                    mintingDayTimestamp
                ]),
            }
        ];
    }
    if (tweetsToVerify.length > 0) {
        const tweetIdToUserIndexMap: Map<string, number> = new Map();

        tweetsToVerify.forEach((tweet) => {
            tweetIdToUserIndexMap.set(tweet.tweetID, parseInt(tweet.userID));
        })
        const verifiedTweets = await fetchTweetsInBatches(tweetLookupURL, tweetsToVerify, bearerToken);

        let results: Result[] = [];
        for (let i = 0; i < verifiedTweets.length; i++) {
            const res = calculateTweet({} as Result, verifiedTweets[i].tweetContent, verifiedTweets[i].likesCount);
            res.userIndex = tweetIdToUserIndexMap.get(verifiedTweets[i].tweetID) || 0;
            if (res.userIndex > 0) {
                results.push(res);
            }
        }

        const sortedResults = results.sort((a, b) => Number(a.userIndex - b.userIndex));

        if (sortedResults) {
            return [{
                to: await smartContract.getAddress() as string,
                data: smartContract.interface.encodeFunctionData("mintCoinsForTwitterUsers", [
                    sortedResults,
                    mintingDayTimestamp,
                    [],
                ]),
            }]
        }

    }
}

async function getTweetsToVerify(mintingDayTimestamp: number, storage: w3fStorage): Promise<Tweet[]> {
    return JSON.parse(await storage.get(`${mintingDayTimestamp}_tweetsToVerify`) || '[]') as Tweet[];
}

async function saveTweetsToVerify(mintingDayTimestamp: number, storage: w3fStorage, tweets: Tweet[]) {
    await storage.set(`${mintingDayTimestamp}_tweetsToVerify`, JSON.stringify(tweets));
}

async function checkMintedLastUserIndex(mintingDayTimestamp: number, batches: Batch[], maxUserIndex: number, storage: w3fStorage): Promise<boolean> {
    // check that batch with maxUserIndex was persed
    let mintedLastUserIndexStr = await storage.get(`${mintingDayTimestamp}_isMintedLastUserIndex`);
    if (mintedLastUserIndexStr === undefined) {
        await storage.set(`${mintingDayTimestamp}_isMintedLastUserIndex`, "false");
        return Promise.resolve(false);
    }

    let mintedLastUserIndex = mintedLastUserIndexStr === "true";
    if (!mintedLastUserIndexStr) {
        if (batches.length > 0) {
            if (batches[batches.length - 1].endIndex == maxUserIndex && batches[batches.length - 1].nextCursor == '') {
                mintedLastUserIndex = true;
            }
        }
        await storage.set(`${mintingDayTimestamp}_isMintedLastUserIndex`, mintedLastUserIndex.toString());
    }

    // check that all batches are finished
    for (let i = 0; i < batches.length; i++) {
        if (batches[i].nextCursor != '') {
            return Promise.resolve(false);
        }
    }

    return Promise.resolve(mintedLastUserIndex);
}

async function getMaxUserIndex(smartContract: Contract, mintingDayTimestamp: number, storage: w3fStorage,): Promise<number> {
    let maxUserIndex = parseInt(await storage.get(`${mintingDayTimestamp}_maxUserIndex`) || '0');
    if (maxUserIndex == 0) {
        maxUserIndex = await smartContract.getTotalUserCount();
        await storage.set(`${mintingDayTimestamp}_maxUserIndex`, maxUserIndex.toString());
    }
    return Promise.resolve(maxUserIndex);
}

async function syncUserIDs(mintingDayTimestamp: number, smartContract: Contract, storage: w3fStorage, batches: Batch[]): Promise<{ UserIDs: string[]; indexOffset: number }> {
    console.log('syncUserIDs');
    const lowestStartIndex = batches.reduce((min, batch) => {
        return batch.startIndex < min ? batch.startIndex : min;
    }, 0);

    const highestEndIndex = batches.reduce((max, batch) => {
        return batch.endIndex > max ? batch.endIndex : max;
    }, 0);


    const cachedUserIndexStart = parseInt(await storage.get(`${mintingDayTimestamp}_UserIndexStart`) || '-1');
    const cachedUserIndexEnd = parseInt(await storage.get(`${mintingDayTimestamp}_UserIndexEnd`) || '-1');

    let userIndexOffset = parseInt(await storage.get(`${mintingDayTimestamp}_userIndexOffset`) || '0');

    let userIDs: string[];

    console.log('cacheduserIndexStart', cachedUserIndexStart, "lowestStartIndex", lowestStartIndex, "highestEndIndex", highestEndIndex);
    if (cachedUserIndexStart == -1 || cachedUserIndexEnd < highestEndIndex || cachedUserIndexEnd - highestEndIndex < 400) {
        userIDs = await smartContract.getTwitterUsers(lowestStartIndex, userIDFetchLimit);

        userIndexOffset = lowestStartIndex;
        await storage.set(`${mintingDayTimestamp}_userIndexOffset`, userIndexOffset.toString());

        await storage.set(`${mintingDayTimestamp}_UserIndexStart`, lowestStartIndex.toString());
        await storage.set(`${mintingDayTimestamp}_UserIndexEnd`, (lowestStartIndex + userIDs.length).toString());

        await storage.set(`${mintingDayTimestamp}_userIDs`, JSON.stringify(userIDs));
    } else {
        userIDs = JSON.parse(await storage.get(`${mintingDayTimestamp}_userIDs`) || '[]');
    }

    return Promise.resolve({UserIDs: userIDs, indexOffset: userIndexOffset});
}


function createUserQueryStringStatic(userIDs: string[], mintingDayTimestamp: number, queryPrefix: string): string {
    const untilDayStr = formatDay(mintingDayTimestamp, 1);
    const sinceDayStr = formatDay(mintingDayTimestamp, 0);
    let queryString = `${queryPrefix} since:${sinceDayStr} until:${untilDayStr} AND (`;
    for (let i = 0; i < userIDs.length; i++) {
        if (i > 0) {
            queryString += ` OR `;
        }
        queryString += `from:${userIDs[i]}`;
    }

    queryString += `)`;

    return queryString;
}


/**
 * Function to create a query string from an array of user IDs.
 * @param {string[]} userIDs - Array of user IDs.
 * @param {number} maxLength - Maximum allowed length for the query string (e.g., 512 characters).
 * @param {string} queryPrefix - The initial part of the query string.
 * @returns {string} - The formatted string in the format `(queryPrefix) AND (from:[userID] OR from:[userID])`.
 */
function createUserQueryString(userIDs: string[], mintingDayTimestamp: number, maxLength: number, queryPrefix: string): { queryString: string; lastIndexUsed: number } {
    const untilDayStr = formatDay(mintingDayTimestamp, 1);
    const sinceDayStr = formatDay(mintingDayTimestamp, 0);
    let queryString = `${queryPrefix} since:${sinceDayStr} until:${untilDayStr} AND (`;
    let lastIndexUsed = -1;

    for (let i = 0; i < userIDs.length; i++) {
        const userID = userIDs[i];
        const nextPart = `from:${userID}`;

        if (queryString.length + nextPart.length + 1 + 4 > maxLength) {
            break;
        }

        if (i > 0) {
            queryString += ` OR `;
        }

        queryString += nextPart;
        lastIndexUsed = i;

    }

    queryString += ')';

    // Close the final query string with parentheses
    return {queryString, lastIndexUsed};
}

interface w3fStorage {
    get(key: string): Promise<string | undefined>;

    set(key: string, value: string): Promise<void>;

    delete(key: string): Promise<void>;

    getKeys(): Promise<string[]>;

    getSize(): Promise<number>;
}

interface Batch {
    startIndex: number;
    endIndex: number;
    nextCursor: string;
}

// Define the result structure
interface Result {
    userIndex: number;
    hashtagTweets: number;
    cashtagTweets: number;
    simpleTweets: number;
    tweets: number;
    likes: number;
}

// Function to process tweets and create the result array
function processTweets(indexOffset: number, userIDs: string[], foundTweets: Tweet[]): Result[] {
    let results: Result[] = userIDs.map((value, index) => ({
        hashtagTweets: 0,
        cashtagTweets: 0,
        simpleTweets: 0,
        likes: 0,
        tweets: 0,
        userIndex: index + indexOffset,
    }));

    // Iterate through foundTweets and update the corresponding user's result
    for (const tweet of foundTweets) {
        // console.log('userID', tweet.userID);

        const userIndex = userIDs.indexOf(tweet.userID);

        // If user is found in userIDs
        if (userIndex !== -1) {
            results[userIndex] = calculateTweet(results[userIndex], tweet.tweetContent, tweet.likesCount);
        }
    }

    return results;
}

function calculateTweet(result: Result, tweetContent: string, likesCount: number): Result {
    const foundKeyword = findKeywordWithPrefix(tweetContent, KEYWORD);
    if (foundKeyword == "") {
        return result;
    }

    if (foundKeyword == "$" + KEYWORD) {
        result.cashtagTweets++;
    } else if (foundKeyword == "#" + KEYWORD) {
        result.hashtagTweets++;
    } else if (foundKeyword == KEYWORD) {
        result.simpleTweets++;
    }

    result.tweets++;
    result.likes += likesCount;

    return result;
}

function findKeywordWithPrefix(text: string, keyword: string): string {
    const words = text.split(/\s+/);  // Split by whitespace to get individual words

    let foundWord = "";
    for (const word of words) {
        // Remove punctuation from the word
        const cleanedWord = word.replace(/[.,!?;:()]/g, "").toLowerCase();

        // Check for hashtag tweets
        if (cleanedWord === "$" + KEYWORD) {
            return "$" + KEYWORD;
        }
        // Check for moneytag tweets
        else if (cleanedWord === "#" + KEYWORD && foundWord == "gm") {
            foundWord = "#gm";
        }
        // Check for simple keyword tweets
        else if (cleanedWord === KEYWORD) {
            foundWord = cleanedWord;
        }
    }

    return foundWord;
}


// Define the schema of the tweet result
interface Tweet {
    userIndex: number;
    userID: string;
    tweetID: string;
    tweetContent: string;
    likesCount: number;
    userDescriptionText: string;
}

// Define the response structure from the Twitter API
interface TwitterApiResponse {
    data: {
        search_by_raw_query: {
            search_timeline: {
                timeline: {
                    instructions: Array<{
                        entry?: {
                            content: {
                                cursor_type?: string,
                                value?: string
                            }
                        },
                        entries?: Array<{
                            content: {
                                cursor_type?: string,
                                value?: string,

                                content: {
                                    tweet_results?: {
                                        rest_id: string; // This is the tweetID
                                        result: {
                                            rest_id: string; // This
                                            core: {
                                                user_results: {
                                                    result: {
                                                        rest_id: string; // This is the userID
                                                        profile_bio: {
                                                            description: string;
                                                        };
                                                    };
                                                };
                                            };
                                            legacy: {
                                                full_text: string; // The tweet content
                                                favorite_count: number; // The number of likes
                                                created_at: string;
                                            };
                                        };
                                    };
                                };
                            };
                        }>;
                    }>;
                };
            };
        };
    };
}


// Function to fetch tweets based on a query
async function fetchTweets(searchURL: string, secretKey: string, queryString: string, cursor: string): Promise<{ tweets: Tweet[]; nextCursor?: string }> {
    try {
        // Perform the GET request using ky
        const response = await ky.get(searchURL, {
            headers: {
                'X-Rapidapi-Key': secretKey,
                'X-Rapidapi-Host': 'twitter283.p.rapidapi.com',
            },
            searchParams: {
                q: queryString,
                type: 'Latest',
                count: '20',
                cursor: cursor,
                safe_search: 'false',
            }
        }).json<TwitterApiResponse>();

        const tweets: Tweet[] = [];

        let nextCursor = '';
        // Navigate the response and extract the required tweet information
        const instructions = response.data.search_by_raw_query.search_timeline.timeline.instructions;
        for (const instruction of instructions) {
            if (instruction.entry?.content.cursor_type == "Bottom") {
                nextCursor = instruction.entry?.content.value as string;
                continue;
            }
            for (const entry of instruction.entries) {
                if (entry.content?.cursor_type == "Bottom") {
                    nextCursor = entry.content?.value as string;
                    continue;
                }

                const tweetData = entry.content.content.tweet_results?.result;
                if (tweetData) {
                    const user = tweetData.core.user_results.result;
                    const legacy = tweetData.legacy;

                    const tweet: Tweet = {
                        tweetID: tweetData.rest_id,  // Extract tweetID from rest_id
                        userID: user.rest_id,        // Extract userID from user_results
                        tweetContent: legacy.full_text,  // Extract tweet content
                        likesCount: legacy.favorite_count, // Extract likes count
                        userDescriptionText: user.profile_bio?.description || '', // Extract user bio
                        userIndex: 0,
                    };
                    tweets.push(tweet);
                }
            }
        }

        return {tweets, nextCursor};
    } catch (error) {
        console.error('Error fetching tweets:', error);
        throw error;
    }
}

async function fetchTweetsInBatches(
    twitterURL: string,
    tweets: Tweet[],
    bearerToken: string
): Promise<Tweet[]> {
    const batchSize = 100;
    const batches: Tweet[][] = [];
    const results: Tweet[] = [];

    // Step 1: Group tweets into batches of 100
    for (let i = 0; i < tweets.length; i += batchSize) {
        batches.push(tweets.slice(i, i + batchSize));
    }

    let userIdToUserIndex = new Map<string, number>;
    for (const batch of batches) {
        for (const b of batch) {
            userIdToUserIndex.set(b.userID, b.userIndex);
        }
    }

    // Step 2: Prepare and send parallel requests
    const requests = batches.map(async (batch) => {
        const tweetIDs = batch.map((tweet) => tweet.tweetID).join(',');
        const url = `${twitterURL}?ids=${tweetIDs}&tweet.fields=public_metrics&expansions=author_id&user.fields=description`;


        try {
            const response = await ky
                .get(url, {
                    headers: {
                        Authorization: `Bearer ${bearerToken}`,
                    },
                })
                .json<any>();

            // Step 3: Process the response and map to Tweet interface
            if (response.data && response.includes && response.includes.users) {
                const usersMap = new Map(
                    response.includes.users.map((user: any) => [user.id, user])
                );

                response.data.forEach((tweet: any) => {
                    const user = usersMap.get(tweet.author_id);
                    const userIndex = userIdToUserIndex.get(tweet.author_id)
                    if (user) {
                        results.push({
                            userID: tweet.author_id,
                            tweetID: tweet.id,
                            tweetContent: tweet.text,
                            likesCount: tweet.public_metrics.like_count,
                            userDescriptionText: user.description,
                            userIndex: userIndex,
                        });
                    }
                });
            }
        } catch (error) {
            // Handle errors for this batch
            console.error('Error fetching batch:', error);
        }
    });

    // Step 4: Execute all requests in parallel
    await Promise.all(requests);

    return results;
}

function formatDay(timestamp: number, addDays: number): string {
    // Create a Date object from the timestamp
    const date = new Date(timestamp * 1000);
    if (addDays != 0) {
        date.setDate(date.getDate() + addDays);
    }

    // Use Intl.DateTimeFormat to format the date as "YYYY-MM-DD"
    const formatter = new Intl.DateTimeFormat('en-CA'); // 'en-CA' ensures "YYYY-MM-DD" format
    return formatter.format(date);
}


function bytesStringToString(strBytes: string): string {
    const cursorBytes = getBytes(strBytes);
    let decoder = new TextDecoder("utf-8");
    return decoder.decode(cursorBytes);
}