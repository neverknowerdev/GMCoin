const hre = require("hardhat");


import {ethers, upgrades} from "hardhat";

async function main(): Promise<void> {
    // Get the ContractFactory for "TwitterCoin"
    const contract = await ethers.getContractFactory("GMCoin");

    if (hre.network.name !== "baseSepolia") {
        throw new Error(`This script must be run on the 'baseSepolia' network. Current network: ${hre.network.name}`);
    }

    const [owner, feeAddress] = await ethers.getSigners();

    const treasuryContractFactory = await ethers.getContractFactory("GMTreasury");
    const treasuryContract = await treasuryContractFactory.deploy();
    await treasuryContract.waitForDeployment();

    const treasuryAddress = await treasuryContract.getAddress();
    console.log('treasuryContract address', treasuryAddress);

    // Deploy an upgradeable proxy for TwitterCoin using UUPS pattern
    const GMCoin = await upgrades.deployProxy(contract,
        [owner.address, feeAddress.address, treasuryAddress, '0xda5f67A923887181B3848eF4d609D747d9dbBb43', 100, 2],
        {
            kind: "uups",
            initializer: 'initialize',
            salt: "gm",
            verifySourceCode: true,
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