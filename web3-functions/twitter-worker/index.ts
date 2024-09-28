import { Interface } from "@ethersproject/abi";
import {
  Web3Function,
  Web3FunctionEventContext,
} from "@gelatonetwork/web3-functions-sdk";
import { Contract } from "ethers";
import ky from "ky";

// Define Twitter API endpoint
const TWITTER_TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
const TWITTER_ME_URL = 'https://api.twitter.com/2/users/me';
const TWITTER_REVOKE_URL = 'https://api.twitter.com/2/oauth2/revoke';


const VerifierContractABI = [
  "event VerifyTwitterRequested(string authCode, string verifier, address wallet)",
  "function verifyTwitter(string calldata userID, address wallet)",
];

Web3Function.onRun(async (context: Web3FunctionEventContext) => {
  // Get event log from Web3FunctionEventContext
  const { log, userArgs, multiChainProvider } = context;

  const bearerToken = await context.secrets.get("TWITTER_BEARER");
  console.log(`bearer token: ${bearerToken}`);
  if (!bearerToken)
    return { canExec: false, message: `TWITTER_BEARER not set in secrets` };

  const twitterClientID = await context.secrets.get("TWITTER_CLIENT_ID");
  console.log(`Twitter ClientID: ${twitterClientID}`);
  if (!twitterClientID)
    return { canExec: false, message: `TWITTER_BEARER not set in secrets` };


  console.log(`verifier address is ${userArgs.verifierContractAddress}`);

  try {
    const provider = multiChainProvider.default();

    const verifierContract = new Contract(
      userArgs.verifierContractAddress as string,
      VerifierContractABI,
      provider
    );

    // Parse your event from ABI
    console.log("Parsing event");

    const contract = new Interface(VerifierContractABI);
    const event = contract.parseLog(log);

    // Handle event data
    const { authCode, verifier, wallet } = event.args;
    console.log(`Veryfing Twitter for address ${wallet}..`);
    // verify here


    // Step 1: exchange authCode for accessToken
    const tokenResponse = await ky.post(
      TWITTER_TOKEN_URL,
      {
        headers: {
          'Authorization': `Bearer ${bearerToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: twitterClientID, // Ensure client ID is set in env
          redirect_uri: twitterAuthRedirectURL, // Ensure redirect URI is set in env
          grant_type: 'authorization_code',
          code: authCode,
          code_verifier: verifier, // OAuth code verifier, not the contract object
        }).toString(),
      }
    ).json();

    const accessToken = (tokenResponse as any).access_token;

    if (!accessToken) {
      return {
        canExec: false,
        message: 'Failed to retrieve access token.',
      };
    }


    // Step 2: Use access token to call the users/me endpoint
    const userResponse = await ky.get(TWITTER_ME_URL, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    }).json();

    const twitterUser = userResponse as any;
    const userID = twitterUser.data.id;

    if (!userID) {
      return {
        canExec: false,
        message: 'Failed to retrieve user from Twitter.',
      };
    }


    // Step 4: Revoke the access token after successful validation
    await ky.post(
      TWITTER_REVOKE_URL,
      {
        headers: {
          'Authorization': `Bearer ${bearerToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          token: accessToken
        }).toString(),
      }
    );


    return {
      canExec: true,
      callData: [
        {
          to: userArgs.verifierContractAddress as string,
          data: verifierContract.interface.encodeFunctionData("verifyTwitter", [
            userID,
            wallet,
          ]),
        },
      ],
    };
  } catch (error: any) {
    console.error('Error during Twitter user validation:', error);
    return {
      canExec: false,
      message: 'Error occurred while validation: ' + error.message,
    };
  }
});