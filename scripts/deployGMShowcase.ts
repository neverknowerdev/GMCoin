import { ethers } from "hardhat";
import { GMShowcase } from "../typechain";

async function main() {
    console.log("🚀 Deploying GM Showcase...");
    
    const [deployer] = await ethers.getSigners();
    console.log("📋 Deployer:", await deployer.getAddress());

    // Configuration
    const GM_TOKEN_ADDRESS = process.env.GM_TOKEN_ADDRESS || "0x26f36F365E5EB6483DF4735e40f87E96e15e0007";
    
    console.log("⚙️  GM Token:", GM_TOKEN_ADDRESS);

    // Deploy GMShowcase
    const GMShowcaseFactory = await ethers.getContractFactory("GMShowcase");
    const gmShowcase = await GMShowcaseFactory.deploy(
        GM_TOKEN_ADDRESS,
        await deployer.getAddress() // Admin = deployer
    );

    await gmShowcase.waitForDeployment();
    const showcaseAddress = await gmShowcase.getAddress();

    console.log("✅ GMShowcase deployed to:", showcaseAddress);
    console.log("✅ Admin (deployer) can configure parameters as needed");

    return { gmShowcase, address: showcaseAddress };
}

// Main execution
if (require.main === module) {
    main()
        .then(({ address }) => {
            console.log("\n🎯 Contract deployed! Admin can now:");
            console.log("• Configure parameters with admin functions");
            console.log("• Test proposal submission and voting");
            console.log("• Set up frontend integration");
            
            process.exit(0);
        })
        .catch((error) => {
            console.error("❌ Deployment failed:", error);
            process.exit(1);
        });
}

export { main as deployGMShowcase };
