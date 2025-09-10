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
    const { coinContract, accountManager } = await loadFixture(createGMCoinFixture(2));
    await accountManager.connect(owner).enableUnifiedUserSystem();
    return { coinContract, accountManager };
  }

  it("should allow users to request Farcaster verification", async function () {
    const { coinContract, accountManager } = await deployFixture();

    await expect(
      accountManager.connect(user1).requestFarcasterVerification(SAMPLE_FID_1, user1.address)
    ).to.not.be.reverted;
  });

  it("should complete Farcaster verification when called by Gelato", async function () {
    const { coinContract, accountManager } = await deployFixture();

    await accountManager.connect(gelatoAddr).verifyFarcasterUnified(SAMPLE_FID_1, user1.address);

    const unified = await accountManager.getUnifiedUserByWallet(user1.address);
    expect(unified.farcasterFid).to.equal(SAMPLE_FID_1);
  });

  it("should handle verification errors (emit on AccountManager)", async function () {
    const { accountManager } = await deployFixture();

    await expect(
      accountManager.connect(gelatoAddr).farcasterVerificationError(SAMPLE_FID_1, user1.address, "Wallet mismatch")
    ).to.emit(accountManager, "FarcasterVerificationResult").withArgs(SAMPLE_FID_1, user1.address, false, "Wallet mismatch");
  });

  it("should record verification state on first verification", async function () {
    const { accountManager } = await deployFixture();
    await accountManager.connect(gelatoAddr).verifyFarcasterUnified(SAMPLE_FID_1, user1.address);
    const unified = await accountManager.getUnifiedUserByWallet(user1.address);
    expect(unified.farcasterFid).to.equal(SAMPLE_FID_1);
  });
});
