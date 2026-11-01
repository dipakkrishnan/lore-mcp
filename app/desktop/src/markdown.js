// Untrusted text (memory bodies, drafts, agent replies) to DOM: the renderer's only markup filtering. Its own script,
// loaded before renderer.js, so test/boundary.test.cjs can run it alone (APP-063). It must not reach window.lore.

marked.use({ renderer: { html: () => "" } });

/** @param {string} text */
function markdown(text) {
  const node = document.createElement("div");
  node.className = "md";
  node.innerHTML = marked.parse(text, { async: false });
  for (const link of node.querySelectorAll("a")) {
    const href = link.getAttribute("href") ?? "";
    if (!/^https?:\/\//i.test(href)) link.removeAttribute("href");
    else { link.target = "_blank"; link.rel = "noreferrer"; }
  }
  for (const image of node.querySelectorAll("img")) image.remove();
  return node;
}
