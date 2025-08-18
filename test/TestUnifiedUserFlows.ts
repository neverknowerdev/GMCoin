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

  it("creates unified user on verifyFarcaster", async () => {
    const { coinContract } = await deploy();
    const gelato = coinContract.connect(gelatoAddr);

    await gelato.verifyFarcaster(FID_1, user1.address);

    const count = await coinContract.totalUnifiedUsersCount();
    expect(count).to.equal(1n);

    const u = await coinContract.getUnifiedUserByWallet(user1.address);
    expect(u.userId).to.not.equal(0n);
    expect(u.primaryWallet).to.equal(user1.address);
    expect(u.farcasterFid).to.equal(BigInt(FID_1));
    expect(u.twitterId).to.equal("");
  });

  it("links additional wallet to existing unified user", async () => {
    const { coinContract } = await deploy();
    const gelato = coinContract.connect(gelatoAddr);

    // Create user with Farcaster
    await gelato.verifyFarcaster(FID_1, user1.address);
    const user = await coinContract.getUnifiedUserByWallet(user1.address);

    // Sign message for linking wallet
    const message = "I want to link this wallet to my GMCoin account";
    const signature = await user2.signMessage(message);

    // Link additional wallet
    await coinContract.connect(user1).linkAdditionalWallet(user2.address, signature);

    // Verify both wallets are now linked to the same user
    const userFromWallet1 = await coinContract.getUnifiedUserByWallet(user1.address);
    const userFromWallet2 = await coinContract.getUnifiedUserByWallet(user2.address);

    expect(userFromWallet1.userId).to.equal(user.userId);
    expect(userFromWallet2.userId).to.equal(user.userId);

    // Check all wallets for the user
    const wallets = await coinContract.getUnifiedUserWallets(user.userId);
    expect(wallets).to.include.members([user1.address, user2.address]);
    expect(wallets.length).to.equal(2);
  });

  it("mergeUsers combines two users and moves all data", async () => {
    const { coinContract } = await deploy();
    const gelato = coinContract.connect(gelatoAddr);

    // Create two separate users
    await gelato.verifyFarcaster(FID_1, user1.address);
    await gelato.verifyTwitter(TWITTER_ALPHA, user2.address);

    const user1Data = await coinContract.getUnifiedUserByWallet(user1.address);
    const user2Data = await coinContract.getUnifiedUserByWallet(user2.address);

    // Verify initial state
    expect(user1Data.farcasterFid).to.equal(BigInt(FID_1));
    expect(user1Data.twitterId).to.equal("");
    expect(user2Data.farcasterFid).to.equal(0n);
    expect(user2Data.twitterId).to.equal(TWITTER_ALPHA);

    // Merge user1 into user2 (from -> to)
    await coinContract.connect(owner).mergeUsers(user1Data.userId, user2Data.userId);

    // Verify user1 is removed
    await expect(coinContract.getUnifiedUserById(user1Data.userId)).to.be.reverted;

    // Verify user2 now has combined data
    const mergedUser = await coinContract.getUnifiedUserByWallet(user1.address);
    expect(mergedUser.userId).to.equal(user2Data.userId);
    expect(mergedUser.farcasterFid).to.equal(BigInt(FID_1));
    expect(mergedUser.twitterId).to.equal(TWITTER_ALPHA);

    // Verify both wallets now point to the same user
    const userFromWallet2 = await coinContract.getUnifiedUserByWallet(user2.address);
    expect(userFromWallet2.userId).to.equal(user2Data.userId);

    // Check total user count decreased
    const count = await coinContract.totalUnifiedUsersCount();
    expect(count).to.equal(1n);
  });

  it("removeMe allows user to remove themselves", async () => {
    const { coinContract } = await deploy();
    const gelato = coinContract.connect(gelatoAddr);

    // Create user
    await gelato.verifyFarcaster(FID_1, user1.address);

    // Verify user exists
    const initialCount = await coinContract.totalUnifiedUsersCount();
    expect(initialCount).to.equal(1n);

    const user = await coinContract.getUnifiedUserByWallet(user1.address);
    expect(user.userId).to.not.equal(0n);

    // User removes themselves
    await coinContract.connect(user1).removeMe();

    // Verify user is removed
    await expect(coinContract.getUnifiedUserByWallet(user1.address)).to.be.reverted;

    const finalCount = await coinContract.totalUnifiedUsersCount();
    expect(finalCount).to.equal(0n);
  });

  it("mergeUsers fails when trying to merge same user", async () => {
    const { coinContract } = await deploy();
    const gelato = coinContract.connect(gelatoAddr);

    // Create user
    await gelato.verifyFarcaster(FID_1, user1.address);
    const user = await coinContract.getUnifiedUserByWallet(user1.address);

    // Try to merge user with itself
    await expect(
      coinContract.connect(owner).mergeUsers(user.userId, user.userId)
    ).to.be.reverted;
  });

  it("mergeUsers fails when fromUser doesn't exist", async () => {
    const { coinContract } = await deploy();
    const gelato = coinContract.connect(gelatoAddr);

    // Create only one user
    await gelato.verifyFarcaster(FID_1, user1.address);
    const user = await coinContract.getUnifiedUserByWallet(user1.address);

    // Try to merge from non-existent user
    await expect(
      coinContract.connect(owner).mergeUsers(999, user.userId)
    ).to.be.reverted;
  });

  it("mergeUsers fails when toUser doesn't exist", async () => {
    const { coinContract } = await deploy();
    const gelato = coinContract.connect(gelatoAddr);

    // Create only one user
    await gelato.verifyFarcaster(FID_1, user1.address);
    const user = await coinContract.getUnifiedUserByWallet(user1.address);

    // Try to merge to non-existent user
    await expect(
      coinContract.connect(owner).mergeUsers(user.userId, 999)
    ).to.be.reverted;
  });

  it("mergeUsers fails when called by non-owner", async () => {
    const { coinContract } = await deploy();
    const gelato = coinContract.connect(gelatoAddr);

    // Create two users
    await gelato.verifyFarcaster(FID_1, user1.address);
    await gelato.verifyTwitter(TWITTER_ALPHA, user2.address);

    const user1Data = await coinContract.getUnifiedUserByWallet(user1.address);
    const user2Data = await coinContract.getUnifiedUserByWallet(user2.address);

    // Non-owner tries to merge
    await expect(
      coinContract.connect(user1).mergeUsers(user1Data.userId, user2Data.userId)
    ).to.be.reverted;
  });

  it("linkAdditionalWallet fails with invalid signature", async () => {
    const { coinContract } = await deploy();
    const gelato = coinContract.connect(gelatoAddr);

    // Create user
    await gelato.verifyFarcaster(FID_1, user1.address);

    // Try to link with wrong message
    const wrongMessage = "Wrong message";
    const wrongSignature = await user2.signMessage(wrongMessage);

    await expect(
      coinContract.connect(user1).linkAdditionalWallet(user2.address, wrongSignature)
    ).to.be.reverted;
  });

  it("linkAdditionalWallet fails when wallet already registered", async () => {
    const { coinContract } = await deploy();
    const gelato = coinContract.connect(gelatoAddr);

    // Create two separate users
    await gelato.verifyFarcaster(FID_1, user1.address);
    await gelato.verifyTwitter(TWITTER_ALPHA, user2.address);

    // Try to link user2's wallet to user1 (user2 already has their own user)
    const message = "I want to link this wallet to my GMCoin account";
    const signature = await user2.signMessage(message);

    await expect(
      coinContract.connect(user1).linkAdditionalWallet(user2.address, signature)
    ).to.be.reverted;
  });

  it("linkAdditionalWallet fails when wallet already linked to another user", async () => {
    const { coinContract } = await deploy();
    const gelato = coinContract.connect(gelatoAddr);

    // Create user
    await gelato.verifyFarcaster(FID_1, user1.address);

    // Create a third wallet and link it to user1
    const user3 = ethers.Wallet.createRandom().connect(ethers.provider);
    await owner.sendTransaction({ to: user3.address, value: ethers.parseEther("1") });

    const message = "I want to link this wallet to my GMCoin account";
    const signature = await user3.signMessage(message);
    await coinContract.connect(user1).linkAdditionalWallet(user3.address, signature);

    // Try to link user3 to user2 (user3 already linked to user1)
    const user2Signature = await user3.signMessage(message);
    await expect(
      coinContract.connect(user2).linkAdditionalWallet(user3.address, user2Signature)
    ).to.be.reverted;
  });

  it("linkAdditionalWallet fails when caller is not registered", async () => {
    const { coinContract } = await deploy();
    const gelato = coinContract.connect(gelatoAddr);

    // Don't create any users, just try to link wallets
    const message = "I want to link this wallet to my GMCoin account";
    const signature = await user2.signMessage(message);

    await expect(
      coinContract.connect(user1).linkAdditionalWallet(user2.address, signature)
    ).to.be.reverted;
  });

  it("complex scenario: create, link, merge, and remove users", async () => {
    const { coinContract } = await deploy();
    const gelato = coinContract.connect(gelatoAddr);

    // Create three users
    await gelato.verifyFarcaster(FID_1, user1.address);
    await gelato.verifyTwitter(TWITTER_ALPHA, user2.address);

    const user3 = ethers.Wallet.createRandom().connect(ethers.provider);
    await owner.sendTransaction({ to: user3.address, value: ethers.parseEther("1") });
    await gelato.verifyFarcaster(FID_2, user3.address);

    // Verify initial state
    expect(await coinContract.totalUnifiedUsersCount()).to.equal(3n);

    // Link additional wallet to user1
    const message = "I want to link this wallet to my GMCoin account";
    const additionalWallet = ethers.Wallet.createRandom().connect(ethers.provider);
    await owner.sendTransaction({ to: additionalWallet.address, value: ethers.parseEther("1") });
    const signature = await additionalWallet.signMessage(message);
    await coinContract.connect(user1).linkAdditionalWallet(additionalWallet.address, signature);

    // Verify user1 now has 2 wallets
    const user1Data = await coinContract.getUnifiedUserByWallet(user1.address);
    const user1Wallets = await coinContract.getUnifiedUserWallets(user1Data.userId);
    expect(user1Wallets.length).to.equal(2);
    expect(user1Wallets).to.include.members([user1.address, additionalWallet.address]);

    // Merge user1 into user2
    const user2Data = await coinContract.getUnifiedUserByWallet(user2.address);
    await coinContract.connect(owner).mergeUsers(user1Data.userId, user2Data.userId);

    // Verify merge results
    expect(await coinContract.totalUnifiedUsersCount()).to.equal(2n);

    // All wallets from user1 should now point to user2
    const mergedUser = await coinContract.getUnifiedUserByWallet(user1.address);
    const mergedUser2 = await coinContract.getUnifiedUserByWallet(additionalWallet.address);
    expect(mergedUser.userId).to.equal(user2Data.userId);
    expect(mergedUser2.userId).to.equal(user2Data.userId);

    // user2 should now have combined data
    const finalUser2 = await coinContract.getUnifiedUserById(user2Data.userId);
    expect(finalUser2.farcasterFid).to.equal(BigInt(FID_1));
    expect(finalUser2.twitterId).to.equal(TWITTER_ALPHA);

    // Remove user3
    await coinContract.connect(user3).removeMe();
    expect(await coinContract.totalUnifiedUsersCount()).to.equal(1n);

    // Final state: only user2 remains with combined data from user1
    const finalCount = await coinContract.totalUnifiedUsersCount();
    expect(finalCount).to.equal(1n);
  });


});


