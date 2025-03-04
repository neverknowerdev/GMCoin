// import hre, {ethers, upgrades} from "hardhat";
// import {GMCoinV4} from "../typechain";
// import {GMCoinExposed} from "../typechain/contracts/testing/GMCoinExposed";
//
// describe("CREATE2", function () {
//     it('deploy', async function () {
//         const [owner, feeAddr, gelatoAddr, otherAcc1, otherAcc2] = await hre.ethers.getSigners();
//
//         const TwitterCoin = await ethers.getContractFactory("GMCoinV4");
//         const coinContract: GMCoinExposed = await upgrades.deployProxy(TwitterCoin,
//             [owner.address, feeAddr.address, 50, 1_000_000, gelatoAddr.address, 1_000_000, 2],
//             {
//                 kind: "uups",
//                 salt: "gmcoin1"
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