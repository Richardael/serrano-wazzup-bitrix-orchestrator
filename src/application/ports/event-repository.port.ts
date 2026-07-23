import { IntegrationEvent, EventStatus } from "../../domain/events/integration-event";

export interface EventRepository {
  findByProviderEventId(provider: string, providerEventId: string): Promise<IntegrationEvent | null>;
  findByPayloadHash(provider: string, payloadHash: string, since: Date): Promise<IntegrationEvent | null>;
  create(event: Omit<IntegrationEvent, "id" | "createdAt">): Promise<IntegrationEvent>;
  updateStatus(id: string, status: EventStatus, errorCode?: string, errorMessage?: string): Promise<void>;
  incrementAttempts(id: string): Promise<void>;
}
