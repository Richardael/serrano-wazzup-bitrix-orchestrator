import { Direction, MessageType } from "../shared/value-objects";
import { ContactInfo } from "../contacts/contact";

export interface NormalizedIncomingMessage {
  readonly providerEventId: string;
  readonly providerMessageId: string | null;
  readonly channelId: string | null;
  readonly direction: Direction;
  readonly messageType: MessageType;
  readonly occurredAt: string;
  readonly contact: ContactInfo;
  readonly content: {
    readonly hasText: boolean;
    readonly textHash: string | null;
    readonly hasAttachments: boolean;
  };
  readonly rawMetadata: Record<string, unknown> | null;
}
