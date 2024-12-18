import {Interface} from "@ethersproject/abi";
import {
    Web3Function,
    Web3FunctionEventContext,
    Web3FunctionStorage,
    Web3FunctionResult
} from "@gelatonetwork/web3-functions-sdk";
import {Contract, ContractRunner, getBytes} from "ethers";
import ky from "ky";
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

const MAX_TWITTER_SEARCH_QUERY_LENGTH = 512;
const KEYWORD = "gm";

Web3Function.onRun(async (context: Web3FunctionEventContext): Promise<Web3FunctionResult> => {
    // Get event log from Web3FunctionEventContext
    console.log('running..');
    const {log, userArgs, multiChainProvider, storage} = context;

    const SearchURL = userArgs.searchURL as string;
    const CONCURRENCY_LIMIT = userArgs.concurrencyLimit as number;
    const UserIDFetchLimit = userArgs.userIdFetchLimit as number;

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

        let batches = initBatches.map(item => ({
            startIndex: item.startIndex.toNumber(),
            endIndex: item.endIndex.toNumber(),
            nextCursor: item.nextCursor
        }));

        console.log(' ');
        console.log(' ');
        console.log(' ');
        console.log('onRun!', mintingDayTimestamp);
        console.log('received batches', batches);

        batches = batches.filter(batch => batch.nextCursor != '')
            .sort((a, b) => Number(a.startIndex - b.startIndex));

        let userIndexByUserID: Map<string, number> = new Map();

        let queryList: string[] = [];
        for (let i = 0; i < batches.length; i++) {
            const cur = batches[i];

            // cache userIDs for batches
            // fetch them here
            const batchUserIDs = await getUserIDsForBatch(storage, mintingDayTimestamp, cur.startIndex, cur.endIndex);
            const generatedQuery = createUserQueryStringStatic(batchUserIDs, mintingDayTimestamp, KEYWORD);
            queryList.push(generatedQuery);
            fillUserIndexByUserId(userIndexByUserID, batchUserIDs, cur.startIndex);
        }

        if (batches.length < CONCURRENCY_LIMIT) {
            console.log('generating new batches and queries..');
            const newCursorsCount = CONCURRENCY_LIMIT - batches.length;

            const maxEndIndex = await getMaxEndIndex(mintingDayTimestamp, storage);
            let startIndex = maxEndIndex;

            let remainingUserIDs = await getNextUserIDs(storage, smartContract, mintingDayTimestamp, UserIDFetchLimit, startIndex, newCursorsCount * 50);
            for (let i = 0; i < newCursorsCount; i++) {
                if (remainingUserIDs.length == 0) {
                    break;
                }

                const {
                    queryString,
                    recordInsertedCount
                } = createUserQueryString(remainingUserIDs, mintingDayTimestamp, MAX_TWITTER_SEARCH_QUERY_LENGTH, KEYWORD);

                if (recordInsertedCount == 0) {
                    break;
                }

                queryList.push(queryString);

                const newBatch: Batch = {
                    startIndex: startIndex,
                    endIndex: startIndex + recordInsertedCount,
                    nextCursor: ''
                }

                if (newBatch.endIndex > maxEndIndex) {
                    await saveMaxEndIndex(mintingDayTimestamp, storage, newBatch.endIndex);
                }

                startIndex += recordInsertedCount;

                batches.push(newBatch);

                const batchUserIDs = remainingUserIDs.slice(0, recordInsertedCount);
                await fillUserIndexByUserId(userIndexByUserID, batchUserIDs, newBatch.startIndex);

                await setUserIDsForBatch(storage, mintingDayTimestamp, newBatch.startIndex, newBatch.endIndex, batchUserIDs);

                remainingUserIDs = remainingUserIDs.slice(recordInsertedCount);
            }


            await saveRemainingUserIDs(storage, mintingDayTimestamp, remainingUserIDs);
            console.log('newBatches', batches);
        }

        let UserResults = await loadUserResults(storage, mintingDayTimestamp);

        const isMintingFinished = batches.length == 0;
        if (isMintingFinished) {
            console.log('mintingFinished');
            let transactions: Web3FunctionResultCallData[] = [];
            const verifyMostLikedTweetsTransactions = await verifyMostLikedTweets(storage, mintingDayTimestamp, UserResults, smartContract, userArgs.tweetLookupURL as string, bearerToken);
            if (verifyMostLikedTweetsTransactions && verifyMostLikedTweetsTransactions.length > 0) {
                transactions.push(...verifyMostLikedTweetsTransactions);
            }

            transactions.push({
                to: await smartContract.getAddress() as string,
                data: smartContract.interface.encodeFunctionData("finishMinting", [
                    mintingDayTimestamp
                ]),
            });

            // finish minting at all
            const keys = await storage.getKeys();
            for (let i = 0; i < keys.length; i++) {
                if (keys[i].startsWith(`${mintingDayTimestamp}`)) {
                    await storage.delete(keys[i]);
                }
            }

            return {
                canExec: true,
                callData: transactions
            }
        }

        let tweetsToVerify: Tweet[] = await getTweetsToVerify(mintingDayTimestamp, storage);

        let isNewTweetsToVerify = false;
        let errorBatches: any[] = [];
        await Promise.all(
            batches.map(async (cur, index) => {
                    try {
                        let {
                            tweets,
                            nextCursor
                        } = await fetchTweets(SearchURL, secretKey, queryList[index], cur.nextCursor);

                        console.log('tweets', tweets.length, 'cursor', nextCursor);

                        batches[index].nextCursor = '';
                        if (tweets.length > 0 && nextCursor != '') {
                            batches[index].nextCursor = nextCursor
                        }

                        // we need to verify tweets with >100 likes through official Twitter API
                        let newi = 0;
                        let minLikesCount = tweetsToVerify.length > 0 ? tweetsToVerify[tweetsToVerify.length - 1].likesCount : 0;
                        for (let i = 0; i < tweets.length; i++) {
                            const foundKeyword = findKeywordWithPrefix(tweets[i].tweetContent)
                            if (foundKeyword == "") {
                                continue;
                            }

                            const userIndex = tweets[i].userIndex || userIndexByUserID.get(tweets[i].userID);
                            if (userIndex === undefined) {
                                console.error("not found userIndex!!", userIndex, tweets[i].userID);
                                continue;
                            }

                            tweets[i].userIndex = userIndex;

                            if (tweets[i].likesCount > 100 && tweets[i].likesCount > minLikesCount) {
                                tweetsToVerify.push(tweets[i]);
                                isNewTweetsToVerify = true;

                                tweetsToVerify.sort((a, b) => b.likesCount - a.likesCount);
                                if (tweetsToVerify.length > 300) {
                                    tweets.push(...tweetsToVerify.slice(300));
                                    tweetsToVerify = tweetsToVerify.slice(0, 300);
                                }
                                minLikesCount = tweetsToVerify[tweetsToVerify.length - 1].likesCount;
                                continue;
                            }

                            tweets[newi] = tweets[i];
                            newi++;
                        }

                        tweets = tweets.slice(0, newi);

                        processTweets(UserResults, cur.startIndex, cur.endIndex, tweets);
                    } catch (error) {
                        errorBatches.push(cur);
                        console.error('error fetching and processing tweets: ', error);
                        return null;
                    }
                }
            )
        );

        if (isNewTweetsToVerify) {
            await saveTweetsToVerify(mintingDayTimestamp, storage, tweetsToVerify);
        }

        let ongoingBatches = batches.filter((b) => b.nextCursor != '');
        let results: Result[] = [];

        let userIdUnderVerification: Map<number, boolean> = new Map();
        for (const tweet of tweetsToVerify) {
            userIdUnderVerification.set(tweet.userIndex, true);
        }

        let allUserIndexes = Array.from(UserResults.keys()).sort((a, b) => a - b);
        for (const userIndex of allUserIndexes) {
            if (userIdUnderVerification.get(userIndex) === true) {
                continue;
            }

            let isOngoingBatch = false;
            for (const batch of ongoingBatches) {
                if (batch.startIndex < userIndex && userIndex < batch.endIndex) {
                    isOngoingBatch = true;
                    break;
                }
            }

            if (isOngoingBatch) {
                continue;
            }

            const res = UserResults.get(userIndex) as Result;
            if (res.tweets < 1000) {
                results.push(res);
            }
            UserResults.delete(userIndex);
        }

        let finishedBatches = batches.filter((b) => b.nextCursor == '');
        for (const finishedBatch of finishedBatches) {
            await clearBatchData(storage, mintingDayTimestamp, finishedBatch);
        }

        await saveUserResults(storage, mintingDayTimestamp, UserResults);
        const sortedResults = results.sort((a, b) => Number(a.userIndex - b.userIndex));

        console.log('newBatches', batches);
        // console.log('sortedResults', sortedResults);

        let transactions: any[] = [];
        if (sortedResults.length > 0 || batches.length > 0) {
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

async function verifyMostLikedTweets(storage: w3fStorage, mintingDayTimestamp: number, userResults: Map<number, Result>, smartContract: Contract, tweetLookupURL: string, bearerToken: string): Promise<Web3FunctionResultCallData[]> {
    const tweetsToVerify = await getTweetsToVerify(mintingDayTimestamp, storage)
    if (tweetsToVerify.length > 0) {
        const verifiedTweets = await fetchTweetsInBatches(tweetLookupURL, tweetsToVerify, bearerToken);

        for (let i = 0; i < verifiedTweets.length; i++) {
            const result = userResults.get(verifiedTweets[i].userIndex) || {...defaultResult};

            const res = calculateTweet(result, verifiedTweets[i].tweetContent, verifiedTweets[i].likesCount);
            userResults.set(verifiedTweets[i].userIndex, res);
        }

        let results: Result[] = [];
        for (let [userIndex, result] of userResults) {
            result.userIndex = userIndex;
            results.push(result);
        }

        const sortedResults = results.sort((a, b) => Number(a.userIndex - b.userIndex));

        if (sortedResults) {
            return [
                {
                    to: await smartContract.getAddress() as string,
                    data: smartContract.interface.encodeFunctionData("mintCoinsForTwitterUsers", [
                        sortedResults,
                        mintingDayTimestamp,
                        [],
                    ]),
                },
            ]
        }

    }
}

async function getTweetsToVerify(mintingDayTimestamp: number, storage: w3fStorage): Promise<Tweet[]> {
    return JSON.parse(await storage.get(`${mintingDayTimestamp}_tweetsToVerify`) || '[]') as Tweet[];
}

async function saveTweetsToVerify(mintingDayTimestamp: number, storage: w3fStorage, tweets: Tweet[]) {
    await storage.set(`${mintingDayTimestamp}_tweetsToVerify`, JSON.stringify(tweets));
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
function createUserQueryString(userIDs: string[], mintingDayTimestamp: number, maxLength: number, queryPrefix: string): {
    queryString: string;
    recordInsertedCount: number
} {
    const untilDayStr = formatDay(mintingDayTimestamp, 1);
    const sinceDayStr = formatDay(mintingDayTimestamp, 0);
    let queryString = `${queryPrefix} since:${sinceDayStr} until:${untilDayStr} AND (`;
    let recordInsertedCount = 0;

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
        recordInsertedCount++;

    }

    queryString += ')';

    // Close the final query string with parentheses
    return {queryString, recordInsertedCount};
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

const defaultResult: Result = {
    userIndex: 0,
    hashtagTweets: 0,
    cashtagTweets: 0,
    simpleTweets: 0,
    tweets: 0,
    likes: 0,
};

// Function to process tweets and create the result array
function processTweets(userResults: Map<number, Result>, startIndex: number, endIndex: number, foundTweets: Tweet[]) {
    // let resultsByUserIndex: Map<number, Result> = new Map();

    // Iterate through foundTweets and update the corresponding user's result
    for (const tweet of foundTweets) {
        let result = userResults.get(tweet.userIndex) || {...defaultResult};
        result.userIndex = tweet.userIndex;
        const newResult = calculateTweet(result, tweet.tweetContent, tweet.likesCount);
        userResults.set(tweet.userIndex, newResult);
    }
}

function calculateTweet(result: Result, tweetContent: string, likesCount: number): Result {
    const foundKeyword = findKeywordWithPrefix(tweetContent);
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

function findKeywordWithPrefix(text: string): string {
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
        else if (cleanedWord === "#" + KEYWORD) {
            foundWord = "#gm";
        }
        // Check for simple keyword tweets
        else if (cleanedWord === KEYWORD && foundWord == "") {
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

                                content?: {
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
                                                        core: {
                                                            name: string;
                                                            screen_name: string;
                                                        }
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
async function fetchTweets(searchURL: string, secretKey: string, queryString: string, cursor: string): Promise<{
    tweets: Tweet[];
    nextCursor?: string
}> {
    try {
        // Perform the GET request using ky
        const response = await ky.get(searchURL, {
            timeout: 3000,
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

        // console.log('fetchTweets queryString', queryString);
        // console.log('fetchTweets response', JSON.stringify(response));


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

                if (entry.content.content?.tweet_results) {
                    const tweetData = entry.content.content.tweet_results?.result;
                    if (tweetData) {
                        const user = tweetData.core.user_results.result;
                        const legacy = tweetData.legacy;

                        const tweet: Tweet = {
                            tweetID: tweetData.rest_id,  // Extract tweetID from rest_id
                            userID: user.rest_id, // Extract userID from user_results
                            tweetContent: legacy.full_text,  // Extract tweet content
                            likesCount: legacy.favorite_count, // Extract likes count
                            userDescriptionText: user.profile_bio?.description || '', // Extract user bio
                            userIndex: 0,
                        };
                        tweets.push(tweet);
                    }
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
        for (const tweet of batch) {
            userIdToUserIndex.set(tweet.userID, tweet.userIndex);
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
            if (response.data) {
                response.data.forEach((tweet: any) => {
                    const userIndex = userIdToUserIndex.get(tweet.author_id);

                    results.push({
                        userID: tweet.author_id,
                        tweetID: tweet.id,
                        tweetContent: tweet.text,
                        likesCount: tweet.public_metrics.like_count,
                        userDescriptionText: "",
                        userIndex: userIndex,
                    });
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


async function saveMaxEndIndex(mintingDayTimestamp: number, storage: w3fStorage, maxIndex: number) {
    await storage.set(`${mintingDayTimestamp}_maxEndIndex`, maxIndex.toString());
}

async function getMaxEndIndex(mintingDayTimestamp: number, storage: w3fStorage): Promise<number> {
    return Promise.resolve(parseInt(await storage.get(`${mintingDayTimestamp}_maxEndIndex`) || '0'));
}

async function setUserIDsForBatch(storage: w3fStorage, mintingDayTimestamp: number, startIndex: number, endIndex: number, userIDs: string[]) {
    await storage.set(`${mintingDayTimestamp}_userIDForBatch_${startIndex}:${endIndex}`, JSON.stringify(userIDs));
}

async function getUserIDsForBatch(storage: w3fStorage, mintingDayTimestamp: number, startIndex: number, endIndex: number): Promise<string[]> {
    const res: string[] = JSON.parse(await storage.get(`${mintingDayTimestamp}_userIDForBatch_${startIndex}:${endIndex}`) || '[]');
    return Promise.resolve(res);
}

async function getNextUserIDs(storage: w3fStorage, smartContract: Contract, mintingDayTimestamp: number, fetchLimit: number, startIndex: number, minGap: number): Promise<string[]> {
    let userIDs = JSON.parse(await storage.get(`${mintingDayTimestamp}_nextUserIDs`) || '[]')

    let newRecordsStartIndex = 0;
    if (userIDs.length < minGap) {
        // fetch new userIDs
        let isFetchedLastUser = await storage.get(`${mintingDayTimestamp}_isFetchedLastUserIndex`) == 'true';
        if (isFetchedLastUser) {
            return userIDs;
        }

        console.log('fetching new UserIDs from smart-contract..', startIndex, fetchLimit);

        userIDs = await smartContract.getTwitterUsers(startIndex, fetchLimit);

        await saveRemainingUserIDs(storage, mintingDayTimestamp, userIDs)

        if (userIDs.length < fetchLimit) {
            await storage.set(`${mintingDayTimestamp}_isFetchedLastUserIndex`, 'true');
        }
    }

    return userIDs;
}

async function saveRemainingUserIDs(storage: w3fStorage, mintingDayTimestamp: number, userIDs: string[]) {
    await storage.set(`${mintingDayTimestamp}_nextUserIDs`, JSON.stringify(userIDs));
}

function fillUserIndexByUserId(userIndexByUserID: Map<string, number>, batchUserIDs: string[], startIndex: number) {
    for (let i = 0; i < batchUserIDs.length; i++) {
        userIndexByUserID.set(batchUserIDs[i], startIndex + i);
    }
}


async function loadUserResults(storage: w3fStorage, mintingDayTimestamp: number): Promise<Map<number, Result>> {
    const array = JSON.parse(await storage.get(`${mintingDayTimestamp}_userResults`) || '[]');
    return new Map<number, Result>(array)
}

async function saveUserResults(storage: w3fStorage, mintingDayTimestamp: number, userResults: Map<number, Result>) {
    const array = Array.from(userResults.entries()); // Convert Map to array of key-value pairs
    await storage.set(`${mintingDayTimestamp}_userResults`, JSON.stringify(array));
}

async function clearBatchData(storage: w3fStorage, mintingDayTimestamp: number, batch: Batch) {
    await storage.delete(`${mintingDayTimestamp}_userIDForBatch_${batch.startIndex}:${batch.endIndex}`);
}