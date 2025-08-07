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
    "function verifyBothFarcasterAndTwitter(uint256 farcasterFid, address wallet, string calldata twitterId) public",
    "function farcasterVerificationError(address wallet, uint256 farcasterFid, string calldata errorMsg) public",
    "function isTwitterUserRegistered(string calldata userID) public view returns (bool)",
    "function userByWallet(address wallet) public view returns (string memory)",
    "function mergeUnifiedAccounts(uint256 farcasterFid, string calldata twitterId, address wallet) public",
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

interface FarcasterVerificationsResponse {
    result: {
        verifications: Array<{
            fid: number;
            address: string;
            timestamp: number;
        }>;
    };
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
        // STEP 1: Get primary address for FID and verify wallet ownership
        console.log('STEP 1: Verifying wallet owns the FID...');
        let primaryAddress: string | null = null;
        
        try {
            primaryAddress = await fetchPrimaryAddressFromHub(farcasterFid.toString());
        } catch (hubError) {
            console.log('Hub API failed, trying Neynar API:', hubError);
            
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

        console.log('✅ STEP 1 PASSED: Wallet owns the FID');

        // STEP 2: Check if primary address already has Twitter verified on GM
        console.log('STEP 2: Checking if primary address already has Twitter verified...');
        
        const existingTwitterId = await verifierContract.userByWallet(wallet);
        if (existingTwitterId && existingTwitterId.length > 0) {
            console.log(`✅ STEP 2 RESULT: Primary address already has Twitter verified (${existingTwitterId})`);
            console.log('Linking Farcaster to existing unified account...');
            
            // Link Farcaster to existing unified account
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
        }

        console.log('❌ STEP 2 RESULT: Primary address does NOT have Twitter verified');

        // STEP 3: Check if user has verified Twitter account in Farcaster
        console.log('STEP 3: Checking if FID has Twitter verified in Farcaster...');
        
        const twitterUsername = await fetchTwitterUsernameFromFarcaster(farcasterFid.toString());
        if (!twitterUsername) {
            console.log('❌ STEP 3 RESULT: No Twitter verification found in Farcaster');
            return await returnError(verifierContract, farcasterFid, wallet, 
                "User has not verified Twitter account in Farcaster. Please verify Twitter in Farcaster first.");
        }

        console.log(`✅ STEP 3 RESULT: Found Twitter verification in Farcaster: @${twitterUsername}`);

        // STEP 4: Check if TwitterID is already registered in GM  
        console.log('STEP 4: Checking if Twitter username is already registered in GM...');
        
        const isTwitterRegistered = await verifierContract.isTwitterUserRegistered(twitterUsername);
        if (isTwitterRegistered) {
            console.log(`✅ STEP 4 RESULT: Twitter @${twitterUsername} IS already registered`);
            console.log('Need to merge two unified accounts...');
            
            // Merge two different unified accounts
            return {
                canExec: true,
                callData: [
                    {
                        to: userArgs.verifierContractAddress as string,
                        data: verifierContract.interface.encodeFunctionData("mergeUnifiedAccounts", [
                            farcasterFid,
                            twitterUsername,
                            wallet
                        ]),
                    },
                ],
            };
        } else {
            console.log(`❌ STEP 4 RESULT: Twitter @${twitterUsername} is NOT registered`);
            console.log('Verifying both Farcaster and Twitter together...');
            
            // Verify both FID and TwitterID together for same unified user
            return {
                canExec: true,
                callData: [
                    {
                        to: userArgs.verifierContractAddress as string,
                        data: verifierContract.interface.encodeFunctionData("verifyBothFarcasterAndTwitter", [
                            farcasterFid,
                            wallet,
                            twitterUsername
                        ]),
                    },
                ],
            };
        }

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

async function fetchTwitterUsernameFromFarcaster(fid: string): Promise<string | null> {
    console.log(`Fetching Twitter verifications for FID: ${fid}`);
    
    // Try Neynar API first (most reliable for verifications)
    try {
        const response = await ky.get(`https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}&viewer_fid=1`, {
            timeout: 10000,
            headers: {
                'Accept': 'application/json',
                'api_key': 'NEYNAR_API_DOCS' // Public demo key
            }
        }).json<{ users: Array<{ 
            fid: number; 
            verifications?: string[];
            external_accounts?: Array<{
                platform: string;
                username: string;
            }>;
        }> }>();

        console.log('Neynar verifications response:', JSON.stringify(response, null, 2));

        if (response.users && response.users.length > 0) {
            const user = response.users[0];
            
            // Check external_accounts for Twitter/X verification
            if (user.external_accounts) {
                const twitterAccount = user.external_accounts.find(
                    account => account.platform === 'twitter' || account.platform === 'x'
                );
                
                if (twitterAccount) {
                    console.log(`Found Twitter verification: @${twitterAccount.username}`);
                    return twitterAccount.username;
                }
            }
        }
    } catch (error) {
        console.log('Neynar API failed:', error);
        
        // Fallback: Try Farcaster Hub API for verifications (more complex)
        try {
            return await fetchTwitterUsernameFromHub(fid);
        } catch (hubError) {
            console.log('Hub API also failed:', hubError);
        }
    }

    console.log('No Twitter verification found for FID');
    return null;
}

async function fetchTwitterUsernameFromHub(fid: string): Promise<string | null> {
    console.log(`Trying Farcaster Hub API for FID: ${fid}`);
    
    // Try multiple hub endpoints for reliability
    const hubEndpoints = [
        "https://nemes.farcaster.xyz:2281",
        "https://hub.farcaster.standardcrypto.vc:2281",
        "https://farcaster-mainnet.g.alchemy.com"
    ];

    for (const endpoint of hubEndpoints) {
        try {
            // Get verifications for the FID
            const response = await ky.get(`${endpoint}/v1/verificationsByFid?fid=${fid}`, {
                timeout: 10000,
                headers: {
                    'Content-Type': 'application/json',
                }
            }).json<{
                messages: Array<{
                    data: {
                        verificationAddEthAddressBody?: {
                            address: string;
                            ethSignature: string;
                            claimSignature: string;
                        };
                    };
                }>;
            }>();

            console.log(`Hub ${endpoint} verifications response:`, JSON.stringify(response, null, 2));

            // Note: Farcaster Hub API primarily stores ETH address verifications
            // Twitter verifications are typically stored as UserData, not Verifications
            // This is a limitation - we'd need to query UserData messages and parse them
            
            // For now, return null and rely on Neynar API primarily
            return null;
            
        } catch (error) {
            console.log(`Hub endpoint ${endpoint} failed:`, error);
            continue;
        }
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
