const hre = require("hardhat");

import {ethers, upgrades} from "hardhat";

async function main(): Promise<void> {
    // Get the ContractFactory for "TwitterCoin"
    const contract = await ethers.getContractFactory("GMCoinPreLunch");

    if (hre.network.name !== "base") {
        throw new Error(`This script must be run on the 'base' network. Current network: ${hre.network.name}`);
    }

    const [owner] = await ethers.getSigners();

    // // Deploy an upgradeable proxy for TwitterCoin using UUPS pattern
    // const GMCoin = await upgrades.deployProxy(contract,
    //     [owner.address],
    //     {
    //         kind: "uups",
    //         initializer: 'initialize'
    //     });
    //
    // // Wait for the deployment to be completed
    // await GMCoin.waitForDeployment();
    //
    // // Retrieve and log the deployed contract address
    // const address: string = await GMCoin.getAddress();
    // console.log("GMCoinPreLunch deployed to:", address);
    const address = '0x13BF2ada9e43a5B061117fF3d0B495d7842f8f08';

    const implementationAddress = await upgrades.erc1967.getImplementationAddress(address);
    console.log("Implementation Contract Address:", implementationAddress);

    console.log('verifying implementation contract..');
    await hre.run('verify:verify', {
        address: implementationAddress,
    })
}

// Execute the main function and handle potential errors
main().catch((error: Error) => {
    console.error("Error deploying GMCoinPreLunch:", error);
    process.exitCode = 1;
});