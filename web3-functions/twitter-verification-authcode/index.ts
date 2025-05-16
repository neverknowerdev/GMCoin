import { Interface } from "@ethersproject/abi";
import { Contract } from "ethers";
import { Web3Function, Web3FunctionEventContext } from "@gelatonetwork/web3-functions-sdk";
import { Web3FunctionResult } from "@gelatonetwork/web3-functions-sdk/types";
import ky, { HTTPError } from "ky";

const VerifierContractABI = [
    "function verifyTwitter(string calldata userID, address wallet, bool isSubscribed) public",
    "function twitterVerificationError(address wallet, string calldata userID, string calldata errorMsg) public",
    "event verifyTwitterByAuthCodeRequested(address wallet, string authCode, string tweetID, string userID)",
];

interface TwitterResponseV1 {
    data: {
        tweet_result: {
            result: {
                legacy: {
                    full_text: string;
                    user_id_str: string;
                };
            };
        };
    };
}

interface TwitterResponseV2 {
    text: string;
    author_id: string;
}


Web3Function.onRun(async (context: Web3FunctionEventContext): Promise<Web3FunctionResult> => {
    const { log, userArgs, multiChainProvider } = context;

    const provider = multiChainProvider.default();

    const verifierContract = new Contract(
        userArgs.verifierContractAddress as string,
        VerifierContractABI,
        provider as any
    );

    const contract = new Interface(VerifierContractABI);
    const event = contract.parseLog(log);

    // Handle event data
    const { wallet, authCode, tweetID, userID } = event.args;
    console.log('tweetID', tweetID);
    console.log(`Verifying Twitter for address ${wallet}..`);

    // Validate auth code format and wallet letters
    const authCodeValidation = validateAuthCode(authCode, wallet);
    if (!authCodeValidation.isValid) {
        return await returnError(verifierContract, userID, wallet, authCodeValidation.error || "Invalid auth code");
    }

    const tweetFetchURL = await context.secrets.get("TWITTER_GET_TWEET_URL");
    if (!tweetFetchURL) {
        return await returnError(verifierContract, userID, wallet, "TWITTER_GET_TWEET_URL not set in secrets");
    }

    const headerName = await context.secrets.get("HEADER_NAME");
    if (!headerName) {
        return await returnError(verifierContract, userID, wallet, "HEADER_NAME not set in secrets");
    }

    const twitterBearer = await context.secrets.get("TWITTER_BEARER");
    if (!twitterBearer) {
        return await returnError(verifierContract, userID, wallet, "TWITTER_BEARER not set in secrets");
    }

    try {
        // Fetch tweet using Twitter API
        const response = await ky.get(`${tweetFetchURL}${tweetID}`, {
            headers: {
                [headerName as string]: twitterBearer,
            },
        }).json<any>();

        const tweetData = getTweetContentAndAuthorId(response);
        if (!tweetData) {
            return await returnError(verifierContract, userID, wallet, "Failed to parse tweet data");
        }

        const { tweetContent, authorId } = tweetData;
        console.log('Tweet content:', tweetContent);

        // Check if auth code exists in tweet content
        if (!tweetContent.includes(authCode)) {
            return await returnError(verifierContract, userID, wallet, "Auth code not found in tweet");
        }

        // Verify user ID matches
        if (authorId !== userID) {
            return await returnError(verifierContract, userID, wallet, "User ID mismatch");
        }

        // Call verifyTwitter if auth code is found
        return {
            canExec: true,
            callData: [
                {
                    to: userArgs.verifierContractAddress as string,
                    data: verifierContract.interface.encodeFunctionData("verifyTwitter", [
                        userID,
                        wallet,
                        false,
                    ]),
                },
            ],
        };
    } catch (error: any) {
        if (error instanceof HTTPError) {
            // Attempt to read the error response as JSON
            const errorBody = await error.response.json();
            return await returnError(verifierContract, userID, wallet, `Failed to retrieve tweet: ${JSON.stringify(errorBody)}`);
        } else {
            return await returnError(verifierContract, userID, wallet, `An unexpected error occurred: ${error.message}`);
        }
    }
});

async function returnError(contract: Contract, userID: string, userWallet: string, errorMsg: string): Promise<Web3FunctionResult> {
    const contractAddress = await contract.getAddress();
    console.log('returnError here', contractAddress, errorMsg);
    return {
        canExec: true,
        callData: [
            {
                to: contractAddress,
                data: contract.interface.encodeFunctionData("twitterVerificationError", [
                    userWallet,
                    userID,
                    errorMsg
                ]),
            },
        ],
    }
}

function getTweetContentAndAuthorId(response: any): { tweetContent: string; authorId: string } | null {
    // Check for V1 format
    if (response.data?.tweet_result?.result?.legacy) {
        return {
            tweetContent: response.data.tweet_result.result.legacy.full_text,
            authorId: response.data.tweet_result.result.legacy.user_id_str
        };
    }

    // Check for V2 format
    if (response.text && response.author_id) {
        return {
            tweetContent: response.text,
            authorId: response.author_id
        };
    }

    return null;
}

function validateAuthCode(authCode: string, walletAddress: string): { isValid: boolean; error?: string } {
    // Auth code format: GM${walletStartingLetterNumberStr}${wallet10Letters}${random2}
    if (!authCode.startsWith('GM')) {
        return { isValid: false, error: "Auth code must start with 'GM'" };
    }

    // Extract wallet starting letter number (2 digits)
    const walletStartingLetterNumberStr = authCode.substring(2, 4);
    if (!/^\d{2}$/.test(walletStartingLetterNumberStr)) {
        return { isValid: false, error: "Invalid wallet starting letter number format" };
    }

    // Extract wallet 10 letters
    const wallet10Letters = authCode.substring(4, 14);
    if (!/^[a-fA-F0-9]{10}$/.test(wallet10Letters)) {
        return { isValid: false, error: "Invalid wallet letters format" };
    }

    // Get the actual wallet letters from the wallet address
    const walletStartingLetterNumber = parseInt(walletStartingLetterNumberStr);
    const actualWalletLetters = walletAddress.substring(walletStartingLetterNumber + 2, walletStartingLetterNumber + 10 + 2);

    if (wallet10Letters.toLowerCase() !== actualWalletLetters.toLowerCase()) {
        return { isValid: false, error: "Wallet letters in auth code do not match the wallet address" };
    }

    return { isValid: true };
}