import { expect } from "chai";
import hre from "hardhat";
const { ethers, w3f, upgrades } = hre;
import {
    Web3FunctionUserArgs,
    Web3FunctionResultV2,
  } from "@gelatonetwork/web3-functions-sdk";
import { Web3FunctionHardhat } from "@gelatonetwork/web3-functions-sdk/hardhat-plugin";
import { GMCoinExposed } from "../typechain";

describe("TwitterVerification", function () {
    // it("gelato w3f run", async function () {
    //     let oracleW3f: Web3FunctionHardhat;
    //     let userArgs: Web3FunctionUserArgs;

    //     const [owner, feeAddr, gelatoAddr] = await hre.ethers.getSigners();

    //     const TwitterCoin = await ethers.getContractFactory("GMCoinExposed");
    //     const instance: GMCoinExposed = await upgrades.deployProxy(TwitterCoin, [owner.address, feeAddr.address, 50, 100000, gelatoAddr.address], {kind: "uups"}) as unknown as GMCoin;

    //     await instance.waitForDeployment();

    //     const verifierAddress = await instance.getAddress();
    //     console.log(`deployed GMCoin to ${verifierAddress}`);

    //     oracleW3f = w3f.get("twitter-verification");

    //     userArgs = {
    //         verifierContractAddress: verifierAddress,
    //     };

    //     // fetchMock.get('https://api.x.com', 
    //     //         {    
    //     //             "username": "neverknower_dev",
    //     //             "id": "1796129942104657921",
    //     //             "created_at": "2024-05-30T10:42:40.000Z",
    //     //             "name": "NeverKnower",
    //     //             "description": "web3 developer, going to create my own meme-coin\n0x6794a56583329794f184d50862019ecf7b6d8ba6"
    //     //         }
    //     // )

    //     let { result } = await oracleW3f.run("onRun", { userArgs });
    //     result = result as Web3FunctionResultV2;

    //     console.log('result', result);
    //     expect(result.canExec).to.equal(true);
    //     if (!result.canExec) throw new Error("!result.canExec");

    //     for (let calldata of result.callData) {
    //         await gelatoAddr.sendTransaction({ to: calldata.to, data: calldata.data });    
    //     }

    //     let resultWallet = await instance.getWalletByUsername("neverknower_dev");
    //     expect(resultWallet).to.equal("0x6794a56583329794f184d50862019ecf7b6d8ba6");
    //     // const calldata = result.callData[0];
    //     // await gelatoAddr.sendTransaction({ to: calldata.to, data: calldata.data });

    //     // const lastUpdated = await oracle.lastUpdated();
    //     // const timeNow = await time.latest();

    //     // expect(lastUpdated).to.equal(timeNow);
    // });
})