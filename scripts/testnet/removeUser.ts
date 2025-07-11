const hre = require("hardhat");

import { ethers } from "hardhat";
import { run } from "hardhat";

async function main(): Promise<void> {
    if (hre.network.name !== "baseSepolia") {
        throw new Error(`This script must be run on the 'baseSepolia' network. Current network: ${hre.network.name}`);
    }

    const contractAddress = "0xc5Da77c0C7933Aef5878dF571a4DdC4F3e9090f7";

    const [owner, feeAddress] = await ethers.getSigners();

    // Get the contract instance
    const contract = await ethers.getContractAt("GMCoinTestnet", contractAddress);
    const tx = await contract.removeUser("userID", owner.address)

    console.log("Transaction sent. Waiting for confirmation...");
    await tx.wait(); // Wait for the transaction to be mined

    console.log("Transaction confirmed. Hash:", tx.hash);
}

// Execute the main function and handle potential errors
main().catch((error: Error) => {
    console.error("Error deploying GGCoin:", error);
    process.exitCode = 1;
});