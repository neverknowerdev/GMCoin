import { Batch, Result, Cast, w3fStorage } from "./consts";

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
        await this.storage.delete(`${this.mintingDayTimestamp}_fidForBatch_${batch.startIndex}:${batch.endIndex}`);
    }

    async saveRemainingFIDs(fids: number[]) {
        await this.storage.set(`${this.mintingDayTimestamp}_nextFIDs`, JSON.stringify(fids));
    }

    async getRemainingFIDs(): Promise<number[]> {
        return Promise.resolve(JSON.parse(await this.storage.get(`${this.mintingDayTimestamp}_nextFIDs`) || '[]'))
    }

    async getIsFetchedLastUserIndex(): Promise<boolean> {
        return Promise.resolve(await this.storage.get(`${this.mintingDayTimestamp}_isFetchedLastUserIndex`) == 'true');
    }

    async setIsFetchedLastUserIndex(val: boolean) {
        await this.storage.set(`${this.mintingDayTimestamp}_isFetchedLastUserIndex`, val ? 'true' : 'false');
    }

    async setFIDsForBatch(startIndex: number, endIndex: number, fids: number[]) {
        await this.storage.set(`${this.mintingDayTimestamp}_fidsForBatch_${startIndex}:${endIndex}`, JSON.stringify(fids));
    }

    async getFIDsForBatch(startIndex: number, endIndex: number): Promise<number[]> {
        const res: number[] = JSON.parse(await this.storage.get(`${this.mintingDayTimestamp}_fidsForBatch_${startIndex}:${endIndex}`) || '[]');
        return Promise.resolve(res);
    }

    async saveMaxEndIndex(maxIndex: number) {
        await this.storage.set(`${this.mintingDayTimestamp}_maxEndIndex`, maxIndex.toString());
    }

    async getMaxEndIndex(): Promise<number> {
        return Promise.resolve(parseInt(await this.storage.get(`${this.mintingDayTimestamp}_maxEndIndex`) || '0'));
    }

    async getCastsToVerify(): Promise<Cast[]> {
        return JSON.parse(await this.storage.get(`${this.mintingDayTimestamp}_castsToVerify`) || '[]') as Cast[];
    }

    async saveCastsToVerify(casts: Cast[]) {
        await this.storage.set(`${this.mintingDayTimestamp}_castsToVerify`, JSON.stringify(casts));
    }

    async saveRunningHash(hash: string) {
        await this.storage.set(`${this.mintingDayTimestamp}_runningHash`, hash);
    }

    async getRunningHash(): Promise<string> {
        return await this.storage.get(`${this.mintingDayTimestamp}_runningHash`) || '';
    }

    async saveCastOrder(order: number) {
        await this.storage.set(`${this.mintingDayTimestamp}_castOrder`, order.toString());
    }

    async getCastOrder(): Promise<number> {
        return parseInt(await this.storage.get(`${this.mintingDayTimestamp}_castOrder`) || '0');
    }
}