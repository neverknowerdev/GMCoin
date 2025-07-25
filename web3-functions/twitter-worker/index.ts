import { Interface } from "@ethersproject/abi";
import { Storage } from './storage';
import { Web3Function, Web3FunctionEventContext, Web3FunctionResult } from "@gelatonetwork/web3-functions-sdk";
import { Contract, ContractRunner } from "ethers";
import { Web3FunctionResultCallData } from "@gelatonetwork/web3-functions-sdk/dist/lib/types/Web3FunctionResult";
import { Batch, BatchToString, ContractABI, defaultResult, Result, Tweet, TweetProcessingType } from "./consts";
import { BatchManager } from "./batchManager";
import { TwitterRequester } from "./twitterRequester";
import { SmartContractConnector } from "./smartContractConnector";
import { BatchUploader } from "./batchUploader";
import { CloudwatchLogger } from "./cloudwatch";

const KEYWORD = "gm";
const verifyTweetBatchSize = 300;

Web3Function.onFail(async (context: Web3FunctionFailContext) => {
    const { reason } = context;

    if (reason === "ExecutionReverted") {
        console.log(`onFail: ${reason} txHash: ${context.transactionHash}`);
    } else if (reason === "SimulationFailed") {
        console.log(
            `onFail: ${reason} callData: ${JSON.stringify(context.callData)}`
        );
    } else {
        console.log(`onFail: ${reason}`);
    }
});
Web3Function.onRun(async (context: Web3FunctionEventContext): Promise<Web3FunctionResult> => {
    console.log('onRun');

    const awsAccessKeyID = await context.secrets.get("AWS_ACCESS_KEY_ID");
    if (!awsAccessKeyID) {
        return { canExec: false, message: `Missing AWS_ACCESS_KEY_ID environment variable` };
    }

    const awsSecretAccessKey = await context.secrets.get("AWS_SECRET_ACCESS_KEY");
    if (!awsSecretAccessKey) {
        return { canExec: false, message: `Missing AWS_SECRET_ACCESS_KEY environment variable` };
    }

    const env = await context.secrets.get("ENV") || 'local';

    const logStreamName = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    const logGroupName = env === 'mainnet' ? `TwitterWorkerGelatoLogs-prod` : `TwitterWorkerGelatoLogs`;

    const logger = new CloudwatchLogger({
        region: 'eu-central-1',
        accessKeyId: awsAccessKeyID,
        secretAccessKey: awsSecretAccessKey,
        logGroupName: logGroupName,
        logStreamName: logStreamName,
        bufferSize: 100,
        flushInterval: 0,
        enabled: env !== 'local'
    });

    try {
        const result = await executeTwitterWorker(logger, context);
        if (!result.canExec) {
            logger.error(`result ${JSON.stringify(result)}`);
        } else {
            logger.info(`result.canExec true`);
        }

        await logger.flushAndSend(1);
        return result;
    } catch (error: any) {
        logger.error(`Error in onRun: ${error}`);
        await logger.flushAndSend(1);
        return {
            canExec: false,
            message: 'Unexpected error in onRun: ' + error.message,
        };
    }
});

async function executeTwitterWorker(logger: CloudwatchLogger, context: Web3FunctionEventContext): Promise<Web3FunctionResult> {
    logger.info('Starting Twitter worker execution');

    // Get event log from Web3FunctionEventContext
    const { log, userArgs, multiChainProvider, storage: w3fStorage } = context;

    const CONCURRENCY_LIMIT = userArgs.concurrencyLimit as number;
    const serverURLPrefix = userArgs.serverURLPrefix as string;

    const bearerToken = await context.secrets.get("TWITTER_BEARER");
    if (!bearerToken)
        return { canExec: false, message: `TWITTER_BEARER not set in secrets` };

    const secretKey = await context.secrets.get("TWITTER_OPTIMIZED_SERVER_KEY");
    if (!secretKey) {
        return { canExec: false, message: `Missing TWITTER_OPTIMIZED_SERVER_KEY environment variable` };
    }

    const twitterOptimizedServerHost = userArgs.twitterOptimizedServerHost !== '' ? userArgs.twitterOptimizedServerHost : await context.secrets.get("TWITTER_OPTIMIZED_SERVER_HOST");
    if (!twitterOptimizedServerHost) {
        return { canExec: false, message: `Missing TWITTER_OPTIMIZED_SERVER_HOST environment variable` };
    }

    const twitterOptimizedServerAuthHeaderName = await context.secrets.get("TWITTER_OPTIMIZED_SERVER_AUTH_HEADER_NAME");
    if (!twitterOptimizedServerAuthHeaderName) {
        return { canExec: false, message: `Missing TWITTER_OPTIMIZED_SERVER_AUTH_HEADER_NAME environment variable` };
    }

    const serverApiKey = await context.secrets.get("SERVER_API_KEY");
    if (!serverApiKey) {
        return { canExec: false, message: `Missing SERVER_API_KEY env variable` };
    }

    try {
        const provider = multiChainProvider.default() as unknown as ContractRunner;
        const smartContract = new Contract(
            userArgs.contractAddress as string,
            ContractABI,
            provider
        );

        const contract = new Interface(ContractABI);
        const event = contract.parseLog(log);


        const { mintingDayTimestamp, batches: eventBatches } = event.args;

        let storage = new Storage(w3fStorage, mintingDayTimestamp);

        let twitterRequester = new TwitterRequester({
            OptimizedAPISecretKey: secretKey,
            OfficialBearerToken: bearerToken,
            AuthHeaderName: twitterOptimizedServerAuthHeaderName,
        }, {
            twitterLookupURL: userArgs.tweetLookupURL as string,
            // optimizedServerURLPrefix: twitterOptimizedServerHost as string,
            convertToUsernamesURL: `${twitterOptimizedServerHost}/UserResultsByRestIds`,
            twitterSearchByQueryURL: `${twitterOptimizedServerHost}/Search`,
        });

        let contractConnector = new SmartContractConnector(provider, smartContract, storage, logger);

        let batchManager = new BatchManager(logger, storage, contractConnector, mintingDayTimestamp, CONCURRENCY_LIMIT);

        const initBatches = eventBatches.map((item: any) => ({
            startIndex: item.startIndex.toNumber(),
            endIndex: item.endIndex.toNumber(),
            nextCursor: item.nextCursor,
            errorCount: item.errorCount,
        }));

        let batchUploader = new BatchUploader(mintingDayTimestamp, storage, serverURLPrefix, serverApiKey, logger);
        await batchUploader.loadStateFromStorage();

        logger.info(`received batches:`, BatchToString(initBatches));

        let {
            batchesToProcess,
            queryList,
            userIndexByUsername
        } = await batchManager.generateNewBatches(twitterRequester, mintingDayTimestamp, initBatches);

        logger.info(`userIndexByUsername size:`, userIndexByUsername.size, `content:`, userIndexByUsername);
        logger.info(`generateNewBatches count:`, batchesToProcess.length, `batches:`, BatchToString(batchesToProcess));
        logger.info(`queryList count:`, queryList.length, `queries:`, queryList);

        let transactions: any[] = [];

        let UserResults = await storage.loadUserResults();

        let tweetsToVerify: Tweet[] = await storage.getTweetsToVerify();

        if (batchesToProcess.length > 0) { // process batches
            logger.info(`Processing`, batchesToProcess.length, `batches`);

            // Processing tweets here..
            const {
                tweets,
                batches,
                errorBatches
            } = await twitterRequester.fetchTweetsInBatches(batchesToProcess, queryList, userIndexByUsername);

            batchesToProcess = batches;

            logger.info(`batchesToProcess:`, batchesToProcess.length, `errorBatches:`, errorBatches.length);
            logger.info(`Fetched`, tweets.length, `tweets`);

            let minLikesCount = tweetsToVerify.length > 0 ? tweetsToVerify[tweetsToVerify.length - 1].likesCount : 0;
            let isNewTweetsToVerify = false;
            for (let i = 0; i < tweets.length; i++) {
                const foundKeyword = findKeywordWithPrefix(tweets[i].tweetContent)
                if (foundKeyword == "") {
                    continue;
                }
                logger.info(`tweets[i] ${JSON.stringify(tweets[i])}`);

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

                let result = UserResults.get(tweets[i].userIndex) || { ...defaultResult };
                result.userIndex = tweets[i].userIndex;
                const processingType = calculateTweetByKeyword(result, tweets[i].likesCount, foundKeyword);

                batchUploader.add(tweets[i], processingType);

                if (processingType == TweetProcessingType.Skipped) {
                    logger.warn(`skipping tweet ${tweets[i].tweetID} ${tweets[i].tweetContent}`);
                    continue;
                }

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

            const ongoingBatches = batchesToProcess.concat(errorBatches).filter((b) => b.nextCursor != '');
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

            const uploaded = await batchUploader.uploadToServer();
            if (!uploaded) {
                throw new Error('failed to upload tweets to the server');
            }
            await batchUploader.saveStateToStorage();

            logger.info(`sortedResults ${JSON.stringify(sortedResults)}`);

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
                logger.info(`logErrorBatches ${errorBatches.length}`);
                transactions.push({
                    to: userArgs.contractAddress as string,
                    data: smartContract.interface.encodeFunctionData("logErrorBatches", [
                        BigInt(mintingDayTimestamp),
                        errorBatches,
                    ]),
                })
            }

            logger.info(`sending txs.. ${transactions.length}`);
            logger.info(`transactions ${JSON.stringify(transactions)}`);
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
            logger.info('mintingFinished');

            let transactions: Web3FunctionResultCallData[] = [];
            try {
                if (tweetsToVerify.length > 0) {
                    const verifiedTweets = await twitterRequester.fetchTweetsByIDs(tweetsToVerify);
                    logger.info(`verifiedTweets ${verifiedTweets.length}`);
                    for (let i = 0; i < verifiedTweets.length; i++) {
                        const result = UserResults.get(verifiedTweets[i].userIndex) || { ...defaultResult };

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
                logger.error(`Error fetching batch for verifyTweets: ${error}`);

                return {
                    canExec: false,
                    message: `error during verifying tweets: ${error}`
                }
            }

            const finalHash = batchUploader.getRunningHash();
            logger.info(`finalHash ${finalHash}`);

            const uploaded = await batchUploader.uploadToServer();
            if (!uploaded) {
                throw new Error('failed to SaveTweets (verifiedTweets) to the server');
            }

            // don't wait for response, cauze it take too long to complete (like 30-60 secs)
            batchUploader.sendUploadToIPFSRequest();
            // wait for 1 sec
            await new Promise(f => setTimeout(f, 1000));

            // finish minting at all
            await storage.clearAll();

            transactions.push({
                to: await smartContract.getAddress() as string,
                data: smartContract.interface.encodeFunctionData("finishMinting", [
                    BigInt(mintingDayTimestamp),
                    finalHash
                ]),
            });

            logger.info(`transactions to send ${JSON.stringify(transactions)}`);

            return {
                canExec: true,
                callData: transactions
            }
        }

        return {
            canExec: false,
            message: 'No batches to process and minting not finished',
        };

    } catch (error: any) {
        if (error.code === 'CALL_EXCEPTION' && error.reason) {
            logger.error(error);
            logger.error(`transaction reverted: ${error.reason}`);
        }

        logger.error(`Error in twitter-worker: ${error}`);
        return {
            canExec: false,
            message: 'Unexpected error in twitter-worker: ' + error.message,
        };
    }
}

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
        default:
            return processingType
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