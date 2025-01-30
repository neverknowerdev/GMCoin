import {Interface} from "@ethersproject/abi";
import {Storage} from './storage';
import {
    Web3Function,
    Web3FunctionEventContext,
    Web3FunctionResult
} from "@gelatonetwork/web3-functions-sdk";
import {Contract, ContractRunner} from "ethers";
import {Web3FunctionResultCallData} from "@gelatonetwork/web3-functions-sdk/dist/lib/types/Web3FunctionResult";
import {ContractABI, Result, Tweet, Batch, TwitterApiResponse, defaultResult, w3fStorage} from "./consts";
import {BatchManager} from "./batchManager";
import {TwitterRequester, TwitterSecrets} from "./twitterRequester";
import {SmartContractConnector} from "./smartContractConnector";
import {createIPFSBatchUploader} from "./IPFSBatchUploader";

const KEYWORD = "gm";
const verifyTweetBatchSize = 300;

Web3Function.onRun(async (context: Web3FunctionEventContext): Promise<Web3FunctionResult> => {
    // Get event log from Web3FunctionEventContext
    console.log('running..');
    const {log, userArgs, multiChainProvider, storage: w3fStorage} = context;

    const SearchURL = userArgs.searchURL as string;
    const CONCURRENCY_LIMIT = userArgs.concurrencyLimit as number;
    const ConvertToUsernamesURL = userArgs.convertToUsernamesURL as string;

    const bearerToken = await context.secrets.get("TWITTER_BEARER");
    if (!bearerToken)
        return {canExec: false, message: `TWITTER_BEARER not set in secrets`};

    const secretKey = await context.secrets.get("TWITTER_RAPIDAPI_KEY");
    if (!secretKey) {
        throw new Error('Missing TWITTER_RAPIDAPI_KEY environment variable');
    }

    const w3spaceDelegationKey = await context.secrets.get("W3SPACE_DELEGATION_KEY");
    if (!w3spaceDelegationKey) {
        throw new Error('Missing W3SPACE_DELEGATION_KEY environment variable');
    }

    const w3spaceDelegationProof = await context.secrets.get("W3SPACE_DELEGATION_PROOF");
    if (!w3spaceDelegationProof) {
        throw new Error('Missing W3SPACE_DELEGATION_PROOF environment variable');
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
            nextCursor: item.nextCursor
        }));

        let ipfsBatchUploader = await createIPFSBatchUploader(storage, mintingDayTimestamp, w3spaceDelegationKey, w3spaceDelegationProof, 1000);

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
                const newResult = calculateTweetByKeyword(result, tweets[i].likesCount, foundKeyword);
                console.log(`newResult for userIndex ${tweets[i].userIndex} userID ${tweets[i].username}`);
                UserResults.set(tweets[i].userIndex, newResult);

                ipfsBatchUploader.add(tweets[i], 0);
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

            console.log('waiting for ipfsBatchUploader..');
            await ipfsBatchUploader.wait();
            await ipfsBatchUploader.saveToStorage();

            console.log('newBatches', batchesToProcess);
            console.log('sortedResults', sortedResults.length);

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
        }
        // minting finished
        if (batchesToProcess.length == 0) {
            console.log('mintingFinished');

            let transactions: Web3FunctionResultCallData[] = [];
            try {
                const verifiedTweets = await twitterRequester.fetchTweetsByIDs(tweetsToVerify);
                console.log('verifiedTweets', verifiedTweets.length);
                console.log('userResults before', UserResults);
                for (let i = 0; i < verifiedTweets.length; i++) {
                    const result = UserResults.get(verifiedTweets[i].userIndex) || {...defaultResult};

                    let res = calculateTweetByKeyword(result, verifiedTweets[i].likesCount, findKeywordWithPrefix(verifiedTweets[i].tweetContent));
                    res.userIndex = verifiedTweets[i].userIndex;
                    UserResults.set(verifiedTweets[i].userIndex, res);

                    ipfsBatchUploader.add(verifiedTweets[i], 0);
                }
                console.log('userResults after', UserResults);

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

            const finalCID = await ipfsBatchUploader.uploadFinalFileToIPFS(10);

            transactions.push({
                to: await smartContract.getAddress() as string,
                data: smartContract.interface.encodeFunctionData("finishMinting", [
                    BigInt(mintingDayTimestamp),
                    finalCID
                ]),
            });

            // finish minting at all
            await storage.clearAll();


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

function calculateTweetByKeyword(result: Result, likesCount: number, keyword: string): Result {
    if (keyword == "") {
        return result;
    }

    // limit 10 hashtag/cashtag per day per user
    if (keyword == "$" + KEYWORD && result.cashtagTweets < 10) {
        result.cashtagTweets++;
    } else if (keyword == "#" + KEYWORD && result.hashtagTweets < 10) {
        result.hashtagTweets++;
    } else if (keyword == KEYWORD) {
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