const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { app, BrowserWindow } = require("electron");

// The DMG window's picture behind the app and Applications icons, at 1x and 2x: dmgbuild pairs `name@2x.png` with it.
const [out] = process.argv.slice(-1);
const svg = readFileSync(join(__dirname, "dmg-background.svg"), "utf8");
const WIDTH = 660;
const HEIGHT = 400;

app.dock?.hide();
app.whenReady().then(async () => {
  const [width, height] = [WIDTH * 2, HEIGHT * 2];
  const window = new BrowserWindow({ show: false, frame: false, width, height, webPreferences: { offscreen: true } });
  await window.loadURL(`data:text/html,<body style="margin:0">${encodeURIComponent(svg.replace("<svg", `<svg width="${width}" height="${height}"`))}</body>`);
  await window.webContents.executeJavaScript("document.fonts.ready.then(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))");
  const image = (await window.webContents.capturePage()).resize({ width, height, quality: "best" });
  writeFileSync(out.replace(/\.png$/, "@2x.png"), image.toPNG());
  writeFileSync(out, image.resize({ width: WIDTH, height: HEIGHT, quality: "best" }).toPNG());
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
