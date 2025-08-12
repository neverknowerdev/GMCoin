import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { HDNodeWallet } from "ethers";
import { createGMCoinFixture } from "./tools/deployContract";

describe("UnifiedUserFlows", function () {
  let owner: HardhatEthersSigner;
  let gelatoAddr: HardhatEthersSigner;
  let user1: HDNodeWallet;
  let user2: HDNodeWallet;

  const TWITTER_ALPHA = "tw_alpha";
  const TWITTER_BETA = "tw_beta";
  const FID_1 = 100001;
  const FID_2 = 100002;

  beforeEach(async () => {
    [owner, , , gelatoAddr] = await ethers.getSigners();
    user1 = ethers.Wallet.createRandom().connect(ethers.provider);
    user2 = ethers.Wallet.createRandom().connect(ethers.provider);
    for (const w of [user1, user2]) {
      await owner.sendTransaction({ to: w.address, value: ethers.parseEther("1") });
    }
  });

  async function deploy() {
    const { coinContract } = await loadFixture(createGMCoinFixture(2));
    // In the proxy upgrade path, unified system may be disabled by default, so ensure it's enabled
    const [owner] = await ethers.getSigners();
    await coinContract.connect(owner).enableUnifiedUserSystem();
    return { coinContract };
  }

  it("creates unified user on verifyFarcasterUnified", async () => {
    const { coinContract } = await deploy();
    const gelato = coinContract.connect(gelatoAddr);

    await gelato.verifyFarcasterUnified(FID_1, user1.address);

    const count = await coinContract.totalUnifiedUsersCount();
    expect(count).to.equal(1n);

    const u = await coinContract.getUnifiedUserByWallet(user1.address);
    expect(u.userId).to.not.equal(0n);
    expect(u.primaryWallet).to.equal(user1.address);
    expect(u.farcasterFid).to.equal(BigInt(FID_1));
    expect(u.twitterId).to.equal("");
  });

  it("creates unified user on verifyBothFarcasterAndTwitter (no existing user)", async () => {
    const { coinContract } = await deploy();
    const gelato = coinContract.connect(gelatoAddr);

    await gelato.verifyBothFarcasterAndTwitter(FID_2, user1.address, TWITTER_ALPHA);

    const count = await coinContract.totalUnifiedUsersCount();
    expect(count).to.equal(1n);

    const u = await coinContract.getUnifiedUserByWallet(user1.address);
    expect(u.userId).to.not.equal(0n);
    expect(u.primaryWallet).to.equal(user1.address);
    expect(u.farcasterFid).to.equal(BigInt(FID_2));
    expect(u.twitterId).to.equal(TWITTER_ALPHA);
  });

  it("merges Farcaster to existing Twitter user via verifyFarcasterAndMergeWithTwitter (new wallet)", async () => {
    const { coinContract } = await deploy();
    const gelato = coinContract.connect(gelatoAddr);

    // Step 1: Twitter unified user created for user1
    await gelato.verifyTwitterUnified(TWITTER_BETA, user1.address);
    const u1 = await coinContract.getUnifiedUserByWallet(user1.address);

    // Step 2: Farcaster arrives for user2, with the same twitter id → should attach user2 to the same unified user
    await gelato.verifyFarcasterAndMergeWithTwitter(FID_1, user2.address, TWITTER_BETA);

    const u2 = await coinContract.getUnifiedUserByWallet(user2.address);
    expect(u2.userId).to.equal(u1.userId);

    // Farcaster mappings updated
    expect(await coinContract.isFarcasterUserRegistered(FID_1)).to.equal(true);
    expect(await coinContract.getFIDByWallet(user2.address)).to.equal(BigInt(FID_1));

    const wallets = await coinContract.getUnifiedUserWallets(u1.userId);
    expect(wallets).to.include.members([user1.address, user2.address]);
  });

  it("does not duplicate unified user when wallet already has user and later verifies Farcaster", async () => {
    const { coinContract } = await deploy();
    const gelato = coinContract.connect(gelatoAddr);

    await gelato.verifyTwitterUnified(TWITTER_ALPHA, user1.address);
    const before = await coinContract.totalUnifiedUsersCount();

    await gelato.verifyFarcasterUnified(FID_2, user1.address);

    const after = await coinContract.totalUnifiedUsersCount();
    expect(after).to.equal(before);

    const u = await coinContract.getUnifiedUserByWallet(user1.address);
    expect(u.twitterId).to.equal(TWITTER_ALPHA);
    expect(u.farcasterFid).to.equal(BigInt(FID_2));
  });
});


