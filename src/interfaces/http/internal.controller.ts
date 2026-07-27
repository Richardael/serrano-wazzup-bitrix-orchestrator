import { Controller, Get } from "@nestjs/common";

interface StoredPayload {
  receivedAt: string;
  keys: string[];
  preview: string;
  full: Record<string, unknown>;
}

@Controller("internal")
export class InternalController {
  static lastPayload: StoredPayload | null = null;
  static lastMessages: Array<{ keys: string[]; preview: string }> = [];

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
}
