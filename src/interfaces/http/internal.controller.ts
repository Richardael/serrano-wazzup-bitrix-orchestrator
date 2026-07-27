import { Controller, Get } from "@nestjs/common";

interface StoredPayload {
  receivedAt: string;
  keys: string[];
  preview: string;
  full: Record<string, unknown>;
}

interface StoredUpdate {
  at: string;
  leadId: string;
  contactName: string | null;
  vendorName: string;
  historyLength: number;
  extracted: Record<string, unknown> | null;
  camposLlenos: number;
  updated: boolean;
  error?: string;
}

@Controller("internal")
export class InternalController {
  static lastPayload: StoredPayload | null = null;
  static lastMessages: Array<{ keys: string[]; preview: string }> = [];
  static lastUpdate: StoredUpdate | null = null;

  @Get("last-payload")
  getLastPayload(): StoredPayload | { message: string } {
    if (!InternalController.lastPayload) {
      return { message: "No payload received yet" };
    }
    return InternalController.lastPayload;
  }

  @Get("last-messages")
  getLastMessages(): Array<{ keys: string[]; preview: string }> | { message: string } {
    if (InternalController.lastMessages.length === 0) {
      return { message: "No messages received yet" };
    }
    return InternalController.lastMessages;
  }

  @Get("last-update")
  getLastUpdate(): StoredUpdate | { message: string } {
    if (!InternalController.lastUpdate) {
      return { message: "No lead update attempted yet" };
    }
    return InternalController.lastUpdate;
  }
}
