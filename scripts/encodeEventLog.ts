import { ethers, EventFragment } from 'ethers';
import * as fs from 'fs';

// Define the event ABI with indexed parameters
const abi: string[] = [
  "event TwitterVerificationRequested(string username, address wallet)"
];

// Create an interface
const iface = new ethers.Interface(abi);

// Event parameters
const username: string = "neverknower_dev";
const wallet: string = "0x6794a56583329794f184d50862019ecf7b6d8ba6";

// Get the event fragment
const eventFragment = iface.getEvent("TwitterVerificationRequested");

// Event signature hash (Topic 0)
const eventSignature = "TwitterVerificationRequested(string,address)";
const eventSignatureHash = ethers.id(eventSignature);

// Encode indexed parameters
const usernameTopic = ethers.keccak256(ethers.toUtf8Bytes(username));
const walletTopic = ethers.zeroPadValue(wallet, 32);

// Construct topics array
const topics: string[] = [
  eventSignatureHash
];

const data = iface.encodeEventLog(
    eventFragment as EventFragment,
    [username, wallet]
  );

// Create the log object
const log = {
  address: "0xYourContractAddress",
  topics: topics,
  data: data.data,
  blockNumber: "0",
  transactionHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  transactionIndex: "0",
  blockHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  logIndex: "0",
  removed: false
};

console.log('log.json generated successfully.');
console.log(JSON.stringify(log, null, 2));

