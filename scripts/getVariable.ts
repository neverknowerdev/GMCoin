// scripts/readMintingInProgress.ts
import {ethers} from "hardhat";

async function main() {
    // The address of your UUPS proxy
    const PROXY_ADDRESS = "0xfC19678d38629B6242fEe33f482E84F3CD338E23";

    // The slot index for mintingInProgressForDay
    const SLOT_INDEX = 5; // <-- replace with the actual slot index
    // const SLOT_INDEX = 266; // <-- replace with the actual slot index

    // Hardhat provides `ethers.provider` automatically
    const provider = ethers.provider;

    for (let i = 0; i < 200; i++) {
        // 1) Read the raw storage data at the given slot
        const rawStorage = await provider.getStorage(PROXY_ADDRESS, i);

        console.log(`Raw storage at slot ${i}: ${rawStorage}`);
    }

    // 2) Convert the hex string (e.g. "0x000000...") to a BigInt
    // const storageBigInt = BigInt(rawStorage);

    // 3) Since mintingInProgressForDay is a uint32, mask out only the lower 32 bits
    // const mask32Bits = 0xffffffffn; // n for BigInt literal
    // const valueUint32 = storageBigInt & mask32Bits;

    // 4) Convert from BigInt to a normal JS number (safe because it's a 32-bit value)
    // const finalValue = Number(valueUint32);

    // console.log("mintingInProgressForDay (uint32) =", finalValue);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });