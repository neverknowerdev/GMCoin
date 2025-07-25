import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import "@gelatonetwork/web3-functions-sdk/hardhat-plugin";
import '@openzeppelin/hardhat-upgrades';
import '@typechain/hardhat';

import "./tasks/addTwitterUser";
import "./tasks/tweetCountStat";

// Process Env Variables
import * as dotenv from "dotenv";

dotenv.config({ path: __dirname + "/.env" });

const config = {
    solidity: {
        version: "0.8.24",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200
            },
            outputSelection: {
                "*": {
                    "*": ["storageLayout"],
                },
            },
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
            baseSepolia: process.env.BASESCAN_KEY,
            base: process.env.BASESCAN_KEY,
        }
    },
    networks: {
        hardhat: {
            chainId: 31337,
            mining: {
                auto: true,
                interval: 1000 // 1 second
            },
            // accounts: {
            //     mnemonic: "gm1 gm2 gm3 gm4 gm5 gm6 gm7 gm8 gm9 gm10 gm11 gm12"
            // }
        },
        baseSepolia: {
            url: "https://sepolia.base.org", // RPC URL for Base Sepolia
            chainId: 84532, // Base Sepolia's chain ID
            accounts: process.env.CI ? [] : [process.env.BASE_TESTNET_PRIVATE_KEY, process.env.BASE_TESTNET2_PRIVATE_KEY],
        },
        base: {
            url: "https://mainnet.base.org",
            chainId: 8453,
            accounts: process.env.CI ? [] : [process.env.BASE_PROD_PRIVATE_KEY, process.env.BASE_PROD_FEE_PRIVATE_KEY, process.env.BASE_FARCASTER_ACC_PRIVATE_KEY],
        },
        polygon: {
            url: "https://polygon-bor-rpc.publicnode.com",
            chainId: 137,
            accounts: process.env.CI ? [] : [process.env.BASE_TESTNET_LEARNING_PRIVATE_KEY]
        },
        polygonAmoy: {
            url: "https://rpc-amoy.polygon.technology",
            chainId: 80002,
            accounts: process.env.CI ? [] : [process.env.BASE_TESTNET_PRIVATE_KEY]
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
        timeout: 100000000,
        parallel: false
    },
};

export default config;
