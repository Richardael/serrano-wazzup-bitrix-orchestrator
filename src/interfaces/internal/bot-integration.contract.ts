export interface BotOutboundMessageRequest {
  channelId: string;
  chatId: string;
  text: string;
}

export interface BotOutboundMessageResponse {
  accepted: true;
}

export type BotInboundWazzupPayload = Record<string, unknown> & {
  messages: Array<Record<string, unknown>>;
};
