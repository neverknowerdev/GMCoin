import { expect } from "chai";
import hre from "hardhat";
import { Web3FunctionResultV2 } from "@gelatonetwork/web3-functions-sdk";
import { Web3FunctionHardhat } from "@gelatonetwork/web3-functions-sdk/hardhat-plugin";
import { MockHttpServer } from './tools/mockServer';
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployGMCoinWithProxy } from "./tools/deployContract";
import { generateEventLog } from './tools/helpers';
import { GMCoinExposed } from "../typechain";

const { w3f } = hre;

describe("GelatoW3F Twitter Verification Thirdweb", function () {
    let mockServer: MockHttpServer;

    before(async function () {
        // Initialize and start the mock server
        mockServer = new MockHttpServer(8118);
        mockServer.start();
    });

    after(async function () {
        // Stop the mock server after all tests
        mockServer.stop();
    });

    beforeEach(async function () {
        // Reset mocks before each test
        mockServer.resetMocks();
    });

    it('twitter-verification thirdweb success', async function () {
        const {
            coinContract: smartContract,
            owner,
            feeAddr,
            gelatoAddr,
            otherAcc1: userAddr
        } = await loadFixture(deployGMCoinWithProxy);


        const userID = "1796129942104657921";
        const walletAddressSmartAccount = "0xbe25A5869EDFAe90Ce28451e78b4acC6acBEbFF1";

        const verifierAddress = await smartContract.getAddress();
        console.log(`deployed GMCoin to ${verifierAddress}`);


        // Generate event log for verifyTwitterThirdwebRequested
        const log = await generateEventLog('verifyTwitterThirdwebRequested', [walletAddressSmartAccount, userID]);

        // Get the web3-function
        let oracleW3f: Web3FunctionHardhat = w3f.get("twitter-verification-thirdweb");

        let { result } = await oracleW3f.run("onRun", {
            userArgs: {
                verifierContractAddress: verifierAddress
            },
            log: log

        });
        result = result as Web3FunctionResultV2;

        console.log('result', result);
        expect(result.canExec).to.equal(true);

        if (result.canExec) {
            for (let calldata of result.callData) {
                await gelatoAddr.sendTransaction({ to: calldata.to, data: calldata.data });
            }
        }

        let resultWallet = await smartContract.getWalletByUserID(userID as any);
        expect(resultWallet).to.equal(walletAddressSmartAccount);
    });

}); 