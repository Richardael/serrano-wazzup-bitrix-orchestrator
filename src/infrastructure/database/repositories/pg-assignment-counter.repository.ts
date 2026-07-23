import { Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { drizzle, PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { AppConfig } from "../../config/app.config";
import * as schema from "../schema";
import { AssignmentCounterRepository } from "../../../application/ports/assignment-counter-repository.port";

@Injectable()
export class PgAssignmentCounterRepository implements AssignmentCounterRepository {
  private db: PostgresJsDatabase<typeof schema>;

  constructor(config: AppConfig) {
    const client = postgres(config.env.DATABASE_URL);
    this.db = drizzle(client, { schema });
  }

  async getCurrentIndex(): Promise<number> {
    const rows = await this.db.select().from(schema.assignmentCounter).limit(1);

    if (!rows[0]) {
      const [inserted] = await this.db
        .insert(schema.assignmentCounter)
        .values({ currentIndex: 0, updatedAt: new Date() })
        .returning();
      return inserted?.currentIndex ?? 0;
    }

    return rows[0].currentIndex;
  }

  async incrementAndGet(): Promise<number> {
    const rows = await this.db
      .update(schema.assignmentCounter)
      .set({
        currentIndex: sql`current_index + 1`,
        updatedAt: new Date(),
      })
      .where(eq(schema.assignmentCounter.id, sql`(select id from assignment_counter limit 1)`))
      .returning();

    return rows[0]?.currentIndex ?? 0;
  }
}
