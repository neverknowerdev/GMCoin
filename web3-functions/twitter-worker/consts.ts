export const ContractABI = [
    {
        "inputs": [
            {
                "components": [
                    {
                        "internalType": "uint64",
                        "name": "userIndex",
                        "type": "uint64"
                    },
                    {
                        "internalType": "uint16",
                        "name": "tweets",
                        "type": "uint16"
                    },
                    {
                        "internalType": "uint16",
                        "name": "hashtagTweets",
                        "type": "uint16"
                    },
                    {
                        "internalType": "uint16",
                        "name": "cashtagTweets",
                        "type": "uint16"
                    },
                    {
                        "internalType": "uint16",
                        "name": "simpleTweets",
                        "type": "uint16"
                    },
                    {
                        "internalType": "uint32",
                        "name": "likes",
                        "type": "uint32"
                    }
                ],
                "internalType": "struct GMTwitterOracle.UserTwitterData[]",
                "name": "userData",
                "type": "tuple[]"
            },
            {
                "internalType": "uint32",
                "name": "mintingDayTimestamp",
                "type": "uint32"
            },
            {
                "components": [
                    {
                        "internalType": "uint64",
                        "name": "startIndex",
                        "type": "uint64"
                    },
                    {
                        "internalType": "uint64",
                        "name": "endIndex",
                        "type": "uint64"
                    },
                    {
                        "internalType": "string",
                        "name": "nextCursor",
                        "type": "string"
                    }
                ],
                "internalType": "struct GMTwitterOracle.Batch[]",
                "name": "batches",
                "type": "tuple[]"
            }
        ],
        "name": "mintCoinsForTwitterUsers",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint64",
                "name": "start",
                "type": "uint64"
            },
            {
                "internalType": "uint16",
                "name": "count",
                "type": "uint16"
            }
        ],
        "name": "getTwitterUsers",
        "outputs": [
            {
                "internalType": "string[]",
                "name": "",
                "type": "string[]"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": false,
                "internalType": "uint32",
                "name": "mintingDayTimestamp",
                "type": "uint32"
            },
            {
                "components": [
                    {
                        "internalType": "uint64",
                        "name": "startIndex",
                        "type": "uint64"
                    },
                    {
                        "internalType": "uint64",
                        "name": "endIndex",
                        "type": "uint64"
                    },
                    {
                        "internalType": "string",
                        "name": "nextCursor",
                        "type": "string"
                    }
                ],
                "indexed": false,
                "internalType": "struct GMTwitterOracle.Batch[]",
                "name": "batches",
                "type": "tuple[]"
            }
        ],
        "name": "twitterMintingProcessed",
        "type": "event"
    },
    {
        "inputs": [
            {
                "internalType": "uint32",
                "name": "mintingDayTimestamp",
                "type": "uint32"
            },
            {
                "components": [
                    {
                        "internalType": "uint64",
                        "name": "startIndex",
                        "type": "uint64"
                    },
                    {
                        "internalType": "uint64",
                        "name": "endIndex",
                        "type": "uint64"
                    },
                    {
                        "internalType": "string",
                        "name": "nextCursor",
                        "type": "string"
                    }
                ],
                "internalType": "struct GMTwitterOracle.Batch[]",
                "name": "batches",
                "type": "tuple[]"
            }
        ],
        "name": "logErrorBatches",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {
                "internalType": "uint32",
                "name": "mintingDayTimestamp",
                "type": "uint32"
            }
        ],
        "name": "finishMinting",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },

];

export interface Batch {
    startIndex: number;
    endIndex: number;
    nextCursor: string;
}

export interface Tweet {
    userIndex: number;
    userID: string;
    username: string;
    tweetID: string;
    tweetContent: string;
    likesCount: number;
    userDescriptionText: string;
}

export interface TwitterApiResponse {
    data: {
        search_by_raw_query: {
            search_timeline: {
                timeline: {
                    instructions: Array<{
                        entry?: {
                            content: {
                                cursor_type?: string,
                                value?: string
                            }
                        },
                        entries?: Array<{
                            content: {
                                cursor_type?: string,
                                value?: string,

                                content?: {
                                    tweet_results?: {
                                        rest_id: string; // This is the tweetID
                                        result: {
                                            rest_id: string; // This
                                            core: {
                                                user_results: {
                                                    result: {
                                                        rest_id: string; // This is the userID
                                                        profile_bio: {
                                                            description: string;
                                                        };
                                                        core: {
                                                            name: string;
                                                            screen_name: string;
                                                        }
                                                    };
                                                };
                                            };
                                            legacy: {
                                                full_text: string; // The tweet content
                                                favorite_count: number; // The number of likes
                                                created_at: string;
                                            };
                                        };
                                    };
                                };
                            };
                        }>;
                    }>;
                };
            };
        };
    };
}

export interface w3fStorage {
    get(key: string): Promise<string | undefined>;

    set(key: string, value: string): Promise<void>;

    delete(key: string): Promise<void>;

    getKeys(): Promise<string[]>;

    getSize(): Promise<number>;
}

export interface Batch {
    startIndex: number;
    endIndex: number;
    nextCursor: string;
}

// Define the result structure
export interface Result {
    userIndex: number;
    hashtagTweets: number;
    cashtagTweets: number;
    simpleTweets: number;
    tweets: number;
    likes: number;
}

export const defaultResult: Result = {
    userIndex: 0,
    hashtagTweets: 0,
    cashtagTweets: 0,
    simpleTweets: 0,
    tweets: 0,
    likes: 0,
};