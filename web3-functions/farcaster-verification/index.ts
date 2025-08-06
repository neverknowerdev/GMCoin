import { Interface } from "@ethersproject/abi";
import {
    Web3Function,
    Web3FunctionEventContext,
    Web3FunctionResult
} from "@gelatonetwork/web3-functions-sdk";
import { Contract } from "ethers";
import ky, { HTTPError } from "ky";

// Define Farcaster API endpoints
const FARCASTER_PRIMARY_ADDRESS_URL = 'https://api.farcaster.xyz/fc/primary-address';
const FARCASTER_CONNECTED_ADDRESSES_URL = 'https://api.farcaster.xyz/fc/connected-addresses';

// Interface for connected addresses response
interface ConnectedAddress {
    address: string;
    protocol: string;
    verification?: {
        platform: string;
        username?: string;
        userId?: string;
    };
}

interface ConnectedAddressesResponse {
    result: {
        connectedAddresses: ConnectedAddress[];
    };
}

const VerifierContractABI = [
    "function verifyFarcaster(uint256 farcasterFid, address wallet) public",
    "function verifyBothFarcasterAndTwitter(uint256 farcasterFid, string calldata twitterUserID, address wallet) public",
    "function farcasterVerificationError(address wallet, uint256 farcasterFid, string calldata errorMsg) public",
    "function isWalletRegistered(address wallet) public view returns (bool)",
    "function userByWallet(address wallet) public view returns (string memory)",
    "event VerifyFarcasterRequested(uint256 indexed farcasterFid, address indexed wallet)",
];

/**
 * Check if a Farcaster FID has a connected Twitter account by checking the primary address
 * against existing Twitter verifications in the smart contract
 */
async function checkForTwitterVerification(
    farcasterFid: string, 
    primaryAddress: string,
    contract: Contract
): Promise<{
    hasTwitter: boolean;
    twitterUserId?: string;
}> {
    try {
        console.log(`Checking for Twitter verification for FID ${farcasterFid} with address ${primaryAddress}`);
        
        // Check if this address is already registered in the Twitter verification system
        const isRegistered = await contract.isWalletRegistered(primaryAddress);
        
        if (isRegistered) {
            // Get the Twitter user ID for this wallet
            const twitterUserId = await contract.userByWallet(primaryAddress);
            
            if (twitterUserId && twitterUserId !== '') {
                console.log(`✓ Found existing Twitter verification: ${twitterUserId} for address ${primaryAddress}`);
                return {
                    hasTwitter: true,
                    twitterUserId: twitterUserId
                };
            }
        }
        
        console.log(`No existing Twitter verification found for address ${primaryAddress}`);
        return {
            hasTwitter: false,
            twitterUserId: undefined
        };
    } catch (error) {
        console.error('Error checking for Twitter verification:', error);
        return {
            hasTwitter: false,
            twitterUserId: undefined
        };
    }
}

Web3Function.onRun(async (context: Web3FunctionEventContext): Promise<Web3FunctionResult> => {
    // Get event log from Web3FunctionEventContext
    const { log, userArgs, multiChainProvider } = context;

    console.log(`Farcaster verifier address is ${userArgs.verifierContractAddress}`);

    const provider = multiChainProvider.default();

    const verifierContract = new Contract(
        userArgs.verifierContractAddress as string,
        VerifierContractABI,
        provider
    );

    const contract = new Interface(VerifierContractABI);
    const event = contract.parseLog(log);

    // Handle event data
    const { farcasterFid, wallet } = event.args;
    console.log('farcasterFid', farcasterFid.toString());
    console.log(`Verifying Farcaster FID ${farcasterFid} for address ${wallet}..`);

    try {
        // Call Farcaster API to get primary address for the FID
        // Use ethereum protocol since Base uses same address format as Ethereum
        const response = await ky.get(FARCASTER_PRIMARY_ADDRESS_URL, {
            searchParams: {
                fid: farcasterFid.toString(),
                protocol: 'ethereum'
            },
            timeout: 3000
        });

        const farcasterData = await response.json() as any;
        console.log('Farcaster API response:', JSON.stringify(farcasterData));

        // Validate response structure
        if (!farcasterData.result || !farcasterData.result.address) {
            return await returnError(
                verifierContract, 
                farcasterFid, 
                wallet, 
                'Invalid response from Farcaster API: missing address data'
            );
        }

        const farcasterPrimaryAddress = farcasterData.result.address.address;
        const farcasterProtocol = farcasterData.result.address.protocol;
        const responseFid = farcasterData.result.address.fid;

        console.log(`Farcaster primary address: ${farcasterPrimaryAddress}`);
        console.log(`Farcaster protocol: ${farcasterProtocol}`);
        console.log(`Response FID: ${responseFid}`);

        // Validate FID matches
        if (responseFid.toString() !== farcasterFid.toString()) {
            return await returnError(
                verifierContract, 
                farcasterFid, 
                wallet, 
                `FID mismatch: requested ${farcasterFid}, got ${responseFid}`
            );
        }

        // Validate protocol is ethereum (which works for Base)
        if (farcasterProtocol !== 'ethereum') {
            return await returnError(
                verifierContract, 
                farcasterFid, 
                wallet, 
                `Unsupported protocol: ${farcasterProtocol}. Only ethereum protocol is supported.`
            );
        }

        // Validate primary address exists
        if (!farcasterPrimaryAddress) {
            return await returnError(
                verifierContract, 
                farcasterFid, 
                wallet, 
                'No primary address found for this FID'
            );
        }

        // Compare addresses (case-insensitive)
        const walletLower = wallet.toLowerCase();
        const farcasterAddressLower = farcasterPrimaryAddress.toLowerCase();

        if (walletLower !== farcasterAddressLower) {
            return await returnError(
                verifierContract, 
                farcasterFid, 
                wallet, 
                `Address mismatch: wallet ${wallet} does not match Farcaster primary address ${farcasterPrimaryAddress}`
            );
        }

        console.log(`✅ Verification successful: FID ${farcasterFid} primary address matches wallet ${wallet}`);

        // Check for Twitter verification as an enhancement
        const twitterCheck = await checkForTwitterVerification(farcasterFid.toString(), farcasterPrimaryAddress, verifierContract);
        
        if (twitterCheck.hasTwitter && twitterCheck.twitterUserId) {
            console.log(`🎉 Combined verification: FID ${farcasterFid} also has Twitter account ${twitterCheck.twitterUserId}`);
            
            // Use combined verification function
            return {
                canExec: true,
                callData: [
                    {
                        to: userArgs.verifierContractAddress as string,
                        data: verifierContract.interface.encodeFunctionData("verifyBothFarcasterAndTwitter", [
                            farcasterFid,
                            twitterCheck.twitterUserId,
                            wallet
                        ]),
                    },
                ],
            };
        } else {
            console.log(`📝 Standard verification: FID ${farcasterFid} Farcaster-only verification`);
            
            // SUCCESS: Primary address matches wallet - Farcaster only
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

    } catch (error: any) {
        console.error('Error during Farcaster verification:', error);
        
        if (error instanceof HTTPError) {
            // Attempt to read the error response as JSON
            try {
                const errorBody = await error.response.json();
                return await returnError(
                    verifierContract, 
                    farcasterFid, 
                    wallet, 
                    `Farcaster API error (${error.response.status}): ${JSON.stringify(errorBody)}`
                );
            } catch (parseError) {
                return await returnError(
                    verifierContract, 
                    farcasterFid, 
                    wallet, 
                    `Farcaster API error (${error.response.status}): ${error.message}`
                );
            }
        } else {
            return await returnError(
                verifierContract, 
                farcasterFid, 
                wallet, 
                `Verification failed: ${error.message}`
            );
        }
    }
});

async function returnError(
    contract: Contract, 
    farcasterFid: any, 
    userWallet: string, 
    errorMsg: string
): Promise<Web3FunctionResult> {
    const contractAddress = await contract.getAddress();
    console.log('❌ Farcaster verification error:', contractAddress, errorMsg);
    
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
    };
}