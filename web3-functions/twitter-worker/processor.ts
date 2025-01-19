import {w3fStorage, Batch} from "./consts"; // Assuming w3fStorage is defined in consts

// Define Batch interface


export class BatchManager {
    private storage: w3fStorage;
    private mintingDayTimestamp: number;

    constructor(storage: w3fStorage, mintingDayTimestamp: number) {
        this.storage = storage;
        this.mintingDayTimestamp = mintingDayTimestamp;
    }

}