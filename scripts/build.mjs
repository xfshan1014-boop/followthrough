// Builds every version of the tracker from src/: no dependencies, run with `node scripts/build.mjs`.
//   build/artifact.html  -> the claude.ai Artifact (Claude built in, platform layer in Artifact mode)
//   docs/index.html      -> the web version on GitHub Pages
//   mac/Resources/web/   -> the page bundled inside the Mac app
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = p => fs.readFileSync(path.join(root, p), "utf8");
const write = (p, s) => { fs.mkdirSync(path.dirname(path.join(root, p)), {recursive: true}); fs.writeFileSync(path.join(root, p), s); };
const config = JSON.parse(read("scripts/config.json"));

const tracker = read("src/tracker.html");
const platformCss = read("src/platform.css");
const platformJs = read("src/samples.js") + "\n" + read("src/platform.js");
const fontsCss = read("docs/fonts/fonts.css");

// 1. Artifact: unchanged source, booted directly.
// claude.ai has its own Claude and storage; the platform layer switches to Artifact mode there.
const artifact = tracker
  .replace(/<title>.*?<\/title>/, "<title>Followthrough</title>")
  .replace("</style>\n", "</style>\n<style>\n" + platformCss + "</style>\n")
  .trimEnd() + "\n<script>window.TRACKER_CONFIG=" + JSON.stringify({version: config.version, repo: config.repo}) + ";</script>\n<script>\n" + platformJs + "\n</script>\n";
write("build/artifact.html", artifact);

// 2. Web + Mac: a full document with local fonts, a strict security policy, and the platform layer.
const providers = [
  "https://api.anthropic.com", "https://api.openai.com", "https://generativelanguage.googleapis.com",
  "https://api.deepseek.com", "https://openrouter.ai", "https://api.groq.com", "https://api.together.xyz",
  "https://api.mistral.ai", "http://localhost:*", "http://127.0.0.1:*"
];
if (config.signupUrl) providers.push(new URL(config.signupUrl).origin);
const csp = [
  "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'", "font-src 'self'",
  "img-src 'self' data: blob:", "connect-src " + providers.join(" "), "object-src 'none'", "base-uri 'none'", "form-action 'none'"
].join("; ");

const titleMatch = tracker.match(/<title>.*?<\/title>\n?/);
let body = tracker
  .replace(titleMatch[0], "")
  .replace(/<meta name="claude:viewport-fit-sides"[^>]*>\n?/, "")
  .replace(/<link rel="preconnect"[^>]*>\n?/g, "")
  .replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>\n?/, "");

function page(fontPrefix) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
<meta name="description" content="A daily tracker for work that runs through other people: next actions, who you're waiting on, and meeting notes turned into updates. Your work stays on your computer.">
<meta name="theme-color" content="#f6f6f3">
<title>Followthrough</title>
<link rel="icon" href="${fontPrefix}icon.svg" type="image/svg+xml">
<style>
:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
body{margin:0;font:14px/1.5 system-ui,-apple-system,sans-serif}img{max-width:100%}[hidden]{display:none!important}
${fontsCss.replaceAll("url(fonts/", `url(${fontPrefix}fonts/`)}
${platformCss}
</style>
</head>
<body>
${body.trim()}
<script>window.TRACKER_CONFIG=${JSON.stringify({version: config.version, repo: config.repo, signupUrl: config.signupUrl || "", signupKey: config.signupKey || ""})};</script>
<script>
${platformJs}
</script>
</body>
</html>
`;
}
write("docs/index.html", page(""));
write("mac/Resources/web/index.html", page(""));
for (const f of fs.readdirSync(path.join(root, "docs/fonts"))) {
  fs.mkdirSync(path.join(root, "mac/Resources/web/fonts"), {recursive: true});
  fs.copyFileSync(path.join(root, "docs/fonts", f), path.join(root, "mac/Resources/web/fonts", f));
}
fs.copyFileSync(path.join(root, "assets/icon.svg"), path.join(root, "docs/icon.svg"));
fs.copyFileSync(path.join(root, "assets/icon.svg"), path.join(root, "mac/Resources/web/icon.svg"));
write("docs/.nojekyll", "");
console.log("Built build/artifact.html, docs/index.html, mac/Resources/web/index.html (v" + config.version + ")");
