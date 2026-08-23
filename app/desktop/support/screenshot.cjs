const { app, BrowserWindow } = require("electron");

const [out, view = "today"] = process.argv.slice(-2);
require("../src/main.cjs");

app.on("browser-window-created", (_event, window) => {
  window.webContents.once("did-finish-load", async () => {
    await new Promise((done) => setTimeout(done, 2500));
    await window.webContents.executeJavaScript(`window.__lore?.signIn(); window.__lore?.show(${JSON.stringify(view)})`);
    for (let i = 0; i < 30; i++) {
      if (await window.webContents.executeJavaScript(`(() => { const t = (document.querySelector("#content")?.textContent ?? "").trim(); return t !== "" && t !== "Loading…"; })()`)) break;
      await new Promise((done) => setTimeout(done, 500));
    }
    await new Promise((done) => setTimeout(done, 400));
    const image = await window.webContents.capturePage();
    require("node:fs").writeFileSync(out, image.toPNG());
    app.exit(0);
  });
});
