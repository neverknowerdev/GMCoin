import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { GMCoinExposed } from "../typechain";
import { createGMCoinFixture } from "./tools/deployContract";

describe("FarcasterOracle", function () {
    let gmCoin: GMCoinExposed;
    let owner: HardhatEthersSigner;
    let feeAddr: HardhatEthersSigner;
    let treasuryAddr: HardhatEthersSigner;
    let relayerServerAcc: HardhatEthersSigner;
    let user1: HardhatEthersSigner;
    let user2: HardhatEthersSigner;
    let user3: HardhatEthersSigner;

    const SAMPLE_FID_1 = 123456;
    const SAMPLE_FID_2 = 789012;
    const SAMPLE_FID_3 = 345678;

    async function deployFixture() {
        const signers = await ethers.getSigners();
        [owner, feeAddr, treasuryAddr, relayerServerAcc, user1, user2, user3] = signers;

        const { coinContract } = await createGMCoinFixture()();
        return { gmCoin: coinContract, owner, feeAddr, treasuryAddr, relayerServerAcc, user1, user2, user3 };
    }

    beforeEach(async function () {
        const fixture = await loadFixture(deployFixture);
        gmCoin = fixture.gmCoin;
        owner = fixture.owner;
        feeAddr = fixture.feeAddr;
        treasuryAddr = fixture.treasuryAddr;
        relayerServerAcc = fixture.relayerServerAcc;
        user1 = fixture.user1;
        user2 = fixture.user2;
        user3 = fixture.user3;
    });

    describe("Farcaster Verification", function () {
        it("should allow requesting Farcaster verification for new FID", async function () {
            await expect(
                gmCoin.connect(user1).requestFarcasterVerification(SAMPLE_FID_1)
            ).to.not.be.reverted;
        });

        it("should reject requesting verification for already linked FID", async function () {
            // First verification should succeed
            await gmCoin.connect(user1).requestFarcasterVerification(SAMPLE_FID_1);
            await gmCoin.connect(relayerServerAcc).verifyFarcaster(SAMPLE_FID_1, user1.address);
            
            // Second verification with same FID should fail
            await expect(
                gmCoin.connect(user2).requestFarcasterVerification(SAMPLE_FID_1)
            ).to.be.reverted;
        });

        it("should reject requesting verification for wallet already linked to different FID", async function () {
            // First verification should succeed
            await gmCoin.connect(user1).requestFarcasterVerification(SAMPLE_FID_1);
            await gmCoin.connect(relayerServerAcc).verifyFarcaster(SAMPLE_FID_1, user1.address);
            
            // Second verification with same wallet but different FID should fail
            await expect(
                gmCoin.connect(user1).requestFarcasterVerification(SAMPLE_FID_2)
            ).to.be.reverted;
        });

        it("should successfully verify new Farcaster user and mint tokens", async function () {
            const tx = await gmCoin.connect(relayerServerAcc).verifyFarcaster(SAMPLE_FID_1, user1.address);
            const receipt = await tx.wait();

            // Check that verification event was emitted
            const events = receipt?.logs || [];
            expect(events.length).to.be.greaterThan(0);

            // Verify the user is now registered
            expect(await gmCoin.isFarcasterUserRegistered(SAMPLE_FID_1)).to.be.true;
            expect(await gmCoin.getWalletByFID(SAMPLE_FID_1)).to.equal(user1.address);
            expect(await gmCoin.getFIDByWallet(user1.address)).to.equal(SAMPLE_FID_1);
        });

        it("should not allow duplicate verification for already verified Farcaster user", async function () {
            // First verification should succeed
            await gmCoin.connect(relayerServerAcc).verifyFarcaster(SAMPLE_FID_1, user1.address);

            // Second verification should be rejected
            await expect(
                gmCoin.connect(relayerServerAcc).verifyFarcaster(SAMPLE_FID_1, user1.address)
            ).to.be.reverted;
        });
    });

    describe("Farcaster Query Functions", function () {
        beforeEach(async function () {
            // Set up verified users for testing
            await gmCoin.connect(relayerServerAcc).verifyFarcaster(SAMPLE_FID_1, user1.address);
            await gmCoin.connect(relayerServerAcc).verifyFarcaster(SAMPLE_FID_2, user2.address);
        });

        it("should correctly report if Farcaster user is registered", async function () {
            expect(await gmCoin.isFarcasterUserRegistered(SAMPLE_FID_1)).to.be.true;
            expect(await gmCoin.isFarcasterUserRegistered(SAMPLE_FID_2)).to.be.true;
            expect(await gmCoin.isFarcasterUserRegistered(SAMPLE_FID_3)).to.be.false;
        });

        it("should return correct wallet for given FID", async function () {
            expect(await gmCoin.getWalletByFID(SAMPLE_FID_1)).to.equal(user1.address);
            expect(await gmCoin.getWalletByFID(SAMPLE_FID_2)).to.equal(user2.address);
            expect(await gmCoin.getWalletByFID(SAMPLE_FID_3)).to.equal(ethers.ZeroAddress);
        });

        it("should return correct FID for given wallet", async function () {
            expect(await gmCoin.getFIDByWallet(user1.address)).to.equal(SAMPLE_FID_1);
            expect(await gmCoin.getFIDByWallet(user2.address)).to.equal(SAMPLE_FID_2);
            expect(await gmCoin.getFIDByWallet(user3.address)).to.equal(0);
        });

        it("should return Farcaster users in batches", async function () {
            // Add a third user
            await gmCoin.connect(relayerServerAcc).verifyFarcaster(SAMPLE_FID_3, user3.address);

            // Get all users in one batch
            const allUsers = await gmCoin.getFarcasterUsers(0, 10);
            expect(allUsers.length).to.equal(3);
            expect(allUsers[0]).to.equal(SAMPLE_FID_1);
            expect(allUsers[1]).to.equal(SAMPLE_FID_2);
            expect(allUsers[2]).to.equal(SAMPLE_FID_3);

            // Get users in smaller batches
            const firstTwo = await gmCoin.getFarcasterUsers(0, 2);
            expect(firstTwo.length).to.equal(2);
            expect(firstTwo[0]).to.equal(SAMPLE_FID_1);
            expect(firstTwo[1]).to.equal(SAMPLE_FID_2);

            const lastOne = await gmCoin.getFarcasterUsers(2, 1);
            expect(lastOne.length).to.equal(1);
            expect(lastOne[0]).to.equal(SAMPLE_FID_3);
        });

        it("should handle edge cases in getFarcasterUsers", async function () {
            // Request beyond array bounds
            const result = await gmCoin.getFarcasterUsers(1, 10);
            expect(result.length).to.equal(1); // Only one user at index 1

            // Request starting at array length
            const emptyResult = await gmCoin.getFarcasterUsers(2, 5);
            expect(emptyResult.length).to.equal(0);
        });

        it("should reject invalid start index in getFarcasterUsers", async function () {
            await expect(
                gmCoin.getFarcasterUsers(10, 1) // Start beyond array length
            ).to.be.reverted;
        });

    });

    // Farcaster batch minting is not part of the current contract API.
    // Minting via Farcaster occurs on first successful verification.

    describe("Edge Cases and Error Handling", function () {
        it("should handle verification with zero FID", async function () {
            await expect(
                gmCoin.connect(user1).requestFarcasterVerification(0)
            ).to.not.be.reverted;
        });

        it("should handle large FID values", async function () {
            const largeFID = ethers.MaxUint256;
            await expect(
                gmCoin.connect(user1).requestFarcasterVerification(largeFID)
            ).to.not.be.reverted;
        });

        it("should maintain data consistency across operations", async function () {
            // Verify multiple users
            await gmCoin.connect(relayerServerAcc).verifyFarcaster(SAMPLE_FID_1, user1.address);
            await gmCoin.connect(relayerServerAcc).verifyFarcaster(SAMPLE_FID_2, user2.address);

            // Check all mappings are consistent
            expect(await gmCoin.getWalletByFID(SAMPLE_FID_1)).to.equal(user1.address);
            expect(await gmCoin.getFIDByWallet(user1.address)).to.equal(SAMPLE_FID_1);
            expect(await gmCoin.isFarcasterUserRegistered(SAMPLE_FID_1)).to.be.true;

            expect(await gmCoin.getWalletByFID(SAMPLE_FID_2)).to.equal(user2.address);
            expect(await gmCoin.getFIDByWallet(user2.address)).to.equal(SAMPLE_FID_2);
            expect(await gmCoin.isFarcasterUserRegistered(SAMPLE_FID_2)).to.be.true;

            // Check array consistency
            const users = await gmCoin.getFarcasterUsers(0, 10);
            expect(users.length).to.equal(2);
        });
    });
});

// Helper function from TestMinting.ts
const getStartOfDayTimestamp = async (ts: number): Promise<number> => {
    const currentDate = new Date(ts * 1000); // Convert to JavaScript Date
    currentDate.setUTCHours(0, 0, 0, 0); // Set to start of the day (UTC)
    return Math.floor(currentDate.getTime() / 1000); // Return UNIX timestamp in seconds
};