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

    it('twitter-verification authcode success', async function () {
        const {
            coinContract: smartContract,
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

        // Mock Twitter API response
        mockServer.mockFunc(`/tweet/${tweetID}`, 'GET', (url, headers) => {
            expect(headers.authorization).to.equal(bearerHeader);
            return {
                data: {
                    tweet_result: {
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

        const verifierAddress = await smartContract.getAddress();
        console.log(`deployed GMCoin to ${verifierAddress}`);

        // Generate event log for verifyTwitterByAuthCodeRequested
        const log = await generateEventLog('verifyTwitterByAuthCodeRequested', [walletAddress, authCode, tweetID, userID]);

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
                await gelatoAddr.sendTransaction({ to: calldata.to, data: calldata.data });
            }
        }

        let resultWallet = await smartContract.getWalletByUserID(userID as any);
        expect(resultWallet).to.equal(walletAddress);
    });

    it('twitter-verification authcode error - auth code not found in tweet', async function () {
        const {
            coinContract: smartContract,
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

        const verifierAddress = await smartContract.getAddress();
        console.log(`deployed GMCoin to ${verifierAddress}`);

        // Generate event log for verifyTwitterByAuthCodeRequested
        const log = await generateEventLog('verifyTwitterByAuthCodeRequested', [walletAddress, authCode, tweetID, userID]);

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
                const receipt = await tx.wait();

                // Check for TwitterVerificationResult event
                const event = receipt?.logs.find(
                    log => log.topics[0] === smartContract.interface.getEvent('TwitterVerificationResult').topicHash
                );
                expect(event).to.not.be.undefined;

                const decodedEvent = smartContract.interface.parseLog({
                    topics: event?.topics as string[],
                    data: event?.data as string
                });

                expect(decodedEvent?.args.isSuccess).to.be.false;
                expect(decodedEvent?.args.errorMsg).to.equal("Auth code not found in tweet");
                expect(decodedEvent?.args.userID).to.equal(userID);
                expect(decodedEvent?.args.wallet).to.equal(walletAddress);
            }
        }

        let resultWallet = await smartContract.getWalletByUserID(userID as any);
        expect(resultWallet).to.equal("0x0000000000000000000000000000000000000000");
    });

    it('twitter-verification authcode error - invalid auth code format', async function () {
        const {
            coinContract: smartContract,
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

        const verifierAddress = await smartContract.getAddress();
        console.log(`deployed GMCoin to ${verifierAddress}`);

        // Generate event log for verifyTwitterByAuthCodeRequested
        const log = await generateEventLog('verifyTwitterByAuthCodeRequested', [walletAddress, authCode, tweetID, userID]);

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
                const receipt = await tx.wait();

                // Check for TwitterVerificationResult event
                const event = receipt?.logs.find(
                    log => log.topics[0] === smartContract.interface.getEvent('TwitterVerificationResult').topicHash
                );
                expect(event).to.not.be.undefined;

                const decodedEvent = smartContract.interface.parseLog({
                    topics: event?.topics as string[],
                    data: event?.data as string
                });

                expect(decodedEvent?.args.isSuccess).to.be.false;
                expect(decodedEvent?.args.errorMsg).to.equal("Wallet letters in auth code do not match the wallet address");
                expect(decodedEvent?.args.userID).to.equal(userID);
                expect(decodedEvent?.args.wallet).to.equal(walletAddress);
            }
        }

        let resultWallet = await smartContract.getWalletByUserID(userID as any);
        expect(resultWallet).to.equal("0x0000000000000000000000000000000000000000");
    });
}); 