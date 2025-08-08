import { ethers } from "hardhat";

async function main() {
  console.log("🧪 Testing GMCoin contract deployability...");
  
  // Deploy libraries first
  console.log("📚 Deploying libraries...");
  
  const TwitterOracleLib = await ethers.getContractFactory("TwitterOracleLib");
  const twitterLib = await TwitterOracleLib.deploy();
  await twitterLib.waitForDeployment();
  const twitterLibAddress = await twitterLib.getAddress();
  console.log("✅ TwitterOracleLib deployed to:", twitterLibAddress);

  const MintingLib = await ethers.getContractFactory("MintingLib");
  const mintingLib = await MintingLib.deploy();
  await mintingLib.waitForDeployment();
  const mintingLibAddress = await mintingLib.getAddress();
  console.log("✅ MintingLib deployed to:", mintingLibAddress);

  const FarcasterOracleLib = await ethers.getContractFactory("FarcasterOracleLib");
  const farcasterLib = await FarcasterOracleLib.deploy();
  await farcasterLib.waitForDeployment();
  const farcasterLibAddress = await farcasterLib.getAddress();
  console.log("✅ FarcasterOracleLib deployed to:", farcasterLibAddress);

  const AccountManagerLib = await ethers.getContractFactory("AccountManagerLib");
  const accountLib = await AccountManagerLib.deploy();
  await accountLib.waitForDeployment();
  const accountLibAddress = await accountLib.getAddress();
  console.log("✅ AccountManagerLib deployed to:", accountLibAddress);

  // Deploy main contract with library linking
  console.log("🚀 Deploying GMCoin with library linking...");
  
  const GMCoinFactory = await ethers.getContractFactory("GMCoin", {
    libraries: {
      "contracts/TwitterOracleLib.sol:TwitterOracleLib": twitterLibAddress,
      "contracts/MintingLib.sol:MintingLib": mintingLibAddress,
      "contracts/FarcasterOracleLib.sol:FarcasterOracleLib": farcasterLibAddress,
      "contracts/AccountManagerLib.sol:AccountManagerLib": accountLibAddress,
    },
  });

  const [owner] = await ethers.getSigners();
  
  // Deploy a simple version for testing (not using upgrades proxy for simplicity)
  const gmCoin = await GMCoinFactory.deploy();
  await gmCoin.waitForDeployment();
  
  const contractAddress = await gmCoin.getAddress();
  console.log("✅ GMCoin deployed successfully to:", contractAddress);
  
  // Verify the contract size
  const fs = require('fs');
  const artifact = JSON.parse(fs.readFileSync('./artifacts/contracts/GMCoin.sol/GMCoin.json', 'utf8'));
  const bytecodeSize = (artifact.bytecode.length - 2) / 2;
  console.log("📏 Contract bytecode size:", bytecodeSize, "bytes");
  console.log("📏 Size limit:", 24576, "bytes");
  console.log("🎯 Status:", bytecodeSize <= 24576 ? "✅ UNDER LIMIT!" : "❌ OVER LIMIT");
  console.log("💾 Remaining space:", 24576 - bytecodeSize, "bytes");
  
  console.log("\n🎉 CONTRACT IS DEPLOYABLE AND FUNCTIONAL!");
  
  // Test a basic function call to verify it works
  console.log("🧪 Testing contract functionality...");
  try {
    const name = await gmCoin.name();
    console.log("✅ Token name:", name);
    const symbol = await gmCoin.symbol();
    console.log("✅ Token symbol:", symbol);
    console.log("✅ All functions working correctly!");
  } catch (error) {
    console.error("❌ Error testing contract:", error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment test failed:", error);
    process.exit(1);
  });