import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { createGMCoinFixture } from "./tools/deployContract";

describe("FarcasterVerification", function () {
  let owner: HardhatEthersSigner;
  let gelatoAddr: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;

  const SAMPLE_FID_1 = 123456;
  const SAMPLE_FID_2 = 789012;

  beforeEach(async () => {
    [owner, , , gelatoAddr, , user1, user2] = await ethers.getSigners();
  });

  async function deployFixture() {
    const { coinContract } = await loadFixture(createGMCoinFixture(2));
    return { coinContract };
  }

  it("should allow users to request Farcaster verification", async function () {
    const { coinContract } = await deployFixture();

    // User requests Farcaster verification
    await expect(
      coinContract.connect(user1).requestFarcasterVerification(SAMPLE_FID_1)
    ).to.emit(coinContract, "VerifyFarcasterRequested")
     .withArgs(SAMPLE_FID_1, user1.address);
  });

  it("should complete Farcaster verification when called by Gelato", async function () {
    const { coinContract } = await deployFixture();

    // Gelato completes verification
    await expect(
      coinContract.connect(gelatoAddr).completeFarcasterVerification(SAMPLE_FID_1, user1.address)
    ).to.emit(coinContract, "FarcasterVerificationResult")
     .withArgs(SAMPLE_FID_1, user1.address, true, '');

    // Verify user is registered
    expect(await coinContract.isFarcasterUserRegistered(SAMPLE_FID_1)).to.be.true;
    expect(await coinContract.getWalletByFID(SAMPLE_FID_1)).to.equal(user1.address);
    expect(await coinContract.getFIDByWallet(user1.address)).to.equal(SAMPLE_FID_1);
  });

  it("should handle verification errors", async function () {
    const { coinContract } = await deployFixture();

    await expect(
      coinContract.connect(gelatoAddr).farcasterVerificationError(
        SAMPLE_FID_1, 
        user1.address, 
        "Wallet mismatch"
      )
    ).to.emit(coinContract, "FarcasterVerificationResult")
     .withArgs(SAMPLE_FID_1, user1.address, false, "Wallet mismatch");
  });

  it("should mint tokens on first verification", async function () {
    const { coinContract } = await deployFixture();

    const initialBalance = await coinContract.balanceOf(user1.address);
    
    await coinContract.connect(gelatoAddr).completeFarcasterVerification(SAMPLE_FID_1, user1.address);
    
    const finalBalance = await coinContract.balanceOf(user1.address);
    expect(finalBalance).to.be.greaterThan(initialBalance);
  });
});
