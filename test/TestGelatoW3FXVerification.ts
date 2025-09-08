import { expect } from "chai";
import hre from "hardhat";
import { Web3FunctionResultV2 } from "@gelatonetwork/web3-functions-sdk";
import { Web3FunctionHardhat } from "@gelatonetwork/web3-functions-sdk/hardhat-plugin";
import { MockHttpServer } from './tools/mockServer';
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployGMCoinWithProxy } from "./tools/deployContract";
import { generateEventLogFromContract } from './tools/helpers';
import { GMCoinExposed } from "../typechain";

const { w3f } = hre;

describe("GelatoW3F Twitter Verification", function () {
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

    it('twitter-verification authcode success', async function () {
        const {
            coinContract: smartContract,
            accountManager,
            owner,
            feeAddr,
            gelatoAddr,
            otherAcc1: userAddr
        } = await loadFixture(deployGMCoinWithProxy);

        const userID = "1796129942104657921";
        const walletAddress = "0xbe25A5869EDFAe90Ce28451e78b4acC6acBEbFF1";
        // Auth code format: GM${walletStartingLetterNumberStr}${wallet10Letters}${random2}
        const walletStartingLetterNumberStr = "02"; // Starting from index 2
        const wallet10Letters = walletAddress.substring(2, 12); // Get 10 letters starting from index 4
        const random2 = "42";
        const authCode = `GM${walletStartingLetterNumberStr}${wallet10Letters}${random2}`.toUpperCase();
        const tweetID = "1768778186186195177";
        const bearerToken = "test-bearer-token";
        const bearerHeader = `Bearer ${bearerToken}`;

        // Mock Twitter API response
        mockServer.mockFunc(`/tweet/`, 'GET', (url, headers) => {
            expect(url.query.tweet_id).to.equal(tweetID);
            expect(headers.authorization).to.equal(bearerHeader);
            return {
                data: {
                    tweet_results: {
                        result: {
                            legacy: {
                                full_text: `Verifying my GMCoin account with code: ${authCode}`,
                                user_id_str: userID
                            }
                        }
                    }
                }
            };
        });

        const verifierAddress = await accountManager.getAddress();
        await accountManager.connect(owner).enableUnifiedUserSystem();
        console.log(`verifier (AccountManager) at ${verifierAddress}`);

        // Generate event log for verifyTwitterByAuthCodeRequested
        const log = await generateEventLogFromContract(accountManager, 'verifyTwitterByAuthCodeRequested', [walletAddress, authCode, tweetID, userID]);

        // Get the web3-function
        let oracleW3f: Web3FunctionHardhat = w3f.get("twitter-verification-authcode");

        let { result } = await oracleW3f.run("onRun", {
            userArgs: {
                verifierContractAddress: verifierAddress
            },
            log: log,
            secrets: {
                TWITTER_GET_TWEET_URL: "http://localhost:8118/tweet/",
                TWITTER_HEADER_NAME: "Authorization",
                TWITTER_BEARER: bearerHeader
            }
        });
        result = result as Web3FunctionResultV2;

        console.log('result', result);
        expect(result.canExec).to.equal(true);

        if (result.canExec) {
            for (let calldata of result.callData) {
                await gelatoAddr.sendTransaction({ to: calldata.to, data: calldata.data });
            }
        }

        const unified = await accountManager.getUnifiedUserByWallet(walletAddress);
        expect(unified.twitterId).to.equal(userID);
    });

    it('twitter-verification authcode error - auth code not found in tweet', async function () {
        const {
            coinContract: smartContract,
            accountManager,
            owner,
            feeAddr,
            gelatoAddr,
            otherAcc1: userAddr
        } = await loadFixture(deployGMCoinWithProxy);

        const userID = "1796129942104657921";
        const walletAddress = "0xbe25A5869EDFAe90Ce28451e78b4acC6acBEbFF1";
        // Auth code format: GM${walletStartingLetterNumberStr}${wallet10Letters}${random2}
        const walletStartingLetterNumberStr = "02"; // Starting from index 2
        const wallet10Letters = walletAddress.substring(4, 14); // Get 10 letters starting from index 4
        const random2 = "42";
        const authCode = `GM${walletStartingLetterNumberStr}${wallet10Letters}${random2}`;
        const tweetID = "1768778186186195177";
        const bearerToken = "test-bearer-token";
        const bearerHeader = `Bearer ${bearerToken}`;

        // Mock Twitter API response with different auth code
        mockServer.mockFunc(`/tweet/${tweetID}`, 'GET', (url, headers) => {
            expect(headers.authorization).to.equal(bearerHeader);
            return {
                data: {
                    tweet_result: {
                        result: {
                            legacy: {
                                full_text: "Verifying my GMCoin account with code: DIFFERENT_CODE",
                                user_id_str: userID
                            }
                        }
                    }
                }
            };
        });

        const verifierAddress = await accountManager.getAddress();
        await accountManager.connect(owner).enableUnifiedUserSystem();
        console.log(`verifier (AccountManager) at ${verifierAddress}`);

        // Generate event log for verifyTwitterByAuthCodeRequested
        const log = await generateEventLogFromContract(accountManager, 'verifyTwitterByAuthCodeRequested', [walletAddress, authCode, tweetID, userID]);

        // Get the web3-function
        let oracleW3f: Web3FunctionHardhat = w3f.get("twitter-verification-authcode");

        let { result } = await oracleW3f.run("onRun", {
            userArgs: {
                verifierContractAddress: verifierAddress
            },
            log: log,
            secrets: {
                TWITTER_GET_TWEET_URL: "http://localhost:8118/tweet/",
                TWITTER_HEADER_NAME: "Authorization",
                TWITTER_BEARER: bearerHeader
            }
        });
        result = result as Web3FunctionResultV2;

        console.log('result', result);
        expect(result.canExec).to.equal(true);

        if (result.canExec) {
            for (let calldata of result.callData) {
                const tx = await gelatoAddr.sendTransaction({ to: calldata.to, data: calldata.data });
                await tx.wait();
            }
        }

        // after error path, user should not be linked
        await expect(accountManager.getUnifiedUserByWallet(walletAddress)).to.be.reverted;
    });

    it('twitter-verification authcode error - invalid auth code format', async function () {
        const {
            coinContract: smartContract,
            accountManager,
            owner,
            feeAddr,
            gelatoAddr,
            otherAcc1: userAddr
        } = await loadFixture(deployGMCoinWithProxy);

        const userID = "1796129942104657921";
        const walletAddress = "0xbe25A5869EDFAe90Ce28451e78b4acC6acBEbFF1";
        // Invalid auth code - wrong wallet letters
        const authCode = "GM02abcdef1234567890";
        const tweetID = "1768778186186195177";
        const bearerToken = "test-bearer-token";
        const bearerHeader = `Bearer ${bearerToken}`;

        const verifierAddress = await accountManager.getAddress();
        await accountManager.connect(owner).enableUnifiedUserSystem();
        console.log(`verifier (AccountManager) at ${verifierAddress}`);

        // Generate event log for verifyTwitterByAuthCodeRequested
        const log = await generateEventLogFromContract(accountManager, 'verifyTwitterByAuthCodeRequested', [walletAddress, authCode, tweetID, userID]);

        // Get the web3-function 
        let oracleW3f: Web3FunctionHardhat = w3f.get("twitter-verification-authcode");

        let { result } = await oracleW3f.run("onRun", {
            userArgs: {
                verifierContractAddress: verifierAddress
            },
            log: log,
            secrets: {
                TWITTER_GET_TWEET_URL: "http://localhost:8118/tweet/",
                HEADER_NAME: "Authorization",
                TWITTER_BEARER: bearerHeader
            }
        });
        result = result as Web3FunctionResultV2;

        console.log('result', result);
        expect(result.canExec).to.equal(true);

        if (result.canExec) {
            for (let calldata of result.callData) {
                const tx = await gelatoAddr.sendTransaction({ to: calldata.to, data: calldata.data });
                await tx.wait();
            }
        }

        await expect(accountManager.getUnifiedUserByWallet(walletAddress)).to.be.reverted;
    });

    it('twitter-verification authCode real data', async function () {
        const {
            coinContract: smartContract,
            accountManager,
            owner,
            feeAddr,
            gelatoAddr,
            otherAcc1: userAddr
        } = await loadFixture(deployGMCoinWithProxy);

        const userID = "1796129942104657921";
        const walletAddress = "0x7Bf09e0B40D1A4be1ff703f0fd85B47B4e08758E";
        const authCode = "GM21703F0FD85BF3";
        const tweetID = "1933866787050770476";
        const bearerToken = "test-bearer-token";
        const bearerHeader = `Bearer ${bearerToken}`;

        const verifierAddress = await accountManager.getAddress();
        await accountManager.connect(owner).enableUnifiedUserSystem();
        console.log(`verifier (AccountManager) at ${verifierAddress}`);

        // Mock Twitter API response
        mockServer.mockFunc(`/tweet/`, 'GET', (url, headers) => {
            expect(headers.authorization).to.equal(bearerHeader);
            return {
                data: {
                    tweet_results: {
                        result: {
                            legacy: {
                                full_text: `Verifying my GMCoin account with code: ${authCode}`,
                                user_id_str: userID
                            }
                        }
                    }
                }
            };
        });

        // Generate event log for verifyTwitterByAuthCodeRequested
        const log = await generateEventLogFromContract(accountManager, 'verifyTwitterByAuthCodeRequested', [walletAddress, authCode, tweetID, userID]);

        // Get the web3-function
        let oracleW3f: Web3FunctionHardhat = w3f.get("twitter-verification-authcode");

        let { result } = await oracleW3f.run("onRun", {
            userArgs: {
                verifierContractAddress: verifierAddress
            },
            log: log,
            secrets: {
                TWITTER_GET_TWEET_URL: "http://localhost:8118/tweet/",
                TWITTER_HEADER_NAME: "Authorization",
                TWITTER_BEARER: bearerHeader
            }
        });
        result = result as Web3FunctionResultV2;

        console.log('result', result);
        expect(result.canExec).to.equal(true);

        if (result.canExec) {
            for (let calldata of result.callData) {
                const tx = await gelatoAddr.sendTransaction({ to: calldata.to, data: calldata.data });
                await tx.wait();
            }
        }

        const unified2 = await accountManager.getUnifiedUserByWallet(walletAddress);
        expect(unified2.twitterId).to.equal(userID);
    });
}); 