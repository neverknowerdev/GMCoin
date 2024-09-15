import { HardhatUserConfig } from "hardhat/config";
import "@gelatonetwork/web3-functions-sdk/hardhat-plugin";
import "@nomicfoundation/hardhat-toolbox";
import '@openzeppelin/hardhat-upgrades';

// Process Env Variables
import * as dotenv from "dotenv";
dotenv.config({ path: __dirname + "/.env" });

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  defaultNetwork: "hardhat",
  typechain: {
    outDir: "typechain", // Directory for TypeChain-generated files
    target: "ethers-v6", // Target Ethers.js v5
  },
  w3f: {
    rootDir: "./web3-functions",
    debug: true,
    networks: ["hardhat"], //(multiChainProvider) injects provider for these networks
  },
  networks: {
    hardhat: {
      chainId: 31337
    }
  }
};

export default config;
