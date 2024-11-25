
import { expect, use } from "chai";
import { ethers, upgrades } from "hardhat";
import { Contract, ContractFactory, Signer, Wallet, Provider, HDNodeWallet } from "ethers";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { GMCoin } from "../typechain-types/contracts/GMCoin";
import { GMCoinExposed } from "../typechain-types/contracts/testing/GMCoinExposed";
import hre from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("GM minting", function () {
    async function deployGMCoinWithProxy() {
        // Contracts are deployed using the first signer/account by default
        const [owner, feeAddr, gelatoAddr, otherAcc1, otherAcc2] = await hre.ethers.getSigners();
    
        const TwitterCoin = await ethers.getContractFactory("GMCoinExposed");
        const coinContract: GMCoinExposed = await upgrades.deployProxy(TwitterCoin, 
          [owner.address, feeAddr.address, 45, 1_000_000, gelatoAddr.address, 1_000_000], 
          {
            kind: "uups",
          }) as unknown as GMCoinExposed;
    
        await coinContract.waitForDeployment();
    
        const deployedAddress = await coinContract.getAddress();
    
        console.log('contract deployed at ', deployedAddress);
    
        // const tx = await owner.sendTransaction({
        //   to: deployedAddress,
        //   value: ethers.parseEther("1.0"),
        // });
        // await tx.wait();
    
        return { coinContract, owner, feeAddr, gelatoAddr, otherAcc1, otherAcc2 };
      }



      it('minting for twitter users: one day', async() => {
        const { coinContract, owner, feeAddr, gelatoAddr } = await loadFixture(deployGMCoinWithProxy);
    
        const gelatoContract = coinContract.connect(gelatoAddr);
    
        const batchSize = 155;
    
        // await time.increaseTo(unlockTime);
        const usernames = [];
        for (let i = 0; i < batchSize; i++) {
          usernames.push(generateRandomString(14));
        }
        const wallets = await generateWallets(ethers.provider, batchSize);
        
        for(let i=0; i<batchSize; i++) {
          await coinContract.connect(gelatoAddr).verifyTwitter(usernames[i], wallets[i].address);
        }
    
        const usernamesToProcess = await coinContract.connect(gelatoAddr).getTwitterUsers(0, batchSize);
    
        for(let i=0; i<usernames.length; i++) {
          expect(usernamesToProcess[i]).to.be.equal(usernames[i]);
        }
    
        const startOfTheDayTimestamp = await getStartOfDayTimestamp();
        const startOfYesterday = startOfTheDayTimestamp - time.duration.days(1);
    
        const generatedData = generateUserData(100, (index: number): TweetData => {
            return {userIndex: index, tweets: 135, hashtagTweets: 25, cashtagTweets: 10, simpleTweets: 100, likes: 500}
        });

        const nextCursor = ethers.hexlify(ethers.randomBytes(32));

        let cursor: Cursor = {
          startIndex: 0n,
          endIndex: BigInt(generatedData.length-1),
          nextCursor: nextCursor,
          errorCount: 0,
        }
    
        // await simulateDay(startOfTheDayTimestamp, 100_000, coinContract, gelatoAddr, allStakersIndexes, generatedData);
    
        // start minting process
        await expect(gelatoContract.startMinting()).to.emit(coinContract, "MintingStarted").withArgs(startOfYesterday);
    
        let allUsersData = [];

        console.log('expect', startOfYesterday, [cursor]);
    
        await expect(gelatoContract.mintCoinsForTwitterUsers(generatedData, startOfYesterday, [cursor])).
          to.emit(coinContract, "twitterMintingProcessed").withArgs(startOfYesterday, [[0n, 99n, nextCursor, 0]]);

        cursor.nextCursor = "";
    
        await expect(gelatoContract.mintCoinsForTwitterUsers(generatedData, startOfYesterday, [cursor])).
          to.emit(coinContract, "twitterMintingProcessed").withArgs(startOfYesterday, [[0n, 99n, '', 0]]);
    
          // *2 cause we passed that data twice: with cursor and without
        for (let i=0; i<generatedData.length; i++) {
          generatedData[i].cashtagTweets *= 2;
          generatedData[i].hashtagTweets *= 2;
          generatedData[i].tweets *= 2;
          generatedData[i].likes *= 2;
          generatedData[i].simpleTweets *= 2;
        }
    
        allUsersData.push(...generatedData);
    
        // batch 2
        const generatedData2 = generateUserData(55, (index: number): TweetData => {
            return {userIndex: 100+index, tweets: 135, hashtagTweets: 25, cashtagTweets: 10, simpleTweets: 100, likes: 500}
        });
        allUsersData.push(...generatedData2);

        cursor = {
          startIndex: 100n,
          endIndex: BigInt(100+generatedData2.length-1),
          nextCursor: "",
          errorCount: 0,
        }
    
        await expect(gelatoContract.mintCoinsForTwitterUsers(generatedData2, startOfYesterday, [cursor])).
          to.emit(coinContract, "twitterMintingProcessed").withArgs(startOfYesterday, [[100n, 154n, '', 0]]);
        
        const expectedResults = calcPointsForUsers(allUsersData, 1);
        for(let i=0; i<expectedResults.length; i++) {
          let expectedCoins = BigInt(expectedResults[i].expectedCoins) * 10n**18n;
          expect(await coinContract.balanceOf(wallets[i])).to.be.equal(expectedCoins);
        }
      })


      it('minting for twitter users: simple math', async() => {
        const { coinContract, owner, feeAddr, gelatoAddr } = await loadFixture(deployGMCoinWithProxy);
    
        const gelatoContract = coinContract.connect(gelatoAddr);
    
        const batchSize = 15;
    
        // await time.increaseTo(unlockTime);
        const usernames = [];
        for (let i = 0; i < batchSize; i++) {
          usernames.push(generateRandomString(14));
        }
        const wallets = await generateWallets(ethers.provider, batchSize);
        
        for(let i=0; i<batchSize; i++) {
          await coinContract.connect(gelatoAddr).verifyTwitter(usernames[i], wallets[i].address);
        }
    
        const usernamesToProcess = await coinContract.connect(gelatoAddr).getTwitterUsers(0, batchSize);
    
        for(let i=0; i<usernames.length; i++) {
          expect(usernamesToProcess[i]).to.be.equal(usernames[i]);
        }
    
        const startOfTheDayTimestamp = await getStartOfDayTimestamp();
    
        
        const generatedData = generateUserData(batchSize, (index: number): TweetData => {
          if(index%2==0) {
            return {userIndex: index, tweets: 10, hashtagTweets: 3, cashtagTweets: 5, simpleTweets: 2,likes: 15};
          } else {
            return {userIndex: index, tweets: 40, hashtagTweets: 0, cashtagTweets: 12, simpleTweets: 28,likes: 120}
          }
        });
    
        await simulateDay(startOfTheDayTimestamp, 100_000, gelatoContract, gelatoAddr, generatedData);
    
        const expectedPoints = [
          3*4 + 5*10 + 2*2 + 15*1,
          0*4 + 12*10 + 28*2 + 120,
          3*4 + 5*10 + 2*2 + 15*1,
          0*4 + 12*10 + 28*2 + 120,
          3*4 + 5*10 + 2*2 + 15*1,
          0*4 + 12*10 + 28*2 + 120,
          3*4 + 5*10 + 2*2 + 15*1,
          0*4 + 12*10 + 28*2 + 120,
          3*4 + 5*10 + 2*2 + 15*1,
          0*4 + 12*10 + 28*2 + 120,
          3*4 + 5*10 + 2*2 + 15*1,
          0*4 + 12*10 + 28*2 + 120,
          3*4 + 5*10 + 2*2 + 15*1,
          0*4 + 12*10 + 28*2 + 120,
          3*4 + 5*10 + 2*2 + 15*1,
        ];
    
        const totalPointsForUsers = expectedPoints.reduce((acc, current) => acc + current, 0);
    
        log('pointsForUsers', totalPointsForUsers);
        expect(await coinContract.getMintingDayPointsFromUsers()).to.be.equal(totalPointsForUsers);

    
        let coinsSum: bigint = 0n;
        for(let i=0; i<batchSize; i++) {
        log('checking', i);
          const expectedCoins = Math.floor(expectedPoints[i] * 1_000_000);
        log('points', expectedPoints[i]);
        log('expectedCoins', expectedCoins);
          // const expCoins = expPoints * 1_000_000n * 10n**18n / 1n;
          
          
          const walletBalance = await coinContract.balanceOf(wallets[i]);
          const actualCoins: bigint = walletBalance / 10n**18n;
          log('actualCoins', actualCoins);
          log('');
    
          expect(actualCoins).to.be.equal(expectedCoins);
          coinsSum += actualCoins;
        }
    
        log('totalPoints', totalPointsForUsers);
        log('coinsSum',coinsSum);
        expect(BigInt(totalPointsForUsers) - (coinsSum / 1_000_000n)).to.be.below(5); // rounding diff here is ok
    
        let liquidityPoolBalance = await coinContract.balanceOf(coinContract.getAddress());
        log('contract balance (liquidity pool)', liquidityPoolBalance);
        expect(liquidityPoolBalance / 10n**18n).to.be.equal(coinsSum/2n);
    
    
        //
        // Day 2
        //
    
      });

      it('minting for twitter users: one mint per day constraint', async() => {
        const { coinContract, owner, feeAddr, gelatoAddr } = await loadFixture(deployGMCoinWithProxy);

        const gelatoContract: GMCoinExposed = coinContract.connect(gelatoAddr);
        const startOfTheDayTimestamp = await getStartOfDayTimestamp();

        const startOfPrevDay = startOfTheDayTimestamp - time.duration.days(1);

        const users = generateNewUsers(10);

        for(let i=0; i<users.length; i++) {
            await gelatoContract.verifyTwitter(users[i].username, users[i].wallet);
        }

        const userData = generateRandomUserData(10);

        expect(await gelatoContract.getStartOfTheEpoch()).to.be.equal(startOfPrevDay);

        // first day
        await expect(gelatoContract.startMinting()).to.emit(coinContract, "MintingStarted").withArgs(startOfPrevDay);
        await expect(gelatoContract.startMinting()).to.be.revertedWith("minting process already started");
        await expect(gelatoContract.mintCoinsForTwitterUsers(startOfPrevDay, [{startIndex: 0n, endIndex: 9n, nextCursor: '', errorCount: 0}])).to.emit(coinContract, "MintingFinished");
        // await expect(gelatoContract.mintCoinsForTwitterUsers(0, 9, userData, '0x')).to.emit(coinContract, "MintingFinished");

        await expect(gelatoContract.mintCoinsForTwitterUsers(0, 9, userData, '0x')).to.be.rejectedWith("no ongoing minting process");

        await expect(gelatoContract.startMinting()).to.be.revertedWith("minting is already started for that day");
        expect(await gelatoContract.getStartOfTheEpoch()).to.be.equal(startOfPrevDay);

        // next day
        const startOf2Day = startOfTheDayTimestamp + time.duration.days(1);
        await time.increaseTo(startOf2Day);
        await expect(gelatoContract.startMinting()).to.emit(coinContract, "MintingStarted").withArgs(startOf2Day - time.duration.days(1));
        await expect(gelatoContract.mintCoinsForTwitterUsers(0, 9, userData, '0x')).to.emit(coinContract, "MintingFinished");

        await expect(gelatoContract.startMinting()).to.be.revertedWith("minting is already started for that day");
        expect(await gelatoContract.getStartOfTheEpoch()).to.be.equal(startOfPrevDay);

        // 3rd day
        const startOf3Day = startOf2Day + time.duration.days(1);
        await time.increaseTo(startOf3Day);
        await expect(gelatoContract.startMinting()).to.emit(coinContract, "MintingStarted").withArgs(startOf3Day - time.duration.days(1));
        await expect(gelatoContract.mintCoinsForTwitterUsers(0, 9, userData, '0x')).to.emit(coinContract, "MintingFinished");

        await expect(gelatoContract.startMinting()).to.be.revertedWith("minting is already started for that day");
        expect(await gelatoContract.getStartOfTheEpoch()).to.be.equal(startOfPrevDay);

        // 4rd day
        const startOf4Day = startOf3Day + time.duration.days(1);
        await time.increaseTo(startOf4Day);
        await expect(gelatoContract.startMinting()).to.emit(coinContract, "MintingStarted").withArgs(startOf4Day - time.duration.days(1));
        await expect(gelatoContract.mintCoinsForTwitterUsers(0, 9, userData, '0x')).to.emit(coinContract, "MintingFinished");

        await expect(gelatoContract.startMinting()).to.be.revertedWith("minting is already started for that day");
        expect(await gelatoContract.getStartOfTheEpoch()).to.be.equal(startOfPrevDay);

        // 5rd day
        const startOf5Day = startOf4Day + time.duration.days(1);
        await time.increaseTo(startOf5Day);
        await expect(gelatoContract.startMinting()).to.emit(coinContract, "MintingStarted").withArgs(startOf5Day - time.duration.days(1));
        await expect(gelatoContract.mintCoinsForTwitterUsers(0, 9, userData, '0x')).to.emit(coinContract, "MintingFinished");

        await expect(gelatoContract.startMinting()).to.be.revertedWith("minting is already started for that day");
        expect(await gelatoContract.getStartOfTheEpoch()).to.be.equal(startOfPrevDay);

        // 6rd day
        const startOf6Day = startOf5Day + time.duration.days(1);
        await time.increaseTo(startOf6Day);
        await expect(gelatoContract.startMinting()).to.emit(coinContract, "MintingStarted").withArgs(startOf6Day - time.duration.days(1));
        await expect(gelatoContract.mintCoinsForTwitterUsers(0, 9, userData, '0x')).to.emit(coinContract, "MintingFinished");

        await expect(gelatoContract.startMinting()).to.be.revertedWith("minting is already started for that day");
        expect(await gelatoContract.getStartOfTheEpoch()).to.be.equal(startOfPrevDay);

        // 7rd day
        const startOf7Day = startOf6Day + time.duration.days(1);
        await time.increaseTo(startOf7Day);
        await expect(gelatoContract.startMinting()).to.emit(coinContract, "MintingStarted").withArgs(startOf7Day - time.duration.days(1));
        await expect(gelatoContract.mintCoinsForTwitterUsers(0, 9, userData, '0x')).to.emit(coinContract, "MintingFinished");

        await expect(gelatoContract.startMinting()).to.be.revertedWith("minting is already started for that day");
        expect(await gelatoContract.getStartOfTheEpoch()).to.be.equal(startOfPrevDay);

        // 8rd day
        const currentComplexity = await gelatoContract.getCurrentComplexity();
        const expectedNewComplexity = currentComplexity * 80n / 100n;
        log('currentComplexity', currentComplexity, expectedNewComplexity);
        const startOf8Day = startOf7Day + time.duration.days(1);
        await time.increaseTo(startOf8Day);
        await expect(gelatoContract.startMinting()).
            to.emit(coinContract, "MintingStarted").withArgs(startOf8Day - time.duration.days(1)).
            and.to.emit(coinContract, "changedComplexity").withArgs(expectedNewComplexity);
        await expect(gelatoContract.mintCoinsForTwitterUsers(0, 9, userData, '0x')).to.emit(coinContract, "MintingFinished");

        await expect(gelatoContract.startMinting()).to.be.revertedWith("minting is already started for that day");
        expect(await gelatoContract.getStartOfTheEpoch()).to.be.equal(startOf8Day - time.duration.days(1));
      });

      it('minting for twitter users: epochs and complexity', async() => {
        const { coinContract, owner, feeAddr, gelatoAddr } = await loadFixture(deployGMCoinWithProxy);
    
        let users = generateNewUsers(30);
        let userData = generateRandomUserData(30);

        log('week 1');
        let complexity = await coinContract.getCurrentComplexity();
        let dayTimestamp = await time.latest();
        for(let i=0; i<7; i++) {
            log('day', i+1);
            
            await simulateDayFull(dayTimestamp, users, userData, coinContract, gelatoAddr);
            expect(await coinContract.getCurrentComplexity()).to.be.equal(complexity);

            dayTimestamp = dayTimestamp + time.duration.days(1);
            await time.increaseTo(dayTimestamp);
        }

        log('week 2');
        let newComplexity = complexity * 80n / 100n;
        for(let i=0; i<7; i++) {
            log('day', i+1);
            await simulateDayFull(dayTimestamp, users, userData, coinContract, gelatoAddr);
            expect(await coinContract.getCurrentComplexity()).to.be.equal(newComplexity);

            dayTimestamp = dayTimestamp + time.duration.days(1);
            await time.increaseTo(dayTimestamp);
        }

        log('week 3');
        newComplexity = newComplexity * 80n / 100n;
        for(let i=0; i<7; i++) {
            log('day', i+1);
            await simulateDayFull(dayTimestamp, users, userData, coinContract, gelatoAddr);
            expect(await coinContract.getCurrentComplexity()).to.be.equal(newComplexity);

            dayTimestamp = dayTimestamp + time.duration.days(1);
            await time.increaseTo(dayTimestamp);
        }

        log('week 4');
        newComplexity = newComplexity * 80n / 100n;
        for(let i=0; i<7; i++) {
            log('day', i+1);
            await simulateDayFull(dayTimestamp, users, userData, coinContract, gelatoAddr);
            expect(await coinContract.getCurrentComplexity()).to.be.equal(newComplexity);

            dayTimestamp = dayTimestamp + time.duration.days(1);
            await time.increaseTo(dayTimestamp);
        }

      });


});

type User = {
    username: string;
    wallet: HDNodeWallet;
}

type Cursor = {
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
    for(let i=0; i<count; i++) {
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
    if(users.length > alreadyExistingTwitterUsernames.length) {
        for(let i=alreadyExistingTwitterUsernames.length; i<users.length; i++) {
            await gelatoContract.verifyTwitter(users[i].username, users[i].wallet);
        }

        alreadyExistingTwitterUsernames = await gelatoContract.getTwitterUsers(0, users.length);
    }
    expect(alreadyExistingTwitterUsernames.length).to.be.equal(users.length);

    // const startOfPrevDay = dayTimestamp - time.duration.days(1);
    const startOfPrevDay = await getStartOfDayTimestamp() - time.duration.days(1);
    await expect(gelatoContract.startMinting()).to.emit(coinContract, "MintingStarted").withArgs(startOfPrevDay);
  
    await expect(gelatoContract.mintCoinsForTwitterUsers(0, userData.length-1, userData, '0x')).
        to.emit(coinContract, "MintingFinished");
}

async function simulateDay(dayTimestamp: number, totalGMCoins: number, coinContract: GMCoin, gelatoAddr: HardhatEthersSigner, userData: any[]) {
    const gelatoContract: GMCoinExposed = coinContract.connect(gelatoAddr);
  


    const startOfPrevDay = dayTimestamp - time.duration.days(1);

    await expect(gelatoContract.startMinting()).to.emit(coinContract, "MintingStarted").withArgs(startOfPrevDay);

    const cursor = {
      startIndex: 0n,
      endIndex: BigInt(userData.length-1),
      nextCursor: "",
      errorCount: 0,
    }
    await expect(gelatoContract.mintCoinsForTwitterUsers(userData, startOfPrevDay, [cursor])).
          to.emit(coinContract, "twitterMintingProcessed").withArgs(startOfPrevDay, [[cursor.startIndex, cursor.endIndex, cursor.nextCursor, cursor.errorCount]]);

  }
  
  function calcPointsForUsers(userData: TweetData[], divider: number): any[] {
    var results = [];
    for(let i=0; i<userData.length; i++) {
      const expectedPoints = userData[i].simpleTweets*2 + userData[i].hashtagTweets*4 + userData[i].cashtagTweets*10 + userData[i].likes;
  
      let expectedCoinsN = BigInt(expectedPoints) * 1_000_000n / BigInt(divider);
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

  const getStartOfDayTimestamp = async (): Promise<number> => {
    const currentTimestamp = await time.latest(); // Get current blockchain timestamp
    const currentDate = new Date(currentTimestamp * 1000); // Convert to JavaScript Date
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