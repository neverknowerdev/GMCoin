import "@gelatonetwork/web3-functions-sdk/hardhat-plugin";
import "@nomicfoundation/hardhat-toolbox";
import '@openzeppelin/hardhat-upgrades';
import "hardhat-gas-reporter";
import '@typechain/hardhat';

// Process Env Variables
import * as dotenv from "dotenv";

dotenv.config({path: __dirname + "/.env"});


const config = {
    solidity: {
        version: "0.8.24",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200
            }
        }
    },
    defaultNetwork: "hardhat",
    typechain: {
        outDir: "typechain", // Directory for TypeChain-generated files
        target: "ethers-v6", // Target Ethers.js v5
    },
    w3f: {
        rootDir: "./web3-functions",
        debug: false,
        networks: ["hardhat"], //(multiChainProvider) injects provider for these networks
    },
    networks: {
        hardhat: {
            chainId: 31337
        }
    },
    gasReporter: {
        enabled: (process.env.REPORT_GAS == "true"),
        L1: "binance",
        L2: "base",
        coinmarketcap: process.env.COINMARKETCAP_KEY,
        L1Etherscan: process.env.BSCSCAN_KEY,
        L2Etherscan: process.env.BASESCAN_KEY
    },
    mocha: {
        timeout: 100000000
    },
};

export default config;
