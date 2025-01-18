import {task} from "hardhat/config";
import {TwitterApi} from "twitter-api-v2";
import * as dotenv from "dotenv";

dotenv.config(); // Load environment variables from .env file

task("tweetCountStat", "Fetches tweet counts from the Twitter API")
    .addParam("query", "The query to search tweets for")
    .setAction(async (taskArgs, hre) => {
        const {query} = taskArgs;

        // Initialize Twitter API client
        const twitterClient = new TwitterApi(process.env.TWITTER_BEARER!);
        const readOnlyClient = twitterClient.readOnly;

        console.log(`Fetching tweet counts for query: ${query}...`);

        try {
            const recentCounts = await readOnlyClient.v2.tweetCountRecent(query, {
                query: query,
                granularity: "day", // Equivalent to types.TweetCountsGranularityDay
            });

            console.log(`Query "${query}":`);
            for (const rc of recentCounts.data) {
                console.log(
                    `Date: ${new Date(rc.start).toLocaleDateString()}, Count: ${rc.tweet_count}`
                );
            }
        } catch (error) {
            console.error(`Failed to fetch tweet counts: ${error.message}`);
        }
    });