export type EventStatus = "RECEIVED" | "PROCESSING" | "COMPLETED" | "FAILED" | "MANUAL_REVIEW";

export interface IntegrationEvent {
  readonly id: string;
  readonly provider: string;
  readonly providerEventId: string | null;
  readonly eventType: string;
  readonly payloadHash: string;
  readonly sanitizedPayload: Record<string, unknown> | null;
  readonly status: EventStatus;
  readonly attempts: number;
  readonly correlationId: string;
  readonly receivedAt: Date;
  readonly processingStartedAt: Date | null;
  readonly processedAt: Date | null;
  readonly nextRetryAt: Date | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}
