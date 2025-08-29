import { forEach } from "lodash";

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
                        "name": "casts",
                        "type": "uint16"
                    },
                    {
                        "internalType": "uint16",
                        "name": "hashtagCasts",
                        "type": "uint16"
                    },
                    {
                        "internalType": "uint16",
                        "name": "cashtagCasts",
                        "type": "uint16"
                    },
                    {
                        "internalType": "uint16",
                        "name": "simpleCasts",
                        "type": "uint16"
                    },
                    {
                        "internalType": "uint32",
                        "name": "likes",
                        "type": "uint32"
                    }
                ],
                "internalType": "struct GMStorage.UserFarcasterData[]",
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
                    },
                    {
                        "internalType": "uint8",
                        "name": "errorCount",
                        "type": "uint8"
                    }
                ],
                "internalType": "struct GMStorage.Batch[]",
                "name": "batches",
                "type": "tuple[]"
            }
        ],
        "name": "mintCoinsForFarcasterUsers",
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
        "name": "getFarcasterUsers",
        "outputs": [
            {
                "internalType": "uint256[]",
                "name": "",
                "type": "uint256[]"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "anonymous": false,
        "inputs": [
            {
                "indexed": true,
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
                    },
                    {
                        "internalType": "uint8",
                        "name": "errorCount",
                        "type": "uint8"
                    }
                ],
                "indexed": false,
                "internalType": "struct GMStorage.Batch[]",
                "name": "batches",
                "type": "tuple[]"
            }
        ],
        "name": "farcasterMintingProcessed",
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
                    },
                    {
                        "internalType": "uint8",
                        "name": "errorCount",
                        "type": "uint8"
                    }
                ],
                "internalType": "struct GMStorage.Batch[]",
                "name": "batches",
                "type": "tuple[]"
            }
        ],
        "name": "logFarcasterErrorBatches",
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
            },
            {
                "internalType": "string",
                "name": "runningHash",
                "type": "string"
            }
        ],
        "name": "finishFarcasterMinting",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "totalFarcasterUsersCount",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
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
        "name": "getFarcasterUsers",
        "outputs": [
            {
                "internalType": "uint256[]",
                "name": "",
                "type": "uint256[]"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    }
];

export interface Batch {
    startIndex: number;
    endIndex: number;
    nextCursor: string;
    errorCount: number;
}

export function BatchToString(initBatches: Batch[]): string {
    let res: string = '';
    for (const batch of initBatches) {
        res += `[${batch.startIndex},${batch.endIndex},${batch.nextCursor},${batch.errorCount}],`
    }
    return '[' + res + ']';
}

export interface Cast {
    userIndex: number;
    fid: number;
    username: string;
    castHash: string;
    castContent: string;
    likesCount: number;
    recastsCount: number;
    timestamp: string;
}

export interface NeynarApiResponse {
    casts: Array<{
        hash: string;
        parent_hash?: string;
        parent_url?: string;
        root_parent_url?: string;
        parent_author?: {
            fid: number;
        };
        author: {
            object: string;
            fid: number;
            custody_address: string;
            username: string;
            display_name: string;
            pfp_url: string;
            profile: {
                bio: {
                    text: string;
                };
            };
            follower_count: number;
            following_count: number;
            verifications: string[];
            verified_addresses: {
                eth_addresses: string[];
                sol_addresses: string[];
            };
            active_status: string;
            power_badge: boolean;
        };
        text: string;
        timestamp: string;
        embeds: Array<{
            url: string;
            cast_id?: {
                fid: number;
                hash: string;
            };
        }>;
        reactions: {
            likes_count: number;
            recasts_count: number;
            likes: Array<{
                fid: number;
                fname: string;
            }>;
            recasts: Array<{
                fid: number;
                fname: string;
                timestamp: string;
            }>;
        };
        replies: {
            count: number;
        };
        channel?: {
            object: string;
            id: string;
            name: string;
            description: string;
            image_url: string;
            created_at: number;
            parent_url: string;
            url: string;
            lead_fid: number;
            moderator_fids: number[];
            member_count: number;
        };
        mentioned_profiles: Array<{
            object: string;
            fid: number;
            custody_address: string;
            username: string;
            display_name: string;
            pfp_url: string;
            profile: {
                bio: {
                    text: string;
                };
            };
        }>;
    }>;
    next_cursor?: string;
}

export interface w3fStorage {
    get(key: string): Promise<string | undefined>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
    getKeys(): Promise<string[]>;
    getSize(): Promise<number>;
}

export enum CastProcessingType {
    Skipped = 0,
    Simple = 1,
    Hashtag = 2,
    Cashtag = 3,
}

// Define the result structure for Farcaster users
export interface Result {
    userIndex: number;
    hashtagCasts: number;
    cashtagCasts: number;
    simpleCasts: number;
    casts: number;
    likes: number;
}

export const defaultResult: Result = {
    userIndex: 0,
    hashtagCasts: 0,
    cashtagCasts: 0,
    simpleCasts: 0,
    casts: 0,
    likes: 0,
};