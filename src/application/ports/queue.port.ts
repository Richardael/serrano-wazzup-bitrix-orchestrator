export interface QueuePort {
  enqueue<T extends Record<string, unknown>>(queueName: string, payload: T, options?: QueueEnqueueOptions): Promise<string>;
  dequeue<T extends Record<string, unknown>>(queueName: string, batchSize?: number): Promise<QueueJob<T>[]>;
  complete(jobId: string): Promise<void>;
  fail(jobId: string, error: string): Promise<void>;
  retry(jobId: string, delayMs: number): Promise<void>;
}

export interface QueueEnqueueOptions {
  readonly delayUntil?: Date;
  readonly priority?: number;
  readonly maxAttempts?: number;
}

export interface QueueJob<T extends Record<string, unknown>> {
  readonly id: string;
  readonly eventId: string;
  readonly jobType: string;
  readonly payload: T;
  readonly attempts: number;
  readonly createdAt: Date;
}
