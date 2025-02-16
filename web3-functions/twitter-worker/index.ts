import {Interface} from "@ethersproject/abi";
import {Storage} from './storage';
import {Web3Function, Web3FunctionEventContext, Web3FunctionResult} from "@gelatonetwork/web3-functions-sdk";
import {Contract, ContractRunner} from "ethers";
import {Web3FunctionResultCallData} from "@gelatonetwork/web3-functions-sdk/dist/lib/types/Web3FunctionResult";
import {ContractABI, defaultResult, Result, Tweet, TweetProcessingType} from "./consts";
import {BatchManager} from "./batchManager";
import {TwitterRequester} from "./twitterRequester";
import {SmartContractConnector} from "./smartContractConnector";
import {BatchUploader} from "./batchUploader";

const KEYWORD = "gm";
const verifyTweetBatchSize = 300;

Web3Function.onRun(async (context: Web3FunctionEventContext): Promise<Web3FunctionResult> => {
    // Get event log from Web3FunctionEventContext
    console.log('running..');
    const {log, userArgs, multiChainProvider, storage: w3fStorage} = context;

    const SearchURL = userArgs.searchURL as string;
    const CONCURRENCY_LIMIT = userArgs.concurrencyLimit as number;
    const ConvertToUsernamesURL = userArgs.convertToUsernamesURL as string;
    const serverSaveTweetsURL = userArgs.serverSaveTweetsURL as string;

    const bearerToken = await context.secrets.get("TWITTER_BEARER");
    if (!bearerToken)
        return {canExec: false, message: `TWITTER_BEARER not set in secrets`};

    const secretKey = await context.secrets.get("TWITTER_RAPIDAPI_KEY");
    if (!secretKey) {
        throw new Error('Missing TWITTER_RAPIDAPI_KEY environment variable');
    }

    const serverApiKey = await context.secrets.get("SERVER_API_KEY");
    if (!serverApiKey) {
        throw new Error('Missing SERVER_API_KEY env variable');
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


        const {mintingDayTimestamp, batches: eventBatches} = event.args;

        let storage = new Storage(w3fStorage, mintingDayTimestamp);

        let twitterRequester = new TwitterRequester({
            OptimizedAPISecretKey: secretKey,
            OfficialBearerToken: bearerToken,
        }, {
            convertToUsernamesURL: ConvertToUsernamesURL,
            twitterLookupURL: userArgs.tweetLookupURL as string,
            twitterSearchByQueryURL: SearchURL
        });

        let contractConnector = new SmartContractConnector(provider, smartContract, storage);

        let batchManager = new BatchManager(storage, contractConnector, mintingDayTimestamp, CONCURRENCY_LIMIT);

        const initBatches = eventBatches.map(item => ({
            startIndex: item.startIndex.toNumber(),
            endIndex: item.endIndex.toNumber(),
            nextCursor: item.nextCursor,
            errorCount: item.errorCount,
        }));

        let batchUploader = new BatchUploader(mintingDayTimestamp, storage, serverSaveTweetsURL, serverApiKey);
        await batchUploader.loadStateFromStorage();

        console.log(' ');
        console.log(' ');
        console.log(' ');
        console.log('onRun!', mintingDayTimestamp);
        console.log('received batches', initBatches);

        let {
            batchesToProcess,
            queryList,
            userIndexByUsername
        } = await batchManager.generateNewBatches(twitterRequester, mintingDayTimestamp, initBatches);

        console.log('batchesToProcess', batchesToProcess.length, batchesToProcess);

        let transactions: any[] = [];

        let UserResults = await storage.loadUserResults();

        let tweetsToVerify: Tweet[] = await storage.getTweetsToVerify();

        if (batchesToProcess.length > 0) { // process batches
            // Processing tweets here..
            const {
                tweets,
                batches,
                errorBatches
            } = await twitterRequester.fetchTweetsInBatches(batchesToProcess, queryList, userIndexByUsername);

            batchesToProcess = batches;

            console.log('batchesToProcess', batchesToProcess.length);
            console.log('tweets fetched', tweets.length);

            let minLikesCount = tweetsToVerify.length > 0 ? tweetsToVerify[tweetsToVerify.length - 1].likesCount : 0;
            let isNewTweetsToVerify = false;
            for (let i = 0; i < tweets.length; i++) {
                const foundKeyword = findKeywordWithPrefix(tweets[i].tweetContent)
                if (foundKeyword == "") {
                    continue;
                }

                // add to verifyTweets only tweets with more that 100 likes and more that the last element(with least likes) in tweetsToVerify array
                if (tweets[i].likesCount > 100 && tweets[i].likesCount > minLikesCount) {
                    tweetsToVerify.push(tweets[i]);
                    isNewTweetsToVerify = true;

                    tweetsToVerify.sort((a, b) => b.likesCount - a.likesCount);
                    if (tweetsToVerify.length > verifyTweetBatchSize) {
                        tweets.push(...tweetsToVerify.slice(verifyTweetBatchSize));
                        tweetsToVerify = tweetsToVerify.slice(0, verifyTweetBatchSize);
                    }
                    minLikesCount = tweetsToVerify[tweetsToVerify.length - 1].likesCount;
                    continue;
                }

                let result = UserResults.get(tweets[i].userIndex) || {...defaultResult};
                result.userIndex = tweets[i].userIndex;
                const processingType = calculateTweetByKeyword(result, tweets[i].likesCount, foundKeyword);
                batchUploader.add(tweets[i], processingType);

                if (processingType == TweetProcessingType.Skipped) {
                    continue;
                }

                console.log(`newResult for userIndex ${tweets[i].userIndex} userID ${tweets[i].username}`);
                UserResults.set(tweets[i].userIndex, result);
            }

            if (isNewTweetsToVerify) {
                await storage.saveTweetsToVerify(tweetsToVerify);
            }

            let results: Result[] = [];

            let userIndexesUnderVerification: Map<number, boolean> = new Map();
            for (const tweet of tweetsToVerify) {
                userIndexesUnderVerification.set(tweet.userIndex, true);
            }

            let allUserIndexes = Array.from(UserResults.keys()).sort((a, b) => a - b);

            const ongoingBatches = batchesToProcess.filter((b) => b.nextCursor != '');
            for (const userIndex of allUserIndexes) {
                if (userIndexesUnderVerification.get(userIndex) === true) {
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

            const finishedBatches = batchesToProcess.filter((b) => b.nextCursor == '');
            for (const finishedBatch of finishedBatches) {
                await storage.clearBatchData(finishedBatch);
            }

            await storage.saveUserResults(UserResults);
            const sortedResults = results.sort((a, b) => Number(a.userIndex - b.userIndex));

            const runningHash = batchUploader.getRunningHash();
            console.log('runningHash', runningHash);

            const uploaded = await batchUploader.uploadToServer();
            if (!uploaded) {
                throw new Error('failed to upload tweets to the server');
            }
            await batchUploader.saveStateToStorage();

            console.log('newBatches', batchesToProcess);
            console.log('sortedResults', sortedResults.length);

            // retry errored batches that has less that 3 retries
            const batchesToRetry = errorBatches.filter((b) => b.errorCount < 3);
            const errorBatchesToLog = errorBatches.filter((b) => b.errorCount >= 3);

            if (batchesToRetry.length > 0) {
                batchesToProcess.push(...batchesToRetry);
            }

            if (sortedResults.length > 0 || batchesToProcess.length > 0) {
                transactions.push({
                    to: userArgs.contractAddress as string,
                    data: smartContract.interface.encodeFunctionData("mintCoinsForTwitterUsers", [
                        sortedResults,
                        BigInt(mintingDayTimestamp),
                        batchesToProcess,
                    ]),
                })
            }
            if (errorBatchesToLog.length > 0) {
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
        }
        // minting finished
        if (batchesToProcess.length == 0) {
            console.log('mintingFinished');

            let transactions: Web3FunctionResultCallData[] = [];
            try {
                const verifiedTweets = await twitterRequester.fetchTweetsByIDs(tweetsToVerify);
                console.log('verifiedTweets', verifiedTweets.length);
                for (let i = 0; i < verifiedTweets.length; i++) {
                    const result = UserResults.get(verifiedTweets[i].userIndex) || {...defaultResult};

                    let tweetProcessResult = calculateTweetByKeyword(result, verifiedTweets[i].likesCount, findKeywordWithPrefix(verifiedTweets[i].tweetContent));
                    batchUploader.add(verifiedTweets[i], tweetProcessResult);
                    if (tweetProcessResult == TweetProcessingType.Skipped) {
                        continue;
                    }

                    if (!result.userIndex) {
                        result.userIndex = verifiedTweets[i].userIndex;
                    }
                    UserResults.set(verifiedTweets[i].userIndex, result);
                }

                const results = [...UserResults.values()].sort((a, b) => Number(a.userIndex - b.userIndex));

                if (results && results.length > 0) {
                    transactions.push(
                        {
                            to: await smartContract.getAddress() as string,
                            data: smartContract.interface.encodeFunctionData("mintCoinsForTwitterUsers", [
                                results,
                                BigInt(mintingDayTimestamp),
                                [],
                            ]),
                        },
                    )
                }
            } catch (error) {
                // Handle errors for this batch
                console.error('Error fetching batch for verifyTweets:', error);

                return {
                    canExec: false,
                    message: `error during verifying tweets: ${error}`
                }
            }

            const finalHash = batchUploader.getRunningHash();
            console.log('finalHash', finalHash);

            const uploaded = await batchUploader.uploadToServer();
            if (!uploaded) {
                throw new Error('failed to SaveTweets (verifiedTweets) to the server');
            }

            // finish minting at all
            await storage.clearAll();

            transactions.push({
                to: await smartContract.getAddress() as string,
                data: smartContract.interface.encodeFunctionData("finishMinting", [
                    BigInt(mintingDayTimestamp),
                    finalHash
                ]),
            });


            console.log('return transactions', transactions.length);

            return {
                canExec: true,
                callData: transactions
            }
        }

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

function calculateTweetByKeyword(result: Result, likesCount: number, keyword: string): TweetProcessingType {
    let processingType = TweetProcessingType.Skipped;

    if (keyword == "") {
        return processingType;
    }

    // limit 10 hashtag/cashtag per day per user
    if (keyword == "$" + KEYWORD && result.cashtagTweets < 10) {
        processingType = TweetProcessingType.Cashtag;
    } else if (keyword == "#" + KEYWORD && result.hashtagTweets < 10) {
        processingType = TweetProcessingType.Hashtag;
    } else if (keyword == KEYWORD) {
        processingType = TweetProcessingType.Simple;
    }

    if (processingType == TweetProcessingType.Skipped) {
        return processingType;
    }

    switch (processingType) {
        case TweetProcessingType.Simple:
            result.simpleTweets++;
            break;
        case TweetProcessingType.Hashtag:
            result.hashtagTweets++;
            break;
        case TweetProcessingType.Cashtag:
            result.cashtagTweets++;
            break;

    }

    result.tweets++;
    result.likes += likesCount;

    return processingType;
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