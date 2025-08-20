import { ethers } from "hardhat";
import { Web3Function } from "@gelatonetwork/web3-functions-sdk";

async function main() {
  console.log("🚀 Deploying Farcaster Worker...");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // Get contract address from environment or deployment
  const contractAddress = process.env.CONTRACT_ADDRESS;
  if (!contractAddress) {
    throw new Error("CONTRACT_ADDRESS not set in environment");
  }

  console.log("Target contract address:", contractAddress);

  // Deploy the Web3 Function
  const farcasterWorker = await Web3Function.deploy("farcaster-worker", {
    rootDir: "./web3-functions"
  });

  console.log("✅ Farcaster Worker deployed!");
  console.log("Web3Function CID:", farcasterWorker.cid);

  // Configuration for Gelato task creation
  const userArgs = {
    contractAddress: contractAddress,
    concurrencyLimit: 3,
    serverURLPrefix: process.env.SERVER_URL_PREFIX || "https://api.example.com/",
    neynarFeedURL: "https://api.neynar.com/v2/farcaster/feed/"
  };

  console.log("\n📋 Configuration for Gelato Task:");
  console.log("Web3Function CID:", farcasterWorker.cid);
  console.log("User Args:", JSON.stringify(userArgs, null, 2));

  console.log("\n🔧 Required Secrets:");
  console.log("- NEYNAR_API_KEY: Your Neynar API key");
  console.log("- SERVER_API_KEY: Server authentication key");
  console.log("- AWS_ACCESS_KEY_ID: AWS access key for CloudWatch");
  console.log("- AWS_SECRET_ACCESS_KEY: AWS secret key for CloudWatch");
  console.log("- ENV: Environment (local|testnet|mainnet)");

  console.log("\n⏰ Next Steps:");
  console.log("1. Set up the required secrets in Gelato");
  console.log("2. Create a Gelato task with the above configuration");
  console.log("3. Set the task to trigger on farcasterMintingProcessed event");
  console.log("4. Test with a small batch of Farcaster users");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });