import { Injectable } from "@nestjs/common";
import { eq, and, desc, sql, gte } from "drizzle-orm";
import { drizzle, PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { AppConfig } from "../../config/app.config";
import * as schema from "../schema";
import { EventRepository } from "../../../application/ports/event-repository.port";
import { IntegrationEvent, EventStatus } from "../../../domain/events/integration-event";

@Injectable()
export class PgEventRepository implements EventRepository {
  private db: PostgresJsDatabase<typeof schema>;

  constructor(config: AppConfig) {
    const client = postgres(config.env.DATABASE_URL);
    this.db = drizzle(client, { schema });
  }

  async findByProviderEventId(provider: string, providerEventId: string): Promise<IntegrationEvent | null> {
    if (!providerEventId) return null;

    const rows = await this.db
      .select()
      .from(schema.integrationEvents)
      .where(
        and(
          eq(schema.integrationEvents.provider, provider),
          eq(schema.integrationEvents.providerEventId, providerEventId),
        ),
      )
      .limit(1);

    return rows[0] ? this.toDomain(rows[0]) : null;
  }

  async findByPayloadHash(provider: string, payloadHash: string, since: Date): Promise<IntegrationEvent | null> {
    const rows = await this.db
      .select()
      .from(schema.integrationEvents)
      .where(
        and(
          eq(schema.integrationEvents.provider, provider),
          eq(schema.integrationEvents.payloadHash, payloadHash),
          gte(schema.integrationEvents.receivedAt, since),
        ),
      )
      .orderBy(desc(schema.integrationEvents.receivedAt))
      .limit(1);

    return rows[0] ? this.toDomain(rows[0]) : null;
  }

  async create(event: Omit<IntegrationEvent, "id" | "createdAt">): Promise<IntegrationEvent> {
    const [row] = await this.db
      .insert(schema.integrationEvents)
      .values({
        provider: event.provider,
        providerEventId: event.providerEventId,
        eventType: event.eventType,
        payloadHash: event.payloadHash,
        sanitizedPayload: event.sanitizedPayload,
        status: event.status,
        attempts: event.attempts,
        correlationId: event.correlationId,
        receivedAt: event.receivedAt,
        processingStartedAt: event.processingStartedAt,
        processedAt: event.processedAt,
        nextRetryAt: event.nextRetryAt,
        errorCode: event.errorCode,
        errorMessage: event.errorMessage,
      })
      .returning();

    if (!row) throw new Error("Failed to create integration event");
    return this.toDomain(row);
  }

  async updateStatus(
    id: string,
    status: EventStatus,
    errorCode?: string,
    errorMessage?: string,
  ): Promise<void> {
    const updates: Record<string, unknown> = { status };
    if (errorCode !== undefined) updates["errorCode"] = errorCode;
    if (errorMessage !== undefined) updates["errorMessage"] = errorMessage;
    if (status === "COMPLETED") updates["processedAt"] = new Date();
    if (status === "PROCESSING") updates["processingStartedAt"] = new Date();

    await this.db
      .update(schema.integrationEvents)
      .set(updates as Record<string, unknown>)
      .where(eq(schema.integrationEvents.id, id));
  }

  async incrementAttempts(id: string): Promise<void> {
    await this.db
      .update(schema.integrationEvents)
      .set({ attempts: sql`attempts + 1` })
      .where(eq(schema.integrationEvents.id, id));
  }

  private toDomain(row: typeof schema.integrationEvents.$inferSelect): IntegrationEvent {
    return {
      id: row.id,
      provider: row.provider,
      providerEventId: row.providerEventId,
      eventType: row.eventType,
      payloadHash: row.payloadHash,
      sanitizedPayload: row.sanitizedPayload as Record<string, unknown> | null,
      status: row.status as EventStatus,
      attempts: row.attempts,
      correlationId: row.correlationId,
      receivedAt: row.receivedAt,
      processingStartedAt: row.processingStartedAt,
      processedAt: row.processedAt,
      nextRetryAt: row.nextRetryAt,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
    };
  }
}
