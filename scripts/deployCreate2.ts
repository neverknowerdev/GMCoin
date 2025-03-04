import hre, {ethers, upgrades} from "hardhat";
import {ContractFactory} from "ethers";
import {keccak256, toUtf8Bytes} from "ethers/lib/utils";
import {getProxyFactory} from "@openzeppelin/hardhat-upgrades/dist/utils";

async function main() {
    // Deployer address (can be any address; we'll use Hardhat's default for simplicity)
    const [owner] = await ethers.getSigners();
    const deployerAddress = owner.address;
    console.log("Deployer address:", deployerAddress);

    // Get the Factory contract
    const contract: ContractFactory = await ethers.getContractFactory("GMCoinStub");

    const GMCoin = await upgrades.deployProxy(contract,
        [owner.address],
        {
            kind: "uups",
            initializer: 'initialize',
            salt: "gm",
            verifySourceCode: true,
        });

    await GMCoin.waitForDeployment();

    // Retrieve and log the deployed contract address
    const address: string = await GMCoin.getAddress();
    console.log("GMCoin deployed to:", address);

    const implementationAddress = await upgrades.erc1967.getImplementationAddress(address);
    console.log("Implementation Contract Address:", implementationAddress);

    console.log('verifying implementation contract..');
    await hre.run('verify:verify', {
        address: implementationAddress,
    })
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});