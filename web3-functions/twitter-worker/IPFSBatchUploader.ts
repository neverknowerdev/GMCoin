import * as Client from '@web3-storage/w3up-client';
import {StoreMemory} from '@web3-storage/w3up-client/stores/memory';
import * as Proof from '@web3-storage/w3up-client/proof';
import {Signer} from '@web3-storage/w3up-client/principal/ed25519';
import {Tweet, TweetTuple} from "./consts";
import {Storage} from "./storage";

class IPFSBatchUploader {
    private buffer: TweetTuple[] = []; // Array to store elements
    private batchSize: number = 1000; // Upload threshold
    private activeUploads: Promise<void>[] = []; // Track ongoing uploads

    private batchNumber: number = 0;
    private mintingDayTimestamp: number;
    private client: Client;
    private fileCIDs: string[] = [];

    private storage: Storage;

    constructor(client: Client, batchLimit: number, mintingDayTimestamp: number, storage: Storage) {
        this.client = client;
        this.batchSize = batchLimit;
        this.mintingDayTimestamp = mintingDayTimestamp;
        this.storage = storage;
    }

    // Add an element to the buffer
    add(element: Tweet, points: number): void {
        this.buffer.push([element.tweetID, element.userID, element.tweetContent, element.likesCount, points]);

        if (this.buffer.length >= this.batchSize) {
            this.activeUploads.push(this.uploadToIPFS([...this.buffer]));
            this.buffer = [];
        }
    }

    // Upload to IPFS in the background
    private async uploadToIPFS(batch: TweetTuple[]): Promise<void> {
        if (batch.length === 0) return;

        console.log(`Uploading batch of ${batch.length} elements to IPFS...`);
        console.time('uploadToIPFS');

        const data = JSON.stringify(batch);
        const encoder = new TextEncoder();
        const uint8Array = encoder.encode(data);
        const blob = new Blob([uint8Array], {type: 'application/json'});
        const file = new File([blob], `batches/${this.mintingDayTimestamp}/batch_${this.batchNumber}.json`);
        this.batchNumber++;

        const cid = await this.client.uploadFile(file as File);

        this.fileCIDs.push(cid.toString());

        console.timeEnd('uploadToIPFS'); // Logs the time taken

        return;
    }

    async saveToStorage(): Promise<void> {
        await this.storage.saveIPFSTweets(this.buffer);
        await this.storage.saveIPFSCids(this.fileCIDs);
    }

    async loadFromStorage(): Promise<void> {
        this.buffer = await this.storage.getIPFSTweets();
        this.fileCIDs = await this.storage.getIPFSCids();
    }

    async uploadRestAndWait(): Promise<void> {
        await this.uploadToIPFS([...this.buffer]);
        await this.wait();
    }

    async uploadFinalFileToIPFS(mintingDifficulty: number): Promise<string> {
        console.time('uploadFinalFileToIPFS')

        await this.uploadRestAndWait();
        const result = {
            mintingDifficulty: mintingDifficulty,
            mintingDayTimestamp: this.mintingDayTimestamp,
            fileCIDs: [],
        };

        result.fileCIDs = this.fileCIDs;

        const data = JSON.stringify(result);
        const encoder = new TextEncoder();
        const uint8Array = encoder.encode(data);
        const blob = new Blob([uint8Array], {type: 'application/json'});
        const file = new File([blob], `batches/${this.mintingDayTimestamp}/batch_info.json`);

        const cid = await this.client.uploadFile(file as File);

        console.time('uploadFinalFileToIPFS finished')
        return cid.toString();
    }

    // Wait for all pending uploads to complete before exiting
    async wait(): Promise<void> {
        console.log("Waiting for all uploads to finish...");
        await Promise.all(this.activeUploads);
        console.log("✅ All uploads completed.");
    }
}

export async function createIPFSBatchUploader(storage: Storage, mintingDayTimestamp: number, didKey: string, delegationProofBase64: string, batchLimit: number): Promise<IPFSBatchUploader> {
    const principal = Signer.parse(didKey)
    const store = new StoreMemory()
    const client = await Client.create({principal, store})


    // const delegationProof = base64ToArrayBuffer(delegationProofBase64);
    const proof = await Proof.parse(delegationProofBase64)
    const space = await client.addSpace(proof)
    await client.setCurrentSpace(space.did())

    const uploader = new IPFSBatchUploader(client, batchLimit, mintingDayTimestamp, storage);
    await uploader.loadFromStorage();

    return uploader;
}

function base64ToArrayBuffer(base64) {
    var binaryString = atob(base64);
    var bytes = new Uint8Array(binaryString.length);
    for (var i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}