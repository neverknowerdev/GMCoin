import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { GMCoinExposed } from "../typechain";
import { deployGMCoinWithProxy } from "./tools/deployContract";

describe("Farcaster Verification Unit Tests", function () {
    let gmCoin: GMCoinExposed;
    let owner: HardhatEthersSigner;
    let gelatoAddr: HardhatEthersSigner;
    let user1: HardhatEthersSigner;
    let user2: HardhatEthersSigner;

    const SAMPLE_FID_1 = 123456;
    const SAMPLE_FID_2 = 789012;

    beforeEach(async function () {
        const { 
            coinContract, 
            owner: deployedOwner, 
            gelatoAddr: deployedGelato,
            otherAcc1, 
            otherAcc2 
        } = await loadFixture(deployGMCoinWithProxy);
        
        gmCoin = coinContract;
        owner = deployedOwner;
        gelatoAddr = deployedGelato;
        user1 = otherAcc1;
        user2 = otherAcc2;
    });

    describe("Farcaster Request Verification", function () {
        it("should allow requesting Farcaster verification", async function () {
            const tx = await gmCoin.connect(user1).requestFarcasterVerification(SAMPLE_FID_1);
            const receipt = await tx.wait();
            
            // Check that VerifyFarcasterRequested event was emitted
            const events = receipt?.logs || [];
            expect(events.length).to.be.greaterThan(0);
            
            // Find the VerifyFarcasterRequested event
            const farcasterInterface = gmCoin.interface;
            const verifyEvent = events.find(event => {
                try {
                    const parsed = farcasterInterface.parseLog(event);
                    return parsed?.name === 'VerifyFarcasterRequested';
                } catch {
                    return false;
                }
            });
            
            expect(verifyEvent).to.not.be.undefined;
            
            // Parse the event to verify parameters
            const parsedEvent = farcasterInterface.parseLog(verifyEvent!);
            expect(parsedEvent!.args[0]).to.equal(SAMPLE_FID_1); // farcasterFid
            expect(parsedEvent!.args[1]).to.equal(user1.address); // wallet
        });

        it("should reject duplicate FID verification requests", async function () {
            // First request should succeed
            await gmCoin.connect(user1).requestFarcasterVerification(SAMPLE_FID_1);
            
            // Simulate Gelato verification
            await gmCoin.connect(gelatoAddr).verifyFarcaster(SAMPLE_FID_1, user1.address);
            
            // Second request with same FID should fail
            await expect(
                gmCoin.connect(user2).requestFarcasterVerification(SAMPLE_FID_1)
            ).to.be.revertedWith("Farcaster account already linked");
        });

        it("should reject wallet already linked to different FID", async function () {
            // First verification
            await gmCoin.connect(user1).requestFarcasterVerification(SAMPLE_FID_1);
            await gmCoin.connect(gelatoAddr).verifyFarcaster(SAMPLE_FID_1, user1.address);
            
            // Second verification with same wallet but different FID should fail
            await expect(
                gmCoin.connect(user1).requestFarcasterVerification(SAMPLE_FID_2)
            ).to.be.revertedWith("wallet already linked to FID");
        });
    });

    describe("Farcaster Manual Verification (Gelato Simulation)", function () {
        it("should successfully verify new Farcaster user", async function () {
            const tx = await gmCoin.connect(gelatoAddr).verifyFarcaster(SAMPLE_FID_1, user1.address);
            const receipt = await tx.wait();

            // Check that verification event was emitted
            const events = receipt?.logs || [];
            expect(events.length).to.be.greaterThan(0);

            // Verify the user is now registered
            expect(await gmCoin.isFarcasterUserRegistered(SAMPLE_FID_1)).to.be.true;
            expect(await gmCoin.getWalletByFID(SAMPLE_FID_1)).to.equal(user1.address);
            expect(await gmCoin.getFIDByWallet(user1.address)).to.equal(SAMPLE_FID_1);
            
            // Check that welcome tokens were minted
            const balance = await gmCoin.balanceOf(user1.address);
            expect(balance).to.be.greaterThan(0);
        });

        it("should handle verification errors correctly", async function () {
            const tx = await gmCoin.connect(gelatoAddr).farcasterVerificationError(
                user1.address, 
                SAMPLE_FID_1, 
                "API verification failed"
            );
            const receipt = await tx.wait();

            // Check that error event was emitted
            const events = receipt?.logs || [];
            expect(events.length).to.be.greaterThan(0);
            
            // Find the FarcasterVerificationResult event
            const farcasterInterface = gmCoin.interface;
            const errorEvent = events.find(event => {
                try {
                    const parsed = farcasterInterface.parseLog(event);
                    return parsed?.name === 'FarcasterVerificationResult';
                } catch {
                    return false;
                }
            });
            
            expect(errorEvent).to.not.be.undefined;
            
            // Parse the event to verify it indicates failure
            const parsedEvent = farcasterInterface.parseLog(errorEvent!);
            expect(parsedEvent!.args[0]).to.equal(SAMPLE_FID_1); // farcasterFid
            expect(parsedEvent!.args[1]).to.equal(user1.address); // wallet
            expect(parsedEvent!.args[2]).to.be.false; // isSuccess
            expect(parsedEvent!.args[3]).to.include("API verification failed"); // errorMsg
            
            // Verify user was NOT registered
            expect(await gmCoin.isFarcasterUserRegistered(SAMPLE_FID_1)).to.be.false;
        });
    });

    describe("Farcaster User Management", function () {
        beforeEach(async function () {
            // Set up verified users for testing
            await gmCoin.connect(gelatoAddr).verifyFarcaster(SAMPLE_FID_1, user1.address);
            await gmCoin.connect(gelatoAddr).verifyFarcaster(SAMPLE_FID_2, user2.address);
        });

        it("should return correct user counts", async function () {
            expect(await gmCoin.totalFarcasterUsersCount()).to.equal(2);
        });

        it("should return correct user lists", async function () {
            const users = await gmCoin.getFarcasterUsers(0, 10);
            expect(users.length).to.equal(2);
            expect(users[0]).to.equal(SAMPLE_FID_1);
            expect(users[1]).to.equal(SAMPLE_FID_2);
        });

        it("should handle wallet-FID mappings correctly", async function () {
            expect(await gmCoin.getWalletByFID(SAMPLE_FID_1)).to.equal(user1.address);
            expect(await gmCoin.getWalletByFID(SAMPLE_FID_2)).to.equal(user2.address);
            
            expect(await gmCoin.getFIDByWallet(user1.address)).to.equal(SAMPLE_FID_1);
            expect(await gmCoin.getFIDByWallet(user2.address)).to.equal(SAMPLE_FID_2);
        });
    });
});