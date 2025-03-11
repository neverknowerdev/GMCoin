const hre = require("hardhat");

import {ethers, upgrades} from "hardhat";
import {run} from "hardhat";

async function main(): Promise<void> {
    // Get the ContractFactory for "TwitterCoin"
    const newContract = await ethers.getContractFactory("GMCoinTestnet");

    if (hre.network.name !== "baseSepolia") {
        throw new Error(`This script must be run on the 'baseSepolia' network. Current network: ${hre.network.name}`);
    }

    const [owner] = await ethers.getSigners();

    const deployedImplementation = await newContract.deploy();
    const deployedContractAddress = await deployedImplementation.getAddress();

    console.log(`deployed new implementation at ${deployedContractAddress}`);

    console.log('verifying implementation..');
    await hre.run('verify:verify', {
        address: deployedContractAddress,
    })

    const proxyContract = await ethers.getContractAt("GMCoinTestnet", "0x19bD68AD19544FFA043B2c3A5064805682783E91");

    const tx = await proxyContract.forceTimeLockUpdateTestnet(deployedContractAddress);
    await tx.wait()
    const tx2 = await proxyContract.upgradeToAndCall(deployedContractAddress, '0x');
    await tx2.wait();
}

// Execute the main function and handle potential errors
main().catch((error: Error) => {
    console.error("Error deploying GGCoin:", error);
    process.exitCode = 1;
});