export interface ConversationFacts {
  customerName: string | null;
  productCategory: string | null;
  productNames: readonly string[];
  spaceType: string | null;
  state: string | null;
  city: string | null;
  measurements: string | null;
  seats: number | null;
  preferredConfiguration: string | null;
  preferredMaterials: readonly string[];
  selectedProductSlug: string | null;
}

export interface ConversationState {
  readonly chatId: string;
  readonly normalizedPhone: string;
  readonly leadId: string | null;
  readonly assignedVendorId: number | null;
  readonly stage: string;
  readonly lastIntent: string | null;
  readonly summary: string;
  readonly facts: ConversationFacts;
  readonly selectedProductIds: readonly string[];
  readonly rejectedProductIds: readonly string[];
  readonly pendingQuestion: string | null;
  readonly handoffRequested: boolean;
  readonly handoffReason: string | null;
  readonly lastActivityAt: Date;
  readonly expiresAt: Date | null;
}

export const DEFAULT_FACTS: ConversationFacts = {
  customerName: null,
  productCategory: null,
  productNames: [],
  spaceType: null,
  state: null,
  city: null,
  measurements: null,
  seats: null,
  preferredConfiguration: null,
  preferredMaterials: [],
  selectedProductSlug: null,
};
