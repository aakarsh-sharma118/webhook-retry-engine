import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWebhookEngine } from '../src/engine.js';
import { createJobRepository } from '../src/storage.js';
import { createDispatcher } from '../src/dispatcher.js';
import { IncidentEvent } from '../src/types.js';

describe('Webhook Retry Engine Tests', () => {
  let repo: ReturnType<typeof createJobRepository>;
  let mockFetch: any;

  const sampleEvent: IncidentEvent = {
    eventId: 'evt_test_001',
    type: 'incident.created',
    occurredAt: '2026-09-17T12:00:00Z',
    payload: { incidentId: 'inc_555', severity: 'high' },
  };

  const targetUrl = 'https://receiver.internal/webhooks';

  beforeEach(() => {
    repo = createJobRepository();
    mockFetch = vi.fn();
  });

  it('delivers an event successfully on a reachable endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
    });

    const dispatcher = createDispatcher(mockFetch);
    const engine = createWebhookEngine({ repository: repo, dispatcher });

    const { job, isDuplicate } = await engine.submitEvent(sampleEvent, targetUrl);

    expect(isDuplicate).toBe(false);
    expect(job.status).toBe('SUCCESS');
    expect(job.attempts.length).toBe(1);
    expect(job.attempts[0].statusCode).toBe(200);
    expect(job.attempts[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toBe(targetUrl);
    expect(callArgs[1].headers['Idempotency-Key']).toBe(sampleEvent.eventId);
    expect(callArgs[1].headers['X-Attempt-Number']).toBe('1');
  });

  it('records failed attempts, schedules retries, and succeeds after recovery', async () => {
    // Attempt 1: 503, Attempt 2: 503, Attempt 3: 200
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 503, headers: new Headers() })
      .mockResolvedValueOnce({ ok: false, status: 503, headers: new Headers() })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers() });

    const dispatcher = createDispatcher(mockFetch);
    const engine = createWebhookEngine({
      repository: repo,
      dispatcher,
      config: {
        maxRetries: 3,
        baseBackoffMs: 10,
        maxBackoffMs: 50,
      },
    });

    let { job } = await engine.submitEvent(sampleEvent, targetUrl);
    expect(job.status).toBe('RETRY_SCHEDULED');
    expect(job.attempts.length).toBe(1);
    expect(job.attempts[0].statusCode).toBe(503);
    expect(job.nextRetryAt).toBeDefined();

    job = await engine.retryJob(sampleEvent.eventId);
    expect(job.status).toBe('RETRY_SCHEDULED');
    expect(job.attempts.length).toBe(2);
    expect(job.attempts[1].statusCode).toBe(503);

    job = await engine.retryJob(sampleEvent.eventId);
    expect(job.status).toBe('SUCCESS');
    expect(job.attempts.length).toBe(3);
    expect(job.attempts[2].statusCode).toBe(200);
    expect(job.nextRetryAt).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('stops retrying when the maximum attempt budget is reached', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, headers: new Headers() });

    const dispatcher = createDispatcher(mockFetch);
    const engine = createWebhookEngine({
      repository: repo,
      dispatcher,
      config: {
        maxRetries: 3,
        baseBackoffMs: 10,
      },
    });

    let { job } = await engine.submitEvent(sampleEvent, targetUrl);
    expect(job.status).toBe('RETRY_SCHEDULED');

    job = await engine.retryJob(sampleEvent.eventId);
    expect(job.status).toBe('RETRY_SCHEDULED');

    job = await engine.retryJob(sampleEvent.eventId);
    expect(job.status).toBe('FAILED_TERMINAL');
    expect(job.attempts.length).toBe(3);
    expect(job.terminalReason).toContain('Exhausted maximum retry budget');

    const terminalJob = await engine.retryJob(sampleEvent.eventId);
    expect(terminalJob.attempts.length).toBe(3);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('treats repeated submissions with the same event ID idempotently', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers() });

    const dispatcher = createDispatcher(mockFetch);
    const engine = createWebhookEngine({ repository: repo, dispatcher });

    const firstSubmit = await engine.submitEvent(sampleEvent, targetUrl);
    expect(firstSubmit.isDuplicate).toBe(false);
    expect(firstSubmit.job.status).toBe('SUCCESS');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const secondSubmit = await engine.submitEvent(sampleEvent, targetUrl);
    expect(secondSubmit.isDuplicate).toBe(true);
    expect(secondSubmit.job.eventId).toBe(sampleEvent.eventId);
    expect(secondSubmit.job.attempts.length).toBe(1);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('marks fatal 400 client errors as terminal without retrying', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      headers: new Headers(),
    });

    const dispatcher = createDispatcher(mockFetch);
    const engine = createWebhookEngine({ repository: repo, dispatcher });

    const { job } = await engine.submitEvent(sampleEvent, targetUrl);

    expect(job.status).toBe('FAILED_TERMINAL');
    expect(job.attempts.length).toBe(1);
    expect(job.attempts[0].classification).toBe('FATAL');
    expect(job.attempts[0].statusCode).toBe(400);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const history = await engine.getJob(sampleEvent.eventId);
    expect(history).not.toBeNull();
    expect(history?.attempts[0].statusCode).toBe(400);
  });

  it('honors the Retry-After header from 429 responses', async () => {
    const headers = new Headers();
    headers.set('retry-after', '2');

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers,
    });

    const dispatcher = createDispatcher(mockFetch);
    const engine = createWebhookEngine({ repository: repo, dispatcher });

    const before = Date.now();
    const { job } = await engine.submitEvent(sampleEvent, targetUrl);

    expect(job.status).toBe('RETRY_SCHEDULED');
    expect(job.nextRetryAt).toBeDefined();

    const scheduledTime = new Date(job.nextRetryAt!).getTime();
    const delay = scheduledTime - before;
    expect(delay).toBeGreaterThanOrEqual(1800);
    expect(delay).toBeLessThanOrEqual(2500);
  });
});
