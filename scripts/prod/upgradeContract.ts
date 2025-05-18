const hre = require("hardhat");

import { ethers, upgrades } from "hardhat";
import { run } from "hardhat";

async function main(): Promise<void> {

    const contractV3 = await ethers.getContractFactory("GMCoin");

    const contractAddress = hre.network.name == "base" ? "0x26f36F365E5EB6483DF4735e40f87E96e15e0007" : "0x19bD68AD19544FFA043B2c3A5064805682783E91";

    const [owner] = await ethers.getSigners();

    // Deploy an upgradeable proxy for TwitterCoin using UUPS pattern
    // address _owner, uint256 _initialSupply, string calldata _gelatoW3fHash, string calldata _serverURL
    const upgraded = await upgrades.upgradeProxy(contractAddress, contractV3, {
        // call: {
        //     fn: "clearUsers"
        // }

        unsafeAllow: [
            'struct-definition',
            'enum-definition'
        ]
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
    console.error("Error deploying GMCoin:", error);
    process.exitCode = 1;
});