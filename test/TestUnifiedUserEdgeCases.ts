import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { HDNodeWallet } from "ethers";
import { createGMCoinFixture } from "./tools/deployContract";

describe("UnifiedUserEdgeCases", function () {
  let owner: HardhatEthersSigner;
  let gelatoAddr: HardhatEthersSigner;
  let wallet1: HDNodeWallet;
  let wallet2: HDNodeWallet;
  let wallet3: HDNodeWallet;

  const LINK_MESSAGE = 'I want to link this wallet to my GMCoin account';
  const TWITTER_ALPHA = "tw_alpha_ec";
  const TWITTER_BETA = "tw_beta_ec";
  const FID_1 = 200001;
  const FID_2 = 200002;

  beforeEach(async () => {
    [owner, , , gelatoAddr] = await ethers.getSigners();
    wallet1 = ethers.Wallet.createRandom().connect(ethers.provider);
    wallet2 = ethers.Wallet.createRandom().connect(ethers.provider);
    wallet3 = ethers.Wallet.createRandom().connect(ethers.provider);
    for (const w of [wallet1, wallet2, wallet3]) {
      await owner.sendTransaction({ to: w.address, value: ethers.parseEther("1") });
    }
  });

  async function deploy() {
    const { coinContract } = await loadFixture(createGMCoinFixture(2));
    await coinContract.connect(owner).enableUnifiedUserSystem();
    return { coinContract };
  }

  it("verifyFarcasterUnified onlyGelato", async () => {
    const { coinContract } = await deploy();
    await expect(
      coinContract.connect(owner).verifyFarcasterUnified(FID_1, wallet1.address)
    ).to.be.revertedWithCustomError(coinContract, "OnlyGelato");
  });

  it("verifyBothFarcasterAndTwitter onlyGelato", async () => {
    const { coinContract } = await deploy();
    await expect(
      coinContract.connect(owner).verifyBothFarcasterAndTwitter(FID_1, wallet1.address, TWITTER_ALPHA)
    ).to.be.revertedWithCustomError(coinContract, "OnlyGelato");
  });

  it("verifyFarcasterAndMergeWithTwitter onlyGelato", async () => {
    const { coinContract } = await deploy();
    await expect(
      coinContract.connect(owner).verifyFarcasterAndMergeWithTwitter(FID_1, wallet1.address, TWITTER_ALPHA)
    ).to.be.revertedWithCustomError(coinContract, "OnlyGelato");
  });

  it("setPrimaryWallet reverts if new wallet not linked", async () => {
    const { coinContract } = await deploy();
    const gelato = coinContract.connect(gelatoAddr);

    await gelato.verifyTwitterUnified(TWITTER_ALPHA, wallet1.address);
    const user = await coinContract.getUnifiedUserByWallet(wallet1.address);

    await expect(
      coinContract.connect(owner).setPrimaryWallet(user.userId, wallet3.address)
    ).to.be.reverted;
  });

  it("linkAdditionalWallet reverts for WalletAlreadyRegistered", async () => {
    const { coinContract } = await deploy();
    const gelato = coinContract.connect(gelatoAddr);

    await gelato.verifyTwitterUnified(TWITTER_ALPHA, wallet1.address);
    await gelato.verifyTwitterUnified(TWITTER_BETA, wallet2.address);

    const sig = await wallet2.signMessage(LINK_MESSAGE);

    await expect(
      coinContract.connect(wallet1).linkAdditionalWallet(wallet2.address, sig)
    ).to.be.reverted;
  });

  it("mergeUsers reverts when merging same user", async () => {
    const { coinContract } = await deploy();
    const gelato = coinContract.connect(gelatoAddr);

    await gelato.verifyTwitterUnified(TWITTER_ALPHA, wallet1.address);
    const u1 = await coinContract.getUnifiedUserByWallet(wallet1.address);

    await expect(
      coinContract.connect(owner).mergeUsers(u1.userId, u1.userId)
    ).to.be.reverted;
  });

  it("queries revert when unified system is disabled", async () => {
    const { coinContract } = await loadFixture(createGMCoinFixture(2));
    await expect(
      coinContract.getUnifiedUserByWallet(wallet1.address)
    ).to.be.revertedWith('Unified user system not enabled');
  });

  it("conflict: adding farcaster to twitter-linked user when fid is already linked elsewhere", async () => {
    const { coinContract } = await deploy();
    const gelato = coinContract.connect(gelatoAddr);

    // Create twitter user on wallet1
    await gelato.verifyTwitterUnified(TWITTER_ALPHA, wallet1.address);
    // Create farcaster-only user on wallet2
    await gelato.verifyFarcasterUnified(FID_1, wallet2.address);

    await expect(
      gelato.verifyFarcasterAndMergeWithTwitter(FID_1, wallet2.address, TWITTER_ALPHA)
    ).to.be.reverted;
  });
});


