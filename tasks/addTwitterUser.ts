import {task} from "hardhat/config";
import hre from "hardhat";

task("addTwitterUser", "Adds a Twitter username to the contract")
    .addParam("contract", "The address of the smart contract")
    .addParam("username", "The Twitter username to add")
    .setAction(async (taskArgs, hre) => {
        const {ethers} = hre;

        const {contract: contractAddress, username} = taskArgs;

        if (hre.network.name !== "baseSepolia") {
            throw new Error(`This script must be run on the 'baseSepolia' network. Current network: ${hre.network.name}`);
        }

        // Generate a random wallet
        const randomWallet = ethers.Wallet.createRandom();

        console.log(`Generated Wallet Address: ${randomWallet.address}`);
        console.log(`Generated Private Key: ${randomWallet.privateKey}`);

        // Get a signer (ensure the signer has funds for the transaction)
        const [signer] = await ethers.getSigners();

        // Load the contract's ABI (replace with your contract's ABI)
        const contractABI = [
            "function addTwitterUsername(string calldata username, address walletAddress)"
        ];

        // Connect to the contract
        const contract = new ethers.Contract(contractAddress, contractABI, signer);

        // Call the `addTwitterUsername` function
        const tx = await contract.addTwitterUsername(username, randomWallet.address);

        console.log("Transaction sent, waiting for confirmation...");
        const receipt = await tx.wait();
        console.log(`Transaction confirmed! Hash: ${receipt.transactionHash}`);
    });

export {};