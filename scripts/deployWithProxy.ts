// scripts/create-twitterCoin.ts

import { ethers, upgrades } from "hardhat";

async function main(): Promise<void> {
  // Get the ContractFactory for "TwitterCoin"
  const contract = await ethers.getContractFactory("GMCoin");

  const [owner] = await ethers.getSigners();

  // Deploy an upgradeable proxy for TwitterCoin using UUPS pattern
  const GMCoin = await upgrades.deployProxy(contract, [owner.address, owner.address, 50, 0], {
    kind: "uups",
  });

  // Wait for the deployment to be completed
  await GMCoin.waitForDeployment();

  // Retrieve and log the deployed contract address
  const address: string = await GMCoin.getAddress();
  console.log("TwitterCoin deployed to:", address);
}

// Execute the main function and handle potential errors
main().catch((error: Error) => {
  console.error("Error deploying TwitterCoin:", error);
  process.exitCode = 1;
});