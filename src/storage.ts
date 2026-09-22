import { WebhookJob, IJobRepository } from './types.js';

// In-memory store using closures; structuredClone protects against outside mutation
export function createJobRepository(): IJobRepository {
  const jobs = new Map<string, WebhookJob>();
  const inFlight = new Set<string>();

  const repo: IJobRepository = {
    async save(job: WebhookJob): Promise<void> {
      jobs.set(job.eventId, structuredClone(job));
    },

    async findByEventId(eventId: string): Promise<WebhookJob | null> {
      const job = jobs.get(eventId);
      return job ? structuredClone(job) : null;
    },

    async getAll(): Promise<WebhookJob[]> {
      return Array.from(jobs.values()).map((j) => structuredClone(j));
    },

    // In-flight lock stops concurrent workers from processing the same event twice
    acquireLock(eventId: string): boolean {
      if (inFlight.has(eventId)) return false;
      inFlight.add(eventId);
      return true;
    },

    releaseLock(eventId: string): void {
      inFlight.delete(eventId);
    },

    async clear(): Promise<void> {
      jobs.clear();
      inFlight.clear();
    },

    acquireInFlightLock(eventId: string): boolean {
      return this.acquireLock(eventId);
    },

    releaseInFlightLock(eventId: string): void {
      this.releaseLock(eventId);
    },
  };

  return repo;
}

export const createInMemoryJobRepository = createJobRepository;
