import {Interface} from "@ethersproject/abi";
import {
    Web3Function,
    Web3FunctionEventContext,
    Web3FunctionResult
} from "@gelatonetwork/web3-functions-sdk";
import {Contract} from "ethers";
import ky, {HTTPError} from "ky";

import {gcm} from '@noble/ciphers/aes';
import {bytesToHex, bytesToUtf8, hexToBytes} from '@noble/ciphers/utils';

// Define Twitter API endpoint
const TWITTER_ME_URL = '/2/users/me';
const TWITTER_REVOKE_URL = '/2/oauth2/revoke';


const VerifierContractABI = [
    "event VerifyTwitterRequestedRelayer(string accessCodeEncrypted, string userID, address indexed wallet)",
    "function verifyTwitter(string calldata userID, address wallet)",
    "function twitterVerificationError(address wallet, string calldata errorMsg)"
];

const ALGORITHM = "aes-256-gcm";

Web3Function.onRun(async (context: Web3FunctionEventContext): Promise<Web3FunctionResult> => {
    // Get event log from Web3FunctionEventContext
    const {log, userArgs, multiChainProvider} = context;

    const TwitterApiURL = userArgs.twitterHost;

    const twitterClientID = await context.secrets.get("TWITTER_CLIENT_ID");
    if (!twitterClientID)
        return {canExec: false, message: `TWITTER_CLIENT_ID not set in secrets`};

    const twitterSecret = await context.secrets.get("TWITTER_SECRET");
    if (!twitterSecret) {
        return {canExec: false, message: `TWITTER_SECRET not set in secrets`};
    }

    const decryptionKey = await context.secrets.get("DECRYPTION_KEY");
    if (!decryptionKey) {
        return {canExec: false, message: `DECRYPTION_KEY not set in secrets`};
    }


    console.log(`verifier address is ${userArgs.verifierContractAddress}`);

    const provider = multiChainProvider.default();

    const verifierContract = new Contract(
        userArgs.verifierContractAddress as string,
        VerifierContractABI,
        provider
    );

    const contract = new Interface(VerifierContractABI);
    const event = contract.parseLog(log);

    // Handle event data
    const {accessCodeEncrypted, userID, wallet} = event.args;
    console.log('authCode', accessCodeEncrypted);
    console.log('userID', userID);
    console.log(`Veryfing Twitter for address ${wallet}..`);

    console.log('before decryptData');
    const accessToken = decryptData(accessCodeEncrypted, decryptionKey);
    console.log('after decryptData', accessToken);

    try {

        // Step 2: Use access token to call the users/me endpoint
        const userResponse = await ky.get(TwitterApiURL + TWITTER_ME_URL, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
            },
        }).json();

        const twitterUser = userResponse as any;
        const twitterUserID = twitterUser.data.id;

        if (!twitterUserID) {
            return await returnError(verifierContract, wallet, `Failed to retrieve user from Twitter`);
        }
        if (twitterUserID != userID) {
            return await returnError(verifierContract, wallet, 'userID returned by Twitter is different');
        }

        const basicAuthEncoded = btoa(`${twitterClientID}:${twitterSecret}`);
        // Step 5: Revoke the access token after successful validation
        await ky.post(
            TwitterApiURL + TWITTER_REVOKE_URL,
            {
                headers: {
                    'Authorization': `Basic ${basicAuthEncoded}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    token: accessToken,
                    client_id: twitterClientID,
                    token_type_hint: 'access_token'
                }).toString(),
            }
        );

        return {
            canExec: true,
            callData: [
                {
                    to: userArgs.verifierContractAddress as string,
                    data: verifierContract.interface.encodeFunctionData("verifyTwitter", [
                        userID,
                        wallet,
                    ]),
                },
            ],
        };
    } catch (error: any) {
        if (error instanceof HTTPError) {
            // Attempt to read the error response as JSON
            const errorBody = await error.response.json().catch(() => error.response.text());

            return await returnError(verifierContract, wallet, `Failed to retrieve access token: ${JSON.stringify(errorBody)}`);
        } else {
            return await returnError(verifierContract, wallet, `An unexpected error occurred: ${error.message}`);
        }
    }
});

function decryptData(encryptedData: string, decryptionKey: string): string {
    const nonce = hexToBytes(encryptedData.slice(0, 48));
    const data = hexToBytes(encryptedData.slice(48));
    const aes = gcm(hexToBytes(decryptionKey), nonce);
    const data_ = aes.decrypt(data);
    return bytesToHex(data_);
}

async function returnError(contract: Contract, userWallet: string, errorMsg: string): Promise<Web3FunctionResult> {
    const contractAddress = await contract.getAddress()
    console.log('returnError here', contractAddress, errorMsg);
    return {
        canExec: true,
        callData: [
            {
                to: contractAddress,
                data: contract.interface.encodeFunctionData("twitterVerificationError", [
                    userWallet,
                    errorMsg
                ]),
            },
        ],
    }
}