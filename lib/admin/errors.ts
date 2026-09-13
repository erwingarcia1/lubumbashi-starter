export type AdminErrorCode =
  | "forbidden"
  | "self_approval"
  | "not_found"
  | "invalid_state"
  | "invalid_input"
  | "missing_statement"
  | "open_exceptions"
  | "already_closed"
  | "provider_error";

/** Raised by the admin core functions; pages map the code to a French message (fr.admin.errors). */
export class AdminError extends Error {
  constructor(
    readonly code: AdminErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "AdminError";
  }
}
