// test/deployment.test.ts

import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
import { Contract, ContractFactory, Signer, Wallet, Provider, HDNodeWallet, Result } from "ethers";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { GMCoin, GMCoinExposed } from "../typechain";
import hre from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { createGMCoinFixture, deployGMCoinWithProxy } from "./tools/deployContract";
import { smock } from "@neverknowerdev/smock";


describe("GM", function () {

    it("proxy redeployment success", async function () {

        // 1. Retrieve Signers
        const [owner, feeAddr, treasuryAddr, gelatoAddr, relayerServerAcc, otherAcc1, otherAcc2] = await hre.ethers.getSigners();


        // Take a snapshot
        const snapshot = await network.provider.request({
            method: "evm_snapshot",
        });

        // mock depes
        let gelatoIAutomate = await smock.fake('IAutomate', {
            address: "0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0",
        });
        gelatoIAutomate.gelato.returns('0x2a6c106ae13b558bb9e2ec64bd2f1f7beff30001');
        gelatoIAutomate.taskModuleAddresses.returns('0x2a6c106ae13b558bb9e2ec64bd2f1f7beff30002');

        let gelatoIGelato = await smock.fake('IGelato', {
            address: "0x2a6c106ae13b558bb9e2ec64bd2f1f7beff30001",
        });
        gelatoIGelato.feeCollector.returns();

        let gelatoIProxyModule = await smock.fake('IProxyModule', {
            address: "0x2a6c106ae13b558bb9e2ec64bd2f1f7beff30002",
        });
        gelatoIProxyModule.opsProxyFactory.returns('0x2a6c106ae13b558bb9e2ec64bd2f1f7beff30003');

        let gelatoIOpsProxyFactory = await smock.fake('IOpsProxyFactory', {
            address: "0x2a6c106ae13b558bb9e2ec64bd2f1f7beff30003",
        })

        gelatoIOpsProxyFactory.getProxyOf.returns([gelatoAddr.address, true]);
        // end mocking


        // 2. Get Contract Factories
        const TwitterCoinFactory: ContractFactory = await ethers.getContractFactory("GMCoinV1");

        // would be GMCoinV2 soon
        const TwitterCoinV2Factory: ContractFactory = await ethers.getContractFactory("GMCoinV2");

        // Deploy libraries and get factories with proper linking
        const TwitterOracleLib = await ethers.getContractFactory("TwitterOracleLib");
        const twitterLib = await TwitterOracleLib.deploy();
        await twitterLib.waitForDeployment();
        const twitterLibAddress = await twitterLib.getAddress();

        const MintingLib = await ethers.getContractFactory("MintingLib");
        const mintingLib = await MintingLib.deploy();
        await mintingLib.waitForDeployment();
        const mintingLibAddress = await mintingLib.getAddress();

        const FarcasterOracleLib = await ethers.getContractFactory("FarcasterOracleLib");
        const farcasterLib = await FarcasterOracleLib.deploy();
        await farcasterLib.waitForDeployment();
        const farcasterLibAddress = await farcasterLib.getAddress();

        const AccountManagerLib = await ethers.getContractFactory("AccountManagerLib");
        const accountLib = await AccountManagerLib.deploy();
        await accountLib.waitForDeployment();
        const accountLibAddress = await accountLib.getAddress();

        // Deploy new libraries
        const TwitterVerificationLib = await ethers.getContractFactory("TwitterVerificationLib", {
            libraries: {
                "contracts/TwitterOracleLib.sol:TwitterOracleLib": twitterLibAddress,
            },
        });
        const twitterVerifLib = await TwitterVerificationLib.deploy();
        await twitterVerifLib.waitForDeployment();
        const twitterVerifLibAddress = await twitterVerifLib.getAddress();

        const TwitterMintingLib = await ethers.getContractFactory("TwitterMintingLib", {
            libraries: {
                "contracts/TwitterOracleLib.sol:TwitterOracleLib": twitterLibAddress,
                "contracts/MintingLib.sol:MintingLib": mintingLibAddress,
            },
        });
        const twitterMintLib = await TwitterMintingLib.deploy();
        await twitterMintLib.waitForDeployment();
        const twitterMintLibAddress = await twitterMintLib.getAddress();

        const FarcasterVerificationLib = await ethers.getContractFactory("FarcasterVerificationLib", {
            libraries: {
                "contracts/FarcasterOracleLib.sol:FarcasterOracleLib": farcasterLibAddress,
                "contracts/AccountManagerLib.sol:AccountManagerLib": accountLibAddress,
            },
        });
        const farcasterVerifLib = await FarcasterVerificationLib.deploy();
        await farcasterVerifLib.waitForDeployment();
        const farcasterVerifLibAddress = await farcasterVerifLib.getAddress();

        const FarcasterMintingLib = await ethers.getContractFactory("FarcasterMintingLib", {
            libraries: {
                "contracts/FarcasterOracleLib.sol:FarcasterOracleLib": farcasterLibAddress,
            },
        });
        const farcasterMintLib = await FarcasterMintingLib.deploy();
        await farcasterMintLib.waitForDeployment();
        const farcasterMintLibAddress = await farcasterMintLib.getAddress();

        const GMCoinFactory: ContractFactory = await ethers.getContractFactory("GMCoin", {
            libraries: {
                "contracts/TwitterOracleLib.sol:TwitterOracleLib": twitterLibAddress,
                "contracts/MintingLib.sol:MintingLib": mintingLibAddress,
                "contracts/FarcasterOracleLib.sol:FarcasterOracleLib": farcasterLibAddress,
                "contracts/AccountManagerLib.sol:AccountManagerLib": accountLibAddress,
                "contracts/libraries/TwitterVerificationLib.sol:TwitterVerificationLib": twitterVerifLibAddress,
                "contracts/libraries/TwitterMintingLib.sol:TwitterMintingLib": twitterMintLibAddress,
                "contracts/libraries/FarcasterVerificationLib.sol:FarcasterVerificationLib": farcasterVerifLibAddress,
                "contracts/libraries/FarcasterMintingLib.sol:FarcasterMintingLib": farcasterMintLibAddress,
            },
        });

        console.log('verifying upgrade compability..');
        await upgrades.validateUpgrade(TwitterCoinFactory, TwitterCoinV2Factory);

        // 3. Deploy Upgradeable Proxy for TwitterCoin
        const instance: Contract = await upgrades.deployProxy(
            TwitterCoinFactory,
            [owner.address, feeAddr.address, treasuryAddr.address, relayerServerAcc.address, 1_000_000, 2],
            {
                kind: "uups",
                initializer: 'initialize'
            }
        );

        // 4. Wait for Deployment
        await instance.waitForDeployment();

        // 5. Retrieve and Log Deployed Addresses
        const address1: string = await instance.getAddress();
        console.log("Deployed at:", address1);

        const implementationAddress1: string = await upgrades.erc1967.getImplementationAddress(address1);
        console.log("Implementation deployed to:", implementationAddress1);

        // 6. Verify Initial State
        const totalSupply1: number = await instance.totalSupply();
        expect(totalSupply1).to.equal(0);

        const name1: string = await instance.name();
        expect(name1).to.equal("GM Coin");

        const symbol1: string = await instance.symbol();
        expect(symbol1).to.equal("GM");

        // 7. Deploy New Implementation Contract (TwitterCoin2)
        const instance2 = await upgrades.upgradeProxy(address1, TwitterCoinV2Factory);
        await instance2.waitForDeployment();

        console.log("Implementation GMCoinV2 deployed to:", await upgrades.erc1967.getImplementationAddress(address1));

        const newImplementation = await GMCoinFactory.deploy();

        const newImplementationAddress: string = await newImplementation.getAddress();
        console.log("Deployed new implementation(GMCoin) at:", newImplementationAddress);

        // 8. Schedule Upgrade
        await instance2.scheduleUpgrade(newImplementationAddress);

        // 9. Retrieve Planned Upgrade Time
        const timelockConfig: any = await instance2.timeLockConfig();
        const plannedUpgradeTime: bigint = timelockConfig.plannedNewImplementationTime;

        // 10. Verify Time Delay (Expecting at least 1 day delay)
        const currentTime = await time.latest();
        expect(Number(plannedUpgradeTime) - currentTime).to.be.at.least(60n * 60n * 24n); // 1 day in seconds

        console.log("Planned Upgrade Time:", plannedUpgradeTime);

        // 11. Prepare Initialization Data for TwitterCoin2
        // const initFunctionData: string = TwitterCoinV2Factory.interface.encodeFunctionData("initializeV2", []);
        const initFunctionData: string = "0x";

        // 12. Attempt Upgrade Before Time Delay (Expect Revert)
        await expect(
            instance2.upgradeToAndCall(newImplementation, initFunctionData)
        ).to.be.revertedWith("timeDelay is not passed to make an upgrade");

        // 13. Increase Time to Just Before Planned Upgrade Time
        await time.increaseTo(plannedUpgradeTime - 10n);

        // 14. Attempt Upgrade Again Before Time Delay (Expect Revert)
        await expect(
            instance2.upgradeToAndCall(newImplementationAddress, initFunctionData)
        ).to.be.revertedWith("timeDelay is not passed to make an upgrade");

        // 15. Increase Time to After Planned Upgrade Time
        await time.increaseTo(plannedUpgradeTime + 1n);

        // 16. Perform Upgrade After Time Delay
        await instance2.upgradeToAndCall(newImplementationAddress, initFunctionData);
        console.log("Proxy upgraded to new Implementation");

        // 17. Retrieve and Verify New Implementation Address
        const implementationAddress2: string = await upgrades.erc1967.getImplementationAddress(address1);
        expect(newImplementationAddress).to.equal(implementationAddress2);
        expect(newImplementationAddress).to.not.equal(implementationAddress1);

        // 18. Verify Updated State
        const totalSupply2: number = await instance2.totalSupply();
        expect(totalSupply2).to.equal(0);

        // upgrade to latest version of GM

        console.log("Proxy upgraded to new Implementation");

        // Revert to snapshot (restores original timestamp and state)
        await network.provider.request({
            method: "evm_revert",
            params: [snapshot],
        });


        // const name2: string = await instance.name();
        // expect(name2).to.equal("TwitterCoin2");
        //
        // const symbol2: string = await instance.symbol();
        // expect(symbol2).to.equal("TWTCOIN");
    });

    it('transaction fee', async () => {
        const initOwnerSupply = 100_000;
        const {
            coinContract: coin,
            owner,
            feeAddr,
            gelatoAddr,
            relayerServerAcc,
            treasuryAddr,
            otherAcc1,
            otherAcc2
        } = await loadFixture(createGMCoinFixture(2, initOwnerSupply));


        console.log('owner balance is', await coin.balanceOf(owner));

        expect(await coin.symbol()).to.be.equal("GM");
        expect(await coin.name()).to.be.equal("GM Coin");

        // expect(await coin.balanceOf(owner)).to.be.equal(initOwnerSupply);

        await coin.connect()

        await coin.connect(owner).transfer(otherAcc1, 1000);
        expect(await coin.balanceOf(owner)).to.be.equal(99000);
        expect(await coin.balanceOf(otherAcc1)).to.be.equal(990);
        expect(await coin.balanceOf(feeAddr)).to.be.equal(10);

        await coin.connect(otherAcc1).transfer(otherAcc2, 100);
        expect(await coin.balanceOf(otherAcc1)).to.be.equal(890);
        expect(await coin.balanceOf(otherAcc2)).to.be.equal(99);
        expect(await coin.balanceOf(feeAddr)).to.be.equal(11);

        await coin.connect(owner).transfer(otherAcc1, 90000);
        expect(await coin.balanceOf(owner)).to.be.equal(9000);
        expect(await coin.balanceOf(otherAcc2)).to.be.equal(99);
        expect(await coin.balanceOf(feeAddr)).to.be.equal(11 + 900);

        // 10% of total minted (1_000_000) = 10000
        expect(await coin.balanceOf(treasuryAddr)).to.be.equal(10000);
    });


    it('removeMe', async function () {
        const {
            coinContract,
            accountManager,
            owner,
            feeAddr,
            relayerServerAcc,
            gelatoAddr
        } = await loadFixture(deployGMCoinWithProxy);

        const gelatoContract = coinContract.connect(gelatoAddr);

        const wallet1 = await createRandomWallet();
        const wallet2 = await createRandomWallet();
        const wallet3 = await createRandomWallet();
        const wallet4 = await createRandomWallet();

        await gelatoContract.verifyTwitter("user1" as any, wallet1 as any);
        await gelatoContract.verifyTwitter("user2" as any, wallet2 as any);
        await gelatoContract.verifyTwitter("user3" as any, wallet3 as any);
        await gelatoContract.verifyTwitter("user4" as any, wallet4 as any);

        await expect(await gelatoContract.getTwitterUsers(0n, 10n)).to.deep.equal(["user1", "user2", "user3", "user4"]);
        await accountManager.connect(wallet4).removeMe();
        await expect(await gelatoContract.getTwitterUsers(0n, 10n)).to.deep.equal(["user1", "user2", "user3"]);
        await accountManager.connect(wallet1).removeMe();
        await expect(await gelatoContract.getTwitterUsers(0n, 10n)).to.deep.equal(["user3", "user2"]);
        await accountManager.connect(wallet3).removeMe();
        await expect(await gelatoContract.getTwitterUsers(0n, 10n)).to.deep.equal(["user2"]);
        await accountManager.connect(wallet2).removeMe();
        await expect(await gelatoContract.getTwitterUsers(0n, 10n)).to.deep.equal([]);

        await expect(accountManager.connect(wallet1).removeMe()).to.be.reverted;
        await expect(accountManager.connect(wallet2).removeMe()).to.be.reverted;
        await expect(accountManager.connect(wallet3).removeMe()).to.be.reverted;
        await expect(accountManager.connect(wallet4).removeMe()).to.be.reverted;

        await gelatoContract.verifyTwitter("user1" as any, wallet1 as any);
        await gelatoContract.verifyTwitter("user2" as any, wallet2 as any);

        await expect(await gelatoContract.getTwitterUsers(0n, 10n)).to.deep.equal(["user1", "user2"]);

        await accountManager.connect(wallet1).removeMe();
        await expect(await gelatoContract.getTwitterUsers(0n, 10n)).to.deep.equal(["user2"]);
        await accountManager.connect(wallet2).removeMe();
        await expect(await gelatoContract.getTwitterUsers(0n, 10n)).to.deep.equal([]);
    });

}).timeout("5m");

async function createRandomWallet(): Promise<HDNodeWallet> {
    const newWallet = ethers.Wallet.createRandom().connect(ethers.provider);

    await network.provider.send("hardhat_setBalance", [
        newWallet.address,
        "0x" + (10n ** 18n).toString(16), // 1 ETH in wei
    ]);

    return newWallet;
}