import {MockHttpServer} from "./tools/mockServer";
import {expect} from "chai";

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
        mockServer.mock('/api/test', 'GET', {message: 'Mocked GET response'}, 200, 'application/json');
        mockServer.mock('/api/submit', 'POST', {success: true}, 201, 'application/json');

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
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({data: 'example'}),
            });
            const data = await response.json();

            // Assert the response from the mock server
            expect(data.success).to.be.true;

            // Optionally, check if the endpoint was called with the correct parameters
            mockServer.expectURLToBeCalled('/api/submit', 'POST', undefined, "{\"data\":\"example\"}");
        }
    });
})