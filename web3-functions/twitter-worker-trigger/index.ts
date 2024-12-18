// Runs every hour and trigger twitter workers if needed
import {
    Web3Function,
    Web3FunctionContext,
    Web3FunctionResult
} from "@gelatonetwork/web3-functions-sdk";
import {Contract, ContractRunner} from "ethers";

const ContractABI = [
    {
        "inputs": [],
        "name": "startMinting",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
];

Web3Function.onRun(async (context: Web3FunctionContext): Promise<Web3FunctionResult> => {
    const {userArgs, multiChainProvider} = context;

    const provider = multiChainProvider.default() as ContractRunner;

    const smartContract = new Contract(
        userArgs.contractAddress as string,
        ContractABI,
        provider
    );

    return {
        canExec: true,
        callData: [{
            to: userArgs.contractAddress as string,
            data: smartContract.interface.encodeFunctionData("startMinting"),
        }],
    };
});
