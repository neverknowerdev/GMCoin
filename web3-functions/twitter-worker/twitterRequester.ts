import ky from "ky";
import { Batch, Result, Tweet, TwitterApiResponse, TwitterResultCore, UserResult } from "./consts";
import { setMaxIdleHTTPParsers } from "http";
import { setDefaultAutoSelectFamily } from "net";
import { use } from "chai";

export interface TwitterSecrets {
    OfficialBearerToken: string;
    OptimizedAPISecretKey: string; // optimized Twitter API secret
    AuthHeaderName: string;
}

export interface TwitterURLList {
    // official API
    twitterLookupURL: string;

    // optimized API
    // optimizedServerURLPrefix: string;
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
            // const url = `${this.urlList.optimizedServerURLPrefix}/UserResultsByRestIds?user_ids=${batch.join(',')}`;
            const url = `${this.urlList.convertToUsernamesURL}?user_ids=${batch.join(',')}`;

            const headerKey = this.secrets.AuthHeaderName;
            try {
                const response = await ky
                    .get(url, {
                        headers: {
                            [headerKey]: this.secrets.OptimizedAPISecretKey,
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
                results.push('');
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
        let finalSuccessBatches: Batch[] = [];

        console.log('userIndexByUsername 2', userIndexByUsername.size, userIndexByUsername);

        await Promise.all(
            batchesToProcess.map(async (cur, index) => {
                try {
                    let {
                        tweets,
                        nextCursor
                    } = await this.fetchTweetsBySearchQuery(queryList[index], cur.nextCursor);


                    for (let i = 0; i < tweets.length; i++) {
                        const userIndex = userIndexByUsername.get(tweets[i].username);
                        // console.log('userIndex', userIndex, tweets[i].username);
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

                    batchesToProcess[index].errorCount = 0;
                    finalSuccessBatches.push(batchesToProcess[index]);

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
            batches: finalSuccessBatches,
            errorBatches: errorBatches
        });
    }

    async fetchTweetsBySearchQuery(query: string, cursor: string): Promise<{ tweets: Tweet[], nextCursor: string }> {
        try {
            // Perform the GET request using ky
            // console.log('query', query);
            // console.log('cursor', cursor);
            const headerKey = this.secrets.AuthHeaderName;

            // const response = await ky.get(this.urlList.optimizedServerURLPrefix + "Search", {
            const response = await ky.get(this.urlList.twitterSearchByQueryURL, {
                timeout: 3000,
                retry: 1,
                headers: {
                    [headerKey]: this.secrets.OptimizedAPISecretKey,
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
                            const user = tweetData.core?.user_results.result ?? tweetData.tweet?.core.user_results.result;
                            if (!user) {
                                console.error('failed to find userResults for', entry)
                                continue;
                            }

                            const legacy = tweetData.legacy ?? tweetData.tweet?.legacy;
                            if (!legacy) {
                                console.error('failed to find legacy for', entry)
                                continue;
                            }

                            const tweetID = tweetData.rest_id ?? tweetData.tweet?.rest_id;
                            if (!tweetID) {
                                console.error('failed to get tweetID for entry', entry);
                                continue;
                            }

                            const tweet: Tweet = {
                                tweetID: tweetID,  // Extract tweetID from rest_id
                                userID: user.rest_id, // Extract userID from user_results
                                username: user.core.screen_name,
                                tweetContent: legacy.full_text,  // Extract tweet content
                                likesCount: legacy.favorite_count, // Extract likes count
                                userDescriptionText: user.profile_bio?.description || '', // Extract user bio
                                userIndex: 0,
                            };
                            if (tweet.tweetID == "" || tweet.userID == "" || tweet.username == "" || tweet.tweetContent == "") {
                                console.error("one of required field for tweet is empty, entry", entry);
                                continue;
                            }
                            tweets.push(tweet);
                        }
                    }
                }
            }

            return { tweets, nextCursor };
        } catch (error) {
            console.error('Error fetching tweets:', error);
            throw error;
        }
    }
}