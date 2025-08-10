import {
  Web3Function,
  Web3FunctionContext,
} from "@gelatonetwork/web3-functions-sdk";
import { Contract } from "ethers";
import ky from "ky";

Web3Function.onRun(async (context: Web3FunctionContext) => {
  const { userArgs, multiChainProvider } = context;

  const provider = multiChainProvider.default();
  const verifierContract = new Contract(
    userArgs.verifierContractAddress as string,
    [
      "function completeFarcasterVerification(uint256 farcasterFid, address wallet) external",
      "function verifyBothFarcasterAndTwitter(uint256 farcasterFid, address wallet, string calldata twitterId) external",
      "function farcasterVerificationError(uint256 farcasterFid, address wallet, string calldata errorMsg) external",
    ],
    provider
  );

  console.log("🔄 Starting Farcaster verification...");

  try {
    // Get pending verification requests from storage
    const storage = context.storage;
    const pendingVerifications = await storage.get("pendingVerifications") || [];

    if (pendingVerifications.length === 0) {
      console.log("✅ No pending Farcaster verifications");
      return { canExec: false, message: "No pending verifications" };
    }

    const results = [];

    // Process requests simultaneously as suggested in PR feedback
    const verificationPromises = pendingVerifications.map(async (verification) => {
      const { farcasterFid, wallet, timestamp } = verification;
      
      try {
        console.log(`🔍 Verifying FID ${farcasterFid} for wallet ${wallet}`);

        // Step 1: Fetch primary wallet for this FID
        const primaryWallet = await fetchPrimaryWalletForFid(farcasterFid);
        
        if (!primaryWallet) {
          console.log(`❌ No primary wallet found for FID ${farcasterFid}`);
          return {
            to: userArgs.verifierContractAddress as string,
            data: verifierContract.interface.encodeFunctionData("farcasterVerificationError", [
              farcasterFid,
              wallet,
              "No primary wallet found for this FID"
            ])
          };
        }

        // Step 2: Check if the primary wallet matches the requesting wallet
        if (primaryWallet.toLowerCase() !== wallet.toLowerCase()) {
          console.log(`❌ Wallet mismatch for FID ${farcasterFid}. Expected: ${primaryWallet}, Got: ${wallet}`);
          return {
            to: userArgs.verifierContractAddress as string,
            data: verifierContract.interface.encodeFunctionData("farcasterVerificationError", [
              farcasterFid,
              wallet,
              "Wallet does not match primary wallet for this FID"
            ])
          };
        }

        // Step 3: Check if Farcaster user has Twitter username linked
        const twitterUsername = await fetchTwitterUsernameFromFarcaster(farcasterFid);
        
        if (twitterUsername) {
          console.log(`✅ Found Twitter username: ${twitterUsername} for FID ${farcasterFid}`);
          return {
            to: userArgs.verifierContractAddress as string,
            data: verifierContract.interface.encodeFunctionData("verifyBothFarcasterAndTwitter", [
              farcasterFid,
              wallet,
              twitterUsername
            ])
          };
        } else {
          // No Twitter username is fine - just verify Farcaster
          console.log(`✅ No Twitter username found for FID ${farcasterFid}, verifying Farcaster only`);
          return {
            to: userArgs.verifierContractAddress as string,
            data: verifierContract.interface.encodeFunctionData("completeFarcasterVerification", [
              farcasterFid,
              wallet
            ])
          };
        }

      } catch (error) {
        console.error(`❌ Error verifying FID ${farcasterFid}:`, error);
        return {
          to: userArgs.verifierContractAddress as string,
          data: verifierContract.interface.encodeFunctionData("farcasterVerificationError", [
            farcasterFid,
            wallet,
            `Verification error: ${error.message}`
          ])
        };
      }
    });

    // Wait for all verifications to complete
    const verificationResults = await Promise.all(verificationPromises);
    results.push(...verificationResults);

    // Clear processed verifications
    await storage.set("pendingVerifications", []);

    if (results.length === 0) {
      return { canExec: false, message: "No verifications to process" };
    }

    return {
      canExec: true,
      callData: results
    };

  } catch (error) {
    console.error("❌ Fatal error in Farcaster verification:", error);
    return { canExec: false, message: `Error: ${error.message}` };
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
    
    if (data?.verifications) {
      // Look for Twitter verification in the verifications array
      for (const verification of data.verifications) {
        if (verification.platform === 'twitter' || verification.type === 'twitter') {
          console.log(`✅ Found Twitter username: ${verification.username}`);
          return verification.username;
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
