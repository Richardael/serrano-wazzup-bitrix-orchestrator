export interface WazzupPort {
  sendMessage(input: SendMessageInput): Promise<void>;
  readonly isEnabled: boolean;
}

export interface SendMessageInput {
  chatId: string;
  channelId: string;
  text: string;
}
