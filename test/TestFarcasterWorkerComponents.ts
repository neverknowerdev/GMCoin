import { expect } from "chai";
import { FarcasterRequester } from "../web3-functions/farcaster-worker/farcasterRequester";
import { BatchManager } from "../web3-functions/farcaster-worker/batchManager";
import { Storage } from "../web3-functions/farcaster-worker/storage";
import { BatchUploader } from "../web3-functions/farcaster-worker/batchUploader";
import { Cast, CastProcessingType, Batch } from "../web3-functions/farcaster-worker/consts";
import { MockHttpServer } from './tools/mockServer';
import * as url from 'url';

describe("FarcasterWorker Components", function () {
    let mockServer: MockHttpServer;

    before(async function () {
        mockServer = new MockHttpServer(8120);
        mockServer.start();
    });

    after(async function () {
        mockServer.stop();
    });

    beforeEach(async function () {
        mockServer.resetMocks();
    });

    describe("FarcasterRequester", function () {
        let farcasterRequester: FarcasterRequester;

        beforeEach(function () {
            farcasterRequester = new FarcasterRequester(
                { NeynarAPIKey: "test-key" },
                { neynarFeedURL: "http://localhost:8120/v2/farcaster/feed/" }
            );
        });

        it("should fetch casts by FIDs correctly", async function () {
            const testFids = [1001, 1002, 1003];
            const mockCasts = [
                {
                    hash: "cast1",
                    author: { fid: 1001, username: "user1" },
                    text: "gm everyone!",
                    timestamp: getYesterdayTimestamp(),
                    reactions: { likes_count: 5, recasts_count: 2 }
                },
                {
                    hash: "cast2", 
                    author: { fid: 1002, username: "user2" },
                    text: "#gm builders!",
                    timestamp: getYesterdayTimestamp(),
                    reactions: { likes_count: 10, recasts_count: 3 }
                }
            ];

            mockServer.mockFunc('/v2/farcaster/feed/', 'GET', (url: url.UrlWithParsedQuery) => {
                const fids = url.query.fids as string;
                expect(fids).to.equal(testFids.join(','));
                expect(url.query.feed_type).to.equal('filter');
                expect(url.query.filter_type).to.equal('fids');
                expect(url.query.limit).to.equal('100');

                return {
                    casts: mockCasts
                };
            });

            const result = await farcasterRequester.fetchCastsByFIDs(testFids);

            expect(result).to.have.length(2);
            expect(result[0].castHash).to.equal("cast1");
            expect(result[0].fid).to.equal(1001);
            expect(result[0].castContent).to.equal("gm everyone!");
            expect(result[1].castHash).to.equal("cast2");
            expect(result[1].fid).to.equal(1002);
        });

        it("should handle pagination correctly", async function () {
            const testFids = [1001];
            let callCount = 0;

            mockServer.mockFunc('/v2/farcaster/feed/', 'GET', (url: url.UrlWithParsedQuery) => {
                callCount++;
                const cursor = url.query.cursor as string;

                if (!cursor) {
                    // First page
                    return {
                        casts: [{
                            hash: "cast1",
                            author: { fid: 1001, username: "user1" },
                            text: "gm page 1",
                            timestamp: getYesterdayTimestamp(),
                            reactions: { likes_count: 1, recasts_count: 0 }
                        }],
                        next_cursor: "page2"
                    };
                } else if (cursor === "page2") {
                    // Second page
                    return {
                        casts: [{
                            hash: "cast2",
                            author: { fid: 1001, username: "user1" },
                            text: "gm page 2", 
                            timestamp: getYesterdayTimestamp(),
                            reactions: { likes_count: 2, recasts_count: 0 }
                        }]
                        // No next_cursor = end of results
                    };
                }
                return { casts: [] };
            });

            // Test first page
            const result1 = await farcasterRequester.fetchCastsByFIDsWithCursor(testFids, "");
            expect(result1.casts).to.have.length(1);
            expect(result1.casts[0].castContent).to.equal("gm page 1");
            expect(result1.nextCursor).to.equal("page2");

            // Test second page
            const result2 = await farcasterRequester.fetchCastsByFIDsWithCursor(testFids, "page2");
            expect(result2.casts).to.have.length(1);
            expect(result2.casts[0].castContent).to.equal("gm page 2");
            expect(result2.nextCursor).to.equal("");

            expect(callCount).to.equal(2);
        });

        it("should filter yesterday's casts correctly", async function () {
            const testFids = [1001];
            const today = new Date();
            const yesterday = new Date();
            yesterday.setDate(today.getDate() - 1);
            const twoDaysAgo = new Date();
            twoDaysAgo.setDate(today.getDate() - 2);

            const mockCasts = [
                {
                    hash: "cast_yesterday",
                    author: { fid: 1001, username: "user1" },
                    text: "gm yesterday",
                    timestamp: yesterday.toISOString(),
                    reactions: { likes_count: 1, recasts_count: 0 }
                },
                {
                    hash: "cast_today",
                    author: { fid: 1001, username: "user1" },
                    text: "gm today",
                    timestamp: today.toISOString(),
                    reactions: { likes_count: 2, recasts_count: 0 }
                },
                {
                    hash: "cast_old",
                    author: { fid: 1001, username: "user1" },
                    text: "gm old",
                    timestamp: twoDaysAgo.toISOString(),
                    reactions: { likes_count: 3, recasts_count: 0 }
                }
            ];

            mockServer.mockFunc('/v2/farcaster/feed/', 'GET', () => {
                return { casts: mockCasts };
            });

            const result = await farcasterRequester.fetchCastsByFIDs(testFids);

            // Should only return yesterday's cast
            expect(result).to.have.length(1);
            expect(result[0].castHash).to.equal("cast_yesterday");
        });

        it("should handle API errors gracefully", async function () {
            const testFids = [1001];

            mockServer.mockFunc('/v2/farcaster/feed/', 'GET', () => {
                throw new Error("API rate limit exceeded");
            });

            try {
                await farcasterRequester.fetchCastsByFIDs(testFids);
                expect.fail("Should have thrown an error");
            } catch (error: any) {
                expect(error.message).to.contain("Request failed with status code 500");
            }
        });
    });

    describe("BatchUploader", function () {
        let batchUploader: BatchUploader;
        let mockStorage: MockStorage;

        beforeEach(function () {
            mockStorage = new MockStorage();
            batchUploader = new BatchUploader(
                20241220,
                mockStorage as any,
                "http://localhost:8120/",
                "test-api-key",
                console as any
            );
        });

        it("should calculate running hash correctly", function () {
            const cast1: Cast = {
                userIndex: 0,
                fid: 1001,
                username: "user1",
                castHash: "hash1",
                castContent: "gm everyone!",
                likesCount: 5,
                recastsCount: 2,
                timestamp: "2024-12-20T10:00:00Z"
            };

            const cast2: Cast = {
                userIndex: 1,
                fid: 1002,
                username: "user2", 
                castHash: "hash2",
                castContent: "#gm builders",
                likesCount: 10,
                recastsCount: 1,
                timestamp: "2024-12-20T11:00:00Z"
            };

            // Add first cast
            batchUploader.add(cast1, CastProcessingType.Simple);
            const hash1 = batchUploader.getRunningHash();
            expect(hash1).to.be.a('string').with.lengthOf(64); // Blake2b produces 32-byte = 64-char hex

            // Add second cast
            batchUploader.add(cast2, CastProcessingType.Hashtag);
            const hash2 = batchUploader.getRunningHash();
            expect(hash2).to.be.a('string').with.lengthOf(64);
            expect(hash2).to.not.equal(hash1); // Hash should change

            // Verify hash is deterministic
            const batchUploader2 = new BatchUploader(
                20241220,
                mockStorage as any,
                "http://localhost:8120/",
                "test-api-key", 
                console as any
            );
            batchUploader2.add(cast1, CastProcessingType.Simple);
            batchUploader2.add(cast2, CastProcessingType.Hashtag);
            expect(batchUploader2.getRunningHash()).to.equal(hash2);
        });

        it("should upload casts to server correctly", async function () {
            const cast: Cast = {
                userIndex: 0,
                fid: 1001,
                username: "user1",
                castHash: "hash1",
                castContent: "gm test",
                likesCount: 1,
                recastsCount: 0,
                timestamp: "2024-12-20T10:00:00Z"
            };

            batchUploader.add(cast, CastProcessingType.Simple);

            mockServer.mockFunc('/SaveCasts', 'POST', (url, headers, reqBody: any) => {
                expect(reqBody).to.not.be.null;
                expect(reqBody.casts).to.have.length(1);
                expect(reqBody.casts[0].castHash).to.equal("hash1");
                expect(reqBody.casts[0].castContent).to.equal("gm test");
                expect(reqBody.mintingDayTimestamp).to.equal(20241220);
                return { success: true };
            });

            const result = await batchUploader.uploadToServer();
            expect(result).to.be.true;
        });

        it("should handle upload failures", async function () {
            const cast: Cast = {
                userIndex: 0,
                fid: 1001,
                username: "user1", 
                castHash: "hash1",
                castContent: "gm test",
                likesCount: 1,
                recastsCount: 0,
                timestamp: "2024-12-20T10:00:00Z"
            };

            batchUploader.add(cast, CastProcessingType.Simple);

            mockServer.mockFunc('/SaveCasts', 'POST', () => {
                throw new Error("Server error");
            });

            const result = await batchUploader.uploadToServer();
            expect(result).to.be.false;
        });
    });

    describe("Keyword Detection Logic", function () {
        it("should detect keywords with correct priority", function () {
            const testCases = [
                { text: "gm everyone!", expected: "gm" },
                { text: "Good morning #gm", expected: "#gm" },
                { text: "$gm to the moon!", expected: "$gm" },
                { text: "Both #gm and $gm here", expected: "$gm" }, // $gm has highest priority
                { text: "#gm and then gm", expected: "#gm" }, // #gm over simple gm
                { text: "gm and then #gm", expected: "#gm" }, // #gm over simple gm (order doesn't matter)
                { text: "no morning greeting", expected: "" },
                { text: "gmgm", expected: "" }, // Should be whole word
                { text: "gm.", expected: "gm" }, // Handle punctuation
                { text: "$gm!", expected: "$gm" },
                { text: "GM EVERYONE", expected: "gm" }, // Case insensitive
                { text: "#GM builders", expected: "#gm" }
            ];

            for (const testCase of testCases) {
                const result = findKeywordWithPrefix(testCase.text);
                expect(result).to.equal(testCase.expected, `Failed for text: "${testCase.text}"`);
            }
        });

        it("should handle edge cases correctly", function () {
            const edgeCases = [
                { text: "", expected: "" },
                { text: " ", expected: "" },
                { text: "gm\ngm", expected: "gm" },
                { text: "gm\tgm", expected: "gm" },
                { text: "...$gm...", expected: "$gm" },
                { text: "(@#gm)", expected: "#gm" },
                { text: "multiple gm gm gm", expected: "gm" }
            ];

            for (const testCase of edgeCases) {
                const result = findKeywordWithPrefix(testCase.text);
                expect(result).to.equal(testCase.expected, `Failed for edge case: "${testCase.text}"`);
            }
        });
    });

    describe("Date Filtering", function () {
        it("should identify yesterday's timestamps correctly", function () {
            const now = new Date();
            
            // Yesterday at various times
            const yesterday1 = new Date(now);
            yesterday1.setDate(now.getDate() - 1);
            yesterday1.setHours(0, 0, 0, 0); // Start of yesterday
            
            const yesterday2 = new Date(now);
            yesterday2.setDate(now.getDate() - 1);
            yesterday2.setHours(23, 59, 59, 999); // End of yesterday
            
            // Today
            const today = new Date(now);
            today.setHours(12, 0, 0, 0);
            
            // Two days ago
            const twoDaysAgo = new Date(now);
            twoDaysAgo.setDate(now.getDate() - 2);

            expect(isYesterday(yesterday1)).to.be.true;
            expect(isYesterday(yesterday2)).to.be.true;
            expect(isYesterday(today)).to.be.false;
            expect(isYesterday(twoDaysAgo)).to.be.false;
        });
    });
});

// Helper functions

function getYesterdayTimestamp(): string {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(Math.floor(Math.random() * 24), 0, 0, 0);
    return yesterday.toISOString();
}

function findKeywordWithPrefix(text: string): string {
    const words = text.split(/\s+/);
    const KEYWORD = "gm";

    let foundWord = "";
    for (const word of words) {
        const cleanedWord = word.replace(/[.,!?;:()@]/g, "").toLowerCase();

        if (cleanedWord === "$" + KEYWORD) {
            return "$" + KEYWORD;
        }
        else if (cleanedWord === "#" + KEYWORD) {
            foundWord = "#gm";
        }
        else if (cleanedWord === KEYWORD && foundWord == "") {
            foundWord = cleanedWord;
        }
    }

    return foundWord;
}

function isYesterday(date: Date): boolean {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return date >= yesterday && date < today;
}

// Mock storage implementation for testing
class MockStorage {
    private data: Map<string, string> = new Map();

    async get(key: string): Promise<string | undefined> {
        return this.data.get(key);
    }

    async set(key: string, value: string): Promise<void> {
        this.data.set(key, value);
    }

    async delete(key: string): Promise<void> {
        this.data.delete(key);
    }

    async getKeys(): Promise<string[]> {
        return Array.from(this.data.keys());
    }

    async getSize(): Promise<number> {
        return this.data.size;
    }
}