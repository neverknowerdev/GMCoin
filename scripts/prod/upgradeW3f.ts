import hre, { ethers } from "hardhat";

import { encodeUserArgs, loadEnvVariables, setSecretsForW3f } from "./utils";

const { w3f } = hre;

async function main() {
    const contractAddress = hre.network.name == "base" ? "0x26f36F365E5EB6483DF4735e40f87E96e15e0007" : "0xc5Da77c0C7933Aef5878dF571a4DdC4F3e9090f7";
    const [owner, feeAddress] = await ethers.getSigners();

    try {
        // Uncomment the functions you want to run
        // await setupTwitterVerification(contractAddress, owner);
        // console.log('setting up twitter verification thirdweb..', owner.address);
        // await setupTwitterVerificationThirdweb(contractAddress, owner);
        // await setupTwitterVerificationAuthcode(contractAddress, owner);
        await setupTwitterWorker(contractAddress, owner);
        // await setupDailyFunction(contractAddress);

        console.log('all done!!');
    } catch (error) {
        console.error("Error in main:", error);
        process.exitCode = 1;
    }
}

main().catch((error: Error) => {
    console.error("Error deploying TwitterCoin:", error);
    process.exitCode = 1;
});


async function setupTwitterVerification(contractAddress: string, owner: any) {
    const twitterVerificationFunc = w3f.get('twitter-verification');
    const twitterVerificationCID = await twitterVerificationFunc.deploy();
    console.log('twitterVerification CID', twitterVerificationCID);

    const twitterVerificationArgsHex = await encodeUserArgs(twitterVerificationCID, {
        verifierContractAddress: contractAddress,
        twitterHost: "https://api.x.com",
    });

    const GMCoin = (await ethers.getContractFactory("GMCoin")).attach(contractAddress);
    const twitterVerifyRequestedEvent = GMCoin.interface.getEvent('VerifyTwitterRequested');
    const twitterVerifyTopics: string[][] = [[ethers.id(twitterVerifyRequestedEvent?.format("sighash") as string)]];

    let tx = await GMCoin.createTwitterVerificationFunction(twitterVerificationCID, twitterVerificationArgsHex, twitterVerifyTopics);
    await tx.wait();

    const gelatoConfig = await GMCoin.gelatoConfig();
    const twitterVerificationTaskId = gelatoConfig.gelatoTaskId_twitterVerification;
    const twitterVerificationSecrets = loadEnvVariables('twitter-verification', "prod");

    await setSecretsForW3f(contractAddress, owner, twitterVerificationTaskId, hre.network.config.chainId as number, twitterVerificationSecrets);

    return twitterVerificationTaskId;
}

async function setupTwitterVerificationThirdweb(contractAddress: string, owner: any) {
    // const twitterVerificationThirdwebFunc = w3f.get('twitter-verification-thirdweb');
    // const twitterVerificationThirdwebCID = await twitterVerificationThirdwebFunc.deploy();
    // console.log('twitterVerificationThirdweb CID', twitterVerificationThirdwebCID);

    // const twitterVerificationThirdwebArgsHex = await encodeUserArgs(twitterVerificationThirdwebCID, {
    //     verifierContractAddress: contractAddress
    // });

    const GMCoin = (await ethers.getContractFactory("GMCoin")).attach(contractAddress);
    // const twitterVerifyThirdwebRequestedEvent = GMCoin.interface.getEvent('verifyTwitterThirdwebRequested');
    // const twitterVerifyThirdwebTopics: string[][] = [[ethers.id(twitterVerifyThirdwebRequestedEvent?.format("sighash") as string)]];

    // let tx = await GMCoin.createTwitterVerificationThirdwebFunction(twitterVerificationThirdwebCID, twitterVerificationThirdwebArgsHex, twitterVerifyThirdwebTopics);
    // await tx.wait();

    const gelatoConfig = await GMCoin.gelatoConfig();
    const twitterVerificationThirdwebTaskId = gelatoConfig.gelatoTaskId_twitterVerificationThirdweb;
    const twitterVerificationThirdwebSecrets = loadEnvVariables('twitter-verification-thirdweb', "prod");

    await setSecretsForW3f(contractAddress, owner, twitterVerificationThirdwebTaskId, hre.network.config.chainId as number, twitterVerificationThirdwebSecrets);

    return twitterVerificationThirdwebTaskId;
}

async function setupTwitterVerificationAuthcode(contractAddress: string, owner: any) {
    const twitterVerificationAuthcodeFunc = w3f.get('twitter-verification-authcode');
    const twitterVerificationAuthcodeCID = await twitterVerificationAuthcodeFunc.deploy();
    console.log('twitterVerificationAuthcode CID', twitterVerificationAuthcodeCID);

    const twitterVerificationAuthcodeArgsHex = await encodeUserArgs(twitterVerificationAuthcodeCID, {
        verifierContractAddress: contractAddress
    });

    const GMCoin = (await ethers.getContractFactory("GMCoin")).attach(contractAddress);
    const twitterVerifyAuthcodeRequestedEvent = GMCoin.interface.getEvent('verifyTwitterByAuthCodeRequested');
    const twitterVerifyAuthcodeTopics: string[][] = [[ethers.id(twitterVerifyAuthcodeRequestedEvent?.format("sighash") as string)]];

    let tx = await GMCoin.createTwitterVerificationAuthcodeFunction(twitterVerificationAuthcodeCID, twitterVerificationAuthcodeArgsHex, twitterVerifyAuthcodeTopics);
    await tx.wait();

    const gelatoConfig = await GMCoin.gelatoConfig();
    const twitterVerificationAuthcodeTaskId = gelatoConfig.gelatoTaskId_twitterVerificationAuthcode;
    const twitterVerificationAuthcodeSecrets = loadEnvVariables('twitter-verification-authcode', "prod");

    await setSecretsForW3f(contractAddress, owner, twitterVerificationAuthcodeTaskId, hre.network.config.chainId as number, twitterVerificationAuthcodeSecrets);

    return twitterVerificationAuthcodeTaskId;
}

async function setupTwitterWorker(contractAddress: string, owner: any) {
    const twitterWorkerFunc = w3f.get('twitter-worker');
    const twitterWorkerCID = await twitterWorkerFunc.deploy();
    console.log('twitterWorkerCID CID', twitterWorkerCID);

    const twitterWorkerArgsHex = await encodeUserArgs(twitterWorkerCID, {
        "contractAddress": contractAddress,
        "tweetLookupURL": "https://api.twitter.com/2/tweets",
        "serverURLPrefix": "https://ue63semz7f.execute-api.eu-central-1.amazonaws.com/mainnet/",
        "concurrencyLimit": 10,
        "twitterOptimizedServerHost": ""
    });

    const GMCoin = (await ethers.getContractFactory("GMCoin")).attach(contractAddress);
    const twitterMintingProcessedEvent = GMCoin.interface.getEvent('twitterMintingProcessed');
    const twitterWorkerTopics: string[][] = [[ethers.id(twitterMintingProcessedEvent?.format("sighash") as string)]];

    let tx = await GMCoin.createTwitterWorkerFunction(twitterWorkerCID, twitterWorkerArgsHex, twitterWorkerTopics);
    await tx.wait();

    const gelatoConfig = await GMCoin.gelatoConfig();
    const twitterWorkerTaskId = gelatoConfig.gelatoTaskId_twitterWorker;
    const twitterWorkerSecrets = loadEnvVariables('twitter-worker', "prod");

    await setSecretsForW3f(contractAddress, owner, twitterWorkerTaskId, hre.network.config.chainId as number, twitterWorkerSecrets);

    return twitterWorkerTaskId;
}

async function setupDailyFunction(contractAddress: string) {
    const GMCoin = (await ethers.getContractFactory("GMCoin")).attach(contractAddress);
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const nextDay2AM = currentTimestamp + secondsUntilNext2AM();
    console.log('secondsUntil2AM', nextDay2AM);
    const interval = 60 * 60 * 24; // 1 day
    const execData = GMCoin.interface.encodeFunctionData("startMinting", []);
    let tx = await GMCoin.createDailyFunction(nextDay2AM, interval, execData);
    await tx.wait();
}

function secondsUntilNext2AM(): number {
    const now = new Date();
    const next2AM = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 2);
    if (now >= next2AM) next2AM.setDate(next2AM.getDate() + 1);
    return Math.floor((next2AM.getTime() - now.getTime()) / 1000);
}