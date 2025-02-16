import hre, {ethers, upgrades} from "hardhat";
import {GMCoinExposed} from "../typechain";

// describe("CREATE2", function () {
//     it('deploy', async function () {
//         const [owner, feeAddr, gelatoAddr, otherAcc1, otherAcc2] = await hre.ethers.getSigners();
//
//         const TwitterCoin = await ethers.getContractFactory("GMCoinExposed");
//         const coinContract: GMCoinExposed = await upgrades.deployProxy(TwitterCoin,
//             [owner.address, feeAddr.address, 50, 1_000_000, gelatoAddr.address, 1_000_000, 2],
//             {
//                 kind: "uups",
//                 // salt: "gmcoin1"
//             }) as unknown as GMCoinExposed;
//
//         await coinContract.waitForDeployment();
//
//         const deployedAddress = await coinContract.getAddress();
//
//         console.log('deployedAddress', deployedAddress);
//     })
//
// })