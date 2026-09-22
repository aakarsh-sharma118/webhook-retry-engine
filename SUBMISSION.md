# Product Engineering Challenge Submission

## Candidate

- **Name:** Aakarsh Sharma
- **Email:** sharmaaakarsh2@gmail.com
- **GitHub:** https://github.com/aakarsh-sharma118/webhook-retry-engine
- **Selected problem:** Problem 2: Webhook Retry Engine
- **Demo video:** https://www.loom.com/share/063a7e61e8484909b43b7a16db624c36

---

## Run the project

### Prerequisites
- Node.js (v20+ or v22+)
- npm (v10+ or v11+)
- No databases or external services needed.

### Setup & Run Commands:
```bash
# 1. Install dependencies
npm install

# 2. Run the test suite
npm run test

# 3. Run the interactive demo
npm start
```

### How to Verify the Scenarios:
- **Scenario 1 (Normal Delivery):** Run `npm start` (sends to `/webhook/success` and delivers on attempt 1 with HTTP 200).
- **Scenario 2 (Deduplication):** Run `npm start` (sends the same `eventId` again; returns the saved job with 0 duplicate HTTP calls).
- **Scenario 3 (Temporary Failure & Recovery):** Run `npm start` (targets `/webhook/flaky`, fails twice with 503, and succeeds on attempt 3).
- **Scenario 4 (Fatal Error):** Run `npm start` (targets `/webhook/fatal`, gets a 400 Bad Request, and stops immediately without retrying).
- **Scenario 5 (Audit History):** Run `npm start` (prints the attempt history for all 3 events with timestamps and durations).

---

## Run the tests

```bash
# Runs the full Vitest suite
npm run test
```

All 6 tests run against fast in-memory mocks and complete in under 20ms without arbitrary sleep delays.

---

## Architecture and data flow

When an event comes in, the engine first checks if we have already saved this `eventId`. If we have, it returns the existing job right away without making a new network call. 

If it is new, it saves the event as `PENDING` and makes an HTTP POST request with an `Idempotency-Key` header and a 2-second timeout.

- If the endpoint returns 200 OK, the job is marked `SUCCESS`.
- If it returns a permanent client error (like 400 Bad Request or 404), it stops immediately as `FAILED_TERMINAL` so we do not waste retries.
- If it gets a temporary error (like 503, 429 rate limit, or network drop), it schedules a retry using exponential backoff with jitter until reaching the retry limit.

### Main Components
1. **`createWebhookEngine` (`src/engine.ts`)**: The main engine coordinating state, deduplication, and retries.
2. **`createJobRepository` (`src/storage.ts`)**: In-memory storage using `structuredClone` so state cannot be mutated by outside code, plus simple in-flight locks.
3. **`dispatchWebhook` (`src/dispatcher.ts`)**: Sends the fetch request with an `Idempotency-Key` header and an `AbortController` timeout guard (2 seconds).
4. **`classifyError` (`src/classifier.ts`)**: Decides if an error is temporary (`TRANSIENT`) or a permanent client bug (`FATAL`).
5. **`calculateBackoff` & `parseRetryAfter` (`src/backoff.ts`)**: Calculates randomized jitter delay and reads `Retry-After` headers on 429 responses.
6. **`createMockReceiver` (`src/mockReceiver.ts`)**: Local test server running on port 4000 to simulate 200 success, 503 flaky, 400 fatal, and rate-limited endpoints.

---

## Technology choices

- **TypeScript**: Catches type mismatches early for events, delivery records, and configs.
- **Node.js Native Fetch & AbortController**: Keeps the project clean without needing extra HTTP libraries like Axios, with built-in per-request timeouts.
- **Vitest**: Fast and lightweight test runner that runs TypeScript tests directly without slow compile steps.
- **In-Memory Storage with an Interface (`IJobRepository`)**: Lets reviewers clone and test the app in 30 seconds without needing Docker or databases. In production, this can be swapped with a database adapter.

---

## Important decisions

1. **Failing fast on 4xx errors**:
   Retrying every error is wasteful. If an endpoint returns 400 Bad Request or 404 Not Found, sending it again will just fail again. We stop immediately on 4xx errors and only retry temporary 5xx errors and rate limits.
2. **Adding jitter to backoff**:
   If a server reboots, multiple retrying jobs can wake up at the exact same second and overwhelm it again. Adding random jitter spreads out the retries so they do not hit at the same time.
3. **Reading Retry-After headers**:
   When an API returns 429 Too Many Requests with a `Retry-After` header, we pause for that exact duration instead of guessing.

---

## Assumptions and limitations

- **At-Least-Once Delivery**: Over the internet, network drops happen. If the receiver gets the webhook but the response drops on the way back, we will retry. Receivers should use the `Idempotency-Key` header to avoid processing duplicates.
- **In-Memory Storage**: Jobs are stored in memory for this prototype, so restarting the process resets the state.
- **Single Endpoint**: Built to deliver to one destination URL at a time.

---

## Production and scale

### What could still cause a receiver to see a duplicate delivery?
1. The receiver processes the request, but the network connection drops before the 200 OK reaches our engine.
2. The receiver takes slightly longer than our 2-second timeout, so our engine retries while the receiver finishes in the background.  
*Fix*: The receiver should store the `Idempotency-Key` in a database with a unique constraint.

### Running with many background workers:
- Use a distributed queue like Redis Streams or RabbitMQ so workers do not step on each other.
- Use simple lease locks so if a worker crashes midway, another worker can pick up the job safely.

### Preventing one failing endpoint from slowing down the whole system:
- Add a circuit breaker to temporarily stop sending to an endpoint if it keeps returning 500s.
- Keep per-request timeouts short (like our 2-second limit) so stuck connections do not hold up server resources.

### Monitoring & Alerts:
- Track average delivery times, retry counts, and alert the team if too many jobs are failing terminally.

---

## AI usage

I used Gemini during this project for:
- Drafting and formatting documentation files (`README.md` and `SUBMISSION.md`).
- Debugging syntax and mock typing issues in the Vitest test suite.

All core application architecture, state machine logic, retry algorithms, and delivery guarantees were designed, implemented, and validated directly by me.

---

## Credibility note

- **Product**: Enterprise E-Commerce Platforms (TruckPro LLC & CCC Parts at Saksoft)
- **Problem Solved**: High-volume US retail storefronts for commercial truck parts where customers needed reliable checkout, order history, and invoice receipt downloads.
- **Personal Contribution**:
  - Built a Node.js microservice using Puppeteer inside Docker to generate invoice and order receipt PDFs:
    - Opened a page, took a screenshot of the order view, converted it to Base64 to inject into our custom invoice HTML template, and exported the PDF.
    - Used temporary folders to handle image assets and made sure files were deleted after generation.
    - Added `try/finally` blocks to always call `page.close()` and `browser.close()` so background Chrome processes would not stay open and leak memory.
  - Helped with our Node.js runtime upgrade across services, fixing deprecated packages and improving performance.
  - Built reusable frontend components and backend API routes with standard validation and error handling.
- **Difficult Engineering Decision**:
  - Managing memory in Puppeteer: In the beginning, opening a new Chrome browser for every single PDF request was using too much RAM and crashing the Docker container during busy hours. I fixed this by keeping the browser cleanup strict: ensuring pages and temporary screenshot files in `/tmp` were always destroyed in `finally` blocks, and recycling the browser after batches of requests. This stopped container crashes and kept memory usage steady.
