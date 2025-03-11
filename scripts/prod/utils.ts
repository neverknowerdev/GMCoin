import {AutomateModule} from "@gelatonetwork/automate-sdk";
import {ethers} from "hardhat";
import {HardhatEthersSigner} from "@nomicfoundation/hardhat-ethers/signers";
import {SiweMessage} from "siwe";
import axios from "axios";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

export async function encodeUserArgs(functionCID: string, userArgs: any) {
    let am = new AutomateModule();

    const functionArgsHex = await am.encodeWeb3FunctionArgs(functionCID, userArgs);
    const result = ethers.AbiCoder.defaultAbiCoder().decode(["string", "bytes"], functionArgsHex);

    return result[1];
}

export async function setSecretsForW3f(contractAddress: string, signer: HardhatEthersSigner, taskId: string, chainId: number, secrets: any) {
    // const contractAddress = "0xBc011Bab6A3C5AE25ca8055e36B242775683172E";

    // const [signer] = await ethers.getSigners();

    // const taskId = "0xf120ff6740ba0828cd43dee48881e61b9202cb5b8108f42a4655eea81cab9b97";

    const domain = "app.gelato.network";
    const uri = `https://${domain}/`;
    const version = "1";
    // const chainId = 84532;
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

    try {
        await axios.post(
            `https://api.gelato.digital/automate/users/users/${contractAddress}/secrets/${chainId}/${taskId}`,
            {...secrets},
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

    return true;
}

export function loadEnvVariables(functionName: string, env: string): Record<string, string> {
    // Construct the path to the prod.env file
    const envFilePath = path.join(__dirname, "..", "..", "web3-functions", functionName, env + ".env");

    // Check if the file exists
    if (!fs.existsSync(envFilePath)) {
        throw new Error(`prod.env file not found at: ${envFilePath}`);
    }

    // Read the file content
    const envContent = fs.readFileSync(envFilePath, {encoding: "utf8"});

    // Parse the environment variables using dotenv
    const envVars = dotenv.parse(envContent);

    return envVars;
}