import { NormalizedPhone } from "../shared/value-objects";

export interface ContactInfo {
  readonly externalId: string | null;
  readonly displayName: string | null;
  readonly rawPhone: string;
  readonly normalizedPhone: NormalizedPhone;
}
