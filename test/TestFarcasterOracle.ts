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
            ).to.be.revertedWith("Farcaster account already linked");
        });

        it("should reject requesting verification for wallet already linked to different FID", async function () {
            // First verification should succeed
            await gmCoin.connect(user1).requestFarcasterVerification(SAMPLE_FID_1);
            await gmCoin.connect(relayerServerAcc).verifyFarcaster(SAMPLE_FID_1, user1.address);
            
            // Second verification with same wallet but different FID should fail
            await expect(
                gmCoin.connect(user1).requestFarcasterVerification(SAMPLE_FID_2)
            ).to.be.revertedWith("wallet already linked to FID");
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

        it("should not mint tokens for already verified Farcaster user", async function () {
            // First verification should mint tokens
            await gmCoin.connect(relayerServerAcc).verifyFarcaster(SAMPLE_FID_1, user1.address);
            const initialBalance = await gmCoin.balanceOf(user1.address);

            // Second verification should not mint additional tokens
            await gmCoin.connect(relayerServerAcc).verifyFarcaster(SAMPLE_FID_1, user1.address);
            const finalBalance = await gmCoin.balanceOf(user1.address);

            expect(finalBalance).to.equal(initialBalance);
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
            ).to.be.revertedWith("wrong start index");
        });

    });

    describe("Farcaster Minting Process", function () {
        beforeEach(async function () {
            // Set up verified users
            await gmCoin.connect(relayerServerAcc).verifyFarcaster(SAMPLE_FID_1, user1.address);
            await gmCoin.connect(relayerServerAcc).verifyFarcaster(SAMPLE_FID_2, user2.address);
            await gmCoin.connect(relayerServerAcc).verifyFarcaster(SAMPLE_FID_3, user3.address);
        });

        it("should successfully process Farcaster minting with valid data", async function () {
            const currentTime = await time.latest();
            const startOfTheDayTimestamp = await getStartOfDayTimestamp(currentTime);
            const startOfYesterday = startOfTheDayTimestamp - 86400; // Yesterday timestamp
            
            await gmCoin.connect(relayerServerAcc).startMinting();

            const userData = [
                {
                    userIndex: 0,
                    casts: 10,
                    hashtagCasts: 2,
                    cashtagCasts: 1,
                    simpleCasts: 7,
                    likes: 50
                },
                {
                    userIndex: 1,
                    casts: 5,
                    hashtagCasts: 1,
                    cashtagCasts: 0,
                    simpleCasts: 4,
                    likes: 25
                }
            ];

            const batch = {
                startIndex: 0,
                endIndex: 1,
                nextCursor: "",
                errorCount: 0
            };

            const tx = await gmCoin.connect(relayerServerAcc).mintCoinsForFarcasterUsers(userData, startOfYesterday, [batch]);
            const receipt = await tx.wait();

            expect(receipt?.status).to.equal(1);
        });

        it("should calculate points correctly for Farcaster activity", async function () {
            const currentTime = await time.latest();
            const startOfTheDayTimestamp = await getStartOfDayTimestamp(currentTime);
            const startOfYesterday = startOfTheDayTimestamp - 86400;
            
            await gmCoin.connect(relayerServerAcc).startMinting();

            const POINTS_PER_TWEET = await gmCoin.POINTS_PER_TWEET();
            const POINTS_PER_LIKE = await gmCoin.POINTS_PER_LIKE();
            const POINTS_PER_HASHTAG = await gmCoin.POINTS_PER_HASHTAG();
            const POINTS_PER_CASHTAG = await gmCoin.POINTS_PER_CASHTAG();
            const COINS_MULTIPLICATOR = await gmCoin.COINS_MULTIPLICATOR();

            const userData = [
                {
                    userIndex: 0,
                    casts: 0,
                    hashtagCasts: 2,
                    cashtagCasts: 1,
                    simpleCasts: 3,
                    likes: 10
                }
            ];

            const batch = {
                startIndex: 0,
                endIndex: 0,
                nextCursor: "",
                errorCount: 0
            };

            const expectedPoints = 
                BigInt(userData[0].simpleCasts) * POINTS_PER_TWEET +
                BigInt(userData[0].likes) * POINTS_PER_LIKE +
                BigInt(userData[0].hashtagCasts) * POINTS_PER_HASHTAG +
                BigInt(userData[0].cashtagCasts) * POINTS_PER_CASHTAG;

            const expectedCoins = expectedPoints * COINS_MULTIPLICATOR;

            const initialBalance = await gmCoin.balanceOf(user1.address);
            await gmCoin.connect(relayerServerAcc).mintCoinsForFarcasterUsers(userData, startOfYesterday, [batch]);
            const finalBalance = await gmCoin.balanceOf(user1.address);

            expect(finalBalance - initialBalance).to.equal(expectedCoins);
        });

        it("should not mint tokens for zero activity", async function () {
            const currentTime = await time.latest();
            const startOfTheDayTimestamp = await getStartOfDayTimestamp(currentTime);
            const startOfYesterday = startOfTheDayTimestamp - 86400;
            
            await gmCoin.connect(relayerServerAcc).startMinting();

            const userData = [
                {
                    userIndex: 0,
                    casts: 0,
                    hashtagCasts: 0,
                    cashtagCasts: 0,
                    simpleCasts: 0,
                    likes: 0
                }
            ];

            const batch = {
                startIndex: 0,
                endIndex: 0,
                nextCursor: "",
                errorCount: 0
            };

            const initialBalance = await gmCoin.balanceOf(user1.address);
            await gmCoin.connect(relayerServerAcc).mintCoinsForFarcasterUsers(userData, startOfYesterday, [batch]);
            const finalBalance = await gmCoin.balanceOf(user1.address);

            expect(finalBalance).to.equal(initialBalance);
        });

        it("should process multiple users correctly", async function () {
            const currentTime = await time.latest();
            const startOfTheDayTimestamp = await getStartOfDayTimestamp(currentTime);
            const startOfYesterday = startOfTheDayTimestamp - 86400;
            
            await gmCoin.connect(relayerServerAcc).startMinting();

            const userData = [
                {
                    userIndex: 0,
                    casts: 5,
                    hashtagCasts: 1,
                    cashtagCasts: 1,
                    simpleCasts: 3,
                    likes: 20
                },
                {
                    userIndex: 1,
                    casts: 8,
                    hashtagCasts: 2,
                    cashtagCasts: 0,
                    simpleCasts: 6,
                    likes: 30
                },
                {
                    userIndex: 2,
                    casts: 0,
                    hashtagCasts: 0,
                    cashtagCasts: 0,
                    simpleCasts: 0,
                    likes: 0
                }
            ];

            const batch = {
                startIndex: 0,
                endIndex: 2,
                nextCursor: "",
                errorCount: 0
            };

            const initialBalance1 = await gmCoin.balanceOf(user1.address);
            const initialBalance2 = await gmCoin.balanceOf(user2.address);
            const initialBalance3 = await gmCoin.balanceOf(user3.address);

            await gmCoin.connect(relayerServerAcc).mintCoinsForFarcasterUsers(userData, startOfYesterday, [batch]);

            const finalBalance1 = await gmCoin.balanceOf(user1.address);
            const finalBalance2 = await gmCoin.balanceOf(user2.address);
            const finalBalance3 = await gmCoin.balanceOf(user3.address);

            // Users 1 and 2 should receive tokens, user 3 should not
            expect(finalBalance1).to.be.greaterThan(initialBalance1);
            expect(finalBalance2).to.be.greaterThan(initialBalance2);
            expect(finalBalance3).to.equal(initialBalance3);
        });
    });

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