import { Injectable } from "@nestjs/common";
import postgres from "postgres";
import { AppConfig } from "../../config/app.config";
import { NotificationMarker, NotificationMarkerRepository } from "../../../application/ports/notification-marker.port";

/** La tabla se crea en `MigrationRunner` (CREATE TABLE IF NOT EXISTS). */
@Injectable()
export class PgNotificationMarkerRepository implements NotificationMarkerRepository {
  private readonly sql: postgres.Sql;

  constructor(config: AppConfig) {
    this.sql = postgres(config.env.DATABASE_URL, { max: 3 });
  }

  async register(input: { phoneKey: string; source: string; messageId: string | null; sentAt: Date }): Promise<void> {
    await this.sql`
      INSERT INTO notification_markers (phone_key, source, message_id, sent_at)
      VALUES (${input.phoneKey}, ${input.source}, ${input.messageId}, ${input.sentAt})
      ON CONFLICT (phone_key) DO UPDATE SET
        source = EXCLUDED.source,
        message_id = EXCLUDED.message_id,
        sent_at = EXCLUDED.sent_at,
        reply_count = 0,
        last_reply_at = NULL
    `;
  }

  async findActive(phoneKeys: readonly string[], notBefore: Date): Promise<NotificationMarker[]> {
    if (phoneKeys.length === 0) return [];
    const rows = await this.sql<{ phone_key: string; sent_at: Date; source: string; message_id: string | null }[]>`
      SELECT phone_key, sent_at, source, message_id
        FROM notification_markers
       WHERE phone_key IN ${this.sql(phoneKeys as string[])} AND sent_at >= ${notBefore}
    `;
    return rows.map((r) => ({ phoneKey: r.phone_key, sentAt: r.sent_at, source: r.source, messageId: r.message_id }));
  }

  async recordReply(phoneKey: string, at: Date): Promise<void> {
    await this.sql`
      UPDATE notification_markers SET reply_count = reply_count + 1, last_reply_at = ${at}
       WHERE phone_key = ${phoneKey}
    `;
  }
}
