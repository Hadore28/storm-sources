export type ErrorKind =
  /** the series, chapter or page does not exist (any more) */
  | "not-found"
  /** the site refused us: Cloudflare, a geo block, a ban */
  | "blocked"
  | "rate-limited"
  | "network"
  | "timeout"
  /** the site answered, but not in the shape the extension expects — it needs an update */
  | "changed"
  /** the source cannot do this, e.g. search on a list-only site */
  | "unsupported";

// Extensions bundle their own copy of this class, so the host recognises it by
// name and kind rather than with instanceof.
export class SourceError extends Error {
  readonly kind: ErrorKind;
  readonly detail?: unknown;

  constructor(kind: ErrorKind, message: string, detail?: unknown) {
    super(message);
    this.name = "SourceError";
    this.kind = kind;
    this.detail = detail;
  }
}

export function isSourceError(e: unknown): e is SourceError {
  return typeof e === "object" && e !== null && (e as Error).name === "SourceError" && typeof (e as SourceError).kind === "string";
}

/** Throws "changed" when a value the extension relies on is missing. */
export function must<T>(value: T | null | undefined | "", what: string): T {
  if (value === null || value === undefined || value === "") throw new SourceError("changed", `Missing ${what}`);
  return value;
}
