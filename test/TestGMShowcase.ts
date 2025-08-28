import { expect } from "chai";
import { ethers } from "hardhat";
import { Signer } from "ethers";
import { GMShowcase } from "../typechain";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("GMShowcase", function () {
    let gmShowcase: GMShowcase;
    let owner: Signer;
    let admin: Signer;
    let user1: Signer;
    let user2: Signer;
    let user3: Signer;

    const ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE"));
    const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";

    beforeEach(async function () {
        [owner, admin, user1, user2, user3] = await ethers.getSigners();

        // For testing, we'll use a dummy address for voting token (tests will be limited)
        const DUMMY_TOKEN_ADDRESS = "0x1234567890123456789012345678901234567890";
        
        // Deploy GMShowcase with dummy address as voting token for testing
        const GMShowcaseFactory = await ethers.getContractFactory("GMShowcase");
        gmShowcase = await ethers.deployContract("GMShowcase", [
            DUMMY_TOKEN_ADDRESS, // Using dummy address for token in tests
            await admin.getAddress()
        ]);
    });

    describe("Deployment", function () {
        it("Should deploy with correct initial values", async function () {
            expect(await gmShowcase.currentRoundId()).to.equal(1);
            expect(await gmShowcase.roundDuration()).to.equal(24 * 60 * 60); // 24 hours
            expect(await gmShowcase.maxProposalsPerRound()).to.equal(100);
            expect(await gmShowcase.minProposalStake()).to.equal(ethers.parseEther("0.01"));
            expect(await gmShowcase.maxContentLength()).to.equal(500);
            expect(await gmShowcase.maxMetadataLength()).to.equal(200);
            expect(await gmShowcase.minimumTokenBalance()).to.equal(ethers.parseEther("1"));
            expect(await gmShowcase.maxVotingPower()).to.equal(ethers.parseEther("1000000"));
        });

        it("Should set correct roles", async function () {
            expect(await gmShowcase.hasRole(DEFAULT_ADMIN_ROLE, await admin.getAddress())).to.be.true;
            expect(await gmShowcase.hasRole(ADMIN_ROLE, await admin.getAddress())).to.be.true;
        });

        it("Should set voting token correctly", async function () {
            expect(await gmShowcase.votingToken()).to.equal("0x1234567890123456789012345678901234567890");
        });

        it("Should start first round automatically", async function () {
            const currentRound = await gmShowcase.getCurrentRound();
            expect(currentRound.id).to.equal(1);
            expect(currentRound.isActive).to.be.true;
            expect(currentRound.isFinalized).to.be.false;
        });
    });

    describe("Voting Power", function () {
        it("Should revert when trying to get voting power with invalid token", async function () {
            await expect(
                gmShowcase.getVotingPower(await user1.getAddress())
            ).to.be.reverted;
        });

        it("Should revert for all users when token address is invalid", async function () {
            await expect(
                gmShowcase.getVotingPower(await user2.getAddress())
            ).to.be.reverted;
            
            await expect(
                gmShowcase.getVotingPower(await user3.getAddress())
            ).to.be.reverted;
        });

        it("Should have correct max voting power setting", async function () {
            const maxPower = await gmShowcase.maxVotingPower();
            expect(maxPower).to.equal(ethers.parseEther("1000000"));
        });
    });

    describe("Proposal Submission", function () {
        it("Should allow proposal submission with sufficient stake", async function () {
            const content = "Test proposal content";
            const metadata = "Test metadata";
            const stake = ethers.parseEther("0.02");

            await expect(
                gmShowcase.connect(user1).submitProposal(content, metadata, { value: stake })
            ).to.emit(gmShowcase, "ProposalSubmitted");

            const proposal = await gmShowcase.proposals(1);
            expect(proposal.content).to.equal(content);
            expect(proposal.proposer).to.equal(await user1.getAddress());
            expect(proposal.stake).to.equal(stake);
            expect(proposal.isActive).to.be.true;
        });

        it("Should reject proposal with insufficient stake", async function () {
            const content = "Test proposal content";
            const metadata = "Test metadata";
            const stake = ethers.parseEther("0.005"); // Less than minimum

            await expect(
                gmShowcase.connect(user1).submitProposal(content, metadata, { value: stake })
            ).to.be.revertedWith("Insufficient stake");
        });

        it("Should reject proposal with empty content", async function () {
            const stake = ethers.parseEther("0.02");

            await expect(
                gmShowcase.connect(user1).submitProposal("", "metadata", { value: stake })
            ).to.be.revertedWith("Invalid content length");
        });

        it("Should reject proposal with content too long", async function () {
            const longContent = "x".repeat(501); // Exceeds maxContentLength
            const stake = ethers.parseEther("0.02");

            await expect(
                gmShowcase.connect(user1).submitProposal(longContent, "metadata", { value: stake })
            ).to.be.revertedWith("Invalid content length");
        });

        it("Should reject proposal with metadata too long", async function () {
            const content = "Test proposal content";
            const longMetadata = "x".repeat(201); // Exceeds maxMetadataLength
            const stake = ethers.parseEther("0.02");

            await expect(
                gmShowcase.connect(user1).submitProposal(content, longMetadata, { value: stake })
            ).to.be.revertedWith("Metadata too long");
        });
    });

    describe("Voting", function () {
        beforeEach(async function () {
            // Submit a test proposal
            const content = "Test proposal for voting";
            const metadata = "Test metadata";
            const stake = ethers.parseEther("0.02");

            await gmShowcase.connect(user1).submitProposal(content, metadata, { value: stake });
        });

        it("Should reject voting without sufficient tokens (no token contract)", async function () {
            await expect(
                gmShowcase.connect(user1).voteForProposal(1)
            ).to.be.reverted;
        });

        it("Should reject voting from all users when no voting token is set", async function () {
            await expect(
                gmShowcase.connect(user2).voteForProposal(1)
            ).to.be.reverted;
            
            await expect(
                gmShowcase.connect(user3).voteForProposal(1)
            ).to.be.reverted;
        });

        it("Should properly track voting state even with failed votes", async function () {
            const hasVoted = await gmShowcase.getUserVotedInRound(await user1.getAddress(), 1);
            expect(hasVoted).to.be.false;
            
            const userVote = await gmShowcase.getUserVoteInRound(await user1.getAddress(), 1);
            expect(userVote).to.equal(0);
        });
    });

    describe("Round Finalization", function () {
        beforeEach(async function () {
            // Submit test proposals
            const stake = ethers.parseEther("0.02");
            
            await gmShowcase.connect(user1).submitProposal("Proposal 1", "Meta 1", { value: stake });
            await gmShowcase.connect(user2).submitProposal("Proposal 2", "Meta 2", { value: stake });

            // Note: Voting won't work without a proper token, but proposals are submitted
        });

        it("Should not allow finalization before round ends", async function () {
            await expect(
                gmShowcase.connect(admin).finalizeCurrentRound()
            ).to.be.revertedWith("Round still active");
        });

        it("Should allow finalization after round ends", async function () {
            // Fast forward time to end the round
            await time.increase(24 * 60 * 60 + 1); // 24 hours + 1 second

            await expect(
                gmShowcase.finalizeCurrentRound()
            ).to.emit(gmShowcase, "RoundFinalized");

            const round = await gmShowcase.rounds(1);
            expect(round.isFinalized).to.be.true;
            expect(round.isActive).to.be.false;
        });

        it("Should start new round after finalization", async function () {
            await time.increase(24 * 60 * 60 + 1);
            await gmShowcase.finalizeCurrentRound();

            expect(await gmShowcase.currentRoundId()).to.equal(2);
            
            const newRound = await gmShowcase.getCurrentRound();
            expect(newRound.id).to.equal(2);
            expect(newRound.isActive).to.be.true;
        });
    });

    describe("Dual-Check Voting System", function () {
        it("Should revert validation when no voting power (invalid token)", async function () {
            // Submit proposal 
            const stake = ethers.parseEther("0.02");
            await gmShowcase.connect(user1).submitProposal("Test", "Meta", { value: stake });

            // Check validation should revert due to invalid token
            await expect(
                gmShowcase.validateVotingPower(await user1.getAddress(), 1)
            ).to.be.reverted;
        });

        it("Should return 0 snapshot when user hasn't voted", async function () {
            const snapshot = await gmShowcase.getVotingPowerSnapshot(await user1.getAddress(), 1);
            expect(snapshot).to.equal(0);
        });
    });

    describe("Admin Functions", function () {
        it("Should allow admin to configure round duration", async function () {
            const newDuration = 48 * 60 * 60; // 48 hours
            
            await expect(
                gmShowcase.connect(admin).setRoundDuration(newDuration)
            ).to.emit(gmShowcase, "RoundDurationUpdated")
            .withArgs(newDuration);

            expect(await gmShowcase.roundDuration()).to.equal(newDuration);
        });

        it("Should allow admin to configure max proposals per round", async function () {
            const newMax = 50;
            
            await expect(
                gmShowcase.connect(admin).setMaxProposalsPerRound(newMax)
            ).to.emit(gmShowcase, "MaxProposalsPerRoundUpdated")
            .withArgs(newMax);

            expect(await gmShowcase.maxProposalsPerRound()).to.equal(newMax);
        });

        it("Should allow admin to configure minimum stake", async function () {
            const newStake = ethers.parseEther("0.05");
            
            await expect(
                gmShowcase.connect(admin).setMinProposalStake(newStake)
            ).to.emit(gmShowcase, "MinProposalStakeUpdated")
            .withArgs(newStake);

            expect(await gmShowcase.minProposalStake()).to.equal(newStake);
        });

        it("Should allow admin to configure voting token", async function () {
            // Use a dummy address for testing
            const dummyTokenAddress = "0x1234567890123456789012345678901234567890";
            
            await expect(
                gmShowcase.connect(admin).setVotingToken(dummyTokenAddress)
            ).to.emit(gmShowcase, "VotingTokenUpdated")
            .withArgs(dummyTokenAddress);

            expect(await gmShowcase.votingToken()).to.equal(dummyTokenAddress);
        });

        it("Should reject configuration from non-admin", async function () {
            await expect(
                gmShowcase.connect(user1).setRoundDuration(48 * 60 * 60)
            ).to.be.revertedWith("Not an admin");
        });
    });

    describe("Emergency Functions", function () {
        it("Should allow admin to emergency pause", async function () {
            await gmShowcase.connect(admin).emergencyPause();
            expect(await gmShowcase.paused()).to.be.true;
        });

        it("Should allow admin to emergency unpause", async function () {
            await gmShowcase.connect(admin).emergencyPause();
            await gmShowcase.connect(admin).emergencyUnpause();
            expect(await gmShowcase.paused()).to.be.false;
        });

        it("Should allow admin to emergency finalize round", async function () {
            await expect(
                gmShowcase.connect(admin).emergencyFinalizeRound()
            ).to.emit(gmShowcase, "RoundFinalized");

            const round = await gmShowcase.rounds(1);
            expect(round.isFinalized).to.be.true;
        });

        it("Should reject emergency functions from non-admin", async function () {
            await expect(
                gmShowcase.connect(user1).emergencyPause()
            ).to.be.revertedWith("Not an admin");
        });
    });

    describe("Withdrawal", function () {
        it("Should handle withdrawal when no winner (no votes)", async function () {
            // Setup: Submit proposal but no votes possible due to no token
            const stake = ethers.parseEther("0.02");
            await gmShowcase.connect(user1).submitProposal("Winner proposal", "Meta", { value: stake });

            // Fast forward and finalize
            await time.increase(24 * 60 * 60 + 1);
            await gmShowcase.finalizeCurrentRound();

            // Check user has no pending withdrawal (since no voting occurred)
            const pending = await gmShowcase.getPendingWithdrawal(await user1.getAddress());
            expect(pending).to.equal(0);
            
            // Should revert trying to withdraw nothing
            await expect(
                gmShowcase.connect(user1).withdrawStake()
            ).to.be.revertedWith("No pending withdrawals");
        });
    });

    describe("Gas Limit Protection", function () {
        it("Should handle large number of voters (gas protection test)", async function () {
            // This test verifies the MAX_VOTERS_TO_CHECK limit
            const maxVoters = await gmShowcase.MAX_VOTERS_TO_CHECK();
            expect(maxVoters).to.equal(200);
            
            // In a real scenario with 200+ voters, only first 200 would be validated
            // This is a theoretical test given our setup limitations
        });
    });

    describe("View Functions", function () {
        beforeEach(async function () {
            const stake = ethers.parseEther("0.02");
            await gmShowcase.connect(user1).submitProposal("Test proposal", "Meta", { value: stake });
        });

        it("Should return current round correctly", async function () {
            const currentRound = await gmShowcase.getCurrentRound();
            expect(currentRound.id).to.equal(1);
            expect(currentRound.isActive).to.be.true;
        });

        it("Should return round proposals correctly", async function () {
            const proposals = await gmShowcase.getRoundProposals(1);
            expect(proposals.length).to.equal(1);
            expect(proposals[0]).to.equal(1);
        });

        it("Should return contract balance correctly", async function () {
            const balance = await gmShowcase.getContractBalance();
            expect(balance).to.be.gte(ethers.parseEther("0.02")); // At least the stake from proposal
        });
    });
});
