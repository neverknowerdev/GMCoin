import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import '@openzeppelin/hardhat-upgrades';

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  typechain: {
    outDir: "typechain", // Directory for TypeChain-generated files
    target: "ethers-v6", // Target Ethers.js v5
  },
};

export default config;
