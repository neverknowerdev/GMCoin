import {
    Web3Function,
    Web3FunctionEventContext,
    Web3FunctionResult
} from "@gelatonetwork/web3-functions-sdk";
import {Contract} from "ethers";

const ContractABI = [
    {
        "inputs": [
            {
                "internalType": "int256",
                "name": "delta",
                "type": "int256"
            }
        ],
        "name": "increaseCount",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
]
Web3Function.onRun(async (context: Web3FunctionEventContext): Promise<Web3FunctionResult> => {
    const {log, userArgs, multiChainProvider, storage} = context;

    const contractAddress = userArgs.contractAddress as string;

    const provider = multiChainProvider.default();

    const bearerToken = await context.secrets.get('BEARER_TOKEN');
    console.log('bearerToken', bearerToken);

    const smartContract = new Contract(
        contractAddress,
        ContractABI,
        provider
    );

    return {
        canExec: true,
        callData: [{
            to: contractAddress,
            data: smartContract.interface.encodeFunctionData("increaseCount", [
                BigInt(1)
            ]),
        }]
    }
});