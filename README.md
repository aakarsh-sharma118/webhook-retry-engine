# Webhook Retry Engine

A simple, reliable webhook retry engine built in TypeScript for the **Caygnus Product Engineering Challenge (Problem 2)**.

For full technical details, design decisions, and candidate information, please see **[SUBMISSION.md](SUBMISSION.md)**.

---

## Setup and Run Instructions

### Prerequisites
- Node.js (v20+ or v22+)
- npm

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Automated Tests
```bash
npm run test
```
Runs 6 automated tests using Vitest covering successful delivery, retry with backoff, deduplication, fatal errors, budget exhaustion, and rate limits.

### 3. Run the Live Demo
```bash
npm start
```
Starts a local mock server on port 4000 and runs through the 5 delivery scenarios:
- **Scenario 1 (Normal Delivery):** Immediate successful delivery (HTTP 200).
- **Scenario 2 (Deduplication):** Resubmitting the same event ID makes 0 extra network calls.
- **Scenario 3 (Temporary Failure & Recovery):** Fails twice with 503, then recovers on attempt 3.
- **Scenario 4 (Fatal Error):** Stops immediately on 400 Bad Request without wasting retries.
- **Scenario 5 (Audit History):** Prints attempt history for all 3 events with timestamps and durations.
