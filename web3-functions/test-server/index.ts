import {
    Web3Function,
    Web3FunctionContext,
    Web3FunctionResult
} from "@gelatonetwork/web3-functions-sdk";
import ky , { HTTPError } from "ky";
import axios from "axios";

Web3Function.onRun(async (context: Web3FunctionContext): Promise<Web3FunctionResult> => {
    const { userArgs, multiChainProvider } = context;
    console.log('here');

    const ServerURL = userArgs.ServerURL as string;
    console.log('serverURL', ServerURL);

    // const resp = (await axios.get(ServerURL)).data;
    const resp = await ky.get(ServerURL, {
        headers: {
            "Query": "testQuery",
        },
        searchParams: {
            q: "test"
        }
    }).text();

    console.log('response', resp);

    return {
        canExec: false,
        message: resp
    };
})