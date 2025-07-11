import { expect, use } from "chai";
import { ethers, upgrades } from "hardhat";
import { Contract, ContractFactory, Signer, Wallet, Provider, HDNodeWallet } from "ethers";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { GMCoin } from "../typechain-types/contracts/GMCoin";
import { GMCoinExposed } from "../typechain-types/contracts/testing/GMCoinExposed";
import hre from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { createGMCoinFixture, deployGMCoinWithProxy } from "./tools/deployContract";

describe("GM minting", function () {
    it('minting for twitter users: one day', async () => {
        const { coinContract, owner, feeAddr, gelatoAddr } = await loadFixture(deployGMCoinWithProxy);

        const gelatoContract = coinContract.connect(gelatoAddr);

        const batchSize = 155;

        // await time.increaseTo(unlockTime);
        const usernames = [];
        for (let i = 0; i < batchSize; i++) {
            usernames.push(generateRandomString(14));
        }
        const wallets = await generateWallets(ethers.provider, batchSize);

        for (let i = 0; i < batchSize; i++) {
            await coinContract.connect(gelatoAddr).verifyTwitter(usernames[i], wallets[i].address);
        }

        const usernamesToProcess = await coinContract.connect(gelatoAddr).getTwitterUsers(0, batchSize);

        for (let i = 0; i < usernames.length; i++) {
            expect(usernamesToProcess[i]).to.be.equal(usernames[i]);
        }

        const startOfTheDayTimestamp = await getStartOfDayTimestamp(await time.latest());
        const startOfYesterday = startOfTheDayTimestamp - time.duration.days(1);

        const generatedData = generateUserData(100, (index: number): TweetData => {
            return { userIndex: index, tweets: 135, hashtagTweets: 25, cashtagTweets: 10, simpleTweets: 100, likes: 500 }
        });

        const nextCursor = generateRandomString(32);

        let batch: Batch = {
            startIndex: 0n,
            endIndex: BigInt(generatedData.length - 1),
            nextCursor: nextCursor,
            errorCount: 0,
        }

        // start minting process
        await expect(gelatoContract.startMinting()).to.emit(coinContract, "MintingStarted").withArgs(startOfYesterday);

        let allUsersData = [];

        await expect(gelatoContract.mintCoinsForTwitterUsers(generatedData, startOfYesterday, [batch])).to.emit(coinContract, "twitterMintingProcessed").withArgs(startOfYesterday, [[0n, 99n, nextCursor, 0]]);

        batch.nextCursor = "";

        await expect(gelatoContract.mintCoinsForTwitterUsers(generatedData, startOfYesterday, [batch])).to.emit(coinContract, "twitterMintingProcessed").withArgs(startOfYesterday, [[0n, 99n, '', 0]]);

        // *2 cause we passed that data twice: with cursor and without
        for (let i = 0; i < generatedData.length; i++) {
            generatedData[i].cashtagTweets *= 2;
            generatedData[i].hashtagTweets *= 2;
            generatedData[i].tweets *= 2;
            generatedData[i].likes *= 2;
            generatedData[i].simpleTweets *= 2;
        }

        allUsersData.push(...generatedData);

        // batch 2
        const generatedData2 = generateUserData(55, (index: number): TweetData => {
            return {
                userIndex: 100 + index,
                tweets: 135,
                hashtagTweets: 25,
                cashtagTweets: 10,
                simpleTweets: 100,
                likes: 500
            }
        });
        allUsersData.push(...generatedData2);

        batch = {
            startIndex: 100n,
            endIndex: BigInt(100 + generatedData2.length - 1),
            nextCursor: "",
            errorCount: 0,
        }

        await expect(gelatoContract.mintCoinsForTwitterUsers(generatedData2, startOfYesterday, [batch])).to.emit(coinContract, "twitterMintingProcessed").withArgs(startOfYesterday, [[100n, 154n, '', 0]]);

        const pointsPerCashtag = await gelatoContract.POINTS_PER_CASHTAG();
        const pointsPerLike = await gelatoContract.POINTS_PER_LIKE();
        const pointsPerTweet = await gelatoContract.POINTS_PER_TWEET();
        const pointsPerHashtag = await gelatoContract.POINTS_PER_HASHTAG();
        const coinMultiplicator = await coinContract.COINS_MULTIPLICATOR() / 10n ** 18n;
        const expectedResults = calcPointsForUsers(allUsersData, Number(pointsPerTweet), Number(pointsPerLike), Number(pointsPerHashtag), Number(pointsPerCashtag), coinMultiplicator);
        for (let i = 0; i < expectedResults.length; i++) {
            let expectedCoins = BigInt(expectedResults[i].expectedCoins) * 10n ** 18n;
            expect(await coinContract.balanceOf(wallets[i]) / 10n ** 18n).to.be.equal(expectedCoins / 10n ** 18n);
        }
    })


    it('minting for twitter users: simple math', async () => {
        const { coinContract, owner, feeAddr, gelatoAddr, treasuryAddr } = await loadFixture(deployGMCoinWithProxy);

        const gelatoContract = coinContract.connect(gelatoAddr);
        const perTweet = Number(await coinContract.POINTS_PER_TWEET());
        const perLike = Number(await coinContract.POINTS_PER_LIKE());
        const perHashtag = Number(await coinContract.POINTS_PER_HASHTAG());
        const perCashtag = Number(await coinContract.POINTS_PER_CASHTAG());

        const batchSize = 15;

        // await time.increaseTo(unlockTime);
        const usernames = [];
        for (let i = 0; i < batchSize; i++) {
            usernames.push(generateRandomString(14));
        }
        const wallets = await generateWallets(ethers.provider, batchSize);

        for (let i = 0; i < batchSize; i++) {
            await coinContract.connect(gelatoAddr).verifyTwitter(usernames[i], wallets[i].address);
        }

        const usernamesToProcess = await coinContract.connect(gelatoAddr).getTwitterUsers(0, batchSize);

        for (let i = 0; i < usernames.length; i++) {
            expect(usernamesToProcess[i]).to.be.equal(usernames[i]);
        }

        const startOfTheDayTimestamp = await getStartOfDayTimestamp(await time.latest());


        const generatedData = generateUserData(batchSize, (index: number): TweetData => {
            if (index % 2 == 0) {
                return { userIndex: index, tweets: 10, hashtagTweets: 3, cashtagTweets: 5, simpleTweets: 2, likes: 15 };
            } else {
                return { userIndex: index, tweets: 40, hashtagTweets: 0, cashtagTweets: 12, simpleTweets: 28, likes: 120 }
            }
        });

        await simulateDay(startOfTheDayTimestamp, gelatoContract, gelatoAddr, generatedData);

        let totalPointsForUsers = 0;
        let expectedPoints: number[] = [];
        for (let i = 0; i < generatedData.length; i++) {
            const points = generatedData[i].simpleTweets * perTweet +
                generatedData[i].likes * perLike +
                generatedData[i].hashtagTweets * perHashtag +
                generatedData[i].cashtagTweets * perCashtag;

            expectedPoints.push(points);
            totalPointsForUsers += points;
        }

        let coinsSum: bigint = 0n;
        for (let i = 0; i < batchSize; i++) {
            log('checking', i);
            const expectedCoins = Math.floor((expectedPoints[i] + perTweet) * 1_000_000);
            log('points', expectedPoints[i]);
            log('expectedCoins', expectedCoins);
            // const expCoins = expPoints * 1_000_000n * 10n**18n / 1n;


            const walletBalance = await coinContract.balanceOf(wallets[i]);
            const actualCoins: bigint = walletBalance / 10n ** 18n;
            log('actualCoins', actualCoins);
            log('');

            expect(actualCoins).to.be.equal(expectedCoins);
            coinsSum += actualCoins;
        }

        log('totalPoints', totalPointsForUsers);
        log('coinsSum', coinsSum);
        expect(BigInt(totalPointsForUsers) - (coinsSum / 1_000_000n)).to.be.below(5); // rounding diff here is ok

        let treasuryPoolBalance = await coinContract.balanceOf(treasuryAddr);
        log('contract balance (treasury pool)', treasuryPoolBalance);
        expect(treasuryPoolBalance / 10n ** 18n).to.be.equal(coinsSum * 10n / 100n); // 5%


        //
        // Day 2
        //

    });

    it('minting for twitter users: continuation after error', async () => {
        const { coinContract, owner, feeAddr, gelatoAddr } = await loadFixture(createGMCoinFixture(7));

        const gelatoContract: GMCoinExposed = coinContract.connect(gelatoAddr);
        const ts = await time.latest();
        const startDay = await getStartOfDayTimestamp(ts);
        const startOfPrevDay = startDay - time.duration.days(1);


        const users = generateNewUsers(10);

        for (let i = 0; i < users.length; i++) {
            await gelatoContract.verifyTwitter(users[i].username, users[i].wallet);
        }

        const userData = generateRandomUserData(10);

        expect(await gelatoContract.getStartOfTheEpoch()).to.be.equal(startOfPrevDay);

        // first day - success
        await expect(gelatoContract.startMinting()).to.emit(coinContract, "MintingStarted").withArgs(startOfPrevDay);
        await expect(gelatoContract.startMinting()).to.be.revertedWith("minting process already started");
        await expect(gelatoContract.mintCoinsForTwitterUsers(userData, startOfPrevDay, [[0, 9, '', 0]])).to.emit(coinContract, "twitterMintingProcessed");
        await expect(gelatoContract.finishMinting(startOfPrevDay, "finalHash")).to.emit(coinContract, "MintingFinished").withArgs(startOfPrevDay, "finalHash");

        await expect(gelatoContract.mintCoinsForTwitterUsers(userData, startOfPrevDay, [[0, 9, '', 0]])).to.be.rejectedWith("no ongoing minting process");

        await expect(gelatoContract.startMinting()).to.be.revertedWith("dayToMint should be not further than yesterday");
        await expect(await gelatoContract.getStartOfTheEpoch()).to.be.equal(startOfPrevDay);

        // next day
        const day2Ts = ts + time.duration.days(1);
        await time.increaseTo(day2Ts);

        const startOf2Day = await getStartOfDayTimestamp(day2Ts);
        const mintingDay2Ts = startOf2Day - time.duration.days(1);

        await expect(gelatoContract.startMinting()).to.emit(coinContract, "MintingStarted").withArgs(mintingDay2Ts);
        // then something went wrong and minting is not finished..
        const day3Ts = day2Ts + time.duration.days(1);

        const startOf3Day = await getStartOfDayTimestamp(day3Ts);
        const mintingDay3Ts = startOf3Day - time.duration.days(1);

        await time.increaseTo(day3Ts);
        await expect(gelatoContract.startMinting()).to.emit(coinContract, "twitterMintingProcessed").withArgs(mintingDay2Ts, []);
        await expect(gelatoContract.mintCoinsForTwitterUsers(userData, mintingDay2Ts, [[0, 9, '', 0]])).to.emit(coinContract, "twitterMintingProcessed");
        await expect(gelatoContract.finishMinting(mintingDay2Ts, "runningHash")).to
            .emit(coinContract, "MintingFinished").withArgs(mintingDay2Ts, "runningHash")
            .emit(coinContract, "MintingStarted").withArgs(mintingDay3Ts);

        await expect(gelatoContract.mintCoinsForTwitterUsers(userData, mintingDay3Ts, [[0, 9, '', 0]])).to.emit(coinContract, "twitterMintingProcessed");
        await expect(gelatoContract.startMinting()).to.be.revertedWith("minting process already started");
        await expect(gelatoContract.mintCoinsForTwitterUsers(userData, mintingDay3Ts, [[0, 9, '', 0]])).to.emit(coinContract, "twitterMintingProcessed");
        await expect(gelatoContract.startMinting()).to.be.revertedWith("minting process already started");
        await expect(gelatoContract.finishMinting(mintingDay3Ts, "runningHash")).to
            .emit(coinContract, "MintingFinished").withArgs(mintingDay3Ts, "runningHash");


        await expect(gelatoContract.startMinting()).to.be.revertedWith("dayToMint should be not further than yesterday");
        expect(await gelatoContract.getStartOfTheEpoch()).to.be.equal(startOfPrevDay);
    });

    it('minting for twitter users: epochs and complexity', async () => {
        const { coinContract, owner, feeAddr, gelatoAddr } = await loadFixture(createGMCoinFixture(7));

        let users = generateNewUsers(30);
        let userData = generateRandomUserData(30);

        log('week 1');
        let complexity = await coinContract.COINS_MULTIPLICATOR();
        const epochDays = await coinContract.EPOCH_DAYS();
        let dayTimestamp = await time.latest();
        for (let i = 0; i < 7; i++) {
            log('day', i + 1);

            await simulateDayFull(dayTimestamp, users, userData, coinContract, gelatoAddr);

            expect(await coinContract.COINS_MULTIPLICATOR()).to.be.equal(complexity);

            dayTimestamp = dayTimestamp + time.duration.days(1);
            await time.increaseTo(dayTimestamp);
        }

        // week2 - no changes to userData prev week - the same compexity
        log('week 2');
        let userData2x: TweetData[] = [];
        for (let i = 0; i < userData.length; i++) {
            let userDataItem = userData[i];
            userDataItem.likes *= 2;
            userDataItem.simpleTweets *= 2;
            userDataItem.cashtagTweets *= 5;
        }
        // complexity without changes based on week 1
        let newComplexity = complexity;
        for (let i = 0; i < 7; i++) {
            log('day', i + 1);

            await simulateDayFull(dayTimestamp, users, userData, coinContract, gelatoAddr);
            expect(await coinContract.COINS_MULTIPLICATOR()).to.be.equal(newComplexity);

            dayTimestamp = dayTimestamp + time.duration.days(1);
            await time.increaseTo(dayTimestamp);
        }


        // week3 - currentPoints > prevPoints >> complexity -30%
        log('week 3');
        newComplexity = complexity * 70n / 100n;
        for (let i = 0; i < 7; i++) {
            log('day', i + 1);

            await simulateDayFull(dayTimestamp, users, userData, coinContract, gelatoAddr);
            expect(await coinContract.COINS_MULTIPLICATOR()).to.be.equal(newComplexity);

            dayTimestamp = dayTimestamp + time.duration.days(1);
            await time.increaseTo(dayTimestamp);
        }

        // week4: currentPoints == prevPoints
        // complexity the same
        log('week 4');

        for (let i = 0; i < userData.length; i++) {
            let userDataItem = userData[i];
            userDataItem.likes /= 2;
            userDataItem.simpleTweets /= 2;
            userDataItem.cashtagTweets /= 5;
        }
        for (let i = 0; i < 7; i++) {
            log('day', i + 1);

            await simulateDayFull(dayTimestamp, users, userData, coinContract, gelatoAddr);
            expect(await coinContract.COINS_MULTIPLICATOR()).to.be.equal(newComplexity);

            dayTimestamp = dayTimestamp + time.duration.days(1);
            await time.increaseTo(dayTimestamp);
        }

        // week5: currentPoints < prevPoints && epochPointsDeltaStreak == -1
        // complexity without change
        log('week 5');

        for (let i = 0; i < userData.length; i++) {
            let userDataItem = userData[i];
            userDataItem.simpleTweets = userDataItem.simpleTweets <= 0 ? 0 : userDataItem.simpleTweets - 1;
        }
        for (let i = 0; i < 7; i++) {
            log('day', i + 1);

            await simulateDayFull(dayTimestamp, users, userData, coinContract, gelatoAddr);
            expect(await coinContract.COINS_MULTIPLICATOR()).to.be.equal(newComplexity);

            dayTimestamp = dayTimestamp + time.duration.days(1);
            await time.increaseTo(dayTimestamp);
        }

        // week6: currentPoints < prevPoints && epochPointsDeltaStreak == -2
        // complexity +20%
        newComplexity = newComplexity * 120n / 100n;
        log('week 6');

        for (let i = 0; i < 7; i++) {
            log('day', i + 1);

            await simulateDayFull(dayTimestamp, users, userData, coinContract, gelatoAddr);
            expect(await coinContract.COINS_MULTIPLICATOR()).to.be.equal(newComplexity);

            dayTimestamp = dayTimestamp + time.duration.days(1);
            await time.increaseTo(dayTimestamp);
        }

        // week7: currentPoints == prevPoints && epochPointsDeltaStreak == -2
        // complexity +20%
        newComplexity = newComplexity * 120n / 100n;
        log('week 7');
        for (let i = 0; i < userData.length; i++) {
            let userDataItem = userData[i];
            userDataItem.simpleTweets = userDataItem.simpleTweets <= 0 ? 0 : userDataItem.simpleTweets - 1;
        }

        for (let i = 0; i < 7; i++) {
            log('day', i + 1);

            await simulateDayFull(dayTimestamp, users, userData, coinContract, gelatoAddr);
            expect(await coinContract.COINS_MULTIPLICATOR()).to.be.equal(newComplexity);

            dayTimestamp = dayTimestamp + time.duration.days(1);
            await time.increaseTo(dayTimestamp);
        }

        // week8: currentPoints < prevPoints && epochPointsDeltaStreak == -3
        // complexity +30%
        newComplexity = newComplexity * 130n / 100n;
        log('week 8');

        for (let i = 0; i < userData.length; i++) {
            let userDataItem = userData[i];
            userDataItem.likes *= 2;
            userDataItem.simpleTweets *= 2;
            userDataItem.cashtagTweets *= 5;
        }
        for (let i = 0; i < 7; i++) {
            log('day', i + 1);

            await simulateDayFull(dayTimestamp, users, userData, coinContract, gelatoAddr);
            expect(await coinContract.COINS_MULTIPLICATOR()).to.be.equal(newComplexity);

            dayTimestamp = dayTimestamp + time.duration.days(1);
            await time.increaseTo(dayTimestamp);
        }

        // week9: currentPoints > prevPoints
        // complexity -30%
        newComplexity = newComplexity * 70n / 100n;
        log('week 9');

        for (let i = 0; i < 7; i++) {
            log('day', i + 1);

            await simulateDayFull(dayTimestamp, users, userData, coinContract, gelatoAddr);
            expect(await coinContract.COINS_MULTIPLICATOR()).to.be.equal(newComplexity);

            dayTimestamp = dayTimestamp + time.duration.days(1);
            await time.increaseTo(dayTimestamp);
        }

        // week10: currentPoints == prevPoints, epochPointsDeltaStreak == 0
        // complexity is the same
        // newComplexity = newComplexity * 70n / 100n;
        log('week 10');

        for (let i = 0; i < userData.length; i++) {
            let userDataItem = userData[i];
            userDataItem.simpleTweets = userDataItem.simpleTweets <= 0 ? 0 : userDataItem.simpleTweets - 1;
        }

        for (let i = 0; i < 7; i++) {
            log('day', i + 1);

            await simulateDayFull(dayTimestamp, users, userData, coinContract, gelatoAddr);
            expect(await coinContract.COINS_MULTIPLICATOR()).to.be.equal(newComplexity);

            dayTimestamp = dayTimestamp + time.duration.days(1);
            await time.increaseTo(dayTimestamp);
        }

        // week11: currentPoints < prevPoints, epochPointsDeltaStreak == -1
        // complexity +20%
        // newComplexity = newComplexity * 120n / 100n;
        log('week 11');

        for (let i = 0; i < userData.length; i++) {
            let userDataItem = userData[i];
            userDataItem.simpleTweets = userDataItem.simpleTweets <= 0 ? 0 : userDataItem.simpleTweets - 1;
        }

        for (let i = 0; i < 7; i++) {
            log('day', i + 1);

            await simulateDayFull(dayTimestamp, users, userData, coinContract, gelatoAddr);
            expect(await coinContract.COINS_MULTIPLICATOR()).to.be.equal(newComplexity);

            dayTimestamp = dayTimestamp + time.duration.days(1);
            await time.increaseTo(dayTimestamp);
        }

        // week12: currentPoints < prevPoints, epochPointsDeltaStreak == -2
        // complexity +20%
        newComplexity = newComplexity * 120n / 100n;
        log('week 12');

        for (let i = 0; i < userData.length; i++) {
            let userDataItem = userData[i];
            userDataItem.simpleTweets = userDataItem.simpleTweets <= 0 ? 0 : userDataItem.simpleTweets - 1;
        }

        for (let i = 0; i < 7; i++) {
            log('day', i + 1);

            await simulateDayFull(dayTimestamp, users, userData, coinContract, gelatoAddr);
            expect(await coinContract.COINS_MULTIPLICATOR()).to.be.equal(newComplexity);

            dayTimestamp = dayTimestamp + time.duration.days(1);
            await time.increaseTo(dayTimestamp);
        }
    });


});

type User = {
    username: string;
    wallet: HDNodeWallet;
}

type Batch = {
    startIndex: bigint;
    endIndex: bigint;
    nextCursor: string;
    errorCount: number;
}


type TweetData = {
    userIndex: number;
    tweets: number;
    hashtagTweets: number;
    cashtagTweets: number;
    simpleTweets: number;
    likes: number;
};

function generateNewUsers(count: number): User[] {
    let users: User[] = [];
    for (let i = 0; i < count; i++) {
        const wallet = ethers.Wallet.createRandom();
        const connectedWallet = wallet.connect(ethers.provider);
        users.push({
            username: generateRandomString(14),
            wallet: connectedWallet,
        })
    }

    return users;
}


async function simulateDayFull(dayTimestamp: number, users: User[], userData: TweetData[], coinContract: GMCoin, gelatoAddr: HardhatEthersSigner) {
    const gelatoContract: GMCoinExposed = coinContract.connect(gelatoAddr);

    let alreadyExistingTwitterUsernames = await gelatoContract.getTwitterUsers(0, users.length);
    if (users.length > alreadyExistingTwitterUsernames.length) {
        for (let i = alreadyExistingTwitterUsernames.length; i < users.length; i++) {
            await gelatoContract.verifyTwitter(users[i].username, users[i].wallet);
        }

        alreadyExistingTwitterUsernames = await gelatoContract.getTwitterUsers(0, users.length);
    }
    expect(alreadyExistingTwitterUsernames.length).to.be.equal(users.length);

    // const startOfPrevDay = dayTimestamp - time.duration.days(1);
    const startOfPrevDay = await getStartOfDayTimestamp(dayTimestamp) - time.duration.days(1);
    await expect(gelatoContract.startMinting()).to.emit(coinContract, "MintingStarted").withArgs(startOfPrevDay);

    await expect(gelatoContract.mintCoinsForTwitterUsers(userData, startOfPrevDay, [[0, userData.length - 1, '', 0]])).to.emit(coinContract, "twitterMintingProcessed");
    await expect(gelatoContract.finishMinting(startOfPrevDay, "finalHash")).to.emit(coinContract, "MintingFinished");
}

async function simulateDay(dayTimestamp: number, coinContract: GMCoin, gelatoAddr: HardhatEthersSigner, userData: any[]) {
    const gelatoContract: GMCoinExposed = coinContract.connect(gelatoAddr);


    const startOfPrevDay = dayTimestamp - time.duration.days(1);

    await expect(gelatoContract.startMinting()).to.emit(coinContract, "MintingStarted").withArgs(startOfPrevDay);

    const cursor = {
        startIndex: 0n,
        endIndex: BigInt(userData.length - 1),
        nextCursor: "",
        errorCount: 0,
    }
    await expect(gelatoContract.mintCoinsForTwitterUsers(userData, startOfPrevDay, [cursor])).to.emit(coinContract, "twitterMintingProcessed").withArgs(startOfPrevDay, [[cursor.startIndex, cursor.endIndex, cursor.nextCursor, cursor.errorCount]]);

}

function calcPointsForUsers(userData: TweetData[], perTweet: number, perLike: number, perHashtag: number, perCashtag: number, multiplicator: number): any[] {
    var results = [];
    for (let i = 0; i < userData.length; i++) {
        const expectedPoints = userData[i].simpleTweets * perTweet + userData[i].hashtagTweets * perHashtag + userData[i].cashtagTweets * perCashtag + userData[i].likes * perLike;

        let expectedCoinsN = BigInt(expectedPoints + perTweet) * BigInt(multiplicator);
        //   expectedCoinsN = expectedCoinsN - (expectedCoinsN * BigInt(mintComission*10000) / 1000n);


        results.push({
            expectedPoints: expectedPoints,
            expectedCoins: expectedCoinsN,
        })
    }

    return results;
}

function generateUserData(numUsers: number, iterateFunc: (index: number) => TweetData) {
    let userData: TweetData[] = [];

    for (let i = 0; i < numUsers; i++) {
        userData.push(iterateFunc(i));
    }
    return userData;
}

function generateRandomUserData(numUsers: number) {
    const userData: TweetData[] = [];
    for (let i = 0; i < numUsers; i++) {
        const hastagTweetsCount = Math.floor(Math.random() * 20);
        const cashtagTweetsCount = Math.floor(Math.random() * 15);
        const simpleTweetsCount = Math.floor(Math.random() * 201);
        userData.push({
            userIndex: i,
            tweets: hastagTweetsCount + cashtagTweetsCount + simpleTweetsCount,
            hashtagTweets: hastagTweetsCount,
            cashtagTweets: cashtagTweetsCount,
            simpleTweets: simpleTweetsCount,
            likes: Math.floor(Math.random() * 10000),
        });
    }
    return userData;
}

const getStartOfDayTimestamp = async (ts: number): Promise<number> => {
    const currentDate = new Date(ts * 1000); // Convert to JavaScript Date
    currentDate.setUTCHours(0, 0, 0, 0); // Set to start of the day (UTC)
    return Math.floor(currentDate.getTime() / 1000); // Return UNIX timestamp in seconds
};

function generateRandomString(length: number) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

async function generateWallets(provider: Provider, count: number = 1000): Promise<HDNodeWallet[]> {
    const wallets: HDNodeWallet[] = [];

    for (let i = 0; i < count; i++) {
        const wallet = ethers.Wallet.createRandom();
        const connectedWallet = wallet.connect(provider);
        wallets.push(connectedWallet);
    }

    return wallets;
}

function log(...args: any[]) {
    if (process.env.SHOW_LOGS === "true") {
        console.log(...args);
    }
}

// function calcPointsForStakers(coinContract: GMCoinExposed, totalCoins: number, stakerIndexes: bigint[], wallets: HDNodeWallet[], userData: TweetData[]) {
//   let totalDayPoints = totalCoins;
//   let userDayPoints = 0;
//   for(let i=0; i<userData.length; i++) {
//     const points = userData[i].simpleTweets*2 + userData[i].hashtagTweets*4 + userData[i].cashtagTweets*10 + userData[i].likes;

//     userDayPoints += points;
//     totalDayPoints += points;
//     if(userData[i].simpleTweets > 0) {
//       totalDayPoints -= userData[i].simpleTweets*2;
//     }
//   }

//   let pointsForStakers = totalDayPoints - userDayPoints;
//   for(let i=0; i<stakerIndexes.length; i++) {
//     let balance = coinContract.balanceOf(wallets[i]);

//     let reward = balance * pointsForStakers / 
//   }
// }