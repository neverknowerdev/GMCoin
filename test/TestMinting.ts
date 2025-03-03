import {expect, use} from "chai";
import {ethers, upgrades} from "hardhat";
import {Contract, ContractFactory, Signer, Wallet, Provider, HDNodeWallet} from "ethers";
import {time, loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {GMCoin} from "../typechain-types/contracts/GMCoin";
import {GMCoinExposed} from "../typechain-types/contracts/testing/GMCoinExposed";
import hre from "hardhat";
import {HardhatEthersSigner} from "@nomicfoundation/hardhat-ethers/signers";
import {createGMCoinFixture, deployGMCoinWithProxy} from "./tools/deployContract";

describe("GM minting", function () {


    it('minting for twitter users: one day', async () => {
        const {coinContract, owner, feeAddr, gelatoAddr} = await loadFixture(deployGMCoinWithProxy);

        const gelatoContract = coinContract.connect(gelatoAddr);

        const batchSize = 155;

        // await time.increaseTo(unlockTime);
        const usernames = [];
        for (let i = 0; i < batchSize; i++) {
            usernames.push(generateRandomString(14));
        }
        const wallets = await generateWallets(ethers.provider, batchSize);

        for (let i = 0; i < batchSize; i++) {
            await coinContract.connect(gelatoAddr).verifyTwitter(usernames[i], wallets[i].address, false);
        }

        const usernamesToProcess = await coinContract.connect(gelatoAddr).getTwitterUsers(0, batchSize);

        for (let i = 0; i < usernames.length; i++) {
            expect(usernamesToProcess[i]).to.be.equal(usernames[i]);
        }

        const startOfTheDayTimestamp = await getStartOfDayTimestamp(await time.latest());
        const startOfYesterday = startOfTheDayTimestamp - time.duration.days(1);

        const generatedData = generateUserData(100, (index: number): TweetData => {
            return {userIndex: index, tweets: 135, hashtagTweets: 25, cashtagTweets: 10, simpleTweets: 100, likes: 500}
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

        const expectedResults = calcPointsForUsers(allUsersData, 1, 1, 2, 3, 1_000_000);
        for (let i = 0; i < expectedResults.length; i++) {
            let expectedCoins = BigInt(expectedResults[i].expectedCoins) * 10n ** 18n;
            expect(await coinContract.balanceOf(wallets[i])).to.be.equal(expectedCoins);
        }
    })


    it('minting for twitter users: simple math', async () => {
        const {coinContract, owner, feeAddr, gelatoAddr, treasuryAddr} = await loadFixture(deployGMCoinWithProxy);

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
            await coinContract.connect(gelatoAddr).verifyTwitter(usernames[i], wallets[i].address, false);
        }

        const usernamesToProcess = await coinContract.connect(gelatoAddr).getTwitterUsers(0, batchSize);

        for (let i = 0; i < usernames.length; i++) {
            expect(usernamesToProcess[i]).to.be.equal(usernames[i]);
        }

        const startOfTheDayTimestamp = await getStartOfDayTimestamp(await time.latest());


        const generatedData = generateUserData(batchSize, (index: number): TweetData => {
            if (index % 2 == 0) {
                return {userIndex: index, tweets: 10, hashtagTweets: 3, cashtagTweets: 5, simpleTweets: 2, likes: 15};
            } else {
                return {userIndex: index, tweets: 40, hashtagTweets: 0, cashtagTweets: 12, simpleTweets: 28, likes: 120}
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
            const expectedCoins = Math.floor(expectedPoints[i] * 1_000_000);
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
        const {coinContract, owner, feeAddr, gelatoAddr} = await loadFixture(deployGMCoinWithProxy);

        const gelatoContract: GMCoinExposed = coinContract.connect(gelatoAddr);
        const ts = await time.latest();
        const startDay = await getStartOfDayTimestamp(ts);
        const startOfPrevDay = startDay - time.duration.days(1);


        const users = generateNewUsers(10);

        for (let i = 0; i < users.length; i++) {
            await gelatoContract.verifyTwitter(users[i].username, users[i].wallet, false);
        }

        const userData = generateRandomUserData(10);

        expect(await gelatoContract.getStartOfTheEpoch()).to.be.equal(startOfPrevDay);

        // first day
        await expect(gelatoContract.startMinting()).to.emit(coinContract, "MintingStarted").withArgs(startOfPrevDay);
        await expect(gelatoContract.startMinting()).to.be.revertedWith("minting process already started");
        await expect(gelatoContract.mintCoinsForTwitterUsers(userData, startOfPrevDay, [[0, 9, '']])).to.emit(coinContract, "twitterMintingProcessed");
        await expect(gelatoContract.finishMinting(startOfPrevDay, "finalHash")).to.emit(coinContract, "MintingFinished").withArgs(startOfPrevDay, "finalHash");

        await expect(gelatoContract.mintCoinsForTwitterUsers(userData, startOfPrevDay, [[0, 9, '']])).to.be.rejectedWith("no ongoing minting process");

        await expect(gelatoContract.startMinting()).to.be.revertedWith("minting is already started for that day");
        expect(await gelatoContract.getStartOfTheEpoch()).to.be.equal(startOfPrevDay);

        // next day
        const day2Ts = ts + time.duration.days(1);
        await time.increaseTo(day2Ts);

        const startOf2Day = await getStartOfDayTimestamp(day2Ts);
        const mintingDay2Ts = startOf2Day - time.duration.days(1);

        await expect(gelatoContract.startMinting()).to.emit(coinContract, "MintingStarted").withArgs(mintingDay2Ts);
        await expect(gelatoContract.mintCoinsForTwitterUsers(userData, mintingDay2Ts, [[0, 9, '']])).to.emit(coinContract, "twitterMintingProcessed");
        await expect(gelatoContract.finishMinting(mintingDay2Ts)).to.emit(coinContract, "MintingFinished").withArgs(mintingDay2Ts);

        await expect(gelatoContract.startMinting()).to.be.revertedWith("minting is already started for that day");
        expect(await gelatoContract.getStartOfTheEpoch()).to.be.equal(startOfPrevDay);

        // 3rd day
        const day3Ts = day2Ts + time.duration.days(1);
        await time.increaseTo(day3Ts);

        const startOf3Day = await getStartOfDayTimestamp(day3Ts);
        const mintingDay3Ts = startOf2Day;
        await expect(gelatoContract.startMinting()).to.emit(coinContract, "MintingStarted").withArgs(mintingDay3Ts);
        await expect(gelatoContract.mintCoinsForTwitterUsers(userData, mintingDay3Ts, [[0, 9, '']])).to.emit(coinContract, "twitterMintingProcessed");
        await expect(gelatoContract.finishMinting(mintingDay3Ts)).to.emit(coinContract, "MintingFinished").withArgs(mintingDay3Ts);

        await expect(gelatoContract.startMinting()).to.be.revertedWith("minting is already started for that day");
        expect(await gelatoContract.getStartOfTheEpoch()).to.be.equal(startOfPrevDay);

        // 4rd day
        const day4Ts = day3Ts + time.duration.days(1);
        await time.increaseTo(day4Ts);

        const startOf4Day = await getStartOfDayTimestamp(day4Ts);
        const mintingDay4Ts = startOf3Day;

        await expect(gelatoContract.startMinting()).to.emit(coinContract, "MintingStarted").withArgs(mintingDay4Ts);
        await expect(gelatoContract.mintCoinsForTwitterUsers(userData, mintingDay4Ts, [[0, 9, '']])).to.emit(coinContract, "twitterMintingProcessed");
        await expect(gelatoContract.finishMinting(mintingDay4Ts)).to.emit(coinContract, "MintingFinished").withArgs(mintingDay4Ts);

        await expect(gelatoContract.startMinting()).to.be.revertedWith("minting is already started for that day");
        expect(await gelatoContract.getStartOfTheEpoch()).to.be.equal(startOfPrevDay);

        // 5rd day
        const day5Ts = day4Ts + time.duration.days(1);
        await time.increaseTo(day5Ts);

        const startOf5Day = await getStartOfDayTimestamp(day5Ts);
        const mintingDay5Ts = startOf4Day;

        await expect(gelatoContract.startMinting()).to.emit(coinContract, "MintingStarted").withArgs(mintingDay5Ts);
        await expect(gelatoContract.mintCoinsForTwitterUsers(userData, mintingDay5Ts, [[0, 9, '']])).to.emit(coinContract, "twitterMintingProcessed");
        await expect(gelatoContract.finishMinting(mintingDay5Ts)).to.emit(coinContract, "MintingFinished").withArgs(mintingDay5Ts);


        await expect(gelatoContract.startMinting()).to.be.revertedWith("minting is already started for that day");
        expect(await gelatoContract.getStartOfTheEpoch()).to.be.equal(startOfPrevDay);

        // 6rd day
        const day6Ts = day5Ts + time.duration.days(1);
        await time.increaseTo(day6Ts);

        const startOf6Day = await getStartOfDayTimestamp(day6Ts);
        const mintingDay6Ts = startOf5Day;

        await expect(gelatoContract.startMinting()).to.emit(coinContract, "MintingStarted").withArgs(mintingDay6Ts);
        await expect(gelatoContract.mintCoinsForTwitterUsers(userData, mintingDay6Ts, [[0, 9, '']])).to.emit(coinContract, "twitterMintingProcessed");
        await expect(gelatoContract.finishMinting(mintingDay6Ts)).to.emit(coinContract, "MintingFinished").withArgs(mintingDay6Ts);

        await expect(gelatoContract.startMinting()).to.be.revertedWith("minting is already started for that day");
        expect(await gelatoContract.getStartOfTheEpoch()).to.be.equal(startOfPrevDay);

        // 7rd day
        const day7Ts = day6Ts + time.duration.days(1);
        await time.increaseTo(day7Ts);

        const startOf7Day = await getStartOfDayTimestamp(day7Ts);
        const mintingDay7Ts = startOf6Day;

        await expect(gelatoContract.startMinting()).to.emit(coinContract, "MintingStarted").withArgs(mintingDay7Ts);
        await expect(gelatoContract.mintCoinsForTwitterUsers(userData, mintingDay7Ts, [[0, 9, '']])).to.emit(coinContract, "twitterMintingProcessed");
        await expect(gelatoContract.finishMinting(mintingDay7Ts)).to.emit(coinContract, "MintingFinished").withArgs(mintingDay7Ts);

        await expect(gelatoContract.startMinting()).to.be.revertedWith("minting is already started for that day");
        expect(await gelatoContract.getStartOfTheEpoch()).to.be.equal(startOfPrevDay);

        // 8rd day
        const currentComplexity = await gelatoContract.getCurrentComplexity();
        const expectedNewComplexity = currentComplexity * 80n / 100n;
        log('currentComplexity', currentComplexity, expectedNewComplexity);

        const day8Ts = day7Ts + time.duration.days(1);
        await time.increaseTo(day8Ts);

        const startOf8Day = await getStartOfDayTimestamp(day8Ts);
        const mintingDay8Ts = startOf7Day;
        await expect(gelatoContract.startMinting()).to.emit(coinContract, "MintingStarted").withArgs(mintingDay8Ts).and.to.emit(coinContract, "changedComplexity").withArgs(expectedNewComplexity);
        await expect(gelatoContract.mintCoinsForTwitterUsers(userData, mintingDay8Ts, [[0, 9, '']])).to.emit(coinContract, "twitterMintingProcessed");
        await expect(gelatoContract.finishMinting(mintingDay8Ts)).to.emit(coinContract, "MintingFinished").withArgs(mintingDay8Ts);

        await expect(gelatoContract.startMinting()).to.be.revertedWith("minting is already started for that day");
        expect(await gelatoContract.getStartOfTheEpoch()).to.be.equal(startOf8Day - time.duration.days(1));
    });

    it('minting for twitter users: epochs and complexity', async () => {
        const {coinContract, owner, feeAddr, gelatoAddr} = await loadFixture(createGMCoinFixture(7));

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

        log('week 2');
        let newComplexity = complexity * 80n / 100n;
        for (let i = 0; i < 7; i++) {
            log('day', i + 1);
            await simulateDayFull(dayTimestamp, users, userData, coinContract, gelatoAddr);
            expect(await coinContract.COINS_MULTIPLICATOR()).to.be.equal(newComplexity);

            dayTimestamp = dayTimestamp + time.duration.days(1);
            await time.increaseTo(dayTimestamp);
        }

        log('week 3');
        newComplexity = newComplexity * 80n / 100n;
        for (let i = 0; i < 7; i++) {
            log('day', i + 1);
            await simulateDayFull(dayTimestamp, users, userData, coinContract, gelatoAddr);
            expect(await coinContract.COINS_MULTIPLICATOR()).to.be.equal(newComplexity);

            dayTimestamp = dayTimestamp + time.duration.days(1);
            await time.increaseTo(dayTimestamp);
        }

        log('week 4');
        newComplexity = newComplexity * 80n / 100n;
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
            await gelatoContract.verifyTwitter(users[i].username, users[i].wallet, false);
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

        let expectedCoinsN = BigInt(expectedPoints) * BigInt(multiplicator);
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