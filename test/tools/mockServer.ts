import {createServer, IncomingHttpHeaders, IncomingMessage, ServerResponse} from 'http';
import * as url from 'url';
import * as querystring from 'querystring';

type MockData = {
    [url: string]: {
        method: string;
        response: any;
        statusCode: number;
        contentType: string;
    };
};

type CalledUrlData = {
    url: string;
    method: string;
    params?: Record<string, any>;
    body?: any;
};

export class MockHttpServer {
    private server;
    private mockData: MockData = {};
    private calledUrls: CalledUrlData[] = [];
    private routes: Map<string, {
        method: string;
        callback?: (url: url.UrlWithParsedQuery, headers: IncomingHttpHeaders) => any
    }> = new Map();

    constructor(private port: number) {
        this.server = createServer(this.requestHandler.bind(this));
    }

    private async requestHandler(req: IncomingMessage, res: ServerResponse) {
        const parsedUrl = url.parse(req.url || '', true);

        const urlPath = parsedUrl.pathname || '';
        const method = req.method || '';

        const mock = this.mockData[urlPath];
        if (mock && mock.method === method) {
            // Store called URL data
            const params = parsedUrl.query;
            const body = await this.getRequestBody(req);
            this.calledUrls.push({url: urlPath, method, params, body});

            let responseBody = '';
            if (mock.contentType === 'application/json') {
                responseBody = JSON.stringify(mock.response);
            } else {
                responseBody = typeof mock.response === 'string' ? mock.response : String(mock.response);
            }

            res.writeHead(mock.statusCode, {
                'Content-Type': mock.contentType,
                'Content-Length': Buffer.byteLength(responseBody)
            });
            res.write(responseBody);
            res.end();

            return;
        }
        const routeKey = `${req.method}:${parsedUrl.pathname}`;

        const route = this.routes.get(routeKey);

        if (route) {
            let responseData;

            try {
                if (route.callback) {
                    // Use callback to generate the response
                    responseData = route.callback(parsedUrl, req.headers);
                } else {
                    responseData = {message: 'No callback provided'};
                }

                res.writeHead(200, {'Content-Type': 'application/json'});
                res.end(JSON.stringify(responseData));
            } catch (error) {
                console.log('500 error', error.message);
                res.writeHead(500, {'Content-Type': 'application/json'});
                res.end(JSON.stringify({error: 'Failed to process request', details: error.message}));
            }

            return;
        }

        res.writeHead(404, {'Content-Type': 'text/plain'});
        res.end('Not Found');
    }

    private getRequestBody(req: IncomingMessage): Promise<any> {
        return new Promise((resolve, reject) => {
            const contentType = req.headers['content-type'];

            if (req.method === 'POST' || req.method === 'PUT') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    try {
                        if (contentType === 'application/json') {
                            resolve(JSON.parse(body));
                        } else if (contentType === 'application/x-www-form-urlencoded') {
                            resolve(querystring.parse(body));
                        } else {
                            resolve(body); // Handle other content types or plain text
                        }
                    } catch (error) {
                        reject(error);
                    }
                });
            } else {
                resolve(null);
            }
        });
    }

    public start() {
        this.server.listen(this.port, () => {
            console.log(`Mock server is running on http://localhost:${this.port}`);
        });
    }

    public stop() {
        this.server.close(() => {
            console.log('Mock server stopped');
        });
    }

    // public mockFunc(url: string, method: string, )

    public mock(url: string, method: string, response: any, statusCode: number = 200, contentType: string = 'application/json') {
        this.mockData[url] = {method, response, statusCode, contentType};
        console.log(`Mocked ${method} ${url} with status ${statusCode} and content type ${contentType}`);
    }

    public mockFunc(route: string, method: string, callback: (url: url.UrlWithParsedQuery, headers: IncomingHttpHeaders) => any) {
        const routeKey = `${method}:${route}`;
        this.routes.set(routeKey, {method, callback});
    }

    public expectURLToBeCalled(url: string, method: string = 'GET', expectedParams?: Record<string, any>, expectedBody?: any) {
        const call = this.calledUrls.find(
            (entry) => entry.url === url && entry.method === method
        );

        if (!call) {
            throw new Error(`Expected ${method} ${url} to be called, but it was not.`);
        }

        // Verify query parameters
        if (expectedParams) {
            for (const [key, value] of Object.entries(expectedParams)) {
                if (call.params?.[key] !== value) {
                    throw new Error(`Expected parameter ${key}=${value} but got ${call.params?.[key]}`);
                }
            }
        }

        // Verify body
        if (expectedBody) {
            if (JSON.stringify(call.body) !== JSON.stringify(expectedBody)) {
                throw new Error(`Expected body ${JSON.stringify(expectedBody)} but got ${JSON.stringify(call.body)}`);
            }
        }

        console.log(`URL ${method} ${url} was successfully called with expected parameters and body.`);
    }

    public resetMocks() {
        this.mockData = {};
        this.calledUrls = [];
        console.log("All mock rules and call history have been reset.");
    }
}