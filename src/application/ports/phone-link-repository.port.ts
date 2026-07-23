export interface PhoneLinkRecord {
  readonly normalizedPhone: string;
  readonly phoneCountry: string | null;
  readonly activeLeadIds: string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PhoneLinkRepository {
  findByPhone(normalizedPhone: string): Promise<PhoneLinkRecord | null>;
  upsert(normalizedPhone: string, phoneCountry: string | null, leadId: string): Promise<void>;
}
