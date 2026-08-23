const { app, BrowserWindow } = require("electron");

const [out, view = "today"] = process.argv.slice(-2);
process.env.LORE_DESKTOP_SCREENSHOT = "1";
require("../src/main.cjs");

app.on("browser-window-created", (_event, window) => {
  window.webContents.once("did-finish-load", async () => {
    await new Promise((done) => setTimeout(done, 2500));
    await window.webContents.executeJavaScript(`window.__lore?.show(${JSON.stringify(view)})`);
    await new Promise((done) => setTimeout(done, 400));
    const image = await window.webContents.capturePage();
    require("node:fs").writeFileSync(out, image.toPNG());
    app.exit(0);
  });
});
