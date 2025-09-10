import { Contract, ContractRunner } from "ethers";
import { Storage } from "./storage";
import { FarcasterRequester } from "./farcasterRequester";
import { Logger } from "../twitter-worker/cloudwatch";

export class SmartContractConnector {
    private provider: ContractRunner;
    private smartContract: Contract;
    private storage: Storage;
    private logger: Logger;

    constructor(provider: ContractRunner, smartContract: Contract, storage: Storage, logger: Logger) {
        this.provider = provider;
        this.smartContract = smartContract;
        this.storage = storage;
        this.logger = logger;
    }

    async getNextFIDs(startIndex: number, count: number): Promise<number[]> {
        try {
            // Check if we've already fetched the last user index to avoid redundant calls
            const isFetchedLastUserIndex = await this.storage.getIsFetchedLastUserIndex();
            if (isFetchedLastUserIndex) {
                const remainingFIDs = await this.storage.getRemainingFIDs();
                this.logger.info(`getNextFIDs from storage`, remainingFIDs.length);
                return remainingFIDs;
            }

            this.logger.info(`getNextFIDs from smart contract`, startIndex, count);
            
            // Get total count of Farcaster users
            const totalCount = await this.smartContract.totalFarcasterUsersCount();
            this.logger.info(`totalFarcasterUsersCount`, totalCount);

            if (startIndex >= totalCount) {
                await this.storage.setIsFetchedLastUserIndex(true);
                await this.storage.saveRemainingFIDs([]);
                return [];
            }

            const actualCount = Math.min(count, Number(totalCount) - startIndex);
            this.logger.info(`getFarcasterUsers`, startIndex, actualCount);

            // Fetch FIDs from smart contract
            const fidStrings = await this.smartContract.getFarcasterUsers(startIndex, actualCount);
            const fids: number[] = fidStrings.map((fidStr: string) => parseInt(fidStr));

            this.logger.info(`getFarcasterUsers result`, fids.length, fids);

            if (startIndex + actualCount >= totalCount) {
                await this.storage.setIsFetchedLastUserIndex(true);
            }

            await this.storage.saveRemainingFIDs(fids);
            return fids;
        } catch (error) {
            this.logger.error('Error in getNextFIDs:', error);
            throw error;
        }
    }
}