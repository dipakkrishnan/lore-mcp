// APP-063: what src/markdown.js puts into a real Chromium DOM, for test/boundary.test.cjs. Loads marked and
// markdown.js exactly as index.html does (classic scripts, main world), renders each input, prints the innerHTML.
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { app, BrowserWindow } = require("electron");

const [inputs, output, directory] = process.argv.slice(-3);
app.setPath("userData", directory);

/** A script's last statement is its result, which executeJavaScript must clone; marked.use returns a function. @param {string} path */
const script = (path) => `${readFileSync(path, "utf8")}\n;void 0`;

app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await window.loadURL("about:blank");
    await window.webContents.executeJavaScript(script(join(__dirname, "../node_modules/marked/lib/marked.umd.js")));
    await window.webContents.executeJavaScript(script(join(__dirname, "../src/markdown.js")));
    const texts = JSON.parse(readFileSync(inputs, "utf8"));
    const rendered = await window.webContents.executeJavaScript(`${JSON.stringify(texts)}.map((text) => markdown(text).innerHTML)`);
    writeFileSync(output, JSON.stringify(rendered));
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
