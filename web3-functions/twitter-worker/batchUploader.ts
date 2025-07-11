import { Tweet, TweetProcessingType } from "./consts";
import { Storage } from "./storage";
import { Logger } from "./cloudwatch";

import { blake2b } from "blakejs";

import ky, { HTTPError } from "ky";

class ServerTweet {
    tweetOrder: number
    userIndex: number;
    userID: string;
    username: string;
    tweetID: string;
    tweetContent: string;
    likesCount: number;
    userDescriptionText: string;
    tweetType: number;
    runningHash: string;
}

export class BatchUploader {
    private buffer: ServerTweet[] = []; // Array to store elements
    private runningHash: string;
    private mintingDayTimestamp: number;
    private storage: Storage;

    private serverURLPrefix: string;
    private serverApiKey: string;

    private tweetIndex: number = 0;

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
    add(element: Tweet, processingResult: TweetProcessingType): void {
        let tw: ServerTweet = new ServerTweet();
        tw.tweetOrder = this.tweetIndex;
        tw.likesCount = element.likesCount;
        tw.tweetContent = element.tweetContent;
        tw.tweetID = element.tweetID;
        tw.userIndex = element.userIndex;
        tw.userDescriptionText = element.userDescriptionText;
        tw.userID = element.userID;
        tw.username = element.username;
        tw.tweetType = processingResult;

        this.runningHash = calculateRunningHash(this.runningHash, element);
        tw.runningHash = this.runningHash;

        this.buffer.push(tw);
        this.tweetIndex++;
    }

    async saveStateToStorage(): Promise<void> {
        await this.storage.saveRunningHash(this.runningHash);
        await this.storage.saveTweetOrder(this.tweetIndex);
    }

    async loadStateFromStorage(): Promise<void> {
        this.runningHash = await this.storage.getRunningHash();
        this.tweetIndex = await this.storage.getTweetOrder();
    }

    async uploadToServer(): Promise<boolean> {
        if (this.buffer.length == 0) {
            this.logger.info('uploadToServer buffer length == 0, skip')
            return true;
        }

        this.logger.info('uploadToServer', this.runningHash, this.buffer.length, this.buffer.map((t => t.tweetID)));

        try {
            const request = {
                tweets: this.buffer,
                mintingDayTimestamp: this.mintingDayTimestamp
            }
            this.logger.info('serverURL', this.serverURLPrefix + "SaveTweets");
            const response = await ky.post(this.serverURLPrefix + "SaveTweets", {
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
            const response = await ky.post(this.serverURLPrefix + "UploadTweetsToIPFS", {
                timeout: 30000000, // Optional: set timeout in milliseconds
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': this.serverApiKey,
                },
                json: {
                    mintingDayTimestamp: this.mintingDayTimestamp,
                    finalHash: this.getRunningHash()
                }
            });

            // If you need to process the response later, you can add handling here
            const data = await response.json();
            this.logger.info('Request completed:', data);

        } catch (error) {
            this.logger.error('Request failed:', error);
        }

        return;
    }
}

function calculateRunningHash(prevHash: string, tweet: any): string {
    const prevHashBytes = base64ToArrayBuffer(prevHash);
    const runningHashLength = prevHashBytes.length;
    const encodedTweet = stringToUint8Array(toTweetKey(tweet));
    const combinedArray = new Uint8Array(runningHashLength + encodedTweet.length);
    if (runningHashLength > 0) {
        combinedArray.set(prevHashBytes);
    }
    combinedArray.set(encodedTweet, runningHashLength);

    return arrayBufferToBase64(blake2b(combinedArray, undefined, 20));
}

function toTweetKey(tweet: Tweet): string {
    return `${tweet.tweetID}`
}

function stringToUint8Array(str: string): Uint8Array {
    const encoder = new TextEncoder();
    return encoder.encode(str);
}

function base64ToArrayBuffer(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

function arrayBufferToBase64(bytes: Uint8Array | ArrayBuffer): string {
    let binary = '';
    const byteArray = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const len = byteArray.byteLength;

    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(byteArray[i]);
    }

    return btoa(binary);
}