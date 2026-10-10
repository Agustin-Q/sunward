// Turn the single-file build (dist/index.html) into a claude.ai Artifact page:
// the Artifact host adds its own <!doctype>/<html>/<head>/<body> skeleton,
// so we keep only <title>, font links, styles, body content and scripts.
import { readFileSync, writeFileSync } from "node:fs";

const html = readFileSync("dist/index.html", "utf8");
const head = html.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? "";
const body = html.match(/<body>([\s\S]*?)<\/body>/i)?.[1] ?? "";
const pick = (re) => head.match(re) ?? [];
const title = pick(/<title>[\s\S]*?<\/title>/i)[0] ?? "<title>Sunward Panel Planner</title>";
const links = head.match(/<link[^>]+>/gi) ?? [];
const styles = head.match(/<style[\s\S]*?<\/style>/gi) ?? [];
const scripts = head.match(/<script[\s\S]*?<\/script>/gi) ?? [];
const out = [title, ...links, ...styles, body.trim(), ...scripts].join("\n");
writeFileSync("dist/artifact.html", out);
console.log(`dist/artifact.html written (${(out.length / 1024).toFixed(0)} kB)`);
