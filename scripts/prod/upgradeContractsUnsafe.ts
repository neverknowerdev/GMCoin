const hre = require("hardhat");

import { ethers, upgrades } from "hardhat";
import { run } from "hardhat";

async function main(): Promise<void> {

    const contractV3 = await ethers.getContractFactory("GMCoin");

    const contractAddress = hre.network.name == "base" ? "0x26f36F365E5EB6483DF4735e40f87E96e15e0007" : "0x19bD68AD19544FFA043B2c3A5064805682783E91";

    const [owner] = await ethers.getSigners();

    const newContract = await ethers.getContractFactory("GMCoin");

    console.log('deploying new implementation..');
    const deployedImplementation = await newContract.deploy();
    await deployedImplementation.waitForDeployment();
    const deployedContractAddress = await deployedImplementation.getAddress();

    console.log(`deployed new implementation at ${deployedContractAddress}`);

    console.log('verifying implementation..');
    await hre.run('verify:verify', {
        address: deployedContractAddress,
    })
    console.log('successfully verified');

    const proxyContract = await ethers.getContractAt("GMCoin", contractAddress);

    const tx2 = await proxyContract.upgradeToAndCall(deployedContractAddress, '0x');
    await tx2.wait();

    console.log('all done')
}

// Execute the main function and handle potential errors
main().catch((error: Error) => {
    console.error("Error deploying GMCoin:", error);
    process.exitCode = 1;
});