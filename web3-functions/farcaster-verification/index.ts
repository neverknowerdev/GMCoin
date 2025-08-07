import { Interface } from "@ethersproject/abi";
import {
    Web3Function,
    Web3FunctionEventContext,
    Web3FunctionResult
} from "@gelatonetwork/web3-functions-sdk";
import { Contract } from "ethers";
import ky, { HTTPError } from "ky";

const VerifierContractABI = [
    "function verifyFarcaster(uint256 farcasterFid, address wallet) public",
    "function farcasterVerificationError(address wallet, uint256 farcasterFid, string calldata errorMsg) public",
    "event VerifyFarcasterRequested(uint256 indexed farcasterFid, address indexed wallet)",
];

interface FarcasterUserResponse {
    result: {
        user: {
            fid: number;
            verifications: string[];
            verified_addresses?: {
                eth_addresses: string[];
            };
        };
    };
}

interface FarcasterHubResponse {
    messages: Array<{
        data: {
            verificationAddEthAddressBody: {
                address: string;
            };
        };
    }>;
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
    const { farcasterFid, wallet } = event.args;
    console.log('farcasterFid', farcasterFid.toString());
    console.log(`Verifying Farcaster for address ${wallet}..`);

    try {
        // First try Farcaster Hub API (most reliable)
        let primaryAddress: string | null = null;
        
        try {
            primaryAddress = await fetchPrimaryAddressFromHub(farcasterFid.toString());
        } catch (hubError) {
            console.log('Hub API failed, trying Neynar API:', hubError);
            
            // Fallback to Neynar API
            const neynarApiKey = await context.secrets.get("NEYNAR_API_KEY");
            if (neynarApiKey) {
                primaryAddress = await fetchPrimaryAddressFromNeynar(farcasterFid.toString(), neynarApiKey);
            } else {
                console.log('No Neynar API key available');
            }
        }

        if (!primaryAddress) {
            return await returnError(verifierContract, farcasterFid, wallet, "Failed to fetch primary address for FID");
        }

        console.log(`Primary address from API: ${primaryAddress}`);
        console.log(`Wallet from event: ${wallet}`);

        // Compare addresses (case insensitive)
        if (primaryAddress.toLowerCase() !== wallet.toLowerCase()) {
            return await returnError(verifierContract, farcasterFid, wallet, 
                `Primary address mismatch. Expected: ${primaryAddress}, Got: ${wallet}`);
        }

        // Success - call verifyFarcaster
        return {
            canExec: true,
            callData: [
                {
                    to: userArgs.verifierContractAddress as string,
                    data: verifierContract.interface.encodeFunctionData("verifyFarcaster", [
                        farcasterFid,
                        wallet
                    ]),
                },
            ],
        };
    } catch (error: any) {
        console.log('error', error);
        if (error instanceof HTTPError) {
            const errorBody = await error.response.json();
            return await returnError(verifierContract, farcasterFid, wallet, 
                `Failed to retrieve Farcaster data: ${JSON.stringify(errorBody)}`);
        } else {
            return await returnError(verifierContract, farcasterFid, wallet, 
                `An unexpected error occurred: ${error.message}`);
        }
    }
});

async function fetchPrimaryAddressFromHub(fid: string): Promise<string | null> {
    console.log(`Fetching from Farcaster Hub for FID: ${fid}`);
    
    // Try multiple hub endpoints for reliability
    const hubEndpoints = [
        "https://nemes.farcaster.xyz:2281",
        "https://hub.farcaster.standardcrypto.vc:2281",
        "https://farcaster-mainnet.g.alchemy.com"
    ];

    for (const endpoint of hubEndpoints) {
        try {
            const response = await ky.get(`${endpoint}/v1/verificationsByFid?fid=${fid}`, {
                timeout: 10000,
                headers: {
                    'Content-Type': 'application/json',
                }
            }).json<FarcasterHubResponse>();

            console.log('Hub response:', JSON.stringify(response, null, 2));

            // Extract verified addresses from the response
            if (response.messages && response.messages.length > 0) {
                // Get the first verified address (primary)
                const firstVerification = response.messages[0];
                if (firstVerification?.data?.verificationAddEthAddressBody?.address) {
                    return firstVerification.data.verificationAddEthAddressBody.address;
                }
            }
        } catch (error) {
            console.log(`Hub endpoint ${endpoint} failed:`, error);
            continue; // Try next endpoint
        }
    }

    return null;
}

async function fetchPrimaryAddressFromNeynar(fid: string, apiKey: string): Promise<string | null> {
    console.log(`Fetching from Neynar API for FID: ${fid}`);
    
    try {
        const response = await ky.get(`https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`, {
            timeout: 10000,
            headers: {
                'Accept': 'application/json',
                'api_key': apiKey
            }
        }).json<{ users: Array<{ fid: number; verified_addresses?: { eth_addresses: string[] } }> }>();

        console.log('Neynar response:', JSON.stringify(response, null, 2));

        if (response.users && response.users.length > 0) {
            const user = response.users[0];
            if (user.verified_addresses?.eth_addresses && user.verified_addresses.eth_addresses.length > 0) {
                // Return the first verified address as primary
                return user.verified_addresses.eth_addresses[0];
            }
        }
    } catch (error) {
        console.log('Neynar API error:', error);
        throw error;
    }

    return null;
}

async function returnError(contract: Contract, farcasterFid: any, userWallet: string, errorMsg: string): Promise<Web3FunctionResult> {
    const contractAddress = await contract.getAddress();
    console.log('returnError here', contractAddress, errorMsg);
    return {
        canExec: true,
        callData: [
            {
                to: contractAddress,
                data: contract.interface.encodeFunctionData("farcasterVerificationError", [
                    userWallet,
                    farcasterFid,
                    errorMsg
                ]),
            },
        ],
    }
}
