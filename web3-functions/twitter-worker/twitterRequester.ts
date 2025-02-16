import ky from "ky";
import {Batch, Result, Tweet, TwitterApiResponse} from "./consts";

export interface TwitterSecrets {
    OfficialBearerToken: string;
    OptimizedAPISecretKey: string; // optimized Twitter API secret
}

export interface TwitterURLList {
    // official API
    twitterLookupURL: string;

    // optimized API
    convertToUsernamesURL: string;
    twitterSearchByQueryURL: string;
}

export class TwitterRequester {
    private secrets: TwitterSecrets;
    private urlList: TwitterURLList;

    constructor(secrets: TwitterSecrets, URLs: TwitterURLList) {
        this.secrets = secrets;
        this.urlList = URLs;
    }

    async convertToUsernames(userIDs: string[]): Promise<string[]> {
        let batches: string[][] = [];

        const batchSize = 100;
        for (let i = 0; i < userIDs.length; i += batchSize) {
            batches.push(userIDs.slice(i, i + batchSize));
        }

        let userIDtoUsername: Map<string, string> = new Map();
        const requests = batches.map(async (batch) => {
            const url = `${this.urlList.convertToUsernamesURL}?user_ids=${batch.join(',')}`;

            try {
                const response = await ky
                    .get(url, {
                        headers: {
                            'X-Rapidapi-Key': this.secrets.OptimizedAPISecretKey,
                        },
                    })
                    .json<any>();

                response.data.users.forEach((user: any) => {
                    if (user.result?.core?.screen_name) {
                        userIDtoUsername.set(user.rest_id, user.result.core.screen_name);
                    }
                })

            } catch (error) {
                // Handle errors for this batch
                console.error('Error fetching batch:', error);
            }
        });

        await Promise.all(requests);

        let results: string[] = [];
        for (const userID of userIDs) {
            const username = userIDtoUsername.get(userID);
            if (!username) {
                continue;
            }

            results.push(username);
        }

        return results;
    }

    async fetchTweetsByIDs(tweets: Tweet[]): Promise<Tweet[]> {
        const batchSize = 100;
        const batches: Tweet[][] = [];
        const results: Tweet[] = [];

        let tweetByID = new Map<string, Tweet>;
        for (const tweet of tweets) {
            tweetByID.set(tweet.tweetID, tweet);
        }

        // Step 1: Group tweets into batches of 100
        for (let i = 0; i < tweets.length; i += batchSize) {
            batches.push(tweets.slice(i, i + batchSize));
        }


        // Step 2: Prepare and send parallel requests
        const requests = batches.map(async (batch) => {
            const tweetIDs = batch.map((tweet) => tweet.tweetID).join(',');
            const url = `${this.urlList.twitterLookupURL}?ids=${tweetIDs}&tweet.fields=public_metrics&expansions=author_id&user.fields=description`;


            const response = await ky
                .get(url, {
                    headers: {
                        Authorization: `Bearer ${this.secrets.OfficialBearerToken}`,
                    },
                })
                .json<any>();


            // Step 3: Process the response and map to Tweet interface
            if (response.data) {
                response.data.forEach((tweet: any) => {
                    let tweetToVerify: Tweet = tweetByID.get(tweet.id);
                    if (!tweetToVerify) {
                        return;
                    }

                    if (Math.abs(tweetToVerify.likesCount - tweet.public_metrics.like_count) > 10) {
                        console.warn('tweetToVerify likesCount diff > 10', JSON.stringify(tweetToVerify));
                    }

                    tweetToVerify.likesCount = tweet.public_metrics.like_count;
                    tweetToVerify.tweetContent = tweet.text;

                    results.push(tweetToVerify);
                });
            }
        });

        await Promise.all(requests);

        return results;
    }

    async fetchTweetsInBatches(batchesToProcess: Batch[], queryList: string[], userIndexByUsername: Map<string, number>): Promise<{
        tweets: Tweet[],
        batches: Batch[],
        errorBatches: Batch[],
    }> {
        let allTweets: Tweet[] = [];
        let errorBatches: Batch[] = [];

        await Promise.all(
            batchesToProcess.map(async (cur, index) => {
                    try {
                        let {
                            tweets,
                            nextCursor
                        } = await this.fetchTweetsBySearchQuery(queryList[index], cur.nextCursor);

                        for (let i = 0; i < tweets.length; i++) {
                            const userIndex = userIndexByUsername.get(tweets[i].username);
                            if (userIndex === undefined) {
                                console.error("not found username!!", tweets[i].username);
                                throw new Error(`not found username!! ${tweets[i].username}`)
                            }
                            tweets[i].userIndex = userIndex || 0;
                        }

                        batchesToProcess[index].nextCursor = '';
                        if (tweets.length > 0 && nextCursor != '') {
                            batchesToProcess[index].nextCursor = nextCursor
                        }

                        allTweets.push(...tweets);
                    } catch (error) {
                        cur.errorCount++;
                        errorBatches.push(cur);

                        console.error('error fetching and processing tweets: ', error);
                        return null;
                    }
                }
            )
        );

        return Promise.resolve({
            tweets: allTweets,
            batches: batchesToProcess,
            errorBatches: errorBatches
        });
    }

    async fetchTweetsBySearchQuery(query: string, cursor: string): Promise<{ tweets: Tweet[], nextCursor: string }> {
        try {
            // Perform the GET request using ky
            console.log('query', query);
            console.log('cursor', cursor);
            const response = await ky.get(this.urlList.twitterSearchByQueryURL, {
                timeout: 3000,
                retry: 1,
                headers: {
                    'X-Rapidapi-Key': this.secrets.OptimizedAPISecretKey,
                },
                searchParams: {
                    q: query,
                    type: 'Latest',
                    count: '20',
                    cursor: cursor,
                    safe_search: 'false',
                }
            }).json<TwitterApiResponse>();

            // console.log('fetchTweets queryString', queryString);
            // console.log('fetchTweets response', JSON.stringify(response));


            const tweets: Tweet[] = [];

            let nextCursor = '';
            // Navigate the response and extract the required tweet information
            const instructions = response.data.search_by_raw_query.search_timeline.timeline.instructions;
            for (const instruction of instructions) {
                if (instruction.entry?.content.cursor_type == "Bottom") {
                    nextCursor = instruction.entry?.content.value as string;
                    continue;
                }
                if (!instruction.entries) {
                    continue;
                }

                for (const entry of instruction.entries) {
                    if (entry.content?.cursor_type == "Bottom") {
                        nextCursor = entry.content?.value as string;
                        continue;
                    }

                    if (entry.content.content?.tweet_results) {
                        const tweetData = entry.content.content.tweet_results?.result;
                        if (tweetData) {
                            const user = tweetData.core.user_results.result;
                            const legacy = tweetData.legacy;

                            const tweet: Tweet = {
                                tweetID: tweetData.rest_id,  // Extract tweetID from rest_id
                                userID: user.rest_id, // Extract userID from user_results
                                username: user.core.screen_name,
                                tweetContent: legacy.full_text,  // Extract tweet content
                                likesCount: legacy.favorite_count, // Extract likes count
                                userDescriptionText: user.profile_bio?.description || '', // Extract user bio
                                userIndex: 0,
                            };
                            tweets.push(tweet);
                        }
                    }
                }
            }

            return {tweets, nextCursor};
        } catch (error) {
            console.error('Error fetching tweets:', error);
            throw error;
        }
    }
}