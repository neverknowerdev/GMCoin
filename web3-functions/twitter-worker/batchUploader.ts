import {Tweet, TweetProcessingType} from "./consts";
import {Storage} from "./storage";

import {blake2b} from "blakejs";

import ky, {HTTPError} from "ky";

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
}

export class BatchUploader {
    private buffer: ServerTweet[] = []; // Array to store elements
    private runningHash: Uint8Array;
    private mintingDayTimestamp: number;
    private storage: Storage;

    private serverURL: string;
    private serverApiKey: string;

    private tweetIndex: number = 0;

    constructor(mintingDayTimestamp: number, storage: Storage, serverURL: string, apiKey: string) {
        this.mintingDayTimestamp = mintingDayTimestamp;
        this.storage = storage;
        this.serverURL = serverURL;
        this.serverApiKey = apiKey;
    }

    public getRunningHash(): string {
        return arrayBufferToBase64(this.runningHash);
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

        this.buffer.push(tw);
        this.tweetIndex++;

        const runningHashLength = this.runningHash ? this.runningHash.length : 0;
        const encodedTweet = stringToUint8Array(toTweetKey(element));
        const combinedArray = new Uint8Array(runningHashLength + encodedTweet.length);
        if (this.runningHash) {
            combinedArray.set(this.runningHash);
        }
        combinedArray.set(encodedTweet, runningHashLength);

        this.runningHash = blake2b(combinedArray, undefined, 20);
    }

    async saveStateToStorage(): Promise<void> {
        await this.storage.saveRunningHash(arrayBufferToBase64(this.runningHash));
        await this.storage.saveTweetOrder(this.tweetIndex);
    }

    async loadStateFromStorage(): Promise<void> {
        this.runningHash = base64ToArrayBuffer(await this.storage.getRunningHash());
        this.tweetIndex = await this.storage.getTweetOrder();
    }

    async uploadToServer(): Promise<boolean> {
        if (this.buffer.length == 0) {
            return true;
        }

        try {
            const request = {
                tweets: this.buffer,
                mintingDayTimestamp: this.mintingDayTimestamp
            }
            const response = await ky.post(this.serverURL, {
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
            console.log('Success:', responseData);
        } catch (error) {
            if (error instanceof HTTPError) {
                // Handle HTTP errors
                console.error('HTTP Error:', error.response.status, error.response.statusText);
                const errorBody = await error.response.text();
                console.error('Error Body:', errorBody);
            } else {
                // Handle network or other errors
                console.error('Unexpected Error:', error);
            }
        }
        return false;
    }
}

function toTweetKey(tweet: Tweet): string {
    return `${tweet.tweetID}|${tweet.likesCount}|${tweet.tweetContent}`
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