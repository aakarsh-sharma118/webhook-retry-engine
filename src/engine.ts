import {
  IncidentEvent,
  WebhookJob,
  EngineConfig,
  DEFAULT_CONFIG,
  EngineOptions,
} from './types.js';
import { createJobRepository } from './storage.js';
import { createDispatcher } from './dispatcher.js';
import { classifyError } from './classifier.js';
import { calculateBackoff, parseRetryAfter } from './backoff.js';

// Orchestrator enforcing idempotent ingestion, exponential backoff, and DLQ routing
export function createWebhookEngine(options: EngineOptions = {}) {
  const repo = options.repository ?? createJobRepository();
  const dispatcher = options.dispatcher ?? createDispatcher();
  const config: EngineConfig = { ...DEFAULT_CONFIG, ...options.config };

  async function executeAttempt(job: WebhookJob): Promise<WebhookJob> {
    const attemptNumber = job.attempts.length + 1;
    job.status = 'IN_FLIGHT';
    job.updatedAt = new Date().toISOString();
    await repo.save(job);

    const result = await dispatcher.dispatch(job.targetUrl, job.event, attemptNumber, config);
    const now = new Date().toISOString();

    if (result.ok) {
      job.attempts.push({
        attemptNumber,
        timestamp: now,
        statusCode: result.statusCode,
        durationMs: result.durationMs,
      });
      job.status = 'SUCCESS';
      job.updatedAt = now;
      job.nextRetryAt = undefined;
      job.terminalReason = undefined;
      await repo.save(job);
      return job;
    }

    const classification = classifyError(result.statusCode, result.error);
    job.attempts.push({
      attemptNumber,
      timestamp: now,
      statusCode: result.statusCode,
      durationMs: result.durationMs,
      error: result.error?.message || `HTTP ${result.statusCode}`,
      classification,
    });
    job.updatedAt = now;

    // Fatal 4xx errors stop immediately without wasting retry attempts
    if (classification === 'FATAL') {
      job.status = 'FAILED_TERMINAL';
      job.terminalReason = `Fatal non-retryable response: HTTP ${result.statusCode}`;
      job.nextRetryAt = undefined;
      await repo.save(job);
      return job;
    }

    // Move to terminal state once retry budget is exhausted
    if (attemptNumber >= config.maxRetries) {
      job.status = 'FAILED_TERMINAL';
      job.terminalReason = `Exhausted maximum retry budget of ${config.maxRetries} attempts`;
      job.nextRetryAt = undefined;
      await repo.save(job);
      return job;
    }

    // Schedule next retry, respecting Retry-After header if present
    const retryAfterMs = parseRetryAfter(result.retryAfterHeader);
    const delayMs = retryAfterMs ?? calculateBackoff(attemptNumber, config);

    job.status = 'RETRY_SCHEDULED';
    job.nextRetryAt = new Date(Date.now() + delayMs).toISOString();
    await repo.save(job);
    return job;
  }

  async function submitEvent(
    event: IncidentEvent,
    targetUrl: string
  ): Promise<{ job: WebhookJob; isDuplicate: boolean }> {
    // Idempotency: return existing job if already ingested
    const existing = await repo.findByEventId(event.eventId);
    if (existing) {
      return { job: existing, isDuplicate: true };
    }

    // Lock to prevent simultaneous submissions with the same eventId
    const lockAcquired = repo.acquireLock(event.eventId);
    if (!lockAcquired) {
      const current = await repo.findByEventId(event.eventId);
      if (current) return { job: current, isDuplicate: true };
      throw new Error(`Concurrent collision for eventId: ${event.eventId}`);
    }

    try {
      const now = new Date().toISOString();
      const newJob: WebhookJob = {
        eventId: event.eventId,
        event,
        targetUrl,
        status: 'PENDING',
        attempts: [],
        createdAt: now,
        updatedAt: now,
      };

      await repo.save(newJob);
      const executed = await executeAttempt(newJob);
      return { job: executed, isDuplicate: false };
    } finally {
      repo.releaseLock(event.eventId);
    }
  }

  async function retryJob(eventId: string): Promise<WebhookJob> {
    const job = await repo.findByEventId(eventId);
    if (!job) throw new Error(`Job not found for eventId: ${eventId}`);
    if (job.status === 'SUCCESS' || job.status === 'FAILED_TERMINAL') return job;
    return executeAttempt(job);
  }

  return {
    submitEvent,
    executeAttempt,
    retryJob,
    getJob: (id: string) => repo.findByEventId(id),
    listJobs: () => repo.getAll(),
  };
}
