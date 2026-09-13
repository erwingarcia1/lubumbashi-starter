import type { NotifyProvider, OutboundMessage, SendResult } from "../provider";

/** Development provider: prints the SMS instead of sending it (M7; real SMS comes later). */
export function consoleProvider(
  log: (line: string) => void = (line) => console.log(line),
): NotifyProvider {
  return {
    name: "console",
    async send(message: OutboundMessage): Promise<SendResult> {
      log(`SMS → ${message.to} [${message.reference}]\n${message.body}`);
      return { ok: true, providerMessageId: `console-${message.reference}` };
    },
  };
}
