import { Interface } from "@ethersproject/abi";
import {
  Web3Function,
  Web3FunctionEventContext,
} from "@gelatonetwork/web3-functions-sdk";
import { Contract, getBytes } from "ethers";
import { Buffer } from 'buffer';
import ky from "ky";



// Define Twitter API endpoint
const TWITTER_API_SEARCH_URL = 'https://twitter283.p.rapidapi.com/Search';

const ContractABI = [
  "event mintingFromTwitter_Progress(uint lastProcessedIndex, bytes nextCursor)",
  "function getTwitterUsers(uint64 start, uint16 count) external view returns (string[] memory)",
  "function mintCoinsForTwitterUsers(uint256 startIndex, uint256 endIndex, uint256[] calldata tweets, uint256[] calldata likes)",
];

const BATCH_COUNT = 100;
const MAX_TWITTER_SEARCH_QUERY_LENGTH = 512;
const BASE_QUERY = `"gm"`;
const KEYWORD = "gm"; 

Web3Function.onRun(async (context: Web3FunctionEventContext) => {
  // Get event log from Web3FunctionEventContext
  const { log, userArgs, multiChainProvider } = context;

  const bearerToken = await context.secrets.get("TWITTER_BEARER");
  if (!bearerToken)
    return { canExec: false, message: `TWITTER_BEARER not set in secrets` };

  const secretKey = await context.secrets.get("TWITTER_RAPIDAPI_KEY");
  if (!secretKey) {
      throw new Error('Missing TWITTER_RAPIDAPI_KEY environment variable');
  }

  try {
    const provider = multiChainProvider.default();

    const smartContract = new Contract(
      userArgs.contractAddress as string,
      ContractABI,
      provider
    );

    const contract = new Interface(ContractABI);
    const event = contract.parseLog(log);

    // Handle event data
    const { lastProcessedIndex: lastProcessedIndexBigNumber, nextCursor: nextCursorString } = event.args;
    const lastProcessedIndex = Number(lastProcessedIndexBigNumber.toBigInt());


    const nextCursor = bytesStringToString(nextCursorString);
    console.log(`Minting for users strarting from index #${lastProcessedIndex}, cursor ${nextCursor}..`);


    let startIndex = lastProcessedIndex+1;
    if (lastProcessedIndex == 0) {
      startIndex = 0;
    }

    console.log('startIndex', startIndex);
    
    const userIDs: string[] = await smartContract.getTwitterUsers(startIndex, BATCH_COUNT);
    console.log('result', userIDs);
    
    const { queryString, lastIndexUsed } = createUserQueryString(userIDs, MAX_TWITTER_SEARCH_QUERY_LENGTH, BASE_QUERY);
    console.log(`created query "${queryString}"`);
    console.log(`lastIndexUsed ${lastIndexUsed}`);

    const { tweets, cursor } = await fetchTweets(secretKey, queryString, nextCursor);
    const results: Result[] = processTweets(userIDs, tweets);

    let resultTransactions: any[] = [];
    resultTransactions.push({
      to: userArgs.verifierContractAddress as string,
      data: smartContract.interface.encodeFunctionData("mintCoinsForTwitterUsers", [
        startIndex,
        lastIndexUsed,
        results,
        cursor,
      ]),
    });

    return {
      canExec: true,
      callData: resultTransactions,
    };
  } catch (error: any) {
    if (error.code === 'CALL_EXCEPTION' && error.reason) {
      console.log(error);
      console.error(`transaction reverted: ${error.reason}`);
    }

    console.error('Error during Twitter user validation:', error);
    return {
      canExec: false,
      message: 'Error occurred while validation: ' + error.message,
    };
  }
});



/**
 * Function to create a query string from an array of user IDs.
 * @param {string[]} userIDs - Array of user IDs.
 * @param {number} maxLength - Maximum allowed length for the query string (e.g., 512 characters).
 * @param {string} queryPrefix - The initial part of the query string.
 * @returns {string} - The formatted string in the format `(queryPrefix) AND (from:[userID] OR from:[userID])`.
 */
function createUserQueryString(userIDs: string[], maxLength: number, queryPrefix: string): { queryString: string; lastIndexUsed: number } {
  let queryString = `${queryPrefix} AND (`;
  let lastIndexUsed = -1; 

  for (let i = 0; i < userIDs.length; i++) {
      const userID = userIDs[i];
      const nextPart = `from:${userID}`;

      if(queryString.length + nextPart.length + 1 + 4 > maxLength) {
        break;
      }

      if(i > 0) {
        queryString += ` OR `;
      }

      queryString += nextPart;
      lastIndexUsed = i; 
      
  }

  queryString += ')';

  // Close the final query string with parentheses
  return { queryString, lastIndexUsed };
}

// Define the result structure
interface Result {
  hashtagTweets: number;
  moneytagTweets: number;
  simpleTweets: number;
  likes: number;
}

// Function to process tweets and create the result array
function processTweets(userIDs: string[], foundTweets: Tweet[]): Result[] {
  const results: Result[] = userIDs.map(() => ({
      hashtagTweets: 0,
      moneytagTweets: 0,
      simpleTweets: 0,
      likes: 0,
  }));

  // Iterate through foundTweets and update the corresponding user's result
  for (const tweet of foundTweets) {
      const userIndex = userIDs.indexOf(tweet.userID);

      // If user is found in userIDs
      if (userIndex !== -1) {
          const foundKeyword = findKeywordWithPrefix(tweet.tweetContent, KEYWORD);
          if(foundKeyword == "$"+KEYWORD) {
            results[userIndex].moneytagTweets++;
          } else if(foundKeyword == "#"+KEYWORD) {
            results[userIndex].hashtagTweets++;
          } else if(foundKeyword == KEYWORD) {
            results[userIndex].simpleTweets++;
          }

          results[userIndex].likes += tweet.likesCount;
      }
  }

  return results;
}

function findKeywordWithPrefix(text: string, keyword: string): string {
  const words = text.split(/\s+/);  // Split by whitespace to get individual words


  for (const word of words) {
      // Remove punctuation from the word
      const cleanedWord = word.replace(/[.,!?;:()]/g, "");

      // Check for hashtag tweets
      if (cleanedWord === "$"+KEYWORD) {
          return "$"+KEYWORD;
      }
      // Check for moneytag tweets
      else if (cleanedWord === "#"+KEYWORD) {
          return "#"+KEYWORD;
      }
      // Check for simple keyword tweets
      else if (cleanedWord === KEYWORD) {
          return KEYWORD;
      }
  }

  return "";
}



// Define the schema of the tweet result
interface Tweet {
  userID: string;
  tweetID: string;
  tweetContent: string;
  likesCount: number;
  userDescriptionText: string;
}

// Define the response structure from the Twitter API
interface TwitterApiResponse {
  data: {
      search_by_raw_query: {
          search_timeline: {
              timeline: {
                  instructions: Array<{
                      entries: Array<{
                          content: {
                              tweet_results?: {
                                  result: {
                                      rest_id: string; // This is the tweetID
                                      core: {
                                          user_results: {
                                              result: {
                                                  rest_id: string; // This is the userID
                                                  profile_bio: {
                                                      description: string;
                                                  };
                                              };
                                          };
                                      };
                                      legacy: {
                                          full_text: string; // The tweet content
                                          favorite_count: number; // The number of likes
                                      };
                                  };
                              };
                          };
                      }>;
                  }>;
                  response_objects?: {
                      feedback_actions?: Array<{
                          value: {
                              timeline: {
                                  cursor: string; // For pagination
                              };
                          };
                      }>;
                  };
              };
          };
      };
  };
}


// Function to fetch tweets based on a query
async function fetchTweets(secretKey: string, queryString: string, cursor: string): Promise<{ tweets: Tweet[]; cursor?: string }> {
  try {
      // Perform the GET request using ky
      const response = await ky.get(TWITTER_API_SEARCH_URL, {
          headers: {
              'X-Rapidapi-Key': secretKey,
              'X-Rapidapi-Host': 'twitter283.p.rapidapi.com',
          },
          searchParams: {
              q: queryString,
              type: 'Latest',
              count: '20',
              cursor: cursor,
              safe_search: 'false',
          },
      }).json<TwitterApiResponse>();

      const tweets: Tweet[] = [];
  
      // Navigate the response and extract the required tweet information
      const instructions = response.data.search_by_raw_query.search_timeline.timeline.instructions;
      for (const instruction of instructions) {
          for (const entry of instruction.entries) {
              const tweetData = entry.content.tweet_results?.result;
  
              if (tweetData) {
                  const user = tweetData.core.user_results.result;
                  const legacy = tweetData.legacy;
  
                  const tweet: Tweet = {
                      tweetID: tweetData.rest_id,  // Extract tweetID from rest_id
                      userID: user.rest_id,        // Extract userID from user_results
                      tweetContent: legacy.full_text,  // Extract tweet content
                      likesCount: legacy.favorite_count, // Extract likes count
                      userDescriptionText: user.profile_bio?.description || '', // Extract user bio
                  };
                  tweets.push(tweet);
              }
          }
      }
  
      // Capture the cursor for pagination if available
      const feedbackActions = response.data.search_by_raw_query.search_timeline.timeline.response_objects?.feedback_actions;
      if (feedbackActions && feedbackActions.length > 0) {
        cursor = feedbackActions[0].value.timeline.cursor;
      }  else {
        cursor = "";
      }

      return { tweets, cursor };
  } catch (error) {
      console.error('Error fetching tweets:', error);
      throw error;
  }
}

function bytesStringToString(strBytes: string): string {
  const cursorBytes = getBytes(strBytes);
  let decoder = new TextDecoder("utf-8");
  return decoder.decode(cursorBytes);
}