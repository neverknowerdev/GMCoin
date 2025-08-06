import hre, {ethers, upgrades} from "hardhat";
import {smock} from "@neverknowerdev/smock";
import {GMCoinExposed} from "../../typechain";
import {ContractFactory} from "ethers";

async function deployLibrariesAndGetFactories() {
    // Deploy libraries first
    const TwitterOracleLib = await ethers.getContractFactory("TwitterOracleLib");
    const twitterLib = await TwitterOracleLib.deploy();
    await twitterLib.waitForDeployment();
    const twitterLibAddress = await twitterLib.getAddress();

    const MintingLib = await ethers.getContractFactory("MintingLib");
    const mintingLib = await MintingLib.deploy();
    await mintingLib.waitForDeployment();
    const mintingLibAddress = await mintingLib.getAddress();

    // Get contract factories with library linking (AccountManager is no longer a library)
    const GMCoinExposedFactory = await ethers.getContractFactory("GMCoinExposed", {
        libraries: {
            "contracts/TwitterOracleLib.sol:TwitterOracleLib": twitterLibAddress,
            "contracts/MintingLib.sol:MintingLib": mintingLibAddress,
        },
    });

    const GMCoinFactory = await ethers.getContractFactory("GMCoin", {
        libraries: {
            "contracts/TwitterOracleLib.sol:TwitterOracleLib": twitterLibAddress,
            "contracts/MintingLib.sol:MintingLib": mintingLibAddress,
        },
    });

    return { GMCoinExposedFactory, GMCoinFactory, twitterLibAddress, mintingLibAddress };
}

export function createGMCoinFixture(epochDays: number = 2, ownerSupply: number = 0) {
    return async function deployGMToken() {
        // Contracts are deployed using the first signer/account by default
        const [owner, feeAddr, treasuryAddr, gelatoAddr, relayerServerAcc, otherAcc1, otherAcc2] = await hre.ethers.getSigners();


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

        const coinsMultiplicator = 1_000_000;

        const contractV1 = await ethers.getContractFactory("GMCoinV1");
        const coinContractV1 = await upgrades.deployProxy(contractV1,
            [owner.address, feeAddr.address, treasuryAddr.address, relayerServerAcc.address, coinsMultiplicator, epochDays],
            {
                kind: "uups",
            }) as unknown as GMCoinExposed;
        await coinContractV1.waitForDeployment();

        const contractAddress = await coinContractV1.getAddress();

        const { GMCoinExposedFactory } = await deployLibrariesAndGetFactories();
        const coinContract: GMCoinExposed = await upgrades.upgradeProxy(contractAddress, GMCoinExposedFactory, {
            unsafeAllowLinkedLibraries: true,
        }) as GMCoinExposed;
        await coinContract.waitForDeployment();


        // const coinContract: GMCoinExposed = await upgrades.deployProxy(TwitterCoin,
        //     [owner.address, feeAddr.address, treasuryAddr.address, relayerServerAcc.address, coinsMultiplicator, epochDays],
        //     {
        //         kind: "uups",
        //     }) as unknown as GMCoinExposed;
        //
        // await coinContract.waitForDeployment();

        if (ownerSupply > 0) {
            const tx = await coinContract.mintForWallet(owner.address, ownerSupply);
            await tx.wait();
        }

        // const deployedAddress = await coinContractBase.getAddress();

        // const contractV2 = await ethers.getContractFactory("GMCoinExposedV3");
        // const coinContract = await upgrades.upgradeProxy(deployedAddress, contractV2, {
        //     call: {
        //         fn: "initialize3",
        //         args: [epochDays, ownerSupply]
        //     }
        // });
        // await coinContract.waitForDeployment();
        //
        // console.log('contract deployed at ', deployedAddress);
        // //
        // const tx = await owner.sendTransaction({
        //   to: deployedAddress,
        //   value: ethers.parseEther("1.0"),
        // });
        // await tx.wait();

        return {
            coinContract,
            owner,
            feeAddr,
            treasuryAddr,
            gelatoAddr,
            relayerServerAcc,
            otherAcc1,
            otherAcc2,
            coinsMultiplicator
        };
    }
}

export async function deployGMCoinWithProxy() {
    return await createGMCoinFixture(2)();
}

