import { AutomateModule } from "@gelatonetwork/automate-sdk";
import hre, { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { encodeUserArgs, setSecretsForW3f } from "./utils";

const { w3f } = hre;

async function main() {
    const contractAddress = hre.network.name == "base" ? "0x26f36F365E5EB6483DF4735e40f87E96e15e0007" : "0xc5Da77c0C7933Aef5878dF571a4DdC4F3e9090f7";

    const [owner] = await ethers.getSigners();
    
    const GMCoin = (await ethers.getContractFactory("GMCoin")).attach(contractAddress);

    console.log('Deploying Farcaster verification Web3 function...');
    
    // Deploy the Farcaster verification function
    const farcasterVerificationFunc = w3f.get('farcaster-verification');
    const farcasterVerificationCID = await farcasterVerificationFunc.deploy();
    console.log('Farcaster verification CID:', farcasterVerificationCID);

    // Encode user arguments for the function
    console.log('Encoding farcaster-verification args...');
    const farcasterVerificationArgsHex = await encodeUserArgs(farcasterVerificationCID, {
        verifierContractAddress: contractAddress,
    });

    // Get the event topic for VerifyFarcasterRequested
    console.log('Encoding farcaster-verify event topics...');
    const farcasterVerifyRequestedEvent = GMCoin.interface.getEvent('VerifyFarcasterRequested');
    const farcasterVerifyTopics: string[][] = [[ethers.id(farcasterVerifyRequestedEvent?.format("sighash") as string)]];

    // Create the Farcaster verification function in the contract
    console.log('Calling GMCoin.createFarcasterVerificationFunction...');
    const tx = await GMCoin.createFarcasterVerificationFunction(
        farcasterVerificationCID, 
        farcasterVerificationArgsHex, 
        farcasterVerifyTopics
    );
    await tx.wait();

    // Get the task ID for the new function
    const gelatoConfig = await GMCoin.gelatoConfig();
    const farcasterVerificationTaskId = gelatoConfig.gelatoTaskId_farcasterVerification;
    
    console.log('Farcaster verification task ID:', farcasterVerificationTaskId);

    // Set up secrets (if any are needed - Farcaster API doesn't require authentication)
    // For now, we don't need any secrets as Farcaster API is public
    // But we can add them later if needed
    
    console.log('✅ Farcaster verification function deployed successfully!');
    console.log('Contract address:', contractAddress);
    console.log('Function CID:', farcasterVerificationCID);
    console.log('Task ID:', farcasterVerificationTaskId);
}

main().catch((error: Error) => {
    console.error("Error deploying Farcaster verification function:", error);
    process.exitCode = 1;
});