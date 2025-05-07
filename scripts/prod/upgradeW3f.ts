import hre, {ethers} from "hardhat";

import {encodeUserArgs, loadEnvVariables, setSecretsForW3f} from "./utils";

const {w3f} = hre;

async function main() {
    const contractAddress = hre.network.name == "base" ? "0x26f36F365E5EB6483DF4735e40f87E96e15e0007" : "0x19bD68AD19544FFA043B2c3A5064805682783E91";

    const [owner, feeAddress] = await ethers.getSigners();

    const GMCoin = (await ethers.getContractFactory("GMCoin")).attach(contractAddress);

    // const twitterVerificationFunc = w3f.get('twitter-verification');
    // const twitterVerificationCID = await twitterVerificationFunc.deploy();
    // console.log('twitterVerification CID', twitterVerificationCID);

    const twitterWorkerFunc = w3f.get('twitter-worker');
    const twitterWorkerCID = await twitterWorkerFunc.deploy();
    console.log('twitterWorkerCID CID', twitterWorkerCID);

    // const twitterVerificationArgsHex = await encodeUserArgs(twitterVerificationCID, {
    //     verifierContractAddress: contractAddress,
    //     twitterHost: "https://api.x.com",
    // });

    const twitterWorkerArgsHex = await encodeUserArgs(twitterWorkerCID, {
        "contractAddress": contractAddress,
        "tweetLookupURL": "https://api.twitter.com/2/tweets",
        "serverURLPrefix": "https://ue63semz7f.execute-api.eu-central-1.amazonaws.com/mainnet/",
        "concurrencyLimit": 10,
        "twitterOptimizedServerHost": ""
    });

    // console.log('encoding twitter-verify event topics..');
    // const twitterVerifyRequestedEvent = GMCoin.interface.getEvent('VerifyTwitterRequested');
    // const twitterVerifyTopics: string[][] = [[ethers.id(twitterVerifyRequestedEvent?.format("sighash") as string)]];

    console.log('encoding twitter-worker event topics..');
    const twitterMintingProcessedEvent = GMCoin.interface.getEvent('twitterMintingProcessed');
    const twitterWorkerTopics: string[][] = [[ethers.id(twitterMintingProcessedEvent?.format("sighash") as string)]];

    // console.log('calling GMCoin.createTwitterVerificationFunction..');
    // function createTwitterVerificationFunction(string calldata _w3fHash, bytes calldata argsHash, bytes32[][] calldata topics) public onlyOwner onlyDedicatedMsgSender {
    // let tx = await GMCoin.createTwitterVerificationFunction(twitterVerificationCID, twitterVerificationArgsHex, twitterVerifyTopics);
    // await tx.wait();

    console.log('calling GMCoin.createTwitterWorkerFunction..');
    // function createTwitterWorkerFunction(string calldata _w3fHash, bytes calldata argsHash, bytes32[][] calldata topics) public onlyOwner {
    let tx = await GMCoin.createTwitterWorkerFunction(twitterWorkerCID, twitterWorkerArgsHex, twitterWorkerTopics);
    await tx.wait()

    // console.log('calling GMCoin.createDailyFunction..');
    // const currentTimestamp = Math.floor(Date.now() / 1000);
    // const nextDay2AM = currentTimestamp + secondsUntilNext2AM();
    // console.log('secondsUntil2AM', nextDay2AM);
    // const interval = 60 * 60 * 24; // 1 day
    // const execData = GMCoin.interface.encodeFunctionData("startMinting", []);
    // let tx = await GMCoin.createDailyFunction(nextDay2AM, interval, execData);
    // await tx.wait();

    const gelatoConfig = await GMCoin.gelatoConfig();
    // console.log('gelatoConfig', gelatoConfig);
    // const twitterVerificationTaskId = gelatoConfig.gelatoTaskId_twitterVerification;
    const twitterWorkerTaskId = gelatoConfig.gelatoTaskId_twitterWorker;
    // const twitterWorkerTaskId = "0xc0c72aa40925b767bb0f28ef5280a0f6d3ed8f321ec651c811552af3d42bd10c";
    // const dailyTriggerTaskId = gelatoConfig.gelatoTaskId_dailyTrigger;
    //
    // console.log('twitter-verification task id: ', twitterVerificationTaskId);
    console.log('twitter-worker task id: ', twitterWorkerTaskId);
    // console.log('dailyTrigger task id: ', dailyTriggerTaskId);
    //
    // const twitterVerificationSecrets = loadEnvVariables('twitter-verification', "prod");
    const twitterWorkerSecrets = loadEnvVariables('twitter-worker', "prod");
    //
    console.log('setting secrets for twitter-verification..');
    // await setSecretsForW3f(contractAddress, owner, twitterVerificationTaskId, hre.network.config.chainId as number, twitterVerificationSecrets);
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