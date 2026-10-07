import { IncidentEvent, EngineConfig, DispatchResult, FetchFn } from './types.js';

// Sends HTTP POST with AbortController timeout and Idempotency-Key headers
export async function dispatchWebhook(
  targetUrl: string,
  event: IncidentEvent,
  attemptNumber: number,
  config: EngineConfig,
  fetchFn: FetchFn = globalThis.fetch
): Promise<DispatchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  const start = performance.now();

  try {
    const res = await fetchFn(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': event.eventId,
        'X-Attempt-Number': String(attemptNumber),
        'X-Event-Type': event.type,
      },
      body: JSON.stringify(event),
      signal: controller.signal,
    });

    clearTimeout(timer);
    return {
      ok: res.ok,
      statusCode: res.status,
      durationMs: Math.round(performance.now() - start),
      retryAfterHeader: res.headers.get('retry-after'),
    };
  } catch (err: any) {
    clearTimeout(timer);
    const durationMs = Math.round(performance.now() - start);
    const error =
      err.name === 'AbortError'
        ? new Error(`Delivery timed out after ${config.requestTimeoutMs}ms`)
        : err;

    return { ok: false, durationMs, error };
  }
}

export function createDispatcher(fetchFn: FetchFn = globalThis.fetch) {
  return {
    dispatch: (targetUrl: string, event: IncidentEvent, attempt: number, config: EngineConfig) =>
      dispatchWebhook(targetUrl, event, attempt, config, fetchFn),
  };
}

export const createWebhookDispatcher = createDispatcher;
