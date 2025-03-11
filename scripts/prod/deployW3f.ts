import {AutomateModule} from "@gelatonetwork/automate-sdk";
import hre, {ethers} from "hardhat";
import {HardhatEthersSigner} from "@nomicfoundation/hardhat-ethers/signers";
import {SiweMessage} from "siwe";
import axios from "axios";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import {encodeUserArgs, loadEnvVariables, setSecretsForW3f} from "./utils";

const {w3f} = hre;

async function main() {
    const contractAddress = "0x26f36F365E5EB6483DF4735e40f87E96e15e0007";

    if (hre.network.name !== "base") {
        throw new Error(`This script must be run on the 'base' network. Current network: ${hre.network.name}`);
    }

    if (contractAddress == "") {
        throw new Error(`contractAddress must be set`);
    }

    const [owner, feeAddress] = await ethers.getSigners();
    //
    const GMCoin = (await ethers.getContractFactory("GMCoin")).attach(contractAddress);
    //
    const twitterVerificationFunc = w3f.get('twitter-verification');
    const twitterVerificationCID = await twitterVerificationFunc.deploy();
    console.log('twitterVerification CID', twitterVerificationCID);

    const twitterWorkerFunc = w3f.get('twitter-worker');
    const twitterWorkerCID = await twitterWorkerFunc.deploy();
    console.log('twitterWorkerCID CID', twitterWorkerCID);


    console.log('encoding twitter-verification args..');
    let am = new AutomateModule();
    const twitterVerificationArgsHex = await encodeUserArgs(twitterVerificationCID, {
        verifierContractAddress: contractAddress,
        twitterHost: "https://api.x.com",
    });

    console.log('encoding twitter-worker args..');
    const twitterWorkerArgsHex = await encodeUserArgs(twitterWorkerCID, {
        "contractAddress": contractAddress,
        "searchPath": "/Search",
        "tweetLookupURL": "https://api.twitter.com/2/tweets",
        "convertToUsernamesPath": "/UserResultsByRestIds",
        "serverSaveTweetsURL": "https://ue63semz7f.execute-api.eu-central-1.amazonaws.com/mainnet/SaveTweets",
        "concurrencyLimit": 10,
        "twitterOptimizedServerHost": ""
    });

    console.log('encoding twitter-verify event topics..');
    const twitterVerifyRequestedEvent = GMCoin.interface.getEvent('VerifyTwitterRequested');
    const twitterVerifyTopics: string[][] = [[ethers.id(twitterVerifyRequestedEvent?.format("sighash") as string)]];

    console.log('encoding twitter-worker event topics..');
    const twitterMintingProcessedEvent = GMCoin.interface.getEvent('twitterMintingProcessed');
    const twitterWorkerTopics: string[][] = [[ethers.id(twitterMintingProcessedEvent?.format("sighash") as string)]];

    console.log('calling GMCoin.createTwitterVerificationFunction..');
    // function createTwitterVerificationFunction(string calldata _w3fHash, bytes calldata argsHash, bytes32[][] calldata topics) public onlyOwner onlyDedicatedMsgSender {
    let tx = await GMCoin.createTwitterVerificationFunction(twitterVerificationCID, twitterVerificationArgsHex, twitterVerifyTopics);
    await tx.wait();

    console.log('calling GMCoin.createTwitterWorkerFunction..');
    //  function createTwitterWorkerFunction(string calldata _w3fHash, bytes calldata argsHash, bytes32[][] calldata topics) public onlyOwner {
    tx = await GMCoin.createTwitterWorkerFunction(twitterWorkerCID, twitterWorkerArgsHex, twitterWorkerTopics);
    await tx.wait()

    console.log('calling GMCoin.createDailyFunction..');
    const secondsUntil2AM = secondsUntilNext2AM();
    const interval = 60 * 60 * 24; // 1 day
    const execData = GMCoin.interface.encodeFunctionData("startMinting", []);
    tx = await GMCoin.createDailyFunction(secondsUntil2AM, interval, execData);
    await tx.wait();


    const gelatoConfig = await GMCoin.gelatoConfig();
    console.log('gelatoConfig', gelatoConfig);
    const twitterVerificationTaskId = gelatoConfig.gelatoTaskId_twitterVerification;
    const twitterWorkerTaskId = gelatoConfig.gelatoTaskId_twitterWorker;
    const dailyTriggerTaskId = gelatoConfig.gelatoTaskId_dailyTrigger;

    console.log('twitter-verification task id: ', twitterVerificationTaskId);
    console.log('twitter-worker task id: ', twitterWorkerTaskId);
    console.log('dailyTrigger task id: ', dailyTriggerTaskId);

    const twitterVerificationSecrets = loadEnvVariables('twitter-verification', "prod");
    const twitterWorkerSecrets = loadEnvVariables('twitter-worker', "prod");

    console.log('setting secrets for twitter-verification..');
    await setSecretsForW3f(contractAddress, owner, twitterVerificationTaskId, hre.network.config.chainId as number, twitterVerificationSecrets);
    console.log('setting secrets for twitter-worker..');
    await setSecretsForW3f(contractAddress, owner, twitterWorkerTaskId, hre.network.config.chainId as number, twitterWorkerSecrets);

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

main().catch((error: Error) => {
    console.error("Error deploying TwitterCoin:", error);
    process.exitCode = 1;
});