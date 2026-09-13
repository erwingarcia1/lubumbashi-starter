/**
 * Pure matching of the platform's payments against a provider statement (one business day, one
 * provider). No database: the engine feeds it rows and stores what comes out.
 */
export type ExceptionType =
  | "missing_at_provider"
  | "missing_on_platform"
  | "amount_mismatch"
  | "duplicate_at_provider"
  | "status_mismatch";

export interface PlatformPayment {
  id: string;
  reference: string;
  providerReference: string | null;
  amountFc: number;
  status: "initiated" | "pending" | "confirmed" | "failed" | "reversed" | "expired";
}

export interface StatementRow {
  /** Index in the statement array; the engine maps it back to the stored line. */
  index: number;
  providerReference: string;
  platformReference: string | null;
  amountFc: number;
}

export interface MatchResult {
  matches: Array<{ lineIndex: number; paymentId: string }>;
  exceptions: Array<{
    type: ExceptionType;
    paymentId?: string;
    lineIndex?: number;
    platformAmountFc?: number;
    statementAmountFc?: number;
  }>;
  summary: {
    platformCount: number;
    platformTotalFc: number;
    statementCount: number;
    statementTotalFc: number;
    matchedCount: number;
  };
}

/**
 * Rules (docs/MILESTONES.md M9):
 * - a confirmed payment with no statement line          → missing_at_provider
 * - a confirmed payment with two or more statement lines → duplicate_at_provider (extra lines)
 * - a confirmed payment whose line carries another amount → amount_mismatch
 * - a statement line for a payment the platform did not confirm (failed, expired, pending…) → status_mismatch
 * - a statement line the platform cannot tie to any payment → missing_on_platform
 */
export function matchStatement(payments: PlatformPayment[], lines: StatementRow[]): MatchResult {
  const byPlatformRef = new Map<string, StatementRow[]>();
  const byProviderRef = new Map<string, StatementRow[]>();
  for (const line of lines) {
    if (line.platformReference) {
      const list = byPlatformRef.get(line.platformReference) ?? [];
      list.push(line);
      byPlatformRef.set(line.platformReference, list);
    }
    const list = byProviderRef.get(line.providerReference) ?? [];
    list.push(line);
    byProviderRef.set(line.providerReference, list);
  }

  const result: MatchResult = {
    matches: [],
    exceptions: [],
    summary: {
      platformCount: 0,
      platformTotalFc: 0,
      statementCount: lines.length,
      statementTotalFc: lines.reduce((s, l) => s + l.amountFc, 0),
      matchedCount: 0,
    },
  };
  const claimed = new Set<number>();

  const linesFor = (p: PlatformPayment): StatementRow[] => {
    const seen = new Set<number>();
    const out: StatementRow[] = [];
    for (const l of [
      ...(byPlatformRef.get(p.reference) ?? []),
      ...(p.providerReference ? (byProviderRef.get(p.providerReference) ?? []) : []),
    ]) {
      if (!seen.has(l.index)) {
        seen.add(l.index);
        out.push(l);
      }
    }
    return out.sort((a, b) => a.index - b.index);
  };

  for (const p of payments) {
    const candidates = linesFor(p);
    if (p.status !== "confirmed") {
      // The platform never confirmed it: any line the provider reports is a status mismatch.
      for (const l of candidates) {
        claimed.add(l.index);
        result.exceptions.push({
          type: "status_mismatch",
          paymentId: p.id,
          lineIndex: l.index,
          platformAmountFc: p.amountFc,
          statementAmountFc: l.amountFc,
        });
      }
      continue;
    }
    result.summary.platformCount += 1;
    result.summary.platformTotalFc += p.amountFc;
    if (candidates.length === 0) {
      result.exceptions.push({
        type: "missing_at_provider",
        paymentId: p.id,
        platformAmountFc: p.amountFc,
      });
      continue;
    }
    const [first, ...extra] = candidates as [StatementRow, ...StatementRow[]];
    claimed.add(first.index);
    if (first.amountFc === p.amountFc) {
      result.matches.push({ lineIndex: first.index, paymentId: p.id });
      result.summary.matchedCount += 1;
    } else {
      result.exceptions.push({
        type: "amount_mismatch",
        paymentId: p.id,
        lineIndex: first.index,
        platformAmountFc: p.amountFc,
        statementAmountFc: first.amountFc,
      });
    }
    for (const dup of extra) {
      claimed.add(dup.index);
      result.exceptions.push({
        type: "duplicate_at_provider",
        paymentId: p.id,
        lineIndex: dup.index,
        platformAmountFc: p.amountFc,
        statementAmountFc: dup.amountFc,
      });
    }
  }

  for (const l of lines) {
    if (claimed.has(l.index)) continue;
    result.exceptions.push({
      type: "missing_on_platform",
      lineIndex: l.index,
      statementAmountFc: l.amountFc,
    });
  }
  return result;
}
