import fs from "fs";

const hre = require("hardhat");


import {ethers, upgrades, run} from "hardhat";
import {SiweMessage} from "siwe";
import axios from "axios";
import {HardhatEthersSigner} from "@nomicfoundation/hardhat-ethers/signers";
import path from "path";
import dotenv from "dotenv";


async function main(): Promise<void> {
    if (hre.network.name !== "baseSepolia") {
        throw new Error(`This script must be run on the 'baseSepolia' network. Current network: ${hre.network.name}`);
    }

    const contract = await ethers.getContractFactory("GMCoin");

    const [owner, feeAddress] = await ethers.getSigners();

    const treasuryContractFactory = await ethers.getContractFactory("GMTreasury");
    const treasuryContract = await treasuryContractFactory.deploy();
    await treasuryContract.waitForDeployment();

    const treasuryAddress = await treasuryContract.getAddress();
    console.log('treasuryContract addrress', treasuryAddress);

    // init GMCoin contract
    // Deploy an upgradeable proxy for TwitterCoin using UUPS pattern
    const GMCoin = await upgrades.deployProxy(contract,
        [owner.address, feeAddress.address, treasuryAddress, '0x12EBb8C121b706aE6368147afc5B54702cB26637', 100_000, 2],
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

    let tx = await treasuryContract.setToken(address);
    const receipt = await tx.wait();

    console.log("setToken transaction confirmed.");
}

// Execute the main function and handle potential errors
main().catch((error: Error) => {
    console.error("Error deploying TwitterCoin:", error);
    process.exitCode = 1;
});