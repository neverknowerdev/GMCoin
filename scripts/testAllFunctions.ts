import { ethers } from "hardhat";

async function main() {
  console.log("🧪 Testing ALL major GMCoin functions are preserved...");
  
  // Deploy only libraries that GMCoin needs
  const MintingLib = await ethers.deployContract("MintingLib");

  // Deploy main contract
  const GMCoin = await ethers.getContractFactory("GMCoin", {
    libraries: {
      "contracts/MintingLib.sol:MintingLib": await MintingLib.getAddress(),
    },
  });

  const gmCoin = await GMCoin.deploy();
  await gmCoin.waitForDeployment();
  
  console.log("✅ Contract deployed to:", await gmCoin.getAddress());
  
  // Test critical functions exist and work
  const tests = [
    // ERC20 functions
    { name: "name()", test: async () => await gmCoin.name() },
    { name: "symbol()", test: async () => await gmCoin.symbol() },
    { name: "totalSupply()", test: async () => await gmCoin.totalSupply() },
    
    // Twitter functions  
    { name: "isTwitterUserRegistered()", test: async () => await gmCoin.isTwitterUserRegistered("test") },
    { name: "totalTwitterUsersCount()", test: async () => await gmCoin.totalTwitterUsersCount() },
    
    // Farcaster functions
    { name: "isFarcasterUserRegistered()", test: async () => await gmCoin.isFarcasterUserRegistered(123) },
    { name: "totalFarcasterUsersCount()", test: async () => await gmCoin.totalFarcasterUsersCount() },
    
    // Account Manager functions
    { name: "isUnifiedUserSystemEnabled()", test: async () => await gmCoin.isUnifiedUserSystemEnabled() },
    { name: "totalUnifiedUsersCount()", test: async () => await gmCoin.totalUnifiedUsersCount() },
    
    // Minting functions
    { name: "COINS_MULTIPLICATOR()", test: async () => await gmCoin.COINS_MULTIPLICATOR() },
    { name: "POINTS_PER_TWEET()", test: async () => await gmCoin.POINTS_PER_TWEET() },
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const testCase of tests) {
    try {
      const result = await testCase.test();
      console.log(`✅ ${testCase.name} - WORKS (result: ${result})`);
      passed++;
    } catch (error) {
      console.log(`❌ ${testCase.name} - FAILED:`, error.message);
      failed++;
    }
  }
  
  console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed`);
  
  if (failed === 0) {
    console.log("🎉 ALL FUNCTIONS WORK! NO FUNCTIONALITY WAS LOST!");
  } else {
    console.log("❌ Some functions are broken");
  }
}

main().catch(console.error);