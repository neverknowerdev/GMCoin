import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import '@openzeppelin/hardhat-upgrades';
import "hardhat-gas-reporter";
import '@typechain/hardhat';
import "@gelatonetwork/web3-functions-sdk/hardhat-plugin";

import "./tasks/addTwitterUser";

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
    defender: {
        apiKey: process.env.DEFENDER_API_KEY as string,
        apiSecret: process.env.DEFENDER_SECRET as string,
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
    etherscan: {
        apiKey: {
            baseSepolia: process.env.BASESCAN_KEY
        }
    },
    networks: {
        hardhat: {
            chainId: 31337,
            mining: {
                auto: true,
                interval: 1000 // 1 second
            }
        },
        baseSepolia: {
            url: "https://sepolia.base.org", // RPC URL for Base Sepolia
            chainId: 84532, // Base Sepolia's chain ID
            accounts: [process.env.BASE_TESTNET_PRIVATE_KEY], // Your wallet private key (from .env file)
        },
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
