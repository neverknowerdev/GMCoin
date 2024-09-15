import { expect } from "chai";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import hre from "hardhat";
const { ethers, w3f, upgrades } = hre;
import {
    Web3FunctionUserArgs,
    Web3FunctionResultV2,
  } from "@gelatonetwork/web3-functions-sdk";
import { Web3FunctionHardhat } from "@gelatonetwork/web3-functions-sdk/hardhat-plugin";
import { GMCoin } from "../typechain";

describe("TwitterVerification", function () {
    it("gelato w3f run", async function () {
        let oracleW3f: Web3FunctionHardhat;
        let userArgs: Web3FunctionUserArgs;

        const [owner, feeAddr, gelatoAddr] = await hre.ethers.getSigners();

        const TwitterCoin = await ethers.getContractFactory("GMCoin");
        const instance: GMCoin = await upgrades.deployProxy(TwitterCoin, [owner.address, feeAddr.address, 50, 100000, gelatoAddr.address], {kind: "uups"}) as unknown as GMCoin;

        await instance.waitForDeployment();

        const verifierAddress = await instance.getAddress();
        console.log(`deployed GMCoin to ${verifierAddress}`);

        oracleW3f = w3f.get("twitter-verification");

        userArgs = {
            verifierContractAddress: verifierAddress,
        };

        let { result } = await oracleW3f.run("onRun", { userArgs });
        result = result as Web3FunctionResultV2;

        expect(result.canExec).to.equal(true);
        if (!result.canExec) throw new Error("!result.canExec");

        const calldata = result.callData[0];
        await gelatoAddr.sendTransaction({ to: calldata.to, data: calldata.data });

        // instance.walletsByUsername()
        // const lastUpdated = await oracle.lastUpdated();
        // const timeNow = await time.latest();

        // expect(lastUpdated).to.equal(timeNow);
    });
})