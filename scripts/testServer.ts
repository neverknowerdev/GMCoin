import { createServer, IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';

const port = 8022;

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    console.log('raw URL', req.url);
    if (req.url) {
        const parsedUrl = parse(req.url, true);
        console.log(`Received request: ${parsedUrl.path}`);
    } else {
        console.log('Received request with no URL');
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Hello, World!\n');
});

server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
});