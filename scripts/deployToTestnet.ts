const hre = require("hardhat");


import {ethers, upgrades} from "hardhat";

async function main(): Promise<void> {
    // Get the ContractFactory for "TwitterCoin"
    const contract = await ethers.getContractFactory("GMCoinTestnet");

    if (hre.network.name !== "baseSepolia") {
        throw new Error(`This script must be run on the 'baseSepolia' network. Current network: ${hre.network.name}`);
    }

    // defender.deployProxy()

    const [owner] = await ethers.getSigners();

    // Deploy an upgradeable proxy for TwitterCoin using UUPS pattern
    const GMCoin = await upgrades.deployProxy(contract,
        [owner.address, owner.address, 50, 100_000, '0x12EBb8C121b706aE6368147afc5B54702cB26637', 100_000, 2],
        {
            kind: "uups",
            initializer: 'initialize'
        });

    // Wait for the deployment to be completed
    await GMCoin.waitForDeployment();

    // Retrieve and log the deployed contract address
    const address: string = await GMCoin.getAddress();
    console.log("GMCoin deployed to:", address);

    const implementationAddress = await upgrades.erc1967.getImplementationAddress(address);
    console.log("Implementation Contract Address:", implementationAddress);

    console.log('verifying implementation contract..');
    await hre.run('verify:verify', {
        address: implementationAddress,
    })
}

// Execute the main function and handle potential errors
main().catch((error: Error) => {
    console.error("Error deploying TwitterCoin:", error);
    process.exitCode = 1;
});