import { ErrorClassification } from './types.js';

// 429 and 5xx are retryable; 4xx means bad request or credentials so fail immediately
export function classifyError(statusCode?: number, error?: Error): ErrorClassification {
  if (statusCode !== undefined) {
    if (statusCode === 429 || (statusCode >= 500 && statusCode <= 599)) {
      return 'TRANSIENT';
    }
    if (statusCode >= 400 && statusCode < 500) {
      return 'FATAL';
    }
  }

  // Network drops and timeouts are transient
  if (error) {
    const msg = error.message.toLowerCase();
    const isNetworkDrop =
      error.name === 'AbortError' ||
      msg.includes('timeout') ||
      msg.includes('econnrefused') ||
      msg.includes('econnreset') ||
      msg.includes('fetch failed');

    if (isNetworkDrop) return 'TRANSIENT';
  }

  return 'TRANSIENT';
}
