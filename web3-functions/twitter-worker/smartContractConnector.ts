import { Contract, ContractRunner } from "ethers";
import { TwitterRequester } from "./twitterRequester";
import { Storage } from "./storage";
import { Logger } from "./cloudwatch";

const USER_ID_FETCH_LIMIT = 1000;

export class SmartContractConnector {
    private contract: Contract;
    private provider: ContractRunner;
    private storage: Storage;
    private logger: Logger;

    constructor(provider: ContractRunner, contract: Contract, storage: Storage, logger: Logger) {
        this.provider = provider;
        this.contract = contract;
        this.storage = storage;
        this.logger = logger;
    }

    async getNextUsernames(requester: TwitterRequester, startIndex: number, minGap: number): Promise<string[]> {
        let usernames = await this.storage.getRemainingUsernames();

        let newRecordsStartIndex = 0;
        if (usernames.length < minGap) {
            // fetch new userIDs

            let isFetchedLastUser = await this.storage.getIsFetchedLastUserIndex();
            if (isFetchedLastUser) {
                return usernames;
            }

            console.log('fetching new UserIDs from smart-contract..', startIndex, USER_ID_FETCH_LIMIT);

            const userIDs = await this.contract.getTwitterUsers(startIndex, USER_ID_FETCH_LIMIT);

            this.logger.info('userIDs', userIDs.length, userIDs);
            usernames = await requester.convertToUsernames(userIDs);

            this.logger.info('usernames', usernames.length, usernames);

            await this.storage.saveRemainingUsernames(usernames);

            if (usernames.length < USER_ID_FETCH_LIMIT) {
                await this.storage.setIsFetchedLastUserIndex(true);
            }
        }

        return usernames;
    }
}