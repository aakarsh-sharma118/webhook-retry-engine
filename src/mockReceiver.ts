import http from 'http';

// Local HTTP test server simulating healthy, flaky, fatal, and rate-limited endpoints
export function createMockReceiver(port = 4000) {
  let server: http.Server | null = null;
  let flakyCounter = 0;

  function start(): Promise<string> {
    return new Promise((resolve) => {
      server = http.createServer((req, res) => {
        const url = req.url || '';

        if (url === '/webhook/success') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'delivered', receivedAt: new Date().toISOString() }));
          return;
        }

        // Fails twice with 503, succeeds on attempt 3
        if (url === '/webhook/flaky') {
          flakyCounter++;
          if (flakyCounter <= 2) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Service temporarily overloaded', attempt: flakyCounter }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'recovered_and_delivered', attempt: flakyCounter }));
          }
          return;
        }

        if (url === '/webhook/fatal') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unrecognized event schema structure' }));
          return;
        }

        if (url === '/webhook/rate-limited') {
          res.writeHead(429, {
            'Content-Type': 'application/json',
            'Retry-After': '1',
          });
          res.end(JSON.stringify({ error: 'Too Many Requests' }));
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Endpoint not found' }));
      });

      server.listen(port, () => {
        resolve(`http://localhost:${port}`);
      });
    });
  }

  return {
    start,
    stop: () => new Promise<void>((res) => (server ? server.close(() => res()) : res())),
    resetFlakyCounter: () => { flakyCounter = 0; },
  };
}

// Run standalone mock server: npm run server
if (process.argv[1]?.includes('mockReceiver')) {
  const receiver = createMockReceiver(4000);
  receiver.start().then((url) => {
    console.log(`Mock receiver listening at ${url} (press Ctrl+C to stop)`);
  });
}
