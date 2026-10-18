const { realpath, stat } = require("node:fs/promises");
const { basename, isAbsolute, sep } = require("node:path");

/** Where in Lore's home the agent's copies go, one folder per turn. */
const ATTACHMENTS = "attachments";
/** A credential or a hidden file: never handed to the agent, whatever the owner drags in. */
const GUARDED = /(^|\/)\.[^/]*$|\/\.(ssh|aws|gnupg)\/|\.(pem|key|p12|pfx|keychain(-db)?)$|id_(rsa|ed25519|ecdsa)/;
/** Where the agent's sandbox writes besides Lore's home. */
const SANDBOX_TMP = "/private/tmp/claude";
/** The most Lore takes from one file, and from one turn's files together. */
const FILE_CAP = 25 * 1024 * 1024;
const TURN_CAP = 100 * 1024 * 1024;
const MB = (/** @type {number} */ bytes) => `${bytes / 1024 / 1024} MB`;

/** @param {string} path @param {string[]} roots */
const within = (path, roots) => roots.some((root) => path === root || path.startsWith(root + sep));

/**
 * Check what the owner attached to a turn before the agent keeps a copy of any of it. Only regular files,
 * from outside every folder the agent can write (so nothing on the way to one can change under the copy),
 * never a credential, a hidden file, or anything in a folder Lore keeps from the agent, and within size.
 * Reads nothing: the copy streams each file, one at a time, exactly as large as it is here.
 * @param {string} loreHome @param {unknown} files @param {string[]} hidden
 * @returns {Promise<Attachment[]>}
 */
async function checkAttachments(loreHome, files, hidden) {
  if (!Array.isArray(files) || files.length > 50 || !files.every((file) => typeof file === "string" && isAbsolute(file))) throw new Error("Invalid attachments");
  const kept = await Promise.all([...hidden, loreHome, SANDBOX_TMP].map((dir) => realpath(dir).catch(() => dir)));
  /** @type {Attachment[]} */
  const checked = [];
  let total = 0;
  for (const file of files) {
    const real = await realpath(file).catch(() => file);
    const found = await stat(real).catch(() => null);
    if (GUARDED.test(file) || GUARDED.test(real) || within(real, kept) || !found?.isFile()) throw new Error(`Lore won't read ${basename(file)}`);
    if (found.size > FILE_CAP) throw new Error(`${basename(file)} is larger than Lore takes (${MB(FILE_CAP)})`);
    total += found.size;
    if (total > TURN_CAP) throw new Error(`Those files together are more than Lore takes at once (${MB(TURN_CAP)})`);
    checked.push({ name: basename(real), path: real, size: found.size });
  }
  return checked;
}

module.exports = { ATTACHMENTS, FILE_CAP, GUARDED, TURN_CAP, checkAttachments };
