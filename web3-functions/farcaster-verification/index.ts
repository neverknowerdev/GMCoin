import {
  Web3Function,
  Web3FunctionEventContext,
} from "@gelatonetwork/web3-functions-sdk";
import { Contract, Interface } from "ethers";
import ky from "ky";

const VerifierContractABI = [
  "function completeFarcasterVerification(uint256 farcasterFid, address wallet) external",
  "function verifyBothFarcasterAndTwitter(uint256 farcasterFid, address wallet, string calldata twitterId) external",
  "function farcasterVerificationError(uint256 farcasterFid, address wallet, string calldata errorMsg) external",
  "function isTwitterUserRegistered(string calldata userID) external view returns (bool)",
  "function verifyFarcasterAndMergeWithTwitter(uint256 farcasterFid, address wallet, string calldata twitterId) external",
  "event VerifyFarcasterRequested(uint256 indexed farcasterFid, address indexed wallet)",
];

Web3Function.onRun(async (context: Web3FunctionEventContext) => {
  const { log, userArgs, multiChainProvider } = context;

  const provider = multiChainProvider.default();
  const verifierContract = new Contract(
    userArgs.verifierContractAddress as string,
    VerifierContractABI,
    provider
  );

  console.log("🔄 Starting Farcaster verification...");

  // Parse the event that triggered this Web3 Function (reuse this interface)
  const contract = new Interface(VerifierContractABI);

  try {
    const event = contract.parseLog(log);
    
    // Extract event data
    const { farcasterFid, wallet } = event.args;
    
    // Validate event data
    if (!farcasterFid || !wallet) {
      return {
        canExec: false,
        message: `Invalid event data: farcasterFid=${farcasterFid}, wallet=${wallet}`
      };
    }
    
    console.log(`📧 Event received: VerifyFarcasterRequested for FID ${farcasterFid} and wallet ${wallet}`);
    
    console.log(`🔍 Verifying FID ${farcasterFid} for wallet ${wallet}`);

    // Step 1: Fetch primary wallet for this FID (convert uint256 to string for API)
    const primaryWallet = await fetchPrimaryWalletForFid(farcasterFid.toString());
    
    if (!primaryWallet) {
      console.log(`❌ No primary wallet found for FID ${farcasterFid}`);
      return {
        canExec: true,
        callData: [{
          to: userArgs.verifierContractAddress as string,
          data: verifierContract.interface.encodeFunctionData("farcasterVerificationError", [
            farcasterFid,
            wallet,
            "No primary wallet found for this FID"
          ])
        }]
      };
    }

    // Step 2: Check if the primary wallet matches the requesting wallet
    if (primaryWallet.toLowerCase() !== wallet.toLowerCase()) {
      console.log(`❌ Wallet mismatch for FID ${farcasterFid}. Expected: ${primaryWallet}, Got: ${wallet}`);
      return {
        canExec: true,
        callData: [{
          to: userArgs.verifierContractAddress as string,
          data: verifierContract.interface.encodeFunctionData("farcasterVerificationError", [
            farcasterFid,
            wallet,
            "Wallet does not match primary wallet for this FID"
          ])
        }]
      };
    }

    // Step 3: Check if Farcaster user has Twitter username linked
    const twitterUsername = await fetchTwitterUsernameFromFarcaster(farcasterFid.toString());
    
    let callData;
    
    if (twitterUsername) {
      console.log(`✅ Found Twitter username: ${twitterUsername} for FID ${farcasterFid}`);
      
      // Step 4: Check if this Twitter user is already registered in GM
      let isTwitterUserAlreadyRegistered = false;
      try {
        isTwitterUserAlreadyRegistered = await verifierContract.isTwitterUserRegistered(twitterUsername);
      } catch (contractError) {
        console.error(`❌ Error checking Twitter user registration:`, contractError);
        return {
          canExec: true,
          callData: [{
            to: userArgs.verifierContractAddress as string,
            data: verifierContract.interface.encodeFunctionData("farcasterVerificationError", [
              farcasterFid,
              wallet,
              `Error checking Twitter registration: ${contractError.message}`
            ])
          }]
        };
      }
      
      if (isTwitterUserAlreadyRegistered) {
        console.log(`🔗 Twitter user ${twitterUsername} is already registered - merging accounts`);
        callData = {
          to: userArgs.verifierContractAddress as string,
          data: verifierContract.interface.encodeFunctionData("verifyFarcasterAndMergeWithTwitter", [
            farcasterFid,
            wallet,
            twitterUsername
          ])
        };
      } else {
        console.log(`➕ Twitter user ${twitterUsername} not registered yet - creating new unified account`);
        callData = {
          to: userArgs.verifierContractAddress as string,
          data: verifierContract.interface.encodeFunctionData("verifyBothFarcasterAndTwitter", [
            farcasterFid,
            wallet,
            twitterUsername
          ])
        };
      }
    } else {
      // No Twitter username is fine - just verify Farcaster
      console.log(`✅ No Twitter username found for FID ${farcasterFid}, verifying Farcaster only`);
      callData = {
        to: userArgs.verifierContractAddress as string,
        data: verifierContract.interface.encodeFunctionData("completeFarcasterVerification", [
          farcasterFid,
          wallet
        ])
      };
    }

    return {
      canExec: true,
      callData: [callData]
    };

  } catch (error) {
    console.error("❌ Fatal error in Farcaster verification:", error);
    
    // Try to get the event data for error reporting (reuse existing interface)
    try {
      const event = contract.parseLog(log);
      const { farcasterFid, wallet } = event.args;
      
      return {
        canExec: true,
        callData: [{
          to: userArgs.verifierContractAddress as string,
          data: verifierContract.interface.encodeFunctionData("farcasterVerificationError", [
            farcasterFid,
            wallet,
            `Fatal error: ${error.message}`
          ])
        }]
      };
    } catch (parseError) {
      console.error("❌ Could not parse event for error reporting:", parseError);
      return { canExec: false, message: `Fatal error: ${error.message}` };
    }
  }
});

async function fetchPrimaryWalletForFid(fid: string): Promise<string | null> {
  try {
    console.log(`🔍 Fetching primary wallet for FID ${fid}`);
    
    // Use recommended API endpoint from PR feedback
    const response = await ky.get(`https://api.farcaster.xyz/fc/account-verifications?fid=${fid}`, {
      timeout: 3000  // Reduced timeout as suggested in PR feedback
    });

    const data = await response.json() as any;
    
    if (data?.verifications?.length > 0) {
      const primaryWallet = data.verifications[0].address;
      console.log(`✅ Found primary wallet: ${primaryWallet}`);
      return primaryWallet;
    }

    console.log(`❌ No verifications found for FID ${fid}`);
    return null;

  } catch (error) {
    console.error(`❌ Error fetching primary wallet for FID ${fid}:`, error);
    
    // Fallback to Neynar as backup
    try {
      console.log(`🔄 Trying Neynar fallback for FID ${fid}`);
      const response = await ky.get(`https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}&viewer_fid=1`, {
        timeout: 2000  // Even shorter timeout for fallback
      });

      const data = await response.json() as any;
      
      if (data?.users?.[0]?.verifications?.length > 0) {
        // Neynar API returns verification addresses as strings in an array
        const primaryWallet = data.users[0].verifications[0];
        console.log(`✅ Found primary wallet via Neynar: ${primaryWallet}`);
        return primaryWallet;
      }

    } catch (fallbackError) {
      console.error(`❌ Neynar fallback also failed:`, fallbackError);
    }

    return null;
  }
}

async function fetchTwitterUsernameFromFarcaster(fid: string): Promise<string | null> {
  try {
    console.log(`🔍 Fetching Twitter username for FID ${fid}`);
    
    // Use recommended API endpoint
    const response = await ky.get(`https://api.farcaster.xyz/fc/account-verifications?fid=${fid}`, {
      timeout: 3000
    });

    const data = await response.json() as any;
    
    if (data?.verifications && Array.isArray(data.verifications)) {
      // Look for Twitter verification in the verifications array
      for (const verification of data.verifications) {
        if (verification && (verification.platform === 'twitter' || verification.type === 'twitter')) {
          const username = verification.username || verification.handle || verification.value;
          if (username) {
            console.log(`✅ Found Twitter username: ${username}`);
            return username;
          }
        }
      }
    }

    console.log(`ℹ️ No Twitter username found for FID ${fid} - this is OK`);
    return null;

  } catch (error) {
    console.error(`❌ Error fetching Twitter username for FID ${fid}:`, error);
    return null;
  }
}
