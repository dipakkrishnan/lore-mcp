// XC-102: FeedbackQuota.take's window maths, without the Durable Object. That the object stores
// what `claim` returns, and that the relay refuses once it says no, is test/limit.test.ts.
import { describe, expect, it } from "vitest";
import { type Count, WINDOWS, claim } from "../../src/quota-window";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const NOW = 10 * HOUR;

/** A lookup over stored rows, by span. */
const rows = (stored: Record<string, Count>) => (span: string) => stored[span];

describe("the windows", () => {
  it("sit under GitHub's secondary limits for content creation (~80/minute, 500/hour)", () => {
    expect(WINDOWS).toEqual([
      { span: "minute", size: MINUTE, limit: 60 },
      { span: "hour", size: HOUR, limit: 300 }
    ]);
  });
});

describe("claim", () => {
  it.each<[string, Record<string, Count>, ({ span: string } & Count)[] | null]>([
    [
      "no rows yet: both windows open now with one used",
      {},
      [
        { span: "minute", started: NOW, used: 1 },
        { span: "hour", started: NOW, used: 1 }
      ]
    ],
    [
      "both windows running: each counts one more and keeps its start",
      { minute: { started: NOW - 1_000, used: 5 }, hour: { started: NOW - MINUTE * 30, used: 40 } },
      [
        { span: "minute", started: NOW - 1_000, used: 6 },
        { span: "hour", started: NOW - MINUTE * 30, used: 41 }
      ]
    ],
    [
      "the minute ran out exactly at its size: it restarts, the hour carries on",
      { minute: { started: NOW - MINUTE, used: 60 }, hour: { started: NOW - MINUTE, used: 60 } },
      [
        { span: "minute", started: NOW, used: 1 },
        { span: "hour", started: NOW - MINUTE, used: 61 }
      ]
    ],
    [
      "one millisecond before the minute ends, a full minute still refuses",
      { minute: { started: NOW - MINUTE + 1, used: 60 }, hour: { started: NOW, used: 60 } },
      null
    ],
    [
      "one short of the minute's limit: the last one is let through",
      { minute: { started: NOW, used: 59 }, hour: { started: NOW, used: 59 } },
      [
        { span: "minute", started: NOW, used: 60 },
        { span: "hour", started: NOW, used: 60 }
      ]
    ],
    [
      "the hour is full though the minute has room: refused",
      { minute: { started: NOW, used: 0 }, hour: { started: NOW - MINUTE, used: 300 } },
      null
    ],
    [
      "a full hour that has run out restarts, and the request goes through",
      { minute: { started: NOW - 2 * MINUTE, used: 60 }, hour: { started: NOW - HOUR, used: 300 } },
      [
        { span: "minute", started: NOW, used: 1 },
        { span: "hour", started: NOW, used: 1 }
      ]
    ],
    [
      "only the hour has a row: the minute opens now",
      { hour: { started: NOW - 5 * MINUTE, used: 12 } },
      [
        { span: "minute", started: NOW, used: 1 },
        { span: "hour", started: NOW - 5 * MINUTE, used: 13 }
      ]
    ]
  ])("%s", (_, stored, expected) => {
    expect(claim(NOW, rows(stored))).toEqual(expected);
  });

  it("asks for every window, then claims all or none", () => {
    const asked: string[] = [];
    const full = { started: NOW, used: 1 };
    const windows = [
      { span: "a", size: MINUTE, limit: 5 },
      { span: "b", size: MINUTE, limit: 1 }
    ];
    expect(
      claim(NOW, (span) => {
        asked.push(span);
        return full;
      }, windows)
    ).toBeNull();
    expect(asked).toEqual(["a", "b"]);
  });

  it("takes the windows it is given", () => {
    expect(claim(NOW, rows({}), [{ span: "day", size: 24 * HOUR, limit: 1 }])).toEqual([{ span: "day", started: NOW, used: 1 }]);
    expect(claim(NOW, rows({ day: { started: NOW, used: 1 } }), [{ span: "day", size: 24 * HOUR, limit: 1 }])).toBeNull();
  });
});
