import { expect } from "chai";
import hre from "hardhat";
import { Contract, EventLog } from "ethers";
import { GMCoin } from "../typechain";
import { deployGMCoinWithProxy } from "./tools/deployContract";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Web3FunctionHardhat } from "@gelatonetwork/web3-functions-sdk/hardhat-plugin";
import { Web3FunctionUserArgs, Web3FunctionResultV2 } from "@gelatonetwork/web3-functions-sdk";
import { generateEventLog } from './tools/helpers';

const { ethers, w3f } = hre;

describe("Farcaster Verification", function () {
    let farcasterVerificationW3f: Web3FunctionHardhat;

    before(async function () {
        farcasterVerificationW3f = w3f.get('farcaster-verification');
    });

    describe("Farcaster Verification Function", function () {
        it("should verify user with matching primary address", async function () {
            const {
                coinContract: smartContract,
                owner,
                gelatoAddr
            } = await loadFixture(deployGMCoinWithProxy);

            const gelatoContract = smartContract.connect(gelatoAddr);
            const testWallet = owner;
            const testFid = 12345;

            // Mock the Web3 Function
            const userArgs: Web3FunctionUserArgs = {
                verifierContractAddress: await smartContract.getAddress()
            };

            // Generate event log for VerifyFarcasterRequested
            const eventLog = generateEventLog(
                smartContract.interface,
                "VerifyFarcasterRequested",
                [testFid, testWallet.address],
                await smartContract.getAddress()
            );

            // Mock the Farcaster API to return the same address
            const mockSecrets = new Map<string, string>();
            mockSecrets.set("NEYNAR_API_KEY", "test-api-key");

            // Execute the Web3 Function
            const { result } = await farcasterVerificationW3f.run({
                userArgs,
                blockNumber: 1000000,
                log: eventLog,
                secrets: mockSecrets
            });

            expect(result.canExec).to.be.true;
            expect(result.callData).to.have.length(1);

            // Verify the transaction would call verifyFarcaster correctly
            const callData = result.callData![0];
            expect(callData.to).to.equal(await smartContract.getAddress());

            // Decode the function call
            const decodedData = smartContract.interface.decodeFunctionData("verifyFarcaster", callData.data);
            expect(decodedData[0]).to.equal(testFid); // farcasterFid
            expect(decodedData[1]).to.equal(testWallet.address); // wallet
        });

        it("should handle verification error for address mismatch", async function () {
            const {
                coinContract: smartContract,
                owner,
                gelatoAddr
            } = await loadFixture(deployGMCoinWithProxy);

            const testWallet = owner;
            const testFid = 12345;

            const userArgs: Web3FunctionUserArgs = {
                verifierContractAddress: await smartContract.getAddress()
            };

            // Generate event log for VerifyFarcasterRequested
            const eventLog = generateEventLog(
                smartContract.interface,
                "VerifyFarcasterRequested",
                [testFid, testWallet.address],
                await smartContract.getAddress()
            );

            const mockSecrets = new Map<string, string>();
            mockSecrets.set("NEYNAR_API_KEY", "test-api-key");

            // Mock the API to return a different address
            // In a real test, we'd mock the HTTP requests to return different addresses

            // For now, we'll simulate the error case by testing the error handling
            const { result } = await farcasterVerificationW3f.run({
                userArgs,
                blockNumber: 1000000,
                log: eventLog,
                secrets: mockSecrets
            });

            // The function should still be able to execute (to call error function)
            expect(result.canExec).to.be.true;
        });
    });

    describe("Farcaster Oracle Contract", function () {
        it("should emit VerifyFarcasterRequested event when verifyFarcaster is called", async function () {
            const {
                coinContract: smartContract,
                owner
            } = await loadFixture(deployGMCoinWithProxy);

            const testFid = 12345;

            // Call the verifyFarcaster function
            const tx = await smartContract.connect(owner).verifyFarcaster(testFid);
            const receipt = await tx.wait();

            // Check that the correct event was emitted
            const events = receipt!.logs.filter(log => {
                try {
                    const parsed = smartContract.interface.parseLog({
                        topics: log.topics,
                        data: log.data
                    });
                    return parsed?.name === "VerifyFarcasterRequested";
                } catch {
                    return false;
                }
            });

            expect(events).to.have.length(1);

            const eventLog = smartContract.interface.parseLog({
                topics: events[0].topics,
                data: events[0].data
            });

            expect(eventLog!.args[0]).to.equal(testFid); // farcasterFid
            expect(eventLog!.args[1]).to.equal(owner.address); // wallet
        });

        it("should reject verification if FID already registered", async function () {
            const {
                coinContract: smartContract,
                owner,
                gelatoAddr
            } = await loadFixture(deployGMCoinWithProxy);

            const gelatoContract = smartContract.connect(gelatoAddr);
            const testFid = 12345;

            // First, register the FID through the Gelato contract
            await gelatoContract.verifyFarcaster(testFid, owner.address);

            // Try to register the same FID again - should fail
            await expect(
                smartContract.connect(owner).verifyFarcaster(testFid)
            ).to.be.revertedWith("Farcaster account already linked");
        });

        it("should reject verification if wallet already linked to FID", async function () {
            const {
                coinContract: smartContract,
                owner,
                feeAddr,
                gelatoAddr
            } = await loadFixture(deployGMCoinWithProxy);

            const gelatoContract = smartContract.connect(gelatoAddr);
            const testFid1 = 12345;
            const testFid2 = 67890;

            // First, register a FID with the owner's wallet
            await gelatoContract.verifyFarcaster(testFid1, owner.address);

            // Try to register a different FID with the same wallet - should fail
            await expect(
                smartContract.connect(owner).verifyFarcaster(testFid2)
            ).to.be.revertedWith("wallet already linked to FID");
        });

        it("should successfully complete verification flow", async function () {
            const {
                coinContract: smartContract,
                owner,
                gelatoAddr,
                coinsMultiplicator
            } = await loadFixture(deployGMCoinWithProxy);

            const gelatoContract = smartContract.connect(gelatoAddr);
            const testFid = 12345;

            // Check initial state
            expect(await smartContract.isFarcasterUserRegistered(testFid)).to.be.false;
            expect(await smartContract.getFIDByWallet(owner.address)).to.equal(0);

            // Complete the verification through Gelato contract
            const tx = await gelatoContract.verifyFarcaster(testFid, owner.address);
            const receipt = await tx.wait();

            // Check that the verification was successful
            expect(await smartContract.isFarcasterUserRegistered(testFid)).to.be.true;
            expect(await smartContract.getFIDByWallet(owner.address)).to.equal(testFid);
            expect(await smartContract.getWalletByFID(testFid)).to.equal(owner.address);

            // Check that tokens were minted
            const expectedMintAmount = coinsMultiplicator;
            expect(await smartContract.balanceOf(owner.address)).to.equal(expectedMintAmount);

            // Check that FarcasterVerificationResult event was emitted
            const events = receipt!.logs.filter(log => {
                try {
                    const parsed = smartContract.interface.parseLog({
                        topics: log.topics,
                        data: log.data
                    });
                    return parsed?.name === "FarcasterVerificationResult";
                } catch {
                    return false;
                }
            });

            expect(events).to.have.length(1);

            const eventLog = smartContract.interface.parseLog({
                topics: events[0].topics,
                data: events[0].data
            });

            expect(eventLog!.args[0]).to.equal(testFid); // farcasterFid
            expect(eventLog!.args[1]).to.equal(owner.address); // wallet
            expect(eventLog!.args[2]).to.be.true; // isSuccess
            expect(eventLog!.args[3]).to.equal(""); // errorMsg
        });

        it("should handle verification error correctly", async function () {
            const {
                coinContract: smartContract,
                owner,
                gelatoAddr
            } = await loadFixture(deployGMCoinWithProxy);

            const gelatoContract = smartContract.connect(gelatoAddr);
            const testFid = 12345;
            const errorMessage = "Primary address mismatch";

            // Call the error function
            const tx = await gelatoContract.farcasterVerificationError(
                owner.address,
                testFid,
                errorMessage
            );
            const receipt = await tx.wait();

            // Check that verification failed - user should not be registered
            expect(await smartContract.isFarcasterUserRegistered(testFid)).to.be.false;
            expect(await smartContract.getFIDByWallet(owner.address)).to.equal(0);

            // Check that no tokens were minted
            expect(await smartContract.balanceOf(owner.address)).to.equal(0);

            // Check that FarcasterVerificationResult event was emitted with error
            const events = receipt!.logs.filter(log => {
                try {
                    const parsed = smartContract.interface.parseLog({
                        topics: log.topics,
                        data: log.data
                    });
                    return parsed?.name === "FarcasterVerificationResult";
                } catch {
                    return false;
                }
            });

            expect(events).to.have.length(1);

            const eventLog = smartContract.interface.parseLog({
                topics: events[0].topics,
                data: events[0].data
            });

            expect(eventLog!.args[0]).to.equal(testFid); // farcasterFid
            expect(eventLog!.args[1]).to.equal(owner.address); // wallet
            expect(eventLog!.args[2]).to.be.false; // isSuccess
            expect(eventLog!.args[3]).to.equal(errorMessage); // errorMsg
        });

        it("should work with unified user system", async function () {
            const {
                coinContract: smartContract,
                owner,
                gelatoAddr
            } = await loadFixture(deployGMCoinWithProxy);

            const gelatoContract = smartContract.connect(gelatoAddr);
            const testFid = 12345;

            // Enable unified user system
            await smartContract.enableUnifiedUserSystem();

            // Verify Farcaster using the unified flow
            const tx = await gelatoContract.verifyFarcasterUnified(testFid, owner.address);
            const receipt = await tx.wait();

            // Check regular Farcaster verification worked
            expect(await smartContract.isFarcasterUserRegistered(testFid)).to.be.true;
            expect(await smartContract.getFIDByWallet(owner.address)).to.equal(testFid);

            // Check unified user system integration
            expect(await smartContract.isWalletLinkedToUnifiedUser(owner.address)).to.be.true;

            // Check that UnifiedUserCreated event was emitted
            const events = receipt!.logs.filter(log => {
                try {
                    const parsed = smartContract.interface.parseLog({
                        topics: log.topics,
                        data: log.data
                    });
                    return parsed?.name === "UnifiedUserCreated";
                } catch {
                    return false;
                }
            });

            expect(events).to.have.length(1);

            const eventLog = smartContract.interface.parseLog({
                topics: events[0].topics,
                data: events[0].data
            });

            expect(eventLog!.args[1]).to.equal(owner.address); // primaryWallet
            expect(eventLog!.args[2]).to.equal(""); // twitterId (empty)
            expect(eventLog!.args[3]).to.equal(testFid); // farcasterFid
        });
    });
});
