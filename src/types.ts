export type DeliveryStatus = 
  | 'PENDING' 
  | 'IN_FLIGHT' 
  | 'SUCCESS' 
  | 'RETRY_SCHEDULED' 
  | 'FAILED_TERMINAL';

// TRANSIENT = safe to retry (5xx, timeouts, 429). FATAL = permanent client error (400, 401, 404).
export type ErrorClassification = 'TRANSIENT' | 'FATAL';

export interface IncidentEvent {
  eventId: string;
  type: string;
  occurredAt: string;
  payload: Record<string, any>;
}

export interface DeliveryAttempt {
  attemptNumber: number;
  timestamp: string;
  statusCode?: number;
  durationMs: number;
  error?: string;
  classification?: ErrorClassification;
}

export interface WebhookJob {
  eventId: string;
  event: IncidentEvent;
  targetUrl: string;
  status: DeliveryStatus;
  attempts: DeliveryAttempt[];
  createdAt: string;
  updatedAt: string;
  nextRetryAt?: string;
  terminalReason?: string;
}

export interface EngineConfig {
  maxRetries: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  requestTimeoutMs: number;
}

export const DEFAULT_CONFIG: EngineConfig = {
  maxRetries: 3,
  baseBackoffMs: 200,
  maxBackoffMs: 5000,
  requestTimeoutMs: 2000,
};

export const DEFAULT_ENGINE_CONFIG = DEFAULT_CONFIG;

// Repository interface for job persistence and in-flight mutex locking
export interface IJobRepository {
  save(job: WebhookJob): Promise<void>;
  findByEventId(eventId: string): Promise<WebhookJob | null>;
  getAll(): Promise<WebhookJob[]>;
  acquireLock(eventId: string): boolean;
  releaseLock(eventId: string): void;
  clear(): Promise<void>;
  acquireInFlightLock?(eventId: string): boolean;
  releaseInFlightLock?(eventId: string): void;
}

// Result summary of an outbound HTTP delivery attempt
export interface DispatchResult {
  ok: boolean;
  statusCode?: number;
  durationMs: number;
  retryAfterHeader?: string | null;
  error?: Error;
}

// Signature for injectable fetch implementations in tests
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

// Configuration options passed to createWebhookEngine
export interface EngineOptions {
  repository?: IJobRepository;
  dispatcher?: { dispatch: (targetUrl: string, event: IncidentEvent, attempt: number, config: EngineConfig) => Promise<DispatchResult> };
  config?: Partial<EngineConfig>;
}
