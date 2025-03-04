const hre = require("hardhat");

import {ethers, upgrades} from "hardhat";
import {run} from "hardhat";

async function main(): Promise<void> {
    // Get the ContractFactory for "TwitterCoin"
    const contractV3 = await ethers.getContractFactory("GMCoin");

    if (hre.network.name !== "baseSepolia") {
        throw new Error(`This script must be run on the 'base' network. Current network: ${hre.network.name}`);
    }

    const [owner] = await ethers.getSigners();

    // Deploy an upgradeable proxy for TwitterCoin using UUPS pattern
    // address _owner, uint256 _initialSupply, string calldata _gelatoW3fHash, string calldata _serverURL
    const upgraded = await upgrades.upgradeProxy('0x19bD68AD19544FFA043B2c3A5064805682783E91', contractV3, {
        // call: {
        //     fn: "initialize3",
        //     args: [7, 0, 100],
        // }
    })
    // const GMCoin = await upgrades.deployProxy(contract,
    //     [owner.address, 500_000, 'Qme39LGvEnhLJ5dLkthrkqFcu9Dcp5ibb6RvnpqYvWoUXA', 'https://l4xtgdsal5.execute-api.eu-central-1.amazonaws.com/default/GMSecrets'],
    //     {
    //         kind: "uups",
    //         initializer: 'initialize'
    //     });
    const address = await upgraded.getAddress();
    console.log(`upgraded at ${address}`);

    const implementationAddress = await upgrades.erc1967.getImplementationAddress(address);
    console.log("Implementation Contract Address:", implementationAddress);

    console.log('verifying implementation contract..');
    await hre.run('verify:verify', {
        address: implementationAddress,
    })
}

// Execute the main function and handle potential errors
main().catch((error: Error) => {
    console.error("Error deploying GGCoin:", error);
    process.exitCode = 1;
});