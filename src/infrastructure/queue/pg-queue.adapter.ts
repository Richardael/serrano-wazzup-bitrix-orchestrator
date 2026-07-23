import { Injectable, Logger } from "@nestjs/common";
import { eq, and, lte, sql } from "drizzle-orm";
import { drizzle, PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { v4 as uuid } from "uuid";
import { AppConfig } from "../config/app.config";
import * as schema from "../database/schema";
import { QueuePort, QueueEnqueueOptions, QueueJob } from "../../application/ports/queue.port";

const WORKER_ID = `worker-${process.pid}-${Date.now()}`;
const LOCK_TIMEOUT_MS = 300_000;

@Injectable()
export class PgQueueAdapter implements QueuePort {
  private readonly logger = new Logger(PgQueueAdapter.name);
  private db: PostgresJsDatabase<typeof schema>;

  constructor(config: AppConfig) {
    const client = postgres(config.env.DATABASE_URL);
    this.db = drizzle(client, { schema });
  }

  async enqueue<T extends Record<string, unknown>>(
    _queueName: string,
    payload: T,
    options?: QueueEnqueueOptions,
  ): Promise<string> {
    const id = uuid();
    await this.db.insert(schema.processingJobs).values({
      id,
      eventId: (payload as Record<string, string>)["eventId"] ?? uuid(),
      jobType: _queueName,
      payload: payload as unknown as Record<string, unknown>,
      status: "PENDING",
      priority: options?.priority ?? 0,
      attempts: 0,
      maxAttempts: options?.maxAttempts ?? 5,
      runAfter: options?.delayUntil ?? new Date(),
      createdAt: new Date(),
    });

    return id;
  }

  async dequeue<T extends Record<string, unknown>>(
    _queueName: string,
    batchSize: number = 1,
  ): Promise<QueueJob<T>[]> {
    const now = new Date();
    const lockExpiry = new Date(now.getTime() - LOCK_TIMEOUT_MS);

    const result = await this.db.transaction(async (tx) => {
      const jobs = await tx
        .select()
        .from(schema.processingJobs)
        .where(
          and(
            eq(schema.processingJobs.jobType, _queueName),
            eq(schema.processingJobs.status, "PENDING"),
            lte(schema.processingJobs.runAfter, now),
            sql`(
              ${schema.processingJobs.lockedAt} IS NULL
              OR ${schema.processingJobs.lockedAt} < ${lockExpiry.toISOString()}
            )`,
          ),
        )
        .orderBy(schema.processingJobs.priority, schema.processingJobs.createdAt)
        .limit(batchSize)
        .for("update", { skipLocked: true });

      if (jobs.length === 0) return [];

      const ids = jobs.map((j) => j.id);

      await tx
        .update(schema.processingJobs)
        .set({ status: "PROCESSING", lockedAt: now, lockedBy: WORKER_ID, attempts: sql`attempts + 1` })
        .where(sql`${schema.processingJobs.id} IN (${ids.map((id) => `'${id}'`).join(",")})`);

      return jobs;
    });

    return result.map(
      (j): QueueJob<T> => ({
        id: j.id,
        eventId: j.eventId,
        jobType: j.jobType,
        payload: j.payload as T,
        attempts: j.attempts + 1,
        createdAt: j.createdAt,
      }),
    );
  }

  async complete(jobId: string): Promise<void> {
    await this.db
      .update(schema.processingJobs)
      .set({ status: "COMPLETED", completedAt: new Date() })
      .where(eq(schema.processingJobs.id, jobId));
  }

  async fail(jobId: string, error: string): Promise<void> {
    await this.db
      .update(schema.processingJobs)
      .set({ status: "FAILED", errorMessage: error, completedAt: new Date() })
      .where(eq(schema.processingJobs.id, jobId));
  }

  async retry(jobId: string, delayMs: number): Promise<void> {
    await this.db
      .update(schema.processingJobs)
      .set({
        status: "PENDING",
        runAfter: new Date(Date.now() + delayMs),
        lockedAt: null,
        lockedBy: null,
      })
      .where(eq(schema.processingJobs.id, jobId));
  }
}
