const { readFile, rename, writeFile } = require("node:fs/promises");

// New-sale notifications (MON-037): which sales the owner hasn't heard about,
// and the plain words for each Mac notification.

/** Past this many at once, one notification says how many instead of one each. */
const ONE_EACH = 3;

/** @param {Sale} sale */
const key = (sale) => `${sale.network}:${sale.tx}`;

/** What to remember after reading the ledger: its newest sale, or that it was read empty. @param {Sale[]} rows @returns {SeenSale} */
function marker(rows) {
  return rows.length ? { sold_at: rows[0].sold_at, key: key(rows[0]) } : { sold_at: "", key: "" };
}

/** Sales newer than the last one announced, oldest first. Nothing on a first read, so history never floods in. @param {Sale[]} rows newest first @param {SeenSale | null} seen */
function unseen(rows, seen) {
  if (!seen) return [];
  const fresh = [];
  for (const sale of rows) {
    if (key(sale) === seen.key || sale.sold_at < seen.sold_at) break;
    fresh.push(sale);
  }
  return fresh.reverse();
}

/** @param {number} usd */
const dollars = (usd) => `$${usd < 0.01 ? usd : usd.toFixed(2)}`;

/** @param {Sale} sale */
const how = (sale) => (sale.network === "stripe" ? "by card" : "by an agent");

/** One notification per sale, or one for the lot when many land together. @param {Sale[]} fresh @returns {Array<{title: string, body: string}>} */
function announcements(fresh) {
  if (fresh.length > ONE_EACH) {
    const total = fresh.reduce((sum, sale) => sum + sale.price_usd, 0);
    const free = fresh.filter((sale) => sale.network === "free").length;
    const paid = fresh.length - free;
    const read = `${free} free ${free === 1 ? "copy" : "copies"} read`;
    if (!paid) return [{ title: `${read[0].toUpperCase()}${read.slice(1)}`, body: "Free copies of your pieces" }];
    return [{ title: `You sold ${paid} ${paid === 1 ? "piece" : "pieces"}`, body: `${dollars(total)}${free ? ` · ${read}` : ""}` }];
  }
  return fresh.map((sale) =>
    sale.network === "free"
      ? { title: "Someone read a free copy", body: sale.title }
      : {
          title: sale.kind === "answer" ? "You sold an answer" : "You sold a piece",
          body: `${sale.title} · ${dollars(sale.price_usd)} ${how(sale)}`
        }
  );
}

/** Post one Mac notification: Notification Center's own banner, with Lore's icon. @param {{title: string, body: string}} words @param {() => void} onClick */
function notify(words, onClick) {
  const { Notification } = require("electron");
  if (!Notification.isSupported()) return;
  const note = new Notification(words);
  note.on("click", onClick);
  note.show();
}

/** The last sale announced, or null when there is none or the file can't be read: a damaged
 * marker reads as a first read, and the next write repairs it. @param {string} file @returns {Promise<SeenSale | null>} */
async function readSeen(file) {
  try {
    const seen = JSON.parse(await readFile(file, "utf8"));
    return typeof seen?.sold_at === "string" && typeof seen?.key === "string" ? seen : null;
  } catch {
    return null;
  }
}

/** Written beside the file, then renamed over it, so a crash mid-write leaves the old marker whole. @param {string} file @param {SeenSale} seen */
async function writeSeen(file, seen) {
  await writeFile(`${file}.tmp`, JSON.stringify(seen));
  await rename(`${file}.tmp`, file);
}

module.exports = { marker, unseen, announcements, notify, readSeen, writeSeen };
