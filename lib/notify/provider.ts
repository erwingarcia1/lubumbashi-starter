/** SMS/WhatsApp providers implement this; only lib/notify imports one. */
export interface OutboundMessage {
  to: string;
  body: string;
  /** Our notification id, for provider-side idempotency. */
  reference: string;
}

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
}

export interface NotifyProvider {
  readonly name: "console" | "africastalking" | "whatsapp";
  send(message: OutboundMessage): Promise<SendResult>;
}
