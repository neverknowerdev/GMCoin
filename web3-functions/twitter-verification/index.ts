import { Interface } from "@ethersproject/abi";
import {
  Web3Function,
  Web3FunctionEventContext,
} from "@gelatonetwork/web3-functions-sdk";
import { Contract } from "ethers";
import ky from "ky";

const VerifierContractABI = [
  "event TwitterVerificationRequested(string username, address wallet)",
  "function verifyTwitter(string calldata username, address wallet)",
];

interface UserData {
  username: string;
  id: string;
  created_at: string;
  name: string;
  description: string;
}

interface SuccessResponse {
  data: UserData;
}

interface ErrorResponse {
  title: string;
  detail: string;
  type: string;
  status: number;
}

Web3Function.onRun(async (context: Web3FunctionEventContext) => {
  // Get event log from Web3FunctionEventContext
  const { log, userArgs, multiChainProvider } = context;

  const bearerToken = await context.secrets.get("TWITTER_AUTH_TOKEN");
  console.log(`bearer token: ${bearerToken}`);

  if (!bearerToken)
    return { canExec: false, message: `TWITTER_AUTH_TOKEN not set in secrets` };

  console.log(`verifier address is ${userArgs.verifierContractAddress}`);

  const provider = multiChainProvider.default();

  const verifier = new Contract(
    userArgs.verifierContractAddress as string,
    VerifierContractABI,
    provider
  );

  // Parse your event from ABI
  console.log("Parsing event");

  const contract = new Interface(VerifierContractABI);
  const event = contract.parseLog(log);

  // Handle event data
  const { username, wallet } = event.args;
  console.log(`Veryfing Twitter username ${username} for address ${wallet}..`);
  // verify here

  const twitterRequestURL = `https://api.x.com/2/users/by/username/${username}?user.fields=created_at,description`;

  try {
    const response = await ky
      .get(twitterRequestURL, {
        headers: {
          Authorization: `Bearer ${bearerToken}`,
        },
      })
      .json();

    // Check if the response contains the 'data' field
    if ("data" in response) {
      console.log("Success:", response);

      let userData = response as SuccessResponse;
      console.log('isIncludes', userData.data.description, userData.data.description.toLowerCase().includes(wallet.toLowerCase()));
      console.log('wallet', wallet);
      if (
        userData.data.description.toLowerCase().includes(wallet.toLowerCase()) &&
        userData.data.username == username
      ) {
        return {
          canExec: true,
          callData: [
            {
              to: userArgs.verifierContractAddress as string,
              data: verifier.interface.encodeFunctionData("verifyTwitter", [
                username,
                wallet,
              ]),
            },
          ],
        };
      }
    } else {
      console.error("Unexpected response format:", response);
    }
  } catch (error: any) {
    if (error.response) {
      // Parse the error response
      const errorData = await error.response.json();
      console.error("Error response:", errorData);
    } else {
      // Handle network or other errors
      console.error("Request failed:", error.message);
    }
  }

  return {
    canExec: false,
    message: "error occured while validation",
  };
});
