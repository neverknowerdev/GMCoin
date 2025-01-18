const hre = require("hardhat");

import {ethers} from "hardhat";
import {SiweMessage} from "siwe";
import axios from "axios";
import {run} from "hardhat";

async function main(): Promise<void> {
    if (hre.network.name !== "baseSepolia") {
        throw new Error(`This script must be run on the 'baseSepolia' network. Current network: ${hre.network.name}`);
    }

    const contractAddress = "0xBc011Bab6A3C5AE25ca8055e36B242775683172E";

    const [signer] = await ethers.getSigners();

    const taskId = "0xf120ff6740ba0828cd43dee48881e61b9202cb5b8108f42a4655eea81cab9b97";

    const domain = "app.gelato.network";
    const uri = `https://${domain}/`;
    const version = "1";
    const chainId = 84532;
    const statement = "Gelato Web3Functions";
    const expirationTimestamp = Date.now() + 600_000;
    const expirationTime = new Date(expirationTimestamp).toISOString();

    // Construct the SIWE message using the provided information
    const siweMessage = new SiweMessage({
        domain,
        statement,
        uri,
        address: contractAddress,
        version,
        chainId,
        expirationTime,
    });

    const message = siweMessage.prepareMessage();
    const signature = await signer.signMessage(message);

    const authToken = Buffer.from(
        JSON.stringify({message, signature})
    ).toString("base64");

    // Define the secret to be set
    const secretsData = {
        BEARER_TOKEN: "testBearerToken2",
        NEW_SECRET: "secretData"
    };

    try {
        await axios.post(
            `https://api.gelato.digital/automate/users/users/${contractAddress}/secrets/${chainId}/${taskId}`,
            {...secretsData},
            {
                headers: {Authorization: `Bearer ${authToken}`},
            }
        );
        console.log("Secrets set successfully!");

        const {data} = await axios.get(
            `https://api.gelato.digital/automate/users/users/${contractAddress}/secrets/${chainId}/${taskId}`,
            {
                headers: {Authorization: `Bearer ${authToken}`},
            }
        );

        console.log(`Secrets fetched: ${JSON.stringify(data)}`);
    } catch (error) {
        console.error("Error setting secrets:", error);
    }
}

// Execute the main function and handle potential errors
main().catch((error: Error) => {
    console.error("Error deploying GGCoin:", error);
    process.exitCode = 1;
});