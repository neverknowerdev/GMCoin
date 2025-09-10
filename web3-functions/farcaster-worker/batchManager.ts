import { Batch } from "./consts";
import { Storage } from "./storage";
import { SmartContractConnector } from "./smartContractConnector";
import { FarcasterRequester } from "./farcasterRequester";
import { Logger } from "../twitter-worker/cloudwatch";

const MAX_FIDS_PER_BATCH = 100; // Neynar API limit
const KEYWORD = "gm";

export class BatchManager {
    private storage: Storage;
    private mintingDayTimestamp: number;
    private concurrencyLimit: number;
    private contractConnector: SmartContractConnector;
    private logger: Logger;
    private fidBatches: number[][] = [];
    private userIndexByFID: Map<number, number> = new Map();

    constructor(logger: Logger, storage: Storage, contractConnector: SmartContractConnector, mintingDayTimestamp: number, concurrencyLimit: number) {
        this.storage = storage;
        this.mintingDayTimestamp = mintingDayTimestamp;
        this.concurrencyLimit = concurrencyLimit;
        this.contractConnector = contractConnector;
        this.logger = logger;
    }

    async generateNewBatches(requester: FarcasterRequester, mintingDayTimestamp: number, batches: Batch[]): Promise<{
        batchesToProcess: Batch[];
        fidBatches: number[][];
        userIndexByFID: Map<number, number>
    }> {
        // Skip already done batches: nextCursor == '' && errorCount == 0
        batches = batches.filter(batch => !(batch.nextCursor == '' && batch.errorCount == 0))
            .sort((a, b) => Number(a.startIndex - b.startIndex));

        for (let i = 0; i < batches.length; i++) {
            this.logger.info(`restoreBatch`, i, batches[i]);
            const cur = batches[i];

            // Cache FIDs for batches
            const batchFIDs = await this.storage.getFIDsForBatch(cur.startIndex, cur.endIndex);
            this.logger.info(`batchFIDs`, batchFIDs.length, batchFIDs);

            this.fidBatches.push(batchFIDs);
            fillUserIndexByFIDs(this.logger, this.userIndexByFID, batchFIDs, cur.startIndex);
        }

        if (batches.length < this.concurrencyLimit) {
            const newBatchesCount = this.concurrencyLimit - batches.length;
            const maxEndIndex = await this.storage.getMaxEndIndex();
            let startIndex = maxEndIndex;

            this.logger.info(`generateNewBatches`, newBatchesCount);
            let remainingFIDs = await this.contractConnector.getNextFIDs(startIndex, newBatchesCount * MAX_FIDS_PER_BATCH);
            this.logger.info(`remainingFIDs fetched from smart-contract`, remainingFIDs.length, remainingFIDs);

            for (let i = 0; i < newBatchesCount; i++) {
                if (remainingFIDs.length == 0) {
                    break;
                }

                this.logger.info(`generateNewBatches`, i, remainingFIDs.length);

                const { fidBatch, recordInsertedCount } = createFIDBatch(remainingFIDs, MAX_FIDS_PER_BATCH);

                if (recordInsertedCount == 0) {
                    break;
                }

                this.fidBatches.push(fidBatch);

                const endIndex = startIndex + recordInsertedCount;
                fillUserIndexByFIDs(this.logger, this.userIndexByFID, fidBatch, startIndex);

                await this.storage.setFIDsForBatch(startIndex, endIndex, fidBatch);

                const newBatch: Batch = {
                    startIndex: startIndex,
                    endIndex: endIndex,
                    nextCursor: '',
                    errorCount: 0
                };

                batches.push(newBatch);
                startIndex = endIndex;

                remainingFIDs = remainingFIDs.slice(recordInsertedCount);
            }

            await this.storage.saveMaxEndIndex(startIndex);
        }

        return Promise.resolve({
            batchesToProcess: batches,
            fidBatches: this.fidBatches,
            userIndexByFID: this.userIndexByFID
        });
    }
}

function createFIDBatch(fids: number[], maxBatchSize: number): {
    fidBatch: number[];
    recordInsertedCount: number;
} {
    const fidBatch: number[] = [];
    let count = 0;

    for (let i = 0; i < fids.length && count < maxBatchSize; i++) {
        fidBatch.push(fids[i]);
        count++;
    }

    return {
        fidBatch,
        recordInsertedCount: count
    };
}

function fillUserIndexByFIDs(logger: Logger, userIndexByFID: Map<number, number>, fids: number[], startIndex: number) {
    for (let i = 0; i < fids.length; i++) {
        const userIndex = startIndex + i;
        userIndexByFID.set(fids[i], userIndex);
        logger.info(`userIndexByFID.set(${fids[i]}, ${userIndex})`);
    }
}