import { expect } from "chai";
import hre from "hardhat";
const { ethers, w3f, upgrades } = hre;
import {
    Web3FunctionUserArgs,
    Web3FunctionResultV2,
  } from "@gelatonetwork/web3-functions-sdk";
import { Web3FunctionHardhat } from "@gelatonetwork/web3-functions-sdk/hardhat-plugin";
import { GMCoinExposed } from "../typechain";
import { MockHttpServer } from './tools/mockServer';
import { Provider, HDNodeWallet } from "ethers";



describe("GelatoW3F", function () {
  let mockServer: MockHttpServer;

    before(async function () {
      // Initialize and start the mock server
      mockServer = new MockHttpServer(8118);
      mockServer.start();
    });

    after(async function () {
      // Stop the mock server after all tests
      mockServer.stop();
    });

    beforeEach(async function () {
      // Reset mocks before each test
      mockServer.resetMocks();
    });

    it('should post to the mock server and validate the response', async function () {
      mockServer.mock('/api/test', 'GET', { message: 'Mocked GET response' }, 200, 'application/json');
      mockServer.mock('/api/submit', 'POST', { success: true }, 201, 'application/json');

      {
        const response = await fetch('http://localhost:8118/api/test');
        const data = await response.json();

        // Assert the response from the mock server
        expect(data.message).to.equal('Mocked GET response');

        // Optionally, check if the endpoint was called
        mockServer.expectURLToBeCalled('/api/test', 'GET');
      }

      {
        const response = await fetch('http://localhost:8118/api/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: 'example' }),
        });
        const data = await response.json();
    
        // Assert the response from the mock server
        expect(data.success).to.be.true;
    
        // Optionally, check if the endpoint was called with the correct parameters
        mockServer.expectURLToBeCalled('/api/submit', 'POST', undefined, { data: 'example' });
      }
    });

    it("twitter-verification error /oauth2/token", async function () {
        const [owner, feeAddr, otherAcc1, gelatoAddr] = await hre.ethers.getSigners();

        const TwitterCoin = await ethers.getContractFactory("GMCoinExposed");
        const instance: GMCoinExposed = await upgrades.deployProxy(TwitterCoin, [owner.address, feeAddr.address, 50, 100000, gelatoAddr.address, 100_000], {kind: "uups"}) as unknown as GMCoin;

        await instance.waitForDeployment();

        mockServer.mock('/2/oauth2/token', 'POST', 
          {
            "error": "invalid_request",
            "error_description": "Value passed for the authorization code was invalid."
          },
          400
        );

        const verifierAddress = await instance.getAddress();
        console.log(`deployed GMCoin to ${verifierAddress}`);

        let oracleW3f: Web3FunctionHardhat = w3f.get("twitter-verification");

        let { result } = await oracleW3f.run("onRun", { 
          userArgs: {
            verifierContractAddress: verifierAddress,
            TwitterHost: "http://localhost:8118",
          }
         });
        result = result as Web3FunctionResultV2;

        console.log('result', result);
        expect(result.canExec).to.equal(false);
        expect(result.message).to.equal('Failed to retrieve access token: {"error":"invalid_request","error_description":"Value passed for the authorization code was invalid."}');

    });

    it('twitter-verification success', async function() {
      const [owner, feeAddr, otherAcc1, gelatoAddr] = await hre.ethers.getSigners();

      const TwitterCoin = await ethers.getContractFactory("GMCoinExposed");
      const instance: GMCoinExposed = await upgrades.deployProxy(TwitterCoin, [owner.address, feeAddr.address, 50, 100000, gelatoAddr.address, 100_000], {kind: "uups"}) as unknown as GMCoin;

      await instance.waitForDeployment();

      mockServer.mock('/2/oauth2/token', 'POST', 
        {
          "token_type": "bearer",
          "expires_in": 7200,
          "access_token": "YTc4LXlfTk1tVnRZaUN4YUJSU1QxTTdSNlJXeDRDWUdJWXBTZzBHdmhVU2U1OjE3MzA1Njc2MTY4MjY6MTowOmF0OjE",
          "scope": "users.read tweet.read follows.write"
        }
      )

      mockServer.mock('/2/users/me', 'GET',
        {
          "data": {
              "id": "1796129942104657921",
              "name": "NeverKnower",
              "username": "neverknower_dev"
          }
        }
      )

      mockServer.mock('/2/users/userID/following', 'POST',
        {
          "data": {
              "following": true,
              "pending_follow": false
          }
        }
      )
      
      mockServer.mock('/2/oauth2/revoke', 'POST', 
        {
          "revoked": true
        }
      )

      const verifierAddress = await instance.getAddress();
      console.log(`deployed GMCoin to ${verifierAddress}`);

      let oracleW3f: Web3FunctionHardhat = w3f.get("twitter-verification");

      let { result } = await oracleW3f.run("onRun", { 
        userArgs: {
          verifierContractAddress: verifierAddress,
          twitterHost: "http://localhost:8118",
        }
       });
      result = result as Web3FunctionResultV2;

      expect(result.canExec).to.equal(true);

      for (let calldata of result.callData) {
          await gelatoAddr.sendTransaction({ to: calldata.to, data: calldata.data });    
      }

      let resultWallet = await instance.getWalletByUserID("1796129942104657921");
      expect(resultWallet.toLowerCase()).to.equal("0x6794a56583329794f184d50862019ecf7b6d8ba6");
    });

    it('twitter-worker success', async function() {
      const [owner, feeAddr, otherAcc1, gelatoAddr] = await hre.ethers.getSigners();

      const TwitterCoin = await ethers.getContractFactory("GMCoinExposed");
      const instance: GMCoinExposed = await upgrades.deployProxy(TwitterCoin, [owner.address, feeAddr.address, 50, 100000, gelatoAddr.address, 100_000], {kind: "uups"}) as unknown as GMCoin;

      await instance.waitForDeployment();

      const gelatoContract = instance.connect(gelatoAddr);

      const generatedWallets: HDNodeWallet[] = generateWallets(ethers.provider, 200);

      for(let i=0; i<200; i++) {
        await gelatoContract.verifyTwitter(String(i+1), generatedWallets[i]);
      }

      


      mockServer.mock('/2/oauth2/token', 'POST', 
        {
          "token_type": "bearer",
          "expires_in": 7200,
          "access_token": "YTc4LXlfTk1tVnRZaUN4YUJSU1QxTTdSNlJXeDRDWUdJWXBTZzBHdmhVU2U1OjE3MzA1Njc2MTY4MjY6MTowOmF0OjE",
          "scope": "users.read tweet.read follows.write"
        }
      )



      const verifierAddress = await instance.getAddress();
      console.log(`deployed GMCoin to ${verifierAddress}`);

      let oracleW3f: Web3FunctionHardhat = w3f.get("twitter-worker");

      let { result } = await oracleW3f.run("onRun", { 
        userArgs: {
          contractAddress: verifierAddress,
          twitterHost: "http://localhost:8118",
        }
       });
      result = result as Web3FunctionResultV2;

      expect(result.canExec).to.equal(true);

      // for (let calldata of result.callData) {
      //     await gelatoAddr.sendTransaction({ to: calldata.to, data: calldata.data });    
      // }

      // let resultWallet = await instance.getWalletByUserID("1796129942104657921");
      // expect(resultWallet.toLowerCase()).to.equal("0x6794a56583329794f184d50862019ecf7b6d8ba6");
    });

})


function generateWallets(provider: Provider, count: number = 1000): HDNodeWallet[] {
  const wallets: HDNodeWallet[] = [];

  for (let i = 0; i < count; i++) {
    const wallet = ethers.Wallet.createRandom();
    const connectedWallet = wallet.connect(provider);
    wallets.push(connectedWallet);
  }

  return wallets;
}

/*
Possible Twitter API responses:
{
    "title": "Too Many Requests",
    "detail": "Too Many Requests",
    "type": "about:blank",
    "status": 429
}


{
    "title": "Unauthorized",
    "type": "about:blank",
    "status": 401,
    "detail": "Unauthorized"
}

*/


