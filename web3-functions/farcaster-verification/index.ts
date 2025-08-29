import {
  Web3Function,
  Web3FunctionEventContext,
  Web3FunctionResult,
} from "@gelatonetwork/web3-functions-sdk";
import { Contract, Interface } from "ethers";
import ky from "ky";

const VerifierContractABI = [
  "function verifyFarcaster(uint256 farcasterFid, address wallet) external",
  "function farcasterVerificationError(uint256 farcasterFid, address wallet, string calldata errorMsg) external",
  "function getWalletByUserID(string calldata username) public returns (address)",
  "function verifyTwitter(string calldata userID, address wallet) public",
  "function getUnifiedUserIDByWallet(address wallet) public view returns (uint256)",
  "event VerifyFarcasterRequested(uint256 indexed farcasterFid, address indexed wallet)",
  "function linkFarcasterWalletToUnifiedUser(uint256 userId, address wallet) public"
];

Web3Function.onRun(async (context: Web3FunctionEventContext): Promise<Web3FunctionResult> => {
  const { log, userArgs, multiChainProvider } = context;

  const provider = multiChainProvider.default();
  // Contract instance for on-chain reads (cast provider to appease TS types)
  const verifierContract = new Contract(
    userArgs.verifierContractAddress as string,
    VerifierContractABI,
    provider as any
  );
  // Pure encoder for callData
  const iface = new Interface(VerifierContractABI);

  console.log("🔄 Starting Farcaster verification...");

  // Parse the event that triggered this Web3 Function (reuse this interface)
  const contract = new Interface(VerifierContractABI);

  try {
    const event = contract.parseLog(log);
    if (!event || !event.args) {
      return { canExec: false, message: "Invalid or unparsable event log" };
    }
    // Extract event data
    const { farcasterFid, wallet } = event.args as any;

    // Validate event data
    if (!farcasterFid || !wallet) {
      return {
        canExec: false,
        message: `Invalid event data: farcasterFid=${farcasterFid}, wallet=${wallet}`
      };
    }

    const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
    if (!NEYNAR_API_KEY) {
      throw new Error("NEYNAR_API_KEY is not set");
    }

    console.log(`📧 Event received: VerifyFarcasterRequested for FID ${farcasterFid} and wallet ${wallet}`);

    console.log(`🔍 Verifying FID ${farcasterFid} for wallet ${wallet}`);

    // Step 1: Fetch primary wallet for this FID (convert uint256 to string for API)
    const primaryWallet = await fetchPrimaryWalletForFid(farcasterFid.toString(), NEYNAR_API_KEY);

    if (!primaryWallet) {
      console.log(`❌ No primary wallet found for FID ${farcasterFid}`);
      return returnError(userArgs.verifierContractAddress as string, iface, farcasterFid, wallet, "No primary wallet found for this FID");
    }

    // Step 2: Check if the primary wallet matches the requesting wallet
    if (primaryWallet.toLowerCase() !== wallet.toLowerCase()) {
      console.log(`❌ Wallet mismatch for FID ${farcasterFid}. Expected: ${primaryWallet}, Got: ${wallet}`);
      return returnError(userArgs.verifierContractAddress as string, iface, farcasterFid, wallet, "Wallet does not match primary wallet for this FID");
    }

    // Step 3: Check if Farcaster user has Twitter username linked
    const twitterID = await fetchTwitterUserIDFromFarcaster(farcasterFid.toString());

    let callData: any[] = [];
    callData.push({
      to: userArgs.verifierContractAddress as string,
      data: iface.encodeFunctionData("createOrLinkUnifiedUser", [
        primaryWallet,
        twitterID,
        farcasterFid
      ])
    });

    return {
      canExec: true,
      callData: callData
    };

  } catch (error: unknown) {
    const msg = (error as any)?.message || String(error);
    console.error("❌ Fatal error in Farcaster verification:", error);

    // Try to get the event data for error reporting (reuse existing interface)
    try {
      const event = contract.parseLog(log);
      if (!event || !event.args) return { canExec: false, message: `Fatal error: ${msg}` };
      const { farcasterFid, wallet } = event.args as any;

      return returnError(userArgs.verifierContractAddress as string, iface, farcasterFid, wallet, `Fatal error: ${msg}`);
    } catch (parseError: unknown) {
      console.error("❌ Could not parse event for error reporting:", parseError);
      return { canExec: false, message: `Fatal error: ${msg}` };
    }
  }
});

async function fetchPrimaryWalletForFid(fid: string, neynarApiKey: string): Promise<string | null> {
  let primaryAddress: string | null = null;
  try {
    console.log(`🔍 Fetching primary wallet for FID ${fid}`);

    // 1) Warpcast: primary custody address for the FID
    const response = await ky.get(`https://api.farcaster.xyz/fc/primary-address?fid=${fid}&protocol=ethereum`, {
      timeout: 3000
    });

    const data = await response.json() as any;
    primaryAddress = data?.result?.address?.address;
    if (primaryAddress) {
      console.log(`✅ Found primary wallet via Farcaster API: ${primaryAddress}`);
    }

  } catch (error) {
    console.error(`❌ Error fetching primary wallet for FID ${fid}:`, error);
  }

  if (primaryAddress) {
    return String(primaryAddress).toLowerCase();
  }

  try {
    console.log(`🔄 Trying Neynar fallback for FID ${fid}`);
    const response = await ky.get(`https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}&viewer_fid=1`, {
      timeout: 3000,
      headers: {
        'x-api-key': neynarApiKey
      }
    });
    const data = await response.json() as any;
    if (data?.users?.[0]?.verifications?.length > 0) {
      primaryAddress = String(data.users[0].verified_addresses.primary.eth_address).toLowerCase();
      if (primaryAddress) {
        console.log(`✅ Found primary wallet via Neynar: ${primaryAddress}`);
      }
    }
  } catch (fallbackError) {
    console.error(`❌ Neynar fallback also failed:`, fallbackError);
  }


  if (primaryAddress) {
    const addr = String(primaryAddress).toLowerCase();
    console.log(`✅ Found primary wallet: ${addr}`);
    return addr;
  }

  console.log(`ℹ️ No primaryAddress from Warpcast for FID ${fid}`);

  return null;
}

async function fetchTwitterUserIDFromFarcaster(fid: string): Promise<string> {
  try {
    console.log(`🔍 Fetching Twitter username for FID ${fid}`);

    // Use Warpcast account-verifications for Twitter handle discovery
    const response = await ky.get(`https://api.farcaster.xyz/fc/account-verifications?fid=${fid}&platform=x`, {
      timeout: 3000
    });

    const data = await response.json() as any;
    const verifications = data?.result?.verifications || data?.verifications;
    if (verifications && Array.isArray(verifications)) {
      // Look for Twitter verification in the verifications array
      for (const verification of verifications) {
        if (verification && (verification.platform === 'x' || verification.platform === 'twitter' || verification.type === 'twitter')) {
          const twitterId = verification.platformId;
          if (twitterId) {
            console.log(`✅ Found Twitter username: ${verification.platformUsername}`);
            return twitterId;
          }
        }
      }
    }

    console.log(`ℹ️ No Twitter username found for FID ${fid} - this is OK`);
    return "";

  } catch (error) {
    console.error(`❌ Error fetching Twitter username for FID ${fid}:`, error);
    return "";
  }
}

function returnError(
  contractAddress: string,
  iface: Interface,
  farcasterFid: number,
  wallet: string,
  errorMessage: string
): Web3FunctionResult {
  return {
    canExec: true,
    callData: [{
      to: contractAddress,
      data: iface.encodeFunctionData("farcasterVerificationError", [
        farcasterFid,
        wallet,
        errorMessage
      ])
    }]
  };
}