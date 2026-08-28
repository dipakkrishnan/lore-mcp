const { execFile } = require("node:child_process");
const { rm, writeFile } = require("node:fs/promises");
const { join } = require("node:path");
const { promisify } = require("node:util");

const run = promisify(execFile);

/** Transcribe 16 kHz mono WAV bytes with the bundled whisper.cpp; the file never outlives the call. @param {{bin: string, model: string, dir: string}} whisper @param {Buffer} wav */
async function transcribe(whisper, wav) {
  const file = join(whisper.dir, `lore-dictation-${process.pid}-${Date.now()}.wav`);
  await writeFile(file, wav, { mode: 0o600 });
  try {
    const { stdout } = await run(whisper.bin, ["-m", whisper.model, "-f", file, "-l", "en", "-nt", "-np"], { maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    return stdout.replace(/\[[A-Z_ ]+\]/g, "").replace(/\s+/g, " ").trim();
  } finally {
    await rm(file, { force: true });
  }
}

module.exports = { transcribe };
