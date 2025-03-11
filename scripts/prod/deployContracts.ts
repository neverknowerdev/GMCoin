import fs from "fs";

const hre = require("hardhat");


import {ethers, upgrades} from "hardhat";


async function main(): Promise<void> {
    if (hre.network.name !== "base") {
        throw new Error(`This script must be run on the 'base' network. Current network: ${hre.network.name}`);
    }

    const contract = await ethers.getContractFactory("GMCoin");

    const [owner, feeAddress] = await ethers.getSigners();

    const relayerServerAddress = "0xda5f67A923887181B3848eF4d609D747d9dbBb43";

    const treasuryContractFactory = await ethers.getContractFactory("GMTreasury");
    const treasuryContract = await treasuryContractFactory.deploy();
    await treasuryContract.waitForDeployment();

    const treasuryAddress = await treasuryContract.getAddress();
    console.log('treasuryContract address', treasuryAddress);

    // init GMCoin contract
    // Deploy an upgradeable proxy for TwitterCoin using UUPS pattern
    const GMCoin = await upgrades.deployProxy(contract,
        [owner.address, feeAddress.address, treasuryAddress, relayerServerAddress, 100, 7],
        {
            kind: "uups",
            initializer: 'initialize',
            salt: "gm"
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

    console.log('verifying treasury contract..');
    await hre.run('verify:verify', {
        address: treasuryAddress,
    })

    let tx = await treasuryContract.setToken(address);
    const receipt = await tx.wait();

    console.log("setToken transaction confirmed.");
}

// Execute the main function and handle potential errors
main().catch((error: Error) => {
    console.error("Error deploying TwitterCoin:", error);
    process.exitCode = 1;
});