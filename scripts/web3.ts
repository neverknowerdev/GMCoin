const hre = require("hardhat");

import { ethers } from "hardhat";
import { run } from "hardhat";

async function main(): Promise<void> {

    // if (hre.network.name !== "baseSepolia") {
    //     throw new Error(`This script must be run on the 'baseSepolia' network. Current network: ${hre.network.name}`);
    // }

    const contractAddress = hre.network.name == "base" ? "0x26f36F365E5EB6483DF4735e40f87E96e15e0007" : "0xc5Da77c0C7933Aef5878dF571a4DdC4F3e9090f7";

    const [owner, feeAddress, farcasterAcc] = await ethers.getSigners();
    // Get the contract instance
    const contract = (await ethers.getContractAt("GMCoin", contractAddress)).connect(owner);


    const tx = await contract.continueMintingForADay();
    await tx.wait();

    return;

    // const tx = await contract.triggerVerifyTwitter("1796129942104657921", "0x6bc2531Fe2De8c2A2F72465B7d0588249A9BA1Eb");
    // await tx.wait()

    // return;

    // const tx2 = await contract.removeMe();
    // await tx2.wait();

    // const tx2 = await contract.removeUser("1796129942104657921", "0x6bc2531Fe2De8c2A2F72465B7d0588249A9BA1Eb");
    // await tx2.wait();

    // return;

    console.log('encoding twitter-worker event topics..');
    const twitterMintingProcessedEvent = contract.interface.getEvent('changedComplexity');
    const twitterWorkerTopics: string[][] = [[ethers.id(twitterMintingProcessedEvent?.format("sighash") as string)]];
    // const resp = await contract.userByWallet(owner.address as any);
    console.log('topics', twitterWorkerTopics);

    return;
    // const tx = await contract.upgradeToAndCall("0x37e82120B82E294e293D58F6A431DE908688a5B2", '0x')
    // await tx.wait();
    // const tx = await contract.cancelWeb3Function('0xf20973a55f4f29e9a58bd83ae32b8ebdbb2c7954dcfd434075175cbdbc9682a3');
    // const tx = await contract.createWeb3Functions('Qmd3evcVCqMMHoBkKe3NrDfDuE3tpTa35QAifahkBGf2n6', '0xBc011Bab6A3C5AE25ca8055e36B242775683172E');

    // console.log("Transaction sent. Waiting for confirmation...");
    // await tx.wait(); // Wait for the transaction to be mined

    // await hre.run('verify:verify', {
    //     address: '0x37e82120B82E294e293D58F6A431DE908688a5B2',
    // })

    // console.log("Transaction confirmed. Hash:", tx.hash);
}

// Execute the main function and handle potential errors
main().catch((error: Error) => {
    console.error("Error deploying GGCoin:", error);
    process.exitCode = 1;
});