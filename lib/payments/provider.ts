/**
 * The one provider interface (CLAUDE.md): every provider (mock, mpesa, airtel, orange, tpe)
 * implements it, and nothing outside lib/payments imports a provider directly.
 */
export type PaymentChannel = "mock" | "mpesa" | "airtel" | "orange" | "tpe";

export interface InitiateRequest {
  /** Our platform reference, generated before the provider is contacted (invariant 5). */
  reference: string;
  amountFc: number;
  payerPhone: string;
  channel: PaymentChannel;
  description: string;
}

export interface InitiateResult {
  providerRequestId: string | null;
  status: "pending" | "failed";
  failureReason?: string;
  raw: unknown;
}

export interface StatusContext {
  reference: string;
  providerRequestId: string | null;
  amountFc: number;
  payerPhone: string;
  initiatedAt: Date;
  now: Date;
}

export type StatusResult =
  | { status: "pending"; raw?: unknown }
  | {
      status: "confirmed";
      providerReference: string;
      amountFc: number;
      payerPhone?: string;
      providerTime?: Date;
      raw: unknown;
    }
  | { status: "failed"; failureCode?: string; failureReason: string; raw: unknown };

export interface ReverseResult {
  ok: boolean;
  providerReference?: string;
  raw: unknown;
}

export interface StatementLine {
  providerReference: string;
  platformReference: string | null;
  amountFc: number;
  occurredAt: Date;
  payerPhone?: string;
  raw: unknown;
}

export interface PaymentProvider {
  readonly name: PaymentChannel;
  initiate(request: InitiateRequest): Promise<InitiateResult>;
  queryStatus(ctx: StatusContext): Promise<StatusResult>;
  reverse(ctx: {
    reference: string;
    providerReference: string;
    amountFc: number;
    reason: string;
  }): Promise<ReverseResult>;
  /** The provider's own statement for a business day (YYYY-MM-DD), for reconciliation (M9). */
  fetchStatement(date: string): Promise<StatementLine[]>;
}
