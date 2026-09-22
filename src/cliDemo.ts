import { createWebhookEngine, createMockReceiver } from './index.js';
import type { IncidentEvent } from './index.js';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runDemo() {
  console.log('===============================================================');
  console.log('                 WEBHOOK RETRY ENGINE DEMO                     ');
  console.log('===============================================================\n');

  const receiver = createMockReceiver(4000);
  const baseUrl = await receiver.start();
  console.log(`[RECEIVER] Listening at ${baseUrl}\n`);

  const engine = createWebhookEngine({
    config: {
      maxRetries: 3,
      baseBackoffMs: 100,
      maxBackoffMs: 1000,
      requestTimeoutMs: 2000,
    },
  });

  // Scenario 1: Immediate Successful Delivery
  console.log('---------------------------------------------------------------');
  console.log('Scenario 1: Immediate Successful Delivery');
  console.log('---------------------------------------------------------------');
  const event1: IncidentEvent = {
    eventId: 'evt_alpha_101',
    type: 'incident.created',
    occurredAt: new Date().toISOString(),
    payload: { incidentId: 'inc_901', severity: 'high', title: 'High memory usage' },
  };

  const { job: job1 } = await engine.submitEvent(event1, `${baseUrl}/webhook/success`);
  console.log(`Event ID:        ${job1.eventId}`);
  console.log(`Final Status:    ${job1.status}`);
  console.log(`Attempts Made:   ${job1.attempts.length}`);
  console.log(`HTTP Status:     ${job1.attempts[0].statusCode}`);
  console.log(`Duration:        ${job1.attempts[0].durationMs}ms\n`);

  // Scenario 2: Idempotent Ingestion
  console.log('---------------------------------------------------------------');
  console.log('Scenario 2: Idempotent Deduplication (Same Event ID)');
  console.log('---------------------------------------------------------------');
  console.log(`Resubmitting identical eventId: "${event1.eventId}"...`);
  const { job: dupJob, isDuplicate } = await engine.submitEvent(event1, `${baseUrl}/webhook/success`);
  console.log(`Is Duplicate:    ${isDuplicate}`);
  console.log(`Current Status:  ${dupJob.status}`);
  console.log(`Total Attempts:  ${dupJob.attempts.length} (no second delivery scheduled)\n`);

  // Scenario 3: Transient Failure & Recovery
  console.log('---------------------------------------------------------------');
  console.log('Scenario 3: Transient 503 Failure & Retry Recovery');
  console.log('---------------------------------------------------------------');
  const event2: IncidentEvent = {
    eventId: 'evt_beta_202',
    type: 'incident.escalated',
    occurredAt: new Date().toISOString(),
    payload: { incidentId: 'inc_902', severity: 'critical' },
  };

  console.log('Submitting event to temporary failing endpoint...');
  let { job: job2 } = await engine.submitEvent(event2, `${baseUrl}/webhook/flaky`);
  console.log(`Attempt 1 Result: HTTP ${job2.attempts[0].statusCode} (${job2.status})`);
  console.log(`Next Retry Time:  ${job2.nextRetryAt}`);

  while (job2.status === 'RETRY_SCHEDULED') {
    console.log('Waiting for backoff window...');
    await wait(200);
    job2 = await engine.retryJob(job2.eventId);
    const last = job2.attempts[job2.attempts.length - 1];
    console.log(`Attempt ${last.attemptNumber} Result: HTTP ${last.statusCode} (${job2.status})`);
  }
  console.log(`Final Status:     ${job2.status}\n`);

  // Scenario 4: Non-Retryable Fatal Client Error
  console.log('---------------------------------------------------------------');
  console.log('Scenario 4: Non-Retryable Fatal Error (HTTP 400)');
  console.log('---------------------------------------------------------------');
  const event3: IncidentEvent = {
    eventId: 'evt_gamma_303',
    type: 'incident.resolved',
    occurredAt: new Date().toISOString(),
    payload: { incidentId: 'inc_903' },
  };

  console.log('Submitting event to endpoint that returns 400 Bad Request...');
  const { job: job3 } = await engine.submitEvent(event3, `${baseUrl}/webhook/fatal`);
  console.log(`Final Status:    ${job3.status}`);
  console.log(`Terminal Reason: ${job3.terminalReason}`);
  console.log(`Attempts Made:   ${job3.attempts.length} (stopped immediately without retrying)\n`);

  // Scenario 5: Inspectable Audit History
  console.log('---------------------------------------------------------------');
  console.log('Scenario 5: Inspectable Audit History (All Events)');
  console.log('---------------------------------------------------------------');
  const allJobs = await engine.listJobs();
  console.log(`Total Tracked Events: ${allJobs.length}\n`);

  for (const job of allJobs) {
    console.log(`Event [${job.eventId}] - Status: ${job.status}`);
    job.attempts.forEach((att) => {
      console.log(
        `  Attempt #${att.attemptNumber} at ${att.timestamp} -> HTTP ${att.statusCode || 'Timeout'} (${att.durationMs}ms)`
      );
    });
    if (job.terminalReason) {
      console.log(`  Reason: ${job.terminalReason}`);
    }
    console.log('');
  }

  if (process.argv.includes('--keep-alive')) {
    console.log(`[RECEIVER] Server kept alive at ${baseUrl} (press Ctrl+C to stop)...`);
  } else {
    await receiver.stop();
    console.log('Receiver stopped. Demo finished.');
  }
}

runDemo().catch((err) => {
  console.error('Demo encountered an error:', err);
  process.exit(1);
});
