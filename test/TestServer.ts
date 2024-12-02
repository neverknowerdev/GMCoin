import hre from "hardhat";

const {w3f} = hre;
import {createServer, IncomingMessage, ServerResponse} from "http";
import {Web3FunctionHardhat} from "@gelatonetwork/web3-functions-sdk/dist/hardhat";
import {Web3FunctionResultV2} from "@gelatonetwork/web3-functions-sdk";
import {expect} from "chai";
import HttpRequestMock from 'http-request-mock';


/*
When w3f function sends HTTP GET request with query parameters - there is no query parameters on server side when receiving request

Here is 2 tests:
- request to the server without w3f - works fine ✅
- request to the server from w3f - fails to return the same URL with query params ❌
 */
describe("w3f-query-bug", function () {
    before(async function () {
        const port = 8022;

        const server = createServer((req: IncomingMessage, res: ServerResponse) => {
            console.log('received request to server with URL', req.url);

            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/plain');
            res.end(req.url);
        });

        server.listen(port, () => {
            console.log(`Server running at http://localhost:${port}/`);
        });
    })
    it('test locally', async function () {
        const host = "localhost:8022";
        const query = "/SearchLocally?test=test"

        const url = `http://${host}${query}`;
        console.log(`sending request directly from the test to ${url}...`);
        const response = await fetch(url, {
            method: 'GET',
        });
        const respText = await response.text();


        expect(respText).to.be.equal(query);
    });

    it('test with w3f', async function () {
        const host = "localhost:8022";
        const query = "/SearchFromW3F?test=test"

        const url = `http://${host}${query}`;
        console.log(`sending request from W3F to ${url}...`);


        let oracleW3f: Web3FunctionHardhat = w3f.get("test-server");
        let {result} = await oracleW3f.run("onRun", {
            userArgs: {
                ServerURL: url
            }
        });
        result = result as Web3FunctionResultV2;

        expect(result.message).to.be.equal(query);
    })

    it('mocker test', async function () {
        const mocker = HttpRequestMock.setup();

        const host = "x.com";
        const query = "/SearchFromW3F?test=test"

        const url = `http://${host}${query}`;
        console.log(`sending request from W3F to ${url}...`);

        mocker.get(url, `${query}`);

        let oracleW3f: Web3FunctionHardhat = w3f.get("test-server");
        let {result} = await oracleW3f.run("onRun", {
            userArgs: {
                ServerURL: url
            }
        });
        result = result as Web3FunctionResultV2;

        expect(result.message).to.be.equal(query);

    })
})