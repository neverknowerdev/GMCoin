import { Interface } from "@ethersproject/abi";
import {
  Web3Function,
  Web3FunctionEventContext
} from "@gelatonetwork/web3-functions-sdk";
import { Contract } from "ethers";
import ky , { HTTPError }from "ky";

// Define Twitter API endpoint
const TWITTER_TOKEN_URL = '/2/oauth2/token';
const TWITTER_ME_URL = '/2/users/me';
const TWITTER_FOLLOW_URL = '/2/users/:id/following';
const TWITTER_REVOKE_URL = '/2/oauth2/revoke';


const VerifierContractABI = [
  "event VerifyTwitterRequested(string authCode, string verifier, address indexed wallet, bool autoFollow)",
  "function verifyTwitter(string calldata userID, address wallet)",
];

Web3Function.onRun(async (context: Web3FunctionEventContext) => {
  // Get event log from Web3FunctionEventContext
  const { log, userArgs, multiChainProvider } = context;

  const TwitterApiURL = userArgs.TwitterHost;

  const bearerToken = await context.secrets.get("TWITTER_BEARER");
  console.log(`bearer token: ${bearerToken}`);
  if (!bearerToken)
    return { canExec: false, message: `TWITTER_BEARER not set in secrets` };

  const twitterClientID = await context.secrets.get("TWITTER_CLIENT_ID");
  console.log(`Twitter ClientID: ${twitterClientID}`);
  if (!twitterClientID)
    return { canExec: false, message: `TWITTER_CLIENT_ID not set in secrets` };

  const twitterSecret = await context.secrets.get("TWITTER_SECRET");
  if (!twitterSecret) {
    return {canExec: false, message: `TWITTER_SECRET not set in secrets`};
  }

  const twitterAuthRedirectURL = await context.secrets.get("TWITTER_AUTH_REDIRECT_URL");
  if (!twitterAuthRedirectURL) 
    return { canExec: false, message: `TWITTER_AUTH_REDIRECT_URL not set in secrets` };
  

  console.log(`verifier address is ${userArgs.verifierContractAddress}`);

  try {
    const provider = multiChainProvider.default();

    const verifierContract = new Contract(
      userArgs.verifierContractAddress as string,
      VerifierContractABI,
      provider
    );

    const contract = new Interface(VerifierContractABI);
    const event = contract.parseLog(log);

    // Handle event data
    const { authCode, verifier, wallet, autoFollow } = event.args;
    console.log(`Veryfing Twitter for address ${wallet}..`);
    // verify here

    const basicAuthEncoded = btoa(`${twitterClientID}:${twitterSecret}`);
    console.log('basicAuthEncoded', basicAuthEncoded);

    const tokenResponse = await ky.post(
      TwitterApiURL+TWITTER_TOKEN_URL,
      {
        headers: {
          'Authorization': `Basic ${basicAuthEncoded}`,
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
        message: 'Failed to retrieve access token: '+JSON.stringify(tokenResponse)
      }
    }


    // Step 2: Use access token to call the users/me endpoint
    const userResponse = await ky.get(TwitterApiURL+TWITTER_ME_URL, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    }).json();

    const twitterUser = userResponse as any;
    const userID = twitterUser.data.id;

    if (!userID) {
      return {
        canExec: false,
        message: 'Failed to retrieve user from Twitter.'
      }
    }

    if(autoFollow) {
      // Step 4: follow GM account
      await ky.post(
        TwitterApiURL+TWITTER_FOLLOW_URL.replace(':id', userID),
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            target_user_id: '1830701284288028673'
          }),
        }
      );
    }

    // Step 5: Revoke the access token after successful validation
    await ky.post(
      TwitterApiURL+TWITTER_REVOKE_URL,
      {
        headers: {
          'Authorization': `Basic ${basicAuthEncoded}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          token: accessToken,
          client_id: twitterClientID,
          token_type_hint: 'access_token'
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
    if (error instanceof HTTPError) {
      // Attempt to read the error response as JSON
      const errorBody = await error.response.json().catch(() => error.response.text());
  
      return {
        canExec: false,
        message: `Failed to retrieve access token: ${JSON.stringify(errorBody)}`,
      };
    } else {
      // Handle any other errors (e.g., network errors)
      return {
        canExec: false,
        message: `An unexpected error occurred: ${error.message}`,
      };
    }
  }
});