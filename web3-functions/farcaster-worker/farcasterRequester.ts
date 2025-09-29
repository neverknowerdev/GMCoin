import ky from "ky";
import { Batch, Result, Cast, NeynarApiResponse, CastProcessingType } from "./consts";

export interface NeynarSecrets {
    NeynarAPIKey: string;
}

export interface NeynarURLList {
    neynarFeedURL: string;
}

export class FarcasterRequester {
    private secrets: NeynarSecrets;
    private urlList: NeynarURLList;

    constructor(secrets: NeynarSecrets, URLs: NeynarURLList) {
        this.secrets = secrets;
        this.urlList = URLs;
    }

    async fetchCastsByFIDs(fids: number[]): Promise<Cast[]> {
        const batchSize = 100; // Neynar limit
        const batches: number[][] = [];
        const results: Cast[] = [];

        // Step 1: Group FIDs into batches of 100
        for (let i = 0; i < fids.length; i += batchSize) {
            batches.push(fids.slice(i, i + batchSize));
        }

        // Step 2: Prepare and send parallel requests
        const requests = batches.map(async (batch) => {
            const fidString = batch.join(',');

            try {
                const response = await ky
                    .get(this.urlList.neynarFeedURL, {
                        headers: {
                            'x-api-key': this.secrets.NeynarAPIKey,
                            'x-neynar-experimental': 'false'
                        },
                        searchParams: {
                            feed_type: 'filter',
                            filter_type: 'fids',
                            fids: fidString,
                            with_recasts: 'true',
                            limit: '100'
                        },
                        timeout: 30000,
                        retry: 2
                    })
                    .json<NeynarApiResponse>();

                // Step 3: Process the response and map to Cast interface
                if (response.casts) {
                    response.casts.forEach((cast) => {
                        // Filter for yesterday's casts
                        const castDate = new Date(cast.timestamp);
                        const yesterday = new Date();
                        yesterday.setDate(yesterday.getDate() - 1);
                        yesterday.setHours(0, 0, 0, 0);
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);

                        if (castDate >= yesterday && castDate < today) {
                            const processedCast: Cast = {
                                userIndex: 0, // Will be set later
                                fid: cast.author.fid,
                                username: cast.author.username,
                                castHash: cast.hash,
                                castContent: cast.text,
                                likesCount: cast.reactions.likes_count,
                                recastsCount: cast.reactions.recasts_count,
                                timestamp: cast.timestamp,
                            };

                            results.push(processedCast);
                        }
                    });
                }
            } catch (error) {
                console.error('Error fetching batch for FIDs:', batch, error);
                throw error;
            }
        });

        await Promise.all(requests);
        return results;
    }

    async fetchCastsInBatches(
        batchesToProcess: Batch[],
        fidBatches: number[][],
        userIndexByFID: Map<number, number>
    ): Promise<{
        casts: Cast[],
        batches: Batch[],
        errorBatches: Batch[],
    }> {
        let allCasts: Cast[] = [];
        let errorBatches: Batch[] = [];
        let finalSuccessBatches: Batch[] = [];

        await Promise.all(
            batchesToProcess.map(async (cur, index) => {
                try {
                    let { casts, nextCursor } = await this.fetchCastsByFIDsWithCursor(
                        fidBatches[index],
                        cur.nextCursor
                    );

                    for (let i = 0; i < casts.length; i++) {
                        const userIndex = userIndexByFID.get(casts[i].fid);
                        if (userIndex === undefined) {
                            console.error("not found FID!!", casts[i].fid);
                            throw new Error(`not found FID!! ${casts[i].fid}`)
                        }
                        casts[i].userIndex = userIndex || 0;
                    }

                    batchesToProcess[index].nextCursor = '';
                    if (casts.length > 0 && nextCursor != '') {
                        batchesToProcess[index].nextCursor = nextCursor
                    }

                    batchesToProcess[index].errorCount = 0;
                    finalSuccessBatches.push(batchesToProcess[index]);

                    allCasts.push(...casts);
                } catch (error) {
                    cur.errorCount++;
                    errorBatches.push(cur);
                    console.error('error fetching and processing casts: ', error);
                    return null;
                }
            })
        );

        return Promise.resolve({
            casts: allCasts,
            batches: finalSuccessBatches,
            errorBatches: errorBatches
        });
    }

    async fetchCastsByFIDsWithCursor(fids: number[], cursor: string): Promise<{ casts: Cast[], nextCursor: string }> {
        try {
            const fidString = fids.join(',');

            const searchParams: any = {
                feed_type: 'filter',
                filter_type: 'fids',
                fids: fidString,
                with_recasts: 'true',
                limit: '100'
            };

            if (cursor && cursor !== '') {
                searchParams.cursor = cursor;
            }

            const response = await ky.get(this.urlList.neynarFeedURL, {
                timeout: 30000,
                retry: 2,
                headers: {
                    'x-api-key': this.secrets.NeynarAPIKey,
                    'x-neynar-experimental': 'false'
                },
                searchParams: searchParams
            }).json<NeynarApiResponse>();

            const casts: Cast[] = [];
            let nextCursor = response.next_cursor || '';

            // Filter for yesterday's casts and process
            if (response.casts) {
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                yesterday.setHours(0, 0, 0, 0);
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                response.casts.forEach((cast) => {
                    const castDate = new Date(cast.timestamp);

                    if (castDate >= yesterday && castDate < today) {
                        const processedCast: Cast = {
                            userIndex: 0, // Will be set later
                            fid: cast.author.fid,
                            username: cast.author.username,
                            castHash: cast.hash,
                            castContent: cast.text,
                            likesCount: cast.reactions.likes_count,
                            recastsCount: cast.reactions.recasts_count,
                            timestamp: cast.timestamp,
                        };

                        if (processedCast.castHash == "" || processedCast.fid == 0 || processedCast.username == "" || processedCast.castContent == "") {
                            console.error("one of required field for cast is empty", cast);
                            return;
                        }

                        casts.push(processedCast);
                    }
                });
            }

            return { casts, nextCursor };
        } catch (error) {
            console.error('Error fetching casts:', error);
            throw error;
        }
    }

    async fetchCastsByHashes(casts: Cast[]): Promise<Cast[]> {
        // For high-engagement cast verification - similar to Twitter's fetchTweetsByIDs
        // This would be used for casts with high likes/recasts for verification
        // For now, we'll return the casts as-is since Neynar feed already provides verified data
        return casts;
    }
}