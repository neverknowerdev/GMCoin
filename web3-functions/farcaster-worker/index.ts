import { Interface } from "@ethersproject/abi";
import { Storage } from './storage';
import { Web3Function, Web3FunctionEventContext, Web3FunctionResult } from "@gelatonetwork/web3-functions-sdk";
import { Contract, ContractRunner } from "ethers";
import { Web3FunctionResultCallData } from "@gelatonetwork/web3-functions-sdk/dist/lib/types/Web3FunctionResult";
import { Batch, BatchToString, ContractABI, defaultResult, Result, Cast, CastProcessingType } from "./consts";
import { BatchManager } from "./batchManager";
import { FarcasterRequester } from "./farcasterRequester";
import { SmartContractConnector } from "./smartContractConnector";
import { BatchUploader } from "./batchUploader";
import { CloudwatchLogger } from "../twitter-worker/cloudwatch";

const KEYWORD = "gm";
const verifyCastBatchSize = 300;

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
    console.log('onRun - Farcaster Worker');

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

    const logGroupName = env === 'mainnet' ? `FarcasterWorkerGelatoLogs-prod` : `FarcasterWorkerGelatoLogs`;

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
        const result = await executeFarcasterWorker(logger, context);
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

async function executeFarcasterWorker(logger: CloudwatchLogger, context: Web3FunctionEventContext): Promise<Web3FunctionResult> {
    logger.info('Starting Farcaster worker execution');

    // Get event log from Web3FunctionEventContext
    const { log, userArgs, multiChainProvider, storage: w3fStorage } = context;

    const CONCURRENCY_LIMIT = userArgs.concurrencyLimit as number;
    const serverURLPrefix = userArgs.serverURLPrefix as string;

    const neynarAPIKey = await context.secrets.get("NEYNAR_API_KEY");
    if (!neynarAPIKey)
        return { canExec: false, message: `NEYNAR_API_KEY not set in secrets` };

    const serverApiKey = await context.secrets.get("SERVER_API_KEY");
    if (!serverApiKey) {
        return { canExec: false, message: `Missing SERVER_API_KEY env variable` };
    }

    const neynarFeedURL = userArgs.neynarFeedURL as string || 'https://api.neynar.com/v2/farcaster/feed/';

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

        let farcasterRequester = new FarcasterRequester({
            NeynarAPIKey: neynarAPIKey,
        }, {
            neynarFeedURL: neynarFeedURL,
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
            fidBatches,
            userIndexByFID
        } = await batchManager.generateNewBatches(farcasterRequester, mintingDayTimestamp, initBatches);

        logger.info(`userIndexByFID size:`, userIndexByFID.size, `content:`, userIndexByFID);
        logger.info(`generateNewBatches count:`, batchesToProcess.length, `batches:`, BatchToString(batchesToProcess));
        logger.info(`fidBatches count:`, fidBatches.length, `batches:`, fidBatches);

        let transactions: any[] = [];

        let UserResults = await storage.loadUserResults();

        let castsToVerify: Cast[] = await storage.getCastsToVerify();

        if (batchesToProcess.length > 0) { // process batches
            logger.info(`Processing`, batchesToProcess.length, `batches`);

            // Processing casts here..
            const {
                casts,
                batches,
                errorBatches
            } = await farcasterRequester.fetchCastsInBatches(batchesToProcess, fidBatches, userIndexByFID);

            batchesToProcess = batches;

            logger.info(`batchesToProcess:`, batchesToProcess.length, `errorBatches:`, errorBatches.length);
            logger.info(`Fetched`, casts.length, `casts`);

            let minLikesCount = castsToVerify.length > 0 ? castsToVerify[castsToVerify.length - 1].likesCount : 0;
            let isNewCastsToVerify = false;
            for (let i = 0; i < casts.length; i++) {
                const foundKeyword = findKeywordWithPrefix(casts[i].castContent)
                if (foundKeyword == "") {
                    continue;
                }
                logger.info(`casts[i] ${JSON.stringify(casts[i])}`);

                // add to verifyCasts only casts with more than 100 likes and more than the last element(with least likes) in castsToVerify array
                if (casts[i].likesCount > 100 && casts[i].likesCount > minLikesCount) {
                    castsToVerify.push(casts[i]);
                    isNewCastsToVerify = true;

                    castsToVerify.sort((a, b) => b.likesCount - a.likesCount);
                    if (castsToVerify.length > verifyCastBatchSize) {
                        casts.push(...castsToVerify.slice(verifyCastBatchSize));
                        castsToVerify = castsToVerify.slice(0, verifyCastBatchSize);
                    }
                    minLikesCount = castsToVerify[castsToVerify.length - 1].likesCount;
                    continue;
                }

                let result = UserResults.get(casts[i].userIndex) || { ...defaultResult };
                result.userIndex = casts[i].userIndex;
                const processingType = calculateCastByKeyword(result, casts[i].likesCount, foundKeyword);

                batchUploader.add(casts[i], processingType);

                if (processingType == CastProcessingType.Skipped) {
                    logger.warn(`skipping cast ${casts[i].castHash} ${casts[i].castContent}`);
                    continue;
                }

                UserResults.set(casts[i].userIndex, result);
            }

            if (isNewCastsToVerify) {
                await storage.saveCastsToVerify(castsToVerify);
            }

            let results: Result[] = [];

            let userIndexesUnderVerification: Map<number, boolean> = new Map();
            for (const cast of castsToVerify) {
                userIndexesUnderVerification.set(cast.userIndex, true);
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
                if (res.casts < 1000) {
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
                throw new Error('failed to upload casts to the server');
            }
            await batchUploader.saveStateToStorage();

            logger.info(`sortedResults ${JSON.stringify(sortedResults)}`);

            // retry errored batches that has less than 3 retries
            const batchesToRetry = errorBatches.filter((b) => b.errorCount < 3);
            const errorBatchesToLog = errorBatches.filter((b) => b.errorCount >= 3);

            if (batchesToRetry.length > 0) {
                batchesToProcess.push(...batchesToRetry);
            }

            if (sortedResults.length > 0 || batchesToProcess.length > 0) {
                transactions.push({
                    to: userArgs.contractAddress as string,
                    data: smartContract.interface.encodeFunctionData("mintCoinsForFarcasterUsers", [
                        sortedResults,
                        BigInt(mintingDayTimestamp),
                        batchesToProcess,
                    ]),
                })
            }
            if (errorBatchesToLog.length > 0) {
                logger.info(`logFarcasterErrorBatches ${errorBatches.length}`);
                transactions.push({
                    to: userArgs.contractAddress as string,
                    data: smartContract.interface.encodeFunctionData("logFarcasterErrorBatches", [
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
                if (castsToVerify.length > 0) {
                    const verifiedCasts = await farcasterRequester.fetchCastsByHashes(castsToVerify);
                    logger.info(`verifiedCasts ${verifiedCasts.length}`);
                    for (let i = 0; i < verifiedCasts.length; i++) {
                        const result = UserResults.get(verifiedCasts[i].userIndex) || { ...defaultResult };

                        let castProcessResult = calculateCastByKeyword(result, verifiedCasts[i].likesCount, findKeywordWithPrefix(verifiedCasts[i].castContent));
                        batchUploader.add(verifiedCasts[i], castProcessResult);
                        if (castProcessResult == CastProcessingType.Skipped) {
                            continue;
                        }

                        if (!result.userIndex) {
                            result.userIndex = verifiedCasts[i].userIndex;
                        }
                        UserResults.set(verifiedCasts[i].userIndex, result);
                    }
                }

                const results = [...UserResults.values()].sort((a, b) => Number(a.userIndex - b.userIndex));

                if (results && results.length > 0) {
                    transactions.push(
                        {
                            to: await smartContract.getAddress() as string,
                            data: smartContract.interface.encodeFunctionData("mintCoinsForFarcasterUsers", [
                                results,
                                BigInt(mintingDayTimestamp),
                                [],
                            ]),
                        },
                    )
                }
            } catch (error) {
                // Handle errors for this batch
                logger.error(`Error fetching batch for verifyCasts: ${error}`);

                return {
                    canExec: false,
                    message: `error during verifying casts: ${error}`
                }
            }

            const finalHash = batchUploader.getRunningHash();
            logger.info(`finalHash ${finalHash}`);

            const uploaded = await batchUploader.uploadToServer();
            if (!uploaded) {
                throw new Error('failed to SaveCasts (verifiedCasts) to the server');
            }

            // don't wait for response, cause it takes too long to complete (like 30-60 secs)
            batchUploader.sendUploadToIPFSRequest();
            // wait for 1 sec
            await new Promise(f => setTimeout(f, 1000));

            // finish minting at all
            await storage.clearAll();

            transactions.push({
                to: await smartContract.getAddress() as string,
                data: smartContract.interface.encodeFunctionData("finishFarcasterMinting", [
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

        logger.error(`Error in farcaster-worker: ${error}`);
        return {
            canExec: false,
            message: 'Unexpected error in farcaster-worker: ' + error.message,
        };
    }
}

function calculateCastByKeyword(result: Result, likesCount: number, keyword: string): CastProcessingType {
    let processingType = CastProcessingType.Skipped;

    if (keyword == "") {
        return processingType;
    }

    // limit 10 hashtag/cashtag per day per user
    if (keyword == "$" + KEYWORD && result.cashtagCasts < 10) {
        processingType = CastProcessingType.Cashtag;
    } else if (keyword == "#" + KEYWORD && result.hashtagCasts < 10) {
        processingType = CastProcessingType.Hashtag;
    } else if (keyword == KEYWORD) {
        processingType = CastProcessingType.Simple;
    }

    switch (processingType) {
        case CastProcessingType.Simple:
            result.simpleCasts++;
            break;
        case CastProcessingType.Hashtag:
            result.hashtagCasts++;
            break;
        case CastProcessingType.Cashtag:
            result.cashtagCasts++;
            break;
        default:
            return processingType
    }

    result.casts++;
    result.likes += likesCount;

    return processingType;
}

function findKeywordWithPrefix(text: string): string {
    const words = text.split(/\s+/);  // Split by whitespace to get individual words

    let foundWord = "";
    for (const word of words) {
        // Remove punctuation from the word
        const cleanedWord = word.replace(/[.,!?;:()]/g, "").toLowerCase();

        // Check for cashtag casts
        if (cleanedWord === "$" + KEYWORD) {
            return "$" + KEYWORD;
        }
        // Check for hashtag casts
        else if (cleanedWord === "#" + KEYWORD) {
            foundWord = "#gm";
        }
        // Check for simple keyword casts
        else if (cleanedWord === KEYWORD && foundWord == "") {
            foundWord = cleanedWord;
        }
    }

    return foundWord;
}