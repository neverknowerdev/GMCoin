const hre = require("hardhat");

import { ethers, upgrades } from "hardhat";
import { run } from "hardhat";

async function main(): Promise<void> {
    const contractAddress = "0x26f36F365E5EB6483DF4735e40f87E96e15e0007";

    const [owner] = await ethers.getSigners();

    // Get the contract instance
    const contract = await ethers.getContractAt("GMCoin", contractAddress);

    const tx = await contract.continueMintingForADay();
    await tx.wait();

    console.log('tx', tx);
    console.log('Done');
}

// Execute the main function and handle potential errors
main().catch((error: Error) => {
    console.error("Error deploying GGCoin:", error);
    process.exitCode = 1;
});