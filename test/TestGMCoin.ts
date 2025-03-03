// test/deployment.test.ts

import {expect} from "chai";
import {ethers, upgrades} from "hardhat";
import {Contract, ContractFactory, Signer, Wallet, Provider, HDNodeWallet} from "ethers";
import {time, loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {GMCoin, GMCoinExposed} from "../typechain";
import hre from "hardhat";
import {HardhatEthersSigner} from "@nomicfoundation/hardhat-ethers/signers";
import {createGMCoinFixture, deployGMCoinWithProxy} from "./tools/deployContract";


describe("GM", function () {

    it("proxy redeployment success", async function () {
        // 1. Retrieve Signers
        const {coinContract, owner, feeAddr, gelatoAddr, relayerServerAcc} = await loadFixture(deployGMCoinWithProxy);
        // 2. Get Contract Factories
        const TwitterCoinFactory: ContractFactory = await ethers.getContractFactory("GMCoinV2");
        const TwitterCoinV2Factory: ContractFactory = await ethers.getContractFactory("GMCoinV3");

        // 3. Deploy Upgradeable Proxy for TwitterCoin
        const instance: Contract = await upgrades.deployProxy(
            TwitterCoinFactory,
            [owner.address, owner.address, gelatoAddr.address, relayerServerAcc.address, 1_000_000, 2],
            {
                kind: "uups",
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
        const newImplementation = await TwitterCoinV2Factory.deploy();

        const newImplementationAddress: string = await newImplementation.getAddress();
        console.log("Deployed new implementation at:", newImplementationAddress);

        // 8. Schedule Upgrade
        await instance.scheduleUpgrade(newImplementationAddress);

        // 9. Retrieve Planned Upgrade Time
        const plannedUpgradeTime: bigint = await instance.plannedNewImplementationTime();

        // 10. Verify Time Delay (Expecting at least 1 day delay)
        const currentTime = await time.latest();
        expect(Number(plannedUpgradeTime) - currentTime).to.be.at.least(60n * 60n * 24n); // 1 day in seconds

        console.log("Planned Upgrade Time:", plannedUpgradeTime);

        // 11. Prepare Initialization Data for TwitterCoin2
        const initFunctionData: string = TwitterCoinV2Factory.interface.encodeFunctionData("initializeV2", []);

        // 12. Attempt Upgrade Before Time Delay (Expect Revert)
        await expect(
            instance.upgradeToAndCall(newImplementation, initFunctionData)
        ).to.be.revertedWith("timeDelay is not passed to make an upgrade");

        // 13. Increase Time to Just Before Planned Upgrade Time
        await time.increaseTo(plannedUpgradeTime - 10n);

        // 14. Attempt Upgrade Again Before Time Delay (Expect Revert)
        await expect(
            instance.upgradeToAndCall(newImplementationAddress, initFunctionData)
        ).to.be.revertedWith("timeDelay is not passed to make an upgrade");

        // 15. Increase Time to After Planned Upgrade Time
        await time.increaseTo(plannedUpgradeTime + 1n);

        // 16. Perform Upgrade After Time Delay
        await instance.upgradeToAndCall(newImplementationAddress, initFunctionData);
        console.log("Proxy upgraded to new Implementation");

        // 17. Retrieve and Verify New Implementation Address
        const implementationAddress2: string = await upgrades.erc1967.getImplementationAddress(address1);
        expect(newImplementationAddress).to.equal(implementationAddress2);
        expect(newImplementationAddress).to.not.equal(implementationAddress1);

        // 18. Verify Updated State
        const totalSupply2: number = await instance.totalSupply();
        expect(totalSupply2).to.equal(3000);

        const name2: string = await instance.name();
        expect(name2).to.equal("TwitterCoin2");

        const symbol2: string = await instance.symbol();
        expect(symbol2).to.equal("TWTCOIN");
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


        console.log('owner balance is', await coin.balanceOf(feeAddr));

        expect(await coin.symbol()).to.be.equal("GM");
        expect(await coin.name()).to.be.equal("GM Coin");

        expect(await coin.balanceOf(owner)).to.be.equal(initOwnerSupply);

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

    it('relayer', async function () {
        const {
            coinContract,
            owner,
            feeAddr,
            relayerServerAcc,
            gelatoAddr,
            otherAcc1: userAddr
        } = await loadFixture(deployGMCoinWithProxy);

        const userID = "user1";
        const accessTokenEncrypted = "encryptedAccessToken";

        const rawMessage = ethers.solidityPackedKeccak256(
            ["string"],
            ["gmcoin.meme twitter-verification"]
        );
        const signature = await userAddr.signMessage(ethers.getBytes(rawMessage));
        const serverRelayContract = coinContract.connect(relayerServerAcc);

        await expect(serverRelayContract.requestTwitterVerificationFromRelayer(userID, signature, accessTokenEncrypted)).to.emit(serverRelayContract, 'VerifyTwitterRequested').withArgs(accessTokenEncrypted, userID, userAddr.address);
    })

}).timeout("5m");