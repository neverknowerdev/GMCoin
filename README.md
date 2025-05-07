Project links: https://gmcoin.meme
https://x.com/say_more_gm

Developer: https://x.com/neverknower_dev


# GM meme-coin backend
This repository contains all backend logic to GM meme-coin:
1. smart-contracts
2. Gelato w3f functions
3. deploying scripts
4. tests

# GM Mechanics
1. Connect your X/Twitter account to your wallet on website
2. Post tweets containing "gm" (or #gm, $gm to increase earnings) - get $GM coins per each tweet and like of that tweets
3. Once per day twitter-worker runs and checks the tweets of all registered to the system (smart-contract) users, and mints calculated amount of GM coins
4. Once per week minting difficulty increases (see StartMinting func in TwitterOracle smart-contract), or decreases in some rare circumstances
5. All operations is trustless, Gelato w3f function creates directly from smart-contract, so no one can stop/modify/add any new or existing Gelato functions related to this smart-contract
6. TimeLock(3 days) prevents from immediately changes that can break the tokenomics or exiting logic


## How to run tests
```shell
npx hardhat test
```

