const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { app, BrowserWindow } = require("electron");

const [out] = process.argv.slice(-1);
const svg = readFileSync(join(__dirname, "icon.svg"), "utf8");

app.dock?.hide();
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, transparent: true, frame: false, width: 1024, height: 1024, webPreferences: { offscreen: true } });
  await window.loadURL(`data:text/html,<body style="margin:0;background:transparent">${encodeURIComponent(svg.replace("<svg", '<svg width="1024" height="1024"'))}</body>`);
  // An offscreen page can be captured before the mark inside the tile has painted, leaving a plain green square:
  // wait until the tile's centre shows the mark's cream.
  let image = await window.webContents.capturePage();
  for (let tries = 0; image.toBitmap()[(512 * 1024 + 512) * 4 + 1] < 200; tries++) {
    if (tries === 50) throw new Error("The mark never painted inside the icon's tile");
    await new Promise((resolve) => setTimeout(resolve, 100));
    image = await window.webContents.capturePage();
  }
  if (image.toBitmap()[3] !== 0) throw new Error("Icon margin is not transparent");
  writeFileSync(out, image.toPNG());
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
