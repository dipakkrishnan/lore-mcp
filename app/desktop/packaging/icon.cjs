const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { app, BrowserWindow } = require("electron");

const [out] = process.argv.slice(-1);
const svg = readFileSync(join(__dirname, "icon.svg"), "utf8");

app.dock?.hide();
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, transparent: true, frame: false, width: 1024, height: 1024, webPreferences: { offscreen: true } });
  await window.loadURL(`data:text/html,<body style="margin:0;background:transparent">${encodeURIComponent(svg.replace("<svg", '<svg width="1024" height="1024"'))}</body>`);
  const image = await window.webContents.capturePage();
  if (image.toBitmap()[3] !== 0) throw new Error("Icon margin is not transparent");
  writeFileSync(out, image.toPNG());
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
