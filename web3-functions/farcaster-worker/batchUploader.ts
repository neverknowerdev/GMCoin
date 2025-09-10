import { Cast, CastProcessingType } from "./consts";
import { Storage } from "./storage";
import { Logger } from "../twitter-worker/cloudwatch";

import { blake2b } from "blakejs";

import ky, { HTTPError } from "ky";

// Web-compatible helper functions (instead of Buffer)
function stringToUint8Array(str: string): Uint8Array {
    const encoder = new TextEncoder();
    return encoder.encode(str);
}

function arrayBufferToHex(bytes: Uint8Array | ArrayBuffer): string {
    const byteArray = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return Array.from(byteArray, byte => byte.toString(16).padStart(2, '0')).join('');
}

class ServerCast {
    castOrder: number
    userIndex: number;
    fid: number;
    username: string;
    castHash: string;
    castContent: string;
    likesCount: number;
    recastsCount: number;
    castType: number;
    runningHash: string;
}

export class BatchUploader {
    private buffer: ServerCast[] = []; // Array to store elements
    private runningHash: string;
    private mintingDayTimestamp: number;
    private storage: Storage;

    private serverURLPrefix: string;
    private serverApiKey: string;

    private castIndex: number = 0;

    private logger: Logger;

    constructor(mintingDayTimestamp: number, storage: Storage, serverURL: string, apiKey: string, logger: Logger) {
        this.mintingDayTimestamp = mintingDayTimestamp;
        this.storage = storage;
        this.serverURLPrefix = serverURL;
        this.serverApiKey = apiKey;
        this.logger = logger;
    }

    public getRunningHash(): string {
        return this.runningHash;
    }

    // Add an element to the buffer
    add(element: Cast, processingResult: CastProcessingType): void {
        let cast: ServerCast = new ServerCast();
        cast.castOrder = this.castIndex;
        cast.likesCount = element.likesCount;
        cast.recastsCount = element.recastsCount;
        cast.castContent = element.castContent;
        cast.castHash = element.castHash;
        cast.userIndex = element.userIndex;
        cast.fid = element.fid;
        cast.username = element.username;
        cast.castType = processingResult;

        this.runningHash = calculateRunningHash(this.runningHash, element);
        cast.runningHash = this.runningHash;

        this.buffer.push(cast);
        this.castIndex++;
    }

    async saveStateToStorage(): Promise<void> {
        await this.storage.saveRunningHash(this.runningHash);
        await this.storage.saveCastOrder(this.castIndex);
    }

    async loadStateFromStorage(): Promise<void> {
        this.runningHash = await this.storage.getRunningHash();
        this.castIndex = await this.storage.getCastOrder();
    }

    async uploadToServer(): Promise<boolean> {
        if (this.buffer.length == 0) {
            this.logger.info('uploadToServer buffer length == 0, skip')
            return true;
        }

        this.logger.info('uploadToServer', this.runningHash, this.buffer.length, this.buffer.map((c => c.castHash)));

        try {
            const request = {
                casts: this.buffer,
                mintingDayTimestamp: this.mintingDayTimestamp
            }
            this.logger.info('serverURL', this.serverURLPrefix + "SaveCasts");
            const response = await ky.post(this.serverURLPrefix + "SaveCasts", {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': this.serverApiKey,
                },
                json: request,
            });

            // Parse the JSON response
            const responseData = await response.json();
            if (responseData.success == true) {
                return true;
            }
            this.logger.info('Success:', responseData);
        } catch (error) {
            if (error instanceof HTTPError) {
                // Handle HTTP errors
                this.logger.error('HTTP Error:', error.response.status, error.response.statusText);
                const errorBody = await error.response.text();
                this.logger.error('Error Body:', errorBody);
            } else {
                // Handle network or other errors
                this.logger.error('Unexpected Error:', error);
            }
        }
        return false;
    }

    async sendUploadToIPFSRequest() {
        try {
            // Using ky to make the request
            const response = await ky.post(this.serverURLPrefix + "UploadCastsToIPFS", {
                timeout: 30000000, // Optional: set timeout in milliseconds
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': this.serverApiKey,
                },
                json: {
                    mintingDayTimestamp: this.mintingDayTimestamp,
                },
            });

            const responseData = await response.json();
            this.logger.info('IPFS Upload Response:', responseData);
        } catch (error) {
            if (error instanceof HTTPError) {
                this.logger.error('IPFS Upload HTTP Error:', error.response.status, error.response.statusText);
                const errorBody = await error.response.text();
                this.logger.error('IPFS Upload Error Body:', errorBody);
            } else {
                this.logger.error('IPFS Upload Unexpected Error:', error);
            }
        }
    }
}

function calculateRunningHash(currentHash: string, cast: Cast): string {
    // Create a consistent string representation of the cast
    const castString = `${cast.castHash}|${cast.fid}|${cast.castContent}|${cast.likesCount}`;
    
    // If this is the first hash, start with the cast string
    if (!currentHash || currentHash === '') {
        const hash = blake2b(stringToUint8Array(castString), null, 32);
        return arrayBufferToHex(hash);
    }
    
    // Combine current hash with new cast data
    const combinedString = currentHash + castString;
    const hash = blake2b(stringToUint8Array(combinedString), null, 32);
    return arrayBufferToHex(hash);
}