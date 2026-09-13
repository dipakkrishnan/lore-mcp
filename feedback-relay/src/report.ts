/**
 * Validate an incoming feedback report independently of what the client
 * claims — the client is not the security boundary. Limits here match
 * lore/feedback.py's Report model and lore/capture.py's title/content caps;
 * test/report.test.ts asserts both sides agree with the shared
 * contracts/feedback_report.json (see MCP-002's contracts/mcp_tools.json for
 * the precedent this mirrors).
 */

export const REPORT_VERSION = 1;

/**
 * Field lengths are counted in **code points**, not JavaScript's default
 * UTF-16 code units: pydantic counts code points, and a description of
 * 15,000 emoji is 15,000 code points but 30,000 code units, so counting
 * units would 400 a report the client had already accepted.
 * contracts/feedback_report.json records the unit; both sides assert it.
 *
 * bodyBytes is deliberately above the largest body those field caps can
 * produce — 20,000 four-byte code points plus title, email, metadata and
 * JSON framing is roughly 82 KB — so nothing a client accepts can come back
 * a 413. It bounds what an arbitrary caller can make this Worker read, not
 * what an owner is allowed to write.
 */
export const LIMITS = {
  title: { min: 1, max: 200 },
  email: { min: 3, max: 254 },
  description: { min: 1, max: 20_000 },
  metadataField: { min: 1, max: 200 },
  bodyBytes: 131_072
};

export const LENGTH_UNIT = "code_points";

export const SOURCES = ["cli", "desktop"] as const;
export type Source = (typeof SOURCES)[number];

export const METADATA_FIELDS = [
  "submitted_at",
  "source",
  "lore_version",
  "platform",
  "arch",
  "python_version",
  "install_id"
] as const;
type MetadataField = (typeof METADATA_FIELDS)[number];

const INSTALL_ID_RE = /^[0-9a-f]{32}$/;
const SUBMITTED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export interface ReportMetadata {
  submitted_at: string;
  source: Source;
  lore_version: string;
  platform: string;
  arch: string;
  python_version: string;
  install_id: string;
}

export interface Report {
  report_version: 1;
  title: string;
  email: string | null;
  description: string;
  metadata: ReportMetadata;
}

export class ReportError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  value: unknown,
  field: string,
  limits: { min: number; max: number }
): string {
  if (typeof value !== "string") {
    throw new ReportError(400, `${field} must be a string`);
  }
  // Spread, not .length: code points, so this agrees with pydantic on
  // anything outside the BMP. See LIMITS.
  const length = [...value].length;
  if (length < limits.min || length > limits.max) {
    throw new ReportError(
      400,
      `${field} must be between ${limits.min} and ${limits.max} characters`
    );
  }
  return value;
}

function isMetadataField(key: string): key is MetadataField {
  return (METADATA_FIELDS as readonly string[]).includes(key);
}

function parseMetadata(value: unknown): ReportMetadata {
  if (!isRecord(value)) {
    throw new ReportError(400, "metadata must be an object");
  }
  const unknown = Object.keys(value).filter((key) => !isMetadataField(key));
  if (unknown.length) {
    throw new ReportError(400, `metadata has unknown field(s): ${unknown.join(", ")}`);
  }
  for (const field of METADATA_FIELDS) {
    if (!(field in value)) {
      throw new ReportError(400, `metadata is missing ${field}`);
    }
  }

  const submitted_at = requireString(
    value.submitted_at,
    "metadata.submitted_at",
    LIMITS.metadataField
  );
  if (!SUBMITTED_AT_RE.test(submitted_at)) {
    throw new ReportError(
      400,
      "metadata.submitted_at must look like 2026-01-01T00:00:00Z"
    );
  }

  const source = requireString(value.source, "metadata.source", LIMITS.metadataField);
  if (!(SOURCES as readonly string[]).includes(source)) {
    throw new ReportError(400, `metadata.source must be one of ${SOURCES.join(", ")}`);
  }

  const install_id = requireString(
    value.install_id,
    "metadata.install_id",
    LIMITS.metadataField
  );
  if (!INSTALL_ID_RE.test(install_id)) {
    throw new ReportError(400, "metadata.install_id must be 32 lowercase hex characters");
  }

  return {
    submitted_at,
    source: source as Source,
    lore_version: requireString(
      value.lore_version,
      "metadata.lore_version",
      LIMITS.metadataField
    ),
    platform: requireString(value.platform, "metadata.platform", LIMITS.metadataField),
    arch: requireString(value.arch, "metadata.arch", LIMITS.metadataField),
    python_version: requireString(
      value.python_version,
      "metadata.python_version",
      LIMITS.metadataField
    ),
    install_id
  };
}

const ALLOWED_TOP_LEVEL = new Set([
  "report_version",
  "title",
  "email",
  "description",
  "metadata"
]);

export function parseReport(raw: unknown): Report {
  if (!isRecord(raw)) {
    throw new ReportError(400, "the request body must be a JSON object");
  }
  const unknown = Object.keys(raw).filter((key) => !ALLOWED_TOP_LEVEL.has(key));
  if (unknown.length) {
    throw new ReportError(400, `unknown field(s): ${unknown.join(", ")}`);
  }
  if (raw.report_version !== REPORT_VERSION) {
    throw new ReportError(400, `report_version must be ${REPORT_VERSION}`);
  }

  const title = requireString(raw.title, "title", LIMITS.title);
  const description = requireString(raw.description, "description", LIMITS.description);

  let email: string | null = null;
  if (raw.email !== null && raw.email !== undefined) {
    email = requireString(raw.email, "email", LIMITS.email);
  }

  return {
    report_version: REPORT_VERSION,
    title,
    email,
    description,
    metadata: parseMetadata(raw.metadata)
  };
}
