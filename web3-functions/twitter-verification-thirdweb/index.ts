import { Interface } from "@ethersproject/abi";
import { Contract } from "ethers";
import { Web3Function, Web3FunctionEventContext } from "@gelatonetwork/web3-functions-sdk";
import { Web3FunctionResult } from "@gelatonetwork/web3-functions-sdk/types";
import { predictSmartAccountAddress } from "thirdweb/wallets/smart";
import { createThirdwebClient } from "thirdweb";
import { base, baseSepolia } from "thirdweb/chains";

interface ThirdwebUserDetails {
    userId: string;
    walletAddress: string;
    createdAt: string;
    linkedAccounts: {
        type: string;
        details: {
            id: string;
            name?: string;
            username?: string;
            fid?: string;
        };
    }[];
}

const ContractABI = [
    "function verifyTwitter(string calldata userID, address wallet, bool isSubscribed) public",
    "function twitterVerificationError(address wallet, string calldata userID, string calldata errorMsg) public",
    "event verifyTwitterThirdwebRequested(address wallet, string userID)",
];

Web3Function.onRun(async (context: Web3FunctionEventContext): Promise<Web3FunctionResult> => {
    const { userArgs, secrets, log, multiChainProvider } = context;

    const contractAddress = userArgs.verifierContractAddress as string;
    const chainId = userArgs.chainId as number;
    const chain = chainId == base.id ? base : baseSepolia;

    // Get Thirdweb credentials from secrets
    const thirdwebClientId = await secrets.get("THIRDWEB_CLIENT_ID");
    if (!thirdwebClientId) {
        return { canExec: false, message: `Missing THIRDWEB_CLIENT environment variable` };
    }

    const thirdwebSecretKey = await secrets.get("THIRDWEB_SECRET_KEY");
    if (!thirdwebSecretKey) {
        return { canExec: false, message: `Missing THIRDWEB_SECRET environment variable` };
    }

    if (!thirdwebClientId || !thirdwebSecretKey) {
        return {
            canExec: false,
            message: "Missing Thirdweb credentials in secrets",
        };
    }

    const provider = multiChainProvider.default();

    const verifierContract = new Contract(
        contractAddress,
        ContractABI,
        provider
    );

    const contract = new Interface(ContractABI);
    const event = contract.parseLog(log);

    // Handle event data
    const { wallet, userID } = event.args;
    console.log('userID', userID);
    console.log(`Veryfing Twitter for address ${wallet}..`);

    try {
        // Fetch user details from Thirdweb API
        const response = await fetch(
            `https://in-app-wallet.thirdweb.com/api/2023-11-30/embedded-wallet/user-details?queryBy=id&id=${userID}`,
            {
                headers: {
                    "x-secret-key": thirdwebSecretKey,
                },
            }
        );

        if (!response.ok) {
            throw new Error(`Failed to fetch user details: ${response.statusText}`);
        }

        const data: ThirdwebUserDetails[] = await response.json();
        if (!data || data.length === 0) {
            throw new Error("No user details found");
        }

        const userDetails = data[0];
        const xAccount = userDetails.linkedAccounts.find(account => account.type === "x");

        if (!xAccount || xAccount.details.id !== userID) {
            return await returnError(verifierContract, userID, wallet, "Twitter account not found or doesn't match");
        }

        const client = createThirdwebClient({ secretKey: thirdwebSecretKey, clientId: thirdwebClientId });

        // Predict smart account address
        const predictedAddress = await predictSmartAccountAddress({
            client: client,
            chain: chain,
            adminAddress: userDetails.walletAddress,
        });

        // Compare predicted address with wallet from event
        if (predictedAddress.toLowerCase() === wallet.toLowerCase()) {
            // Call verifyTwitter if addresses match
            console.log('call verifyTwitter', contractAddress);
            return {
                canExec: true,
                callData: [
                    {
                        to: contractAddress,
                        data: verifierContract.interface.encodeFunctionData("verifyTwitter", [
                            userID,
                            wallet,
                            false,
                        ]),
                    },
                ],
            };
        } else {
            return await returnError(verifierContract, userID, wallet, "Wallet address mismatch");
        }
    } catch (error) {
        console.error("Error processing verification:", error);
        return await returnError(verifierContract, userID, wallet, `Error: ${error.message}`);
    }
});

async function returnError(contract: Contract, userID: string, userWallet: string, errorMsg: string): Promise<Web3FunctionResult> {
    const contractAddress = await contract.getAddress()
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