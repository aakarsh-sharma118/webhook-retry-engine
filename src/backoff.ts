import { EngineConfig } from './types.js';

// Full Jitter: spreads retries randomly across the backoff window to avoid traffic spikes
export function calculateBackoff(attempt: number, config: EngineConfig): number {
  const maxDelay = Math.min(config.maxBackoffMs, config.baseBackoffMs * (2 ** attempt));
  return Math.floor(Math.random() * maxDelay);
}

// Parses standard Retry-After header (supports both integer seconds and HTTP dates)
export function parseRetryAfter(headerValue: string | null | undefined): number | null {
  if (!headerValue) return null;

  const seconds = parseInt(headerValue, 10);
  if (!isNaN(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const epoch = Date.parse(headerValue);
  if (!isNaN(epoch)) {
    return Math.max(0, epoch - Date.now());
  }

  return null;
}
