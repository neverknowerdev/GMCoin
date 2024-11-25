import {ethers, Interface, EventFragment} from 'ethers';
import fs from 'fs';
import path from 'path';

const abiPath = 'artifacts/contracts/parts/TwitterOracle.sol/GMTwitterOracle.json'; // Replace with your ABI file path

export async function generateEventLogFile(dirPath: string, eventName: string, params: any[]): Promise<void> {
    const abiFile = JSON.parse(fs.readFileSync(abiPath, 'utf8'));

    const iface = new Interface(abiFile.abi);
    const event = iface.getEvent(eventName);
    if (event == null) {
        throw Error('event not found');
    }

    const encodedLog = iface.encodeEventLog(event, params);

    const log = {
        address: "0xYourContractAddress",
        topics: encodedLog.topics,
        data: encodedLog.data,
        blockNumber: "0",
        transactionHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
        transactionIndex: "0",
        blockHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
        logIndex: "0",
        removed: false
    };


    // Convert log data to JSON string
    const logJson = JSON.stringify(log, null, 2);

    // Ensure the directory exists
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, {recursive: true});
    }

    // Define the file path
    const filePath = path.join(dirPath, 'log.json');

    console.log(`writing to ${filePath}..`);

    // Write the JSON string to log.json file
    try {
        await fs.promises.writeFile(filePath, logJson, 'utf8');
        console.log(`Log file created at: ${filePath}`);
    } catch (error) {
        console.error(`Failed to write log file: ${error.message}`);
    }
}

export async function writeEventLogFile(dirPath: string, log: any): Promise<void> {
    const logJson = JSON.stringify(log, null, 2);

    // Ensure the directory exists
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, {recursive: true});
    }

    // Define the file path
    const filePath = path.join(dirPath, 'log.json');

    // Write the JSON string to log.json file
    try {
        await fs.promises.writeFile(filePath, logJson, 'utf8');
        console.log(`Log file created at: ${filePath}`);
    } catch (error) {
        console.error(`Failed to write log file: ${error.message}`);
    }
}