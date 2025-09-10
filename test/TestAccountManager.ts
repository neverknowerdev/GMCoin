import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { HDNodeWallet } from "ethers";
import { createGMCoinFixture } from "./tools/deployContract";

const LINK_MESSAGE = 'I want to link this wallet to my GMCoin account';

describe("AccountManagement", function () {
  let owner: HardhatEthersSigner;
  let gelatoAddr: HardhatEthersSigner;
  let wallet1: HDNodeWallet;
  let wallet2: HDNodeWallet;
  let wallet3: HDNodeWallet;

  beforeEach(async () => {
    [owner, , , gelatoAddr] = await ethers.getSigners();
    wallet1 = ethers.Wallet.createRandom().connect(ethers.provider);
    wallet2 = ethers.Wallet.createRandom().connect(ethers.provider);
    wallet3 = ethers.Wallet.createRandom().connect(ethers.provider);
    // fund wallets
    for (const w of [wallet1, wallet2, wallet3]) {
      await owner.sendTransaction({ to: w.address, value: ethers.parseEther("1") });
    }
  });

  async function deployAndEnable() {
    const { accountManager } = await loadFixture(createGMCoinFixture(2));
    // enable unified system
    await accountManager.connect(owner).enableUnifiedUserSystem();
    return { accountManager };
  }

  async function signLinkMessage(fromWallet: HDNodeWallet) {
    const msgHash = ethers.hashMessage(LINK_MESSAGE);
    // ethers.Wallet.signMessage takes the original string, not pre-hashed
    return fromWallet.signMessage(LINK_MESSAGE);
  }

  it("creates unified user via verifyTwitterUnified and queries back", async () => {
    const { accountManager } = await deployAndEnable();

    const gelato = accountManager.connect(gelatoAddr);
    const userID = "user_alpha";

    await expect(gelato.verifyTwitterUnified(userID, wallet1.address))
      .to.emit(accountManager, "UnifiedUserCreated");

    // user exists and primary wallet matches
    const user = await accountManager.getUnifiedUserByWallet(wallet1.address);
    expect(user.userId).to.not.equal(0n);
    expect(user.primaryWallet).to.equal(wallet1.address);

    // queries
    expect(await accountManager.isUnifiedUserSystemEnabled()).to.equal(true);
    expect(await accountManager.isWalletLinkedToUnifiedUser(wallet1.address)).to.equal(true);
    const allWallets = await accountManager.getUnifiedUserWallets(user.userId);
    expect(allWallets).to.deep.equal([wallet1.address]);
  });

  it("links additional wallet with signature", async () => {
    const { accountManager } = await deployAndEnable();
    const gelato = accountManager.connect(gelatoAddr);

    await gelato.verifyTwitterUnified("user_beta", wallet1.address);
    const user = await accountManager.getUnifiedUserByWallet(wallet1.address);

    const sig = await signLinkMessage(wallet2);
    await accountManager.connect(wallet1).linkAdditionalWallet(wallet2.address, sig);

    // new wallet is now linked to same user
    const user2 = await accountManager.getUnifiedUserByWallet(wallet2.address);
    expect(user2.userId).to.equal(user.userId);
    const wallets = await accountManager.getUnifiedUserWallets(user.userId);
    expect(wallets).to.include.members([wallet1.address, wallet2.address]);
  });

  it("setPrimaryWallet allowed for account owner", async () => {
    const { accountManager } = await deployAndEnable();
    const gelato = accountManager.connect(gelatoAddr);

    await gelato.verifyTwitterUnified("user_gamma", wallet1.address);
    const user = await accountManager.getUnifiedUserByWallet(wallet1.address);

    // link wallet2 to the same user
    const sig = await signLinkMessage(wallet2);
    await accountManager.connect(wallet1).linkAdditionalWallet(wallet2.address, sig);

    // account owner can set primary
    await accountManager.connect(wallet1).setPrimaryWallet(user.userId, wallet2.address);
    let updated = await accountManager.getUnifiedUserById(user.userId);
    expect(updated.primaryWallet).to.equal(wallet2.address);

    // unrelated contract owner should not be able to set if not linked
    await expect(
      accountManager.connect(owner).setPrimaryWallet(user.userId, wallet1.address)
    ).to.be.reverted;
  });

  it("mergeUsers onlyOwner and moves wallets/social ids", async () => {
    const { accountManager } = await deployAndEnable();
    const gelato = accountManager.connect(gelatoAddr);

    // create two users
    await gelato.verifyTwitterUnified("user_delta", wallet1.address);
    await gelato.verifyTwitterUnified("user_epsilon", wallet3.address);

    const u1 = await accountManager.getUnifiedUserByWallet(wallet1.address);
    const u2 = await accountManager.getUnifiedUserByWallet(wallet3.address);

    // non-owner cannot merge
    await expect(accountManager.connect(wallet1).mergeUsers(u1.userId, u2.userId)).to.be.reverted;

    // owner merges u1 -> u2
    await accountManager.connect(owner).mergeUsers(u1.userId, u2.userId);

    // wallet1 should now map to u2
    const newUser = await accountManager.getUnifiedUserByWallet(wallet1.address);
    expect(newUser.userId).to.equal(u2.userId);

    // original fromUser removed
    await expect(accountManager.getUnifiedUserById(u1.userId)).to.be.reverted;
  });

  it("reverts on invalid signature when linking wallet", async () => {
    const { accountManager } = await deployAndEnable();
    const gelato = accountManager.connect(gelatoAddr);

    await gelato.verifyTwitterUnified("user_zeta", wallet1.address);

    const badSig = await wallet2.signMessage("WRONG MESSAGE");
    await expect(
      accountManager.connect(wallet1).linkAdditionalWallet(wallet2.address, badSig)
    ).to.be.reverted;
  });

  it("no unified user created when system disabled", async () => {
    const { accountManager } = await loadFixture(createGMCoinFixture(2));
    const gelato = accountManager.connect(gelatoAddr);

    await gelato.verifyTwitterUnified("user_eta", wallet1.address);
    // should not throw, but no user gets created
    expect(await accountManager.totalUnifiedUsersCount()).to.equal(0n);
  });
});
