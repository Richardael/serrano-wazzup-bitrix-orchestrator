import { ConversationState, ConversationFacts } from "../../domain/catalog/conversation-state.entity";

export interface ConversationStatePort {
  findByChatId(chatId: string): Promise<ConversationState | null>;
  upsert(state: {
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
  }): Promise<void>;
  deleteExpired(ttlMinutes: number): Promise<number>;
}
