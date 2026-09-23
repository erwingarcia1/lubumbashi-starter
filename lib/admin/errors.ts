export type AdminErrorCode =
  | "forbidden"
  | "self_approval"
  | "not_found"
  | "invalid_state"
  | "invalid_input"
  | "missing_statement"
  | "open_exceptions"
  | "already_closed"
  | "provider_error"
  | "duplicate_phone";

/**
 * Raised by the admin core functions; pages map the code to a French message (fr.admin.errors).
 * `detail` is what the page may show next to the message (e.g. the taxpayer number that already
 * carries the phone for `duplicate_phone`); it never carries a secret.
 */
export class AdminError extends Error {
  constructor(
    readonly code: AdminErrorCode,
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "AdminError";
  }
}
