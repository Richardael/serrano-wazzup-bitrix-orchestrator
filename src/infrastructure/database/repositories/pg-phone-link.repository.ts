import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { drizzle, PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { AppConfig } from "../../config/app.config";
import * as schema from "../schema";
import { PhoneLinkRepository, PhoneLinkRecord } from "../../../application/ports/phone-link-repository.port";

@Injectable()
export class PgPhoneLinkRepository implements PhoneLinkRepository {
  private db: PostgresJsDatabase<typeof schema>;

  constructor(config: AppConfig) {
    const client = postgres(config.env.DATABASE_URL);
    this.db = drizzle(client, { schema });
  }

  async findByPhone(normalizedPhone: string): Promise<PhoneLinkRecord | null> {
    const rows = await this.db
      .select()
      .from(schema.phoneLinks)
      .where(eq(schema.phoneLinks.normalizedPhone, normalizedPhone))
      .limit(1);

    if (!rows[0]) return null;

    return {
      normalizedPhone: rows[0].normalizedPhone,
      phoneCountry: rows[0].phoneCountry,
      activeLeadIds: rows[0].activeLeadIds as string[],
      createdAt: rows[0].createdAt,
      updatedAt: rows[0].updatedAt,
    };
  }

  async upsert(normalizedPhone: string, phoneCountry: string | null, leadId: string): Promise<void> {
    const existing = await this.findByPhone(normalizedPhone);

    if (existing) {
      const ids = new Set(existing.activeLeadIds);
      ids.add(leadId);
      await this.db
        .update(schema.phoneLinks)
        .set({
          activeLeadIds: [...ids] as unknown as never,
          updatedAt: new Date(),
          phoneCountry: phoneCountry ?? existing.phoneCountry,
        })
        .where(eq(schema.phoneLinks.normalizedPhone, normalizedPhone));
    } else {
      await this.db.insert(schema.phoneLinks).values({
        normalizedPhone,
        phoneCountry,
        activeLeadIds: [leadId] as unknown as never,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }
}
