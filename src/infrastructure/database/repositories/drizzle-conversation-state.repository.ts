import { Injectable } from "@nestjs/common";
import { eq, and, sql, lt } from "drizzle-orm";
import { drizzle, PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { AppConfig } from "../../config/app.config";
import * as schema from "../../database/schema";
import { ConversationStatePort } from "../../../application/ports/conversation-state.port";
import {
  ConversationState,
  ConversationFacts,
  DEFAULT_FACTS,
} from "../../../domain/catalog/conversation-state.entity";

@Injectable()
export class DrizzleConversationStateRepository implements ConversationStatePort {
  private db: PostgresJsDatabase<typeof schema>;

  constructor(config: AppConfig) {
    const client = postgres(config.env.DATABASE_URL);
    this.db = drizzle(client, { schema });
  }

  async findByChatId(chatId: string): Promise<ConversationState | null> {
    const rows = await this.db
      .select()
      .from(schema.conversationStates)
      .where(eq(schema.conversationStates.chatId, chatId))
      .limit(1);

    if (!rows[0]) return null;
    return this.toDomain(rows[0]);
  }

  async upsert(state: {
    chatId: string;
    normalizedPhone: string;
    leadId?: string | null;
    assignedVendorId?: number | null;
    stage?: string;
    lastIntent?: string | null;
    summary?: string;
    facts?: ConversationFacts;
    selectedProductIds?: string[];
    rejectedProductIds?: string[];
    pendingQuestion?: string | null;
    handoffRequested?: boolean;
    handoffReason?: string | null;
  }): Promise<void> {
    const existing = await this.db
      .select({ chatId: schema.conversationStates.chatId })
      .from(schema.conversationStates)
      .where(eq(schema.conversationStates.chatId, state.chatId))
      .limit(1);

    if (existing.length > 0) {
      const updateData: Record<string, unknown> = {};
      if (state.leadId !== undefined) updateData.leadId = state.leadId;
      if (state.assignedVendorId !== undefined) updateData.assignedVendorId = state.assignedVendorId;
      if (state.stage !== undefined) updateData.stage = state.stage;
      if (state.lastIntent !== undefined) updateData.lastIntent = state.lastIntent;
      if (state.summary !== undefined) updateData.summary = state.summary;
      if (state.facts !== undefined) {
        updateData.facts = {
          ...DEFAULT_FACTS,
          ...state.facts,
          productNames: state.facts.productNames ?? [],
          preferredMaterials: state.facts.preferredMaterials ?? [],
        };
      }
      if (state.selectedProductIds !== undefined) updateData.selectedProductIds = state.selectedProductIds;
      if (state.rejectedProductIds !== undefined) updateData.rejectedProductIds = state.rejectedProductIds;
      if (state.pendingQuestion !== undefined) updateData.pendingQuestion = state.pendingQuestion;
      if (state.handoffRequested !== undefined) updateData.handoffRequested = state.handoffRequested;
      if (state.handoffReason !== undefined) updateData.handoffReason = state.handoffReason;
      updateData.lastActivityAt = new Date();
      updateData.updatedAt = new Date();

      if (Object.keys(updateData).length > 2) {
        await this.db
          .update(schema.conversationStates)
          .set(updateData)
          .where(eq(schema.conversationStates.chatId, state.chatId));
      }
    } else {
      await this.db.insert(schema.conversationStates).values({
        chatId: state.chatId,
        normalizedPhone: state.normalizedPhone,
        leadId: state.leadId ?? null,
        assignedVendorId: state.assignedVendorId ?? null,
        stage: state.stage ?? "GREETING",
        lastIntent: state.lastIntent ?? null,
        summary: state.summary ?? "",
        facts: state.facts
          ? {
              ...DEFAULT_FACTS,
              ...state.facts,
              productNames: state.facts.productNames ?? [],
              preferredMaterials: state.facts.preferredMaterials ?? [],
            }
          : DEFAULT_FACTS,
        selectedProductIds: state.selectedProductIds ?? [],
        rejectedProductIds: state.rejectedProductIds ?? [],
        pendingQuestion: state.pendingQuestion ?? null,
        handoffRequested: state.handoffRequested ?? false,
        handoffReason: state.handoffReason ?? null,
      });
    }
  }

  async deleteExpired(ttlMinutes: number): Promise<number> {
    const cutoff = new Date(Date.now() - ttlMinutes * 60 * 1000);

    const expired = await this.db
      .select({ chatId: schema.conversationStates.chatId })
      .from(schema.conversationStates)
      .where(
        and(
          lt(schema.conversationStates.lastActivityAt, cutoff),
          eq(schema.conversationStates.stage, "CLOSED"),
        ),
      );

    if (expired.length === 0) return 0;

    const result = await this.db
      .delete(schema.conversationStates)
      .where(
        and(
          lt(schema.conversationStates.lastActivityAt, cutoff),
          eq(schema.conversationStates.stage, "CLOSED"),
        ),
      );

    return result.length;
  }

  private toDomain(
    row: typeof schema.conversationStates.$inferSelect,
  ): ConversationState {
    const dbFacts = (row.facts ?? {}) as Record<string, unknown>;
    const facts: ConversationFacts = {
      customerName: (dbFacts.customerName as string) ?? null,
      productCategory: (dbFacts.productCategory as string) ?? null,
      productNames: Array.isArray(dbFacts.productNames)
        ? (dbFacts.productNames as string[])
        : [],
      spaceType: (dbFacts.spaceType as string) ?? null,
      state: (dbFacts.state as string) ?? null,
      city: (dbFacts.city as string) ?? null,
      measurements: (dbFacts.measurements as string) ?? null,
      seats: typeof dbFacts.seats === "number" ? (dbFacts.seats as number) : null,
      preferredConfiguration:
        (dbFacts.preferredConfiguration as string) ?? null,
      preferredMaterials: Array.isArray(dbFacts.preferredMaterials)
        ? (dbFacts.preferredMaterials as string[])
        : [],
      selectedProductSlug:
        (dbFacts.selectedProductSlug as string) ?? null,
    };

    return {
      chatId: row.chatId,
      normalizedPhone: row.normalizedPhone,
      leadId: row.leadId,
      assignedVendorId: row.assignedVendorId,
      stage: row.stage,
      lastIntent: row.lastIntent,
      summary: row.summary,
      facts,
      selectedProductIds: Array.isArray(row.selectedProductIds)
        ? (row.selectedProductIds as string[])
        : [],
      rejectedProductIds: Array.isArray(row.rejectedProductIds)
        ? (row.rejectedProductIds as string[])
        : [],
      pendingQuestion: row.pendingQuestion,
      handoffRequested: row.handoffRequested,
      handoffReason: row.handoffReason,
      lastActivityAt: row.lastActivityAt,
      expiresAt: row.expiresAt,
    };
  }
}
