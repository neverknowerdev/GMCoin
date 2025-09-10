import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";

task("addFarcasterUser", "Add a Farcaster user for testing")
  .addParam("fid", "Farcaster FID")
  .addOptionalParam("address", "Wallet address (random if not provided)")
  .setAction(async (taskArgs, hre: HardhatRuntimeEnvironment) => {
    const { ethers } = hre;
    
    // Get contract instance
    const contractAddress = process.env.CONTRACT_ADDRESS;
    if (!contractAddress) {
      throw new Error("CONTRACT_ADDRESS not set in environment");
    }

    const contract = await ethers.getContractAt("GMCoin", contractAddress);
    
    // Generate random address if not provided
    let walletAddress = taskArgs.address;
    if (!walletAddress) {
      const wallet = ethers.Wallet.createRandom();
      walletAddress = wallet.address;
      console.log(`Generated random wallet address: ${walletAddress}`);
    }

    const fid = parseInt(taskArgs.fid);
    
    console.log(`Adding Farcaster user - FID: ${fid}, Address: ${walletAddress}`);
    
    try {
      // Call verifyFarcaster function (this would normally be called by Gelato)
      const tx = await contract.verifyFarcaster(fid, walletAddress);
      await tx.wait();
      
      console.log(`✅ Successfully added Farcaster user!`);
      console.log(`   FID: ${fid}`);
      console.log(`   Wallet: ${walletAddress}`);
      console.log(`   Transaction: ${tx.hash}`);
      
      // Check the user was added
      const isRegistered = await contract.isFarcasterUserRegistered(fid);
      const totalUsers = await contract.totalFarcasterUsersCount();
      
      console.log(`   Registered: ${isRegistered}`);
      console.log(`   Total Farcaster users: ${totalUsers}`);
      
    } catch (error) {
      console.error("❌ Failed to add Farcaster user:", error);
    }
  });