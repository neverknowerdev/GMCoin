
import { expect } from "chai";
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
          [owner.address, feeAddr.address, 50, 1_000_000, gelatoAddr.address], 
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



      it('minting for twitter user: one day', async() => {
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
    
        const allStakersIndexes = [0n, 10n, 20n, 30n, 40n, 50n, 60n, 70n, 80n, 90n];
    
        const generatedData = generateRandomUserData(batchSize);

        await gelatoContract.addStakers(allStakersIndexes);
    
        await simulateDay(startOfTheDayTimestamp, 100_000, coinContract, gelatoAddr, allStakersIndexes, generatedData);
    
        // start minting process
        await expect(gelatoContract.startMinting()).to.emit(coinContract, "mintingStarted").withArgs(startOfYesterday);
    
        await expect(gelatoContract.writeTotalGMForDay(100000)).to.emit(coinContract, "mintingFromTwitter_Progress").withArgs(0, '0x');
    
        let allUsersData = [];

    
    
        const nextCursor = ethers.hexlify(ethers.randomBytes(32));
    
    
        await expect(gelatoContract.mintCoinsForTwitterUsers(0, generatedData.length-1, generatedData, nextCursor)).
          to.emit(coinContract, "mintingFromTwitter_Progress").withArgs(0, nextCursor);
    
        await expect(gelatoContract.mintCoinsForTwitterUsers(0, generatedData.length-1, generatedData, '0x')).
          to.emit(coinContract, "mintingFromTwitter_Progress").withArgs(99, '0x');
    
        for (let i=0; i<generatedData.length; i++) {
          generatedData[i].cashtagTweets *= 2;
          generatedData[i].hashtagTweets *= 2;
          generatedData[i].tweets *= 2;
          generatedData[i].likes *= 2;
          generatedData[i].simpleTweets *= 2;
        }
    
        allUsersData.push(...generatedData);
    
        // batch 2
        const generatedData2 = generateRandomUserData(55);
        allUsersData.push(...generatedData2);
    
        await expect(gelatoContract.mintCoinsForTwitterUsers(100, 100+generatedData2.length-1, generatedData2, '0x')).
          to.emit(coinContract, "mintingForStakers_Progress").withArgs(0);
        
        const expectedResults = calcPointsForUsers(allUsersData, 1, 0.0045);
        for(let i=0; i<expectedResults.length; i++) {
          let expectedCoins = BigInt(expectedResults[i].expectedCoins) * 10n**18n;
          expect(await coinContract.balanceOf(wallets[i])).to.be.equal(expectedCoins);
        }
    
        // minting for stakers
        const totalStakersCount = await gelatoContract.totalStakersCount();
        expect(totalStakersCount).to.be.equal(allStakersIndexes.length);
        
        await expect(gelatoContract.mintCoinsForStakers(0, 5)).
            to.emit(coinContract, "mintingForStakers_Progress").withArgs(5);
        
        await gelatoContract.mintCoinsForStakers(6, totalStakersCount-1n);
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
    
        const allStakersIndexes: bigint[] = [4n, 5n, 8n];
        
        const generatedData = generateUserData(batchSize, (index: number): TweetData => {
          if(index%2==0) {
            return {tweets: 10, hashtagTweets: 3, cashtagTweets: 5, simpleTweets: 2,likes: 15};
          } else {
            return {tweets: 40, hashtagTweets: 0, cashtagTweets: 12, simpleTweets: 28,likes: 120}
          }
        });
    
        await gelatoContract.addStakers(allStakersIndexes);
        await simulateDay(startOfTheDayTimestamp, 100_000, gelatoContract, gelatoAddr, allStakersIndexes, generatedData);
    
        // const expectedResults = calcPointsForUsers(generatedData, 1, 0.0045);
        // const expectedStakingResults = calcPointsForStakers(100_000, allStakersIndexes, wallets, expectedResults);
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
        const totalPoints = 100_000*2 + totalPointsForUsers - 
          10*2 - 40*2 - 10*2 - 40*2 - 10*2 - 40*2 - 10*2 - 40*2 - 10*2 - 40*2 - 10*2 - 40*2 - 10*2 - 40*2 - 10*2 // minus already cointed tweets
        ;
    
        console.log('totalPoints', totalPoints, 'pointsForUsers', totalPointsForUsers);
        expect(await coinContract.getMintingDayTotalPoints()).to.be.equal(totalPoints);
        expect(await coinContract.getMintingDayPointsFromUsers()).to.be.equal(totalPointsForUsers);
    
        const freeReward = (totalPoints - totalPointsForUsers);
        // divide reward proportional to user points
    
        // total staker coins == total stakers points as there is no coins staked before
        const totalStakerCoins = expectedPoints[4] + expectedPoints[5] + expectedPoints[8];
        console.log('totalStakerCoins', totalStakerCoins);
        expect((await coinContract.getMintingDayTotalCoinsStaked()/10n**18n/1_000_000n)).to.be.equal(totalStakerCoins);
        
    
        let expectedPointsWithStaking = [...expectedPoints]; 
        expectedPointsWithStaking[4] += Math.floor(freeReward * expectedPoints[4] / totalStakerCoins);
        expectedPointsWithStaking[5] += Math.floor(freeReward * expectedPoints[5] / totalStakerCoins);
        expectedPointsWithStaking[8] += Math.floor(freeReward * expectedPoints[8] / totalStakerCoins);
    
        console.log('reward for 4 staker', freeReward * expectedPoints[4] / totalStakerCoins);
    
        let coinsSum: bigint = 0n;
        for(let i=0; i<batchSize; i++) {
          console.log('checking', i);
          const expectedCoins = Math.floor(expectedPointsWithStaking[i] * 1_000_000);
          console.log('points', expectedPoints[i], 'pointsWithStaking', expectedPointsWithStaking[i]);
          console.log('expectedCoins', expectedCoins);
          // const expCoins = expPoints * 1_000_000n * 10n**18n / 1n;
          
          
          const walletBalance = await coinContract.balanceOf(wallets[i]);
          const actualCoins: bigint = walletBalance / 10n**18n;
          console.log('actualCoins', actualCoins);
          console.log('');
    
          expect(actualCoins).to.be.equal(expectedCoins);
          coinsSum += actualCoins;
        }
    
        console.log('totalPoints',totalPoints);
        console.log('coinsSum',coinsSum);
        expect(BigInt(totalPoints) - (coinsSum / 1_000_000n)).to.be.below(5); // rounding diff here is ok
    
        let liquidityPoolBalance = await coinContract.balanceOf(coinContract.getAddress());
        console.log('contract balance (liquidity pool)', liquidityPoolBalance);
        expect(liquidityPoolBalance / 10n**18n).to.be.equal(coinsSum/2n);
    
    
        //
        // Day 2
        //
    
      });

});


type TweetData = {
    tweets: number;
    hashtagTweets: number;
    cashtagTweets: number;
    simpleTweets: number;
    likes: number;
  };


async function simulateDay(dayTimestamp: number, totalGMCoins: number, coinContract: GMCoin, gelatoAddr: HardhatEthersSigner, stakerIndexes: bigint[], userData: any[]) {
    const gelatoContract: GMCoinExposed = coinContract.connect(gelatoAddr);
  
    const startOfPrevDay = dayTimestamp - time.duration.days(1);
    await expect(gelatoContract.startMinting()).to.emit(coinContract, "mintingStarted").withArgs(startOfPrevDay);
  
    await expect(gelatoContract.writeTotalGMForDay(totalGMCoins)).to.emit(coinContract, "mintingFromTwitter_Progress").withArgs(0, '0x');
  
    await expect(gelatoContract.mintCoinsForTwitterUsers(0, userData.length-1, userData, '0x')).
        to.emit(coinContract, "mintingForStakers_Progress").withArgs(0);
  
    // minting for stakers
    const totalStakersCount = await gelatoContract.totalStakersCount();
    expect(totalStakersCount).to.be.equal(stakerIndexes.length);
    
    const result = await gelatoContract.getAllStakerIndexes();
    expect(result.map(BigInt)).to.deep.equal(stakerIndexes);
    
    await expect(gelatoContract.mintCoinsForStakers(0, stakerIndexes.length-1)).
        to.emit(coinContract, "MintingFinished");
  }
  
  function calcPointsForUsers(userData: TweetData[], divider: number, mintComission: number): any[] {
    var results = [];
    for(let i=0; i<userData.length; i++) {
      const expectedPoints = userData[i].simpleTweets*2 + userData[i].hashtagTweets*4 + userData[i].cashtagTweets*10 + userData[i].likes;
  
      let expectedCoinsN = BigInt(expectedPoints) * 1_000_000n / BigInt(divider);
      expectedCoinsN = expectedCoinsN - (expectedCoinsN * BigInt(mintComission*10000) / 1000n);
      
      
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
        userData.push({
            tweets: 135,
            hashtagTweets: 25,
            cashtagTweets: 10,
            simpleTweets: 100,
            likes: 500,
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