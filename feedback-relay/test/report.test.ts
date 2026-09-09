// XC-028: the relay's own copy of feedback report validation — matches
// lore/feedback.py's Report model. See tests/test_feedback.py for the
// Python-side half of this check; each surface verifies itself against the
// same checked-in contracts/feedback_report.json.
import { describe, expect, it } from "vitest";
import contract from "../../contracts/feedback_report.json";
import {
  LENGTH_UNIT,
  LIMITS,
  METADATA_FIELDS,
  REPORT_VERSION,
  ReportError,
  SOURCES,
  parseReport
} from "../src/report";

function validMetadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    submitted_at: "2026-01-01T00:00:00Z",
    source: "cli",
    lore_version: "0.1.0",
    platform: "Darwin 25.2.0",
    arch: "arm64",
    python_version: "3.12.4",
    install_id: "0".repeat(32),
    ...overrides
  };
}

function validReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    report_version: 1,
    title: "A title",
    email: "a@b.com",
    description: "A description",
    metadata: validMetadata(),
    ...overrides
  };
}

describe("contract agreement", () => {
  it("matches contracts/feedback_report.json", () => {
    expect(contract.report_version).toBe(REPORT_VERSION);
    expect(contract.limits.title.max).toBe(LIMITS.title.max);
    expect(contract.limits.title.min).toBe(LIMITS.title.min);
    expect(contract.limits.email.max).toBe(LIMITS.email.max);
    expect(contract.limits.description.max).toBe(LIMITS.description.max);
    expect(contract.limits.body_bytes).toBe(LIMITS.bodyBytes);
    // The unit both sides count in. Python counts code points; if this
    // said anything else, an emoji-heavy report valid there would 400 here.
    expect(contract.length_unit).toBe(LENGTH_UNIT);
    expect([...contract.sources].sort()).toEqual([...SOURCES].sort());
    expect([...contract.metadata_fields].sort()).toEqual([...METADATA_FIELDS].sort());
  });
});

describe("parseReport", () => {
  it("accepts a well-formed report", () => {
    const report = parseReport(validReport());
    expect(report.title).toBe("A title");
    expect(report.email).toBe("a@b.com");
    expect(report.metadata.source).toBe("cli");
  });

  it("accepts a report with no email, given as null or omitted", () => {
    expect(parseReport(validReport({ email: null })).email).toBeNull();
    const report = validReport();
    delete report.email;
    expect(parseReport(report).email).toBeNull();
  });

  it("rejects a non-object body", () => {
    for (const bad of ["nope", ["nope"], null, 42]) {
      expect(() => parseReport(bad)).toThrow(ReportError);
    }
  });

  it("rejects unknown top-level fields", () => {
    expect(() => parseReport(validReport({ extra: "field" }))).toThrow(/unknown field/);
  });

  it("rejects a mismatched report_version", () => {
    expect(() => parseReport(validReport({ report_version: 2 }))).toThrow(/report_version/);
  });

  it("rejects a missing title", () => {
    const report = validReport();
    delete report.title;
    expect(() => parseReport(report)).toThrow(ReportError);
  });

  it("rejects a missing description", () => {
    const report = validReport();
    delete report.description;
    expect(() => parseReport(report)).toThrow(ReportError);
  });

  it("rejects an empty title", () => {
    expect(() => parseReport(validReport({ title: "" }))).toThrow(ReportError);
  });

  it("rejects an oversize title", () => {
    expect(() =>
      parseReport(validReport({ title: "x".repeat(LIMITS.title.max + 1) }))
    ).toThrow(ReportError);
  });

  it("accepts a title at exactly the max length", () => {
    expect(parseReport(validReport({ title: "x".repeat(LIMITS.title.max) })).title).toHaveLength(
      LIMITS.title.max
    );
  });

  it("rejects an oversize description", () => {
    expect(() =>
      parseReport(validReport({ description: "x".repeat(LIMITS.description.max + 1) }))
    ).toThrow(ReportError);
  });

  it("counts code points, not UTF-16 units, so emoji at the max are accepted", () => {
    // "🚀" is one code point and two UTF-16 code units. Counting units would
    // reject this at half the documented limit, while lore/feedback.py — and
    // therefore the client that already sent it — considers it valid.
    const description = "🚀".repeat(LIMITS.description.max);
    expect(description.length).toBe(LIMITS.description.max * 2);
    expect(parseReport(validReport({ description })).description).toBe(description);
    expect(parseReport(validReport({ title: "🚀".repeat(LIMITS.title.max) })).title).toBe(
      "🚀".repeat(LIMITS.title.max)
    );
  });

  it("still rejects one code point past the max, in any alphabet", () => {
    expect(() =>
      parseReport(validReport({ description: "🚀".repeat(LIMITS.description.max + 1) }))
    ).toThrow(ReportError);
    expect(() =>
      parseReport(validReport({ description: "字".repeat(LIMITS.description.max + 1) }))
    ).toThrow(ReportError);
  });

  it("rejects a non-string email", () => {
    expect(() => parseReport(validReport({ email: 123 }))).toThrow(ReportError);
  });

  it("rejects metadata that is not an object", () => {
    expect(() => parseReport(validReport({ metadata: "nope" }))).toThrow(/metadata must be/);
  });

  it("rejects metadata with an unknown field", () => {
    expect(() => parseReport(validReport({ metadata: validMetadata({ extra: "x" }) }))).toThrow(
      /unknown field/
    );
  });

  it("rejects metadata missing a required field", () => {
    const metadata = validMetadata();
    delete metadata.arch;
    expect(() => parseReport(validReport({ metadata }))).toThrow(/missing arch/);
  });

  it("rejects a malformed submitted_at", () => {
    expect(() =>
      parseReport(validReport({ metadata: validMetadata({ submitted_at: "not-a-date" }) }))
    ).toThrow(/submitted_at/);
  });

  it("rejects an unknown source", () => {
    expect(() =>
      parseReport(validReport({ metadata: validMetadata({ source: "web" }) }))
    ).toThrow(/metadata.source/);
  });

  it("rejects a malformed install_id", () => {
    expect(() =>
      parseReport(validReport({ metadata: validMetadata({ install_id: "not-hex" }) }))
    ).toThrow(/install_id/);
  });

  it("rejects an oversize metadata field", () => {
    expect(() =>
      parseReport(
        validReport({
          metadata: validMetadata({ platform: "x".repeat(LIMITS.metadataField.max + 1) })
        })
      )
    ).toThrow(ReportError);
  });
});
