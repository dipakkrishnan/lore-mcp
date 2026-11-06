import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { browserOf, downloadPage } from "../src/download.js";
import worker from "../src/worker.js";

const DMG = "https://github.com/dipakkrishnan/lore-mcp/releases/latest/download/Lore-macOS-arm64.dmg";
const UA = {
  chrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0",
  safari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15",
  firefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15.7; rv:145.0) Gecko/20100101 Firefox/145.0",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"
};
const text = (html) => html.replace(/<style>[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<svg[\s\S]*?<\/svg>|<[^>]+>/g, " ").replace(/\s+/g, " ");

async function call(path, ua) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`https://yourlore.dev${path}`, { redirect: "manual", headers: ua ? { "user-agent": ua } : {} }), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe("/download", () => {
  test("on a Mac, starts the disk image and says how to open Lore in three steps", async () => {
    const response = await call("/download", UA.chrome);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("user-agent");
    const html = await response.text();
    expect(html).toContain(`<meta http-equiv="refresh" content="1;url=${DMG}">`);
    expect(text(html)).toContain(
      "Open Lore in 3 steps Open the download from the arrow at the top right of Chrome Double-click Lore-macOS-arm64.dmg In the window that opens, drag Lore into Applications, then open it from there Download didn't start? Download again For Macs with Apple silicon · Notarized by Apple"
    );
    expect(html).toContain(`<a href="${DMG}" download>Download again</a>`);
    expect(html).toContain('<a class="on" aria-current="page" href="/download">Download</a>');
  });

  test("names the browser in hand, and points at where its downloads button sits", () => {
    expect([UA.chrome, UA.edge, UA.safari, UA.firefox, UA.windows, ""].map(browserOf)).toEqual(["chrome", "edge", "safari", "firefox", "chrome", "other"]);
    expect(text(downloadPage({ ua: UA.safari }))).toContain("Open the download from the arrow in Safari&#39;s toolbar");
    expect(text(downloadPage({ ua: UA.firefox }))).toContain("Open the download from the arrow in Firefox&#39;s toolbar");
    expect(text(downloadPage({ ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Something/1" }))).toContain("Open the download from your browser, or your Downloads folder");
    const lit = (html) => html.match(/<circle cx="(\d+)" cy="(\d+)" r="15" class="lit"\/>/).slice(1).map(Number);
    expect(lit(downloadPage({ ua: UA.chrome }))).toEqual([392, 70]);
    expect(lit(downloadPage({ ua: UA.safari }))).toEqual([358, 30]);
    expect(lit(downloadPage({ ua: UA.firefox }))).toEqual([400, 70]);
  });

  test("off a Mac, starts nothing and says Lore is for a Mac", () => {
    for (const ua of [UA.iphone, UA.windows]) {
      const html = downloadPage({ ua });
      expect(html).not.toContain('http-equiv="refresh"');
      expect(text(html)).toContain("Lore is for your Mac Open this page on a Mac with Apple silicon and the download starts by itself. Send this page to your Mac Download for Mac");
      expect(html).toContain('<a class="go" data-share href="https://yourlore.dev/download">Send this page to your Mac</a>');
      expect(html).toContain(`<a class="quiet" href="${DMG}" download>Download for Mac</a>`);
      expect(html).not.toContain('class="steps"');
    }
  });

  test("an iPad behind a Mac user agent checks for touch first, and with touch=1 gets the hand-off instead of the download", async () => {
    expect(downloadPage({ ua: UA.safari })).toMatch(/<script>if\(navigator\.maxTouchPoints>1\).*<meta http-equiv="refresh"/);
    const html = await (await call("/download?touch=1&bid=abc_123", UA.safari)).text();
    expect(html).not.toContain('http-equiv="refresh"');
    expect(html).toContain('data-share href="https://yourlore.dev/download?bid=abc_123"');
  });

  test("Edge is named as Edge, on Chrome's toolbar", () => {
    const html = downloadPage({ ua: UA.edge });
    expect(html).toContain("the arrow at the top right of Edge");
    expect(html).toContain('<circle cx="392" cy="70" r="15" class="lit"/>');
  });

  test("an iPhone sent on to the Mac keeps the bid it came from", () => {
    expect(downloadPage({ ua: UA.iphone, bid: "abc_123" })).toContain('data-share href="https://yourlore.dev/download?bid=abc_123"');
  });

  test("keeps the bid someone came to answer, and drops anything that isn't a bid id", async () => {
    expect(await (await call("/download?bid=abc_123", UA.safari)).text()).toContain('<p class="then">Once Lore is open, the bid you came from is under <b>Bids</b>. <a href="/b/abc_123">See the bid</a></p>');
    for (const bid of ['"><script>alert(1)</script>', "../bids", "x".repeat(65)]) {
      const html = downloadPage({ ua: UA.safari, bid });
      expect(html).not.toContain("See the bid");
      expect(html).not.toContain("<script>alert");
    }
  });
});
