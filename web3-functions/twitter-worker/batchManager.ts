import { Batch } from "./consts"; // Assuming w3fStorage is defined in consts
import { Storage } from "./storage";
import { SmartContractConnector } from "./smartContractConnector";
import { TwitterRequester } from "./twitterRequester";
import { Logger } from "./cloudwatch";

const MAX_TWITTER_SEARCH_QUERY_LENGTH = 512;
const KEYWORD = "gm";

export class BatchManager {
    private storage: Storage;
    private mintingDayTimestamp: number;
    private concurrencyLimit: number;
    private contractConnector: SmartContractConnector;
    private logger: Logger;
    private queryList: string[] = [];
    private userIndexByUsername: Map<string, number> = new Map();

    constructor(logger: Logger, storage: Storage, contractConnector: SmartContractConnector, mintingDayTimestamp: number, concurrencyLimit: number) {
        this.storage = storage;
        this.mintingDayTimestamp = mintingDayTimestamp;
        this.concurrencyLimit = concurrencyLimit;
        this.contractConnector = contractConnector;
        this.logger = logger;
    }

    async generateNewBatches(requester: TwitterRequester, mintingDayTimestamp: number, batches: Batch[]): Promise<{
        batchesToProcess: Batch[];
        queryList: string[];
        userIndexByUsername: Map<string, number>
    }> {
        // skip already done batches: nextCursor == '' && errorCount == 0
        batches = batches.filter(batch => !(batch.nextCursor == '' && batch.errorCount == 0))
            .sort((a, b) => Number(a.startIndex - b.startIndex));

        for (let i = 0; i < batches.length; i++) {
            this.logger.info(`restoreBatch`, i, batches[i]);
            const cur = batches[i];

            // cache userIDs for batches
            // fetch them here
            const batchUsernames = await this.storage.getUsernamesForBatch(cur.startIndex, cur.endIndex);
            this.logger.info(`batchUsernames`, batchUsernames.length, batchUsernames);

            const generatedQuery = createUserQueryStringStatic(batchUsernames, mintingDayTimestamp, KEYWORD);
            this.queryList.push(generatedQuery);

            this.logger.info(`userIndexByUsername`, batchUsernames.length, cur.startIndex, batchUsernames);
            fillUserIndexByUsernames(this.logger, this.userIndexByUsername, batchUsernames, cur.startIndex);
        }

        if (batches.length < this.concurrencyLimit) {
            // console.log('generating new batches and queries..');
            const newCursorsCount = this.concurrencyLimit - batches.length;

            const maxEndIndex = await this.storage.getMaxEndIndex();
            let startIndex = maxEndIndex;

            this.logger.info(`generateNewBatches`, newCursorsCount);
            let remainingUsernames = await this.contractConnector.getNextUsernames(requester, startIndex, newCursorsCount * 50);
            this.logger.info(`remainingUsernames fetched from smart-contract`, remainingUsernames.length, remainingUsernames);

            for (let i = 0; i < newCursorsCount; i++) {
                if (remainingUsernames.length == 0) {
                    break;
                }

                this.logger.info(`generateNewBatches`, i, remainingUsernames.length);

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
                    nextCursor: '',
                    errorCount: 0,
                }

                if (newBatch.endIndex > maxEndIndex) {
                    await this.storage.saveMaxEndIndex(newBatch.endIndex);
                }

                startIndex += recordInsertedCount;

                batches.push(newBatch);

                const batchUsernames = remainingUsernames.slice(0, recordInsertedCount);

                this.logger.info(`batchUsernames`, batchUsernames.length, newBatch.startIndex, batchUsernames);
                fillUserIndexByUsernames(this.logger, this.userIndexByUsername, batchUsernames, newBatch.startIndex);

                await this.storage.setUsernamesForBatch(newBatch.startIndex, newBatch.endIndex, batchUsernames);

                remainingUsernames = remainingUsernames.slice(recordInsertedCount);
                this.logger.info(`remainingUsernames final`, remainingUsernames.length, remainingUsernames);
            }

            await this.storage.saveRemainingUsernames(remainingUsernames);
        }

        return Promise.resolve({
            batchesToProcess: batches,
            queryList: this.queryList,
            userIndexByUsername: this.userIndexByUsername
        });
    }
}

function createUserQueryString(usernames: string[], mintingDayTimestamp: number, maxLength: number, queryPrefix: string): {
    queryString: string;
    recordInsertedCount: number
} {
    const untilDayStr = formatDay(mintingDayTimestamp, 1);
    const sinceDayStr = formatDay(mintingDayTimestamp, 0);
    let queryString = `${queryPrefix} since:${sinceDayStr} until:${untilDayStr} AND (`;
    let ri = 0; // record inserted count

    let usernameAdded = 0;
    for (; ri < usernames.length; ri++) {
        const username = usernames[ri];
        if (username == '') {
            continue;
        }

        const nextPart = `from:${username}`;

        if (queryString.length + nextPart.length + 1 + 4 > maxLength) {
            break;
        }

        if (usernameAdded > 0) {
            queryString += ` OR `;
        }

        queryString += nextPart;
        usernameAdded++;
    }

    queryString += ')';

    // Close the final query string with parentheses
    return { queryString, recordInsertedCount: ri };
}

function createUserQueryStringStatic(usernames: string[], mintingDayTimestamp: number, queryPrefix: string): string {
    const untilDayStr = formatDay(mintingDayTimestamp, 1);
    const sinceDayStr = formatDay(mintingDayTimestamp, 0);
    let queryString = `${queryPrefix} since:${sinceDayStr} until:${untilDayStr} AND (`;
    for (let i = 0; i < usernames.length; i++) {
        if (usernames[i] == '') {
            continue;
        }

        if (i > 0) {
            queryString += ` OR `;
        }
        queryString += `from:${usernames[i]}`;
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

function fillUserIndexByUsernames(logger: Logger, userIndexByUsernames: Map<string, number>, batchUsernames: string[], startIndex: number) {
    for (let i = 0; i < batchUsernames.length; i++) {
        if (batchUsernames[i] == '') {
            continue;
        }

        logger.info(`fillUserIndexByUsernames`, batchUsernames[i], startIndex + i);
        userIndexByUsernames.set(batchUsernames[i], startIndex + i);
    }
}