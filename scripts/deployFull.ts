import fs from "fs";

const hre = require("hardhat");


import {ethers, upgrades, run} from "hardhat";
import {AutomateSDK, AutomateModule} from "@gelatonetwork/automate-sdk";
import {Interface} from "ethers/lib.esm";
import {EventFragment} from "ethers";
import {SiweMessage} from "siwe";
import axios from "axios";
import {HardhatEthersSigner} from "@nomicfoundation/hardhat-ethers/signers";
import path from "path";
import dotenv from "dotenv";

const {w3f} = hre;

async function main(): Promise<void> {
    if (hre.network.name !== "baseSepolia") {
        throw new Error(`This script must be run on the 'baseSepolia' network. Current network: ${hre.network.name}`);
    }

    // Deploy libraries first
    console.log('Deploying libraries...');
    const TwitterOracleLib = await ethers.getContractFactory("TwitterOracleLib");
    const twitterLib = await TwitterOracleLib.deploy();
    await twitterLib.waitForDeployment();
    const twitterLibAddress = await twitterLib.getAddress();
    console.log('TwitterOracleLib deployed to:', twitterLibAddress);

    const MintingLib = await ethers.getContractFactory("MintingLib");
    const mintingLib = await MintingLib.deploy();
    await mintingLib.waitForDeployment();
    const mintingLibAddress = await mintingLib.getAddress();
    console.log('MintingLib deployed to:', mintingLibAddress);

    const FarcasterOracleLib = await ethers.getContractFactory("FarcasterOracleLib");
    const farcasterLib = await FarcasterOracleLib.deploy();
    await farcasterLib.waitForDeployment();
    const farcasterLibAddress = await farcasterLib.getAddress();
    console.log('FarcasterOracleLib deployed to:', farcasterLibAddress);

    const AccountManagerLib = await ethers.getContractFactory("AccountManagerLib");
    const accountLib = await AccountManagerLib.deploy();
    await accountLib.waitForDeployment();
    const accountLibAddress = await accountLib.getAddress();
    console.log('AccountManagerLib deployed to:', accountLibAddress);

    // Get the ContractFactory for "GMCoin" with library linking
    const contract = await ethers.getContractFactory("GMCoin", {
        libraries: {
            "contracts/TwitterOracleLib.sol:TwitterOracleLib": twitterLibAddress,
            "contracts/MintingLib.sol:MintingLib": mintingLibAddress,
            "contracts/FarcasterOracleLib.sol:FarcasterOracleLib": farcasterLibAddress,
            "contracts/AccountManagerLib.sol:AccountManagerLib": accountLibAddress,
        },
    });

    const twitterVerificationFunc = w3f.get('twitter-verification');
    const twitterVerificationCID = await twitterVerificationFunc.deploy();
    console.log('twitterVerification CID', twitterVerificationCID);

    const twitterWorkerFunc = w3f.get('twitter-worker');
    const twitterWorkerCID = await twitterWorkerFunc.deploy();
    console.log('twitterWorkerCID CID', twitterWorkerCID);

    const [owner, feeAddress] = await ethers.getSigners();

    const treasuryContractFactory = await ethers.getContractFactory("GMTreasury");
    const treasuryContract = await treasuryContractFactory.deploy();
    await treasuryContract.waitForDeployment();

    const treasuryAddress = await treasuryContract.getAddress();
    console.log('treasuryContract addrress', treasuryAddress);

    // init GMCoin contract
    // Deploy an upgradeable proxy for GMCoin using UUPS pattern
    const GMCoin = await upgrades.deployProxy(contract,
        [owner.address, owner.address, treasuryAddress, '0x12EBb8C121b706aE6368147afc5B54702cB26637', 100_000, 2],
        {
            kind: "uups",
            initializer: 'initialize',
            unsafeAllowLinkedLibraries: true,
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

    console.log('encoding twitter-verification args..');
    let am = new AutomateModule();
    const twitterVerificationArgsHex = await am.encodeWeb3FunctionArgs(twitterVerificationCID, {
        verifierContractAddress: address.toString(),
        twitterHost: "https://api.x.com",
    });

    console.log('encoding twitter-worker args..');
    const twitterWorkerArgsHex = await am.encodeWeb3FunctionArgs(twitterWorkerCID, {
        "contractAddress": address.toString(),
        "searchPath": "/Search",
        "tweetLookupURL": "https://api.twitter.com/2/tweets",
        "convertToUsernamesPath": "/UserResultsByRestIds",
        "serverSaveTweetsURL": "https://ue63semz7f.execute-api.eu-central-1.amazonaws.com/testnet/SaveTweets",
        "concurrencyLimit": 10,
        "twitterOptimizedServerHost": ""
    });

    console.log('encoding twitter-verify event topics..');
    const twitterVerifyRequestedEvent = GMCoin.interface.getEvent('VerifyTwitterRequested');
    // const twitterVerifyTopics: string[][] = [[ethers.id(twitterVerifyRequestedEvent?.format("sighash") as string)]];
    // console.log('topics', twitterVerifyTopics);
    const twitterVerifyTopics: string[][] = [[
        "0xa5ad92a05a481deca6490891b32fb01290968d76ddd9b07af8e2e4079d8cc3ff",
        "0x0000000000000000000000006794a56583329794f184d50862019ecf7b6d8aa2"
    ]]

    console.log('encoding twitter-worker event topics..');
    const twitterMintingProcessedEvent = GMCoin.interface.getEvent('twitterMintingProcessed');
    const twitterWorkerTopics: string[][] = [[ethers.id(twitterMintingProcessedEvent?.format("sighash") as string)]];

    console.log('calling GMCoin.createTwitterVerificationFunction..');
    // function createTwitterVerificationFunction(string calldata _w3fHash, bytes calldata argsHash, bytes32[][] calldata topics) public onlyOwner onlyDedicatedMsgSender {
    tx = await GMCoin.createTwitterVerificationFunction(twitterVerificationCID, twitterVerificationArgsHex, twitterVerifyTopics);
    await tx.wait();

    console.log('calling GMCoin.createTwitterWorkerFunction..');
    //  function createTwitterWorkerFunction(string calldata _w3fHash, bytes calldata argsHash, bytes32[][] calldata topics) public onlyOwner {
    tx = await GMCoin.createTwitterWorkerFunction(twitterWorkerCID, twitterWorkerArgsHex, twitterWorkerTopics);
    await tx.wait();

    console.log('calling GMCoin.createDailyFunction..');
    const secondsUntil2AM = secondsUntilNext2AM();
    const interval = 60 * 60 * 24; // 1 day
    const execData = GMCoin.interface.encodeFunctionData("startMinting", []);
    tx = await GMCoin.createDailyFunction(secondsUntil2AM, interval, execData);
    await tx.wait();

    const twitterVerificationTaskId = await GMCoin.twitterVerificationTaskId();
    const twitterWorkerTaskId = await GMCoin.twitterWorkerTaskId();
    const dailyTriggerTaskId = await GMCoin.dailyTriggerTaskId();

    console.log('twitter-verification task id: ', twitterVerificationTaskId);
    console.log('twitter-worker task id: ', twitterWorkerTaskId);
    console.log('dailyTrigger task id: ', dailyTriggerTaskId);

    const twitterVerificationSecrets = loadEnvVariables('twitter-verification');
    const twitterWorkerSecrets = loadEnvVariables('twitter-worker');

    console.log('setting secrets for twitter-verification..');
    await setSecretsForW3f(address, owner, twitterVerificationTaskId, hre.network.config.chainId as number, twitterVerificationSecrets);
    console.log('setting secrets for twitter-worker..');
    await setSecretsForW3f(address, owner, twitterWorkerTaskId, hre.network.config.chainId as number, twitterWorkerSecrets);

    console.log('all done!!');
}

function secondsUntilNext2AM(): number {
    const now = new Date();
    // Create a date object for today at 2 AM
    const next2AM = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 2);
    // If it's already past 2 AM today, set to 2 AM tomorrow
    if (now >= next2AM) next2AM.setDate(next2AM.getDate() + 1);
    return Math.floor((next2AM.getTime() - now.getTime()) / 1000);
}

async function setSecretsForW3f(contractAddress: string, signer: HardhatEthersSigner, taskId: string, chainId: number, secrets: any) {
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

export function loadEnvVariables(functionName: string): Record<string, string> {
    // Construct the path to the prod.env file
    const envFilePath = path.join(__dirname, "..", "web3-functions", functionName, "prod.env");

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

// Execute the main function and handle potential errors
main().catch((error: Error) => {
    console.error("Error deploying TwitterCoin:", error);
    process.exitCode = 1;
});