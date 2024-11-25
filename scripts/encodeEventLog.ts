import { ethers, EventFragment } from 'ethers';
import * as fs from 'fs';

// Define the event ABI with indexed parameters
const abi: string[] = [
  "event mintingFromTwitter_Progress(uint lastProcessedIndex, bytes nextCursor)"
];

const lastProcessedIndex = 5;
const nextCursor = ethers.toUtf8Bytes("aaabbbfff"); // Convert string to bytes


const eventSignature = "mintingFromTwitter_Progress(uint256,bytes)";
const topic0 = ethers.keccak256(ethers.toUtf8Bytes(eventSignature));

const topics: string[] = [
  topic0
];

const abiCoder = new ethers.AbiCoder();
// Encode the parameters for the data field
const data = abiCoder.encode(
  ["uint256", "bytes"],
  [lastProcessedIndex, nextCursor]
);

// Create the log object
const log = {
  address: "0xYourContractAddress",
  topics: topics,
  data: data,
  blockNumber: "0",
  transactionHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  transactionIndex: "0",
  blockHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  logIndex: "0",
  removed: false
};

console.log('log.json generated successfully.');
console.log(JSON.stringify(log, null, 2));

