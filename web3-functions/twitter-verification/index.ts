import { Interface } from "@ethersproject/abi";
import { Web3Function, Web3FunctionEventContext } from "@gelatonetwork/web3-functions-sdk";
import { Contract } from "ethers";

const VerifierContractABI = [
  "event TwitterVerificationRequested(string username, address wallet)",
  "function verifyTwitter(string calldata username, address wallet)"
];

Web3Function.onRun(async (context: Web3FunctionEventContext) => {
  // Get event log from Web3FunctionEventContext
  const { log, userArgs, multiChainProvider } = context;

  console.log(`verifier address is ${userArgs.verifierContractAddress}`);

  const provider = multiChainProvider.default();

  const verifier = new Contract(userArgs.verifierContractAddress as string, VerifierContractABI, provider);
  
  // Parse your event from ABI
  console.log("Parsing event");
  
  const contract = new Interface(VerifierContractABI);
  const event = contract.parseLog(log);

  // Handle event data
  const { username, wallet } = event.args;
  console.log(`Veryfing Twitter username ${username} for address ${wallet}..`);
  // verify here
    
  
  return {
        canExec: true,
        callData: [{
            to: userArgs.verifierContractAddress as string,
            data: verifier.interface.encodeFunctionData("verifyTwitter", [username, wallet])
        }]
    }
});