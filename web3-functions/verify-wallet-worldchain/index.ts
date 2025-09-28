import { Interface } from "@ethersproject/abi";
import {
    Web3Function,
    Web3FunctionEventContext,
    Web3FunctionResult
} from "@gelatonetwork/web3-functions-sdk";
import { Contract } from "ethers";
import ky, { HTTPError } from "ky";
import { ethers } from "ethers";

// Worldchain Cloud Verification API endpoint
const WORLDCHAIN_VERIFY_URL = 'https://developer.worldcoin.org/api/v2/verify';

const VerifierContractABI = [
    "function verifyWalletWorldchain(address wallet) public",
    "function verifyWalletWorldchainError(address wallet, uint8 verificationType, string calldata errorMsg) public",
    "event requestWorldchainVerification(address indexed wallet, bytes signatureSignal, string payload)",
];

// Verification types enum (matching the smart contract)
enum VerificationType {
    None = 0,
    Twitter = 1,
    WorldChainDevice = 2
}

Web3Function.onRun(async (context: Web3FunctionEventContext): Promise<Web3FunctionResult> => {
    // Get event log from Web3FunctionEventContext
    const { log, userArgs, multiChainProvider } = context;

    const appId = await context.secrets.get("WORLDCHAIN_APP_ID");
    if (!appId) {
        return { canExec: false, message: `WORLDCHAIN_APP_ID not set in secrets` };
    }

    console.log(`verifier address is ${userArgs.verifierContractAddress}`);

    const provider = multiChainProvider.default();

    const verifierContract = new Contract(
        userArgs.verifierContractAddress as string,
        VerifierContractABI,
        provider as any
    );

    const contract = new Interface(VerifierContractABI);
    const event = contract.parseLog(log);

    // Handle event data
    const { wallet, signatureSignal, payload } = event.args;
    console.log(`Verifying Worldchain for address ${wallet}..`);

    try {
        // Parse the payload to extract verification data
        const verificationData = JSON.parse(payload);
        const { nullifier_hash, merkle_root, proof, verification_level, action, signal } = verificationData;

        // Hash the signal if provided, otherwise use the default
        const signalHash = signal ? ethers.keccak256(ethers.toUtf8Bytes(signal)) : ethers.keccak256(ethers.toUtf8Bytes("I verify I'm human using Worldchain"));

        // Prepare the verification request
        const verifyRequest = {
            nullifier_hash,
            merkle_root,
            proof,
            verification_level: verification_level || "orb",
            action: action || "verify_human",
            signal_hash: signalHash
        };

        console.log('Sending verification request to Worldchain:', {
            app_id: appId,
            ...verifyRequest
        });

        // Call Worldchain Cloud Verification API
        const response = await ky.post(`${WORLDCHAIN_VERIFY_URL}/${appId}`, {
            json: verifyRequest,
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 30000, // 30 second timeout
        });

        const verificationResult = await response.json() as any;
        console.log('Worldchain verification response:', verificationResult);

        // Check if verification was successful
        if (verificationResult.success === true || verificationResult.verified === true) {
            console.log(`Worldchain verification successful for wallet ${wallet}`);

            return {
                canExec: true,
                callData: [
                    {
                        to: userArgs.verifierContractAddress as string,
                        data: verifierContract.interface.encodeFunctionData("verifyWalletWorldchain", [
                            wallet
                        ]),
                    },
                ],
            };
        } else {
            const errorMsg = verificationResult.error || verificationResult.message || 'Verification failed';
            console.log(`Worldchain verification failed: ${errorMsg}`);

            return await returnError(
                verifierContract,
                wallet,
                VerificationType.WorldChainDevice,
                `Worldchain verification failed: ${errorMsg}`
            );
        }

    } catch (error: any) {
        console.error('Error during Worldchain verification:', error);

        let errorMessage = 'Unknown error occurred during verification';

        if (error instanceof HTTPError) {
            try {
                const errorBody = await error.response.json();
                errorMessage = `HTTP Error: ${error.response.status} - ${JSON.stringify(errorBody)}`;
            } catch (parseError) {
                errorMessage = `HTTP Error: ${error.response.status} - ${error.message}`;
            }
        } else if (error.message) {
            errorMessage = error.message;
        }

        return await returnError(
            verifierContract,
            wallet,
            VerificationType.WorldChainDevice,
            errorMessage
        );
    }
});

async function returnError(
    contract: Contract,
    wallet: string,
    verificationType: VerificationType,
    errorMsg: string
): Promise<Web3FunctionResult> {
    const contractAddress = await contract.getAddress();
    console.log('Returning error:', contractAddress, errorMsg);

    return {
        canExec: true,
        callData: [
            {
                to: contractAddress,
                data: contract.interface.encodeFunctionData("verifyWalletWorldchainError", [
                    wallet,
                    verificationType,
                    errorMsg
                ]),
            },
        ],
    };
}
