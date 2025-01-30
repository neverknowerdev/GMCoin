import {Batch} from "./consts"; // Assuming w3fStorage is defined in consts
import {Storage} from "./storage";
import {SmartContractConnector} from "./smartContractConnector";
import {TwitterRequester} from "./twitterRequester";

const MAX_TWITTER_SEARCH_QUERY_LENGTH = 512;
const KEYWORD = "gm";

export class BatchManager {
    private storage: Storage;
    private mintingDayTimestamp: number;
    private concurrencyLimit: number;
    private contractConnector: SmartContractConnector;

    private queryList: string[] = [];
    private userIndexByUsername: Map<string, number> = new Map();

    constructor(storage: Storage, contractConnector: SmartContractConnector, mintingDayTimestamp: number, concurrencyLimit: number) {
        this.storage = storage;
        this.mintingDayTimestamp = mintingDayTimestamp;
        this.concurrencyLimit = concurrencyLimit;
        this.contractConnector = contractConnector;
    }

    async generateNewBatches(requester: TwitterRequester, mintingDayTimestamp: number, batches: Batch[]): Promise<{
        batchesToProcess: Batch[];
        queryList: string[];
        userIndexByUsername: Map<string, number>
    }> {
        batches = batches.filter(batch => batch.nextCursor != '')
            .sort((a, b) => Number(a.startIndex - b.startIndex));

        for (let i = 0; i < batches.length; i++) {
            const cur = batches[i];

            // cache userIDs for batches
            // fetch them here
            const batchUsernames = await this.storage.getUsernamesForBatch(cur.startIndex, cur.endIndex);
            const generatedQuery = createUserQueryStringStatic(batchUsernames, mintingDayTimestamp, KEYWORD);
            this.queryList.push(generatedQuery);
            fillUserIndexByUsernames(this.userIndexByUsername, batchUsernames, cur.startIndex);
        }

        if (batches.length < this.concurrencyLimit) {
            console.log('generating new batches and queries..');
            const newCursorsCount = this.concurrencyLimit - batches.length;

            const maxEndIndex = await this.storage.getMaxEndIndex();
            let startIndex = maxEndIndex;

            let remainingUsernames = await this.contractConnector.getNextUsernames(requester, startIndex, newCursorsCount * 50);
            for (let i = 0; i < newCursorsCount; i++) {
                if (remainingUsernames.length == 0) {
                    break;
                }

                const {
                    queryString,
                    recordInsertedCount
                } = createUserQueryString(remainingUsernames, this.mintingDayTimestamp, MAX_TWITTER_SEARCH_QUERY_LENGTH, KEYWORD);

                if (recordInsertedCount == 0) {
                    break;
                }

                this.queryList.push(queryString);

                const newBatch: Batch = {
                    startIndex: startIndex,
                    endIndex: startIndex + recordInsertedCount,
                    nextCursor: ''
                }

                if (newBatch.endIndex > maxEndIndex) {
                    await this.storage.saveMaxEndIndex(newBatch.endIndex);
                }

                startIndex += recordInsertedCount;

                batches.push(newBatch);

                const batchUsernames = remainingUsernames.slice(0, recordInsertedCount);

                await fillUserIndexByUsernames(this.userIndexByUsername, batchUsernames, newBatch.startIndex);

                await this.storage.setUsernamesForBatch(newBatch.startIndex, newBatch.endIndex, batchUsernames);

                remainingUsernames = remainingUsernames.slice(recordInsertedCount);
            }

            await this.storage.saveRemainingUsernames(remainingUsernames);
            console.log('newBatches', this.concurrencyLimit, batches.length, batches);
        }

        return Promise.resolve({
            batchesToProcess: batches,
            queryList: this.queryList,
            userIndexByUsername: this.userIndexByUsername
        });
    }
}

function createUserQueryString(userIDs: string[], mintingDayTimestamp: number, maxLength: number, queryPrefix: string): {
    queryString: string;
    recordInsertedCount: number
} {
    const untilDayStr = formatDay(mintingDayTimestamp, 1);
    const sinceDayStr = formatDay(mintingDayTimestamp, 0);
    let queryString = `${queryPrefix} since:${sinceDayStr} until:${untilDayStr} AND (`;
    let recordInsertedCount = 0;

    for (let i = 0; i < userIDs.length; i++) {
        const userID = userIDs[i];
        const nextPart = `from:${userID}`;

        if (queryString.length + nextPart.length + 1 + 4 > maxLength) {
            break;
        }

        if (i > 0) {
            queryString += ` OR `;
        }

        queryString += nextPart;
        recordInsertedCount++;

    }

    queryString += ')';

    // Close the final query string with parentheses
    return {queryString, recordInsertedCount};
}

function createUserQueryStringStatic(userIDs: string[], mintingDayTimestamp: number, queryPrefix: string): string {
    const untilDayStr = formatDay(mintingDayTimestamp, 1);
    const sinceDayStr = formatDay(mintingDayTimestamp, 0);
    let queryString = `${queryPrefix} since:${sinceDayStr} until:${untilDayStr} AND (`;
    for (let i = 0; i < userIDs.length; i++) {
        if (i > 0) {
            queryString += ` OR `;
        }
        queryString += `from:${userIDs[i]}`;
    }

    queryString += `)`;

    return queryString;
}

function formatDay(timestamp: number, addDays: number): string {
    // Create a Date object from the timestamp
    const date = new Date(timestamp * 1000);
    if (addDays != 0) {
        date.setDate(date.getDate() + addDays);
    }

    // Use Intl.DateTimeFormat to format the date as "YYYY-MM-DD"
    const formatter = new Intl.DateTimeFormat('en-CA'); // 'en-CA' ensures "YYYY-MM-DD" format
    return formatter.format(date);
}

function fillUserIndexByUsernames(userIndexByUsernames: Map<string, number>, batchUsernames: string[], startIndex: number) {
    for (let i = 0; i < batchUsernames.length; i++) {
        userIndexByUsernames.set(batchUsernames[i], startIndex + i);
    }
}