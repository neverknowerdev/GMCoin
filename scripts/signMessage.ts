import {ethers, upgrades} from "hardhat";

async function main(): Promise<void> {
    const [signer] = await ethers.getSigners();

    console.log('signer address:', signer.address);
    const signature = await signer.signMessage('twitter-worker');
    console.log('signature', signature);
}

main().catch((error: Error) => {
    console.error("Error signing message:", error);
    process.exitCode = 1;
});