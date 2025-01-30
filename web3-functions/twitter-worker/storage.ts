import {Batch, Result, Tweet, TweetTuple, w3fStorage} from "./consts";

export class Storage {
    private storage: w3fStorage;
    private mintingDayTimestamp: number;

    constructor(storage: w3fStorage, mintingDayTimestamp: number) {
        this.storage = storage;
        this.mintingDayTimestamp = mintingDayTimestamp;
    }

    async clearAll() {
        const keys = await this.storage.getKeys();
        for (let i = 0; i < keys.length; i++) {
            if (keys[i].startsWith(`${this.mintingDayTimestamp}`)) {
                await this.storage.delete(keys[i]);
            }
        }
    }

    async loadUserResults(): Promise<Map<number, Result>> {
        const array = JSON.parse(await this.storage.get(`${this.mintingDayTimestamp}_userResults`) || '[]');
        return new Map<number, Result>(array)
    }

    async saveUserResults(userResults: Map<number, Result>) {
        const array = Array.from(userResults.entries()); // Convert Map to array of key-value pairs
        await this.storage.set(`${this.mintingDayTimestamp}_userResults`, JSON.stringify(array));
    }

    async clearBatchData(batch: Batch) {
        await this.storage.delete(`${this.mintingDayTimestamp}_userIDForBatch_${batch.startIndex}:${batch.endIndex}`);
    }

    async saveRemainingUsernames(userIDs: string[]) {
        await this.storage.set(`${this.mintingDayTimestamp}_nextUsernames`, JSON.stringify(userIDs));
    }

    async getRemainingUsernames(): Promise<string[]> {
        return Promise.resolve(JSON.parse(await this.storage.get(`${this.mintingDayTimestamp}_nextUsernames`) || '[]'))
    }

    // await storage.get(`${mintingDayTimestamp}_isFetchedLastUserIndex`) == 'true'
    async getIsFetchedLastUserIndex(): Promise<boolean> {
        return Promise.resolve(await this.storage.get(`${this.mintingDayTimestamp}_isFetchedLastUserIndex`) == 'true');
    }

    async setIsFetchedLastUserIndex(val: boolean) {
        await this.storage.set(`${this.mintingDayTimestamp}_isFetchedLastUserIndex`, val ? 'true' : 'false');
    }

    async setUsernamesForBatch(startIndex: number, endIndex: number, userIDs: string[]) {
        await this.storage.set(`${this.mintingDayTimestamp}_usernamesForBatch_${startIndex}:${endIndex}`, JSON.stringify(userIDs));
    }

    async getUsernamesForBatch(startIndex: number, endIndex: number): Promise<string[]> {
        const res: string[] = JSON.parse(await this.storage.get(`${this.mintingDayTimestamp}_usernamesForBatch_${startIndex}:${endIndex}`) || '[]');
        return Promise.resolve(res);
    }

    async saveMaxEndIndex(maxIndex: number) {
        await this.storage.set(`${this.mintingDayTimestamp}_maxEndIndex`, maxIndex.toString());
    }

    async getMaxEndIndex(): Promise<number> {
        return Promise.resolve(parseInt(await this.storage.get(`${this.mintingDayTimestamp}_maxEndIndex`) || '0'));
    }

    async getTweetsToVerify(): Promise<Tweet[]> {
        return JSON.parse(await this.storage.get(`${this.mintingDayTimestamp}_tweetsToVerify`) || '[]') as Tweet[];
    }

    async saveTweetsToVerify(tweets: Tweet[]) {
        await this.storage.set(`${this.mintingDayTimestamp}_tweetsToVerify`, JSON.stringify(tweets));
    }

    async saveIPFSTweets(tweets: TweetTuple[]) {
        await this.storage.set(`${this.mintingDayTimestamp}_tweetsToIPFS`, JSON.stringify(tweets));
    }

    async getIPFSTweets(): Promise<TweetTuple[]> {
        return JSON.parse(await this.storage.get(`${this.mintingDayTimestamp}_tweetsToIPDS`) || '[]')
    }

    async saveIPFSCids(cids: string[]) {
        await this.storage.set(`${this.mintingDayTimestamp}_cids`, JSON.stringify(cids));
    }

    async getIPFSCids(): Promise<string[]> {
        return JSON.parse(await this.storage.get(`${this.mintingDayTimestamp}_cids`) || '[]')
    }

}