// Stamp the built service worker with (1) a unique per-build id so every deploy gets a new cache
// name (the SW's `activate` handler deletes any cache whose name isn't the current one), and
// (2) the list of this build's hashed JS/CSS bundles so the SW can precache them — making a cold
// launch render fully offline instead of just the HTML shell.
//
// Runs after `vite build` (see package.json "build") and in the CI deploy job. The id is the
// commit SHA in CI (GITHUB_SHA), else the local git short SHA, else a timestamp. Resilient: if
// the built sw.js or its placeholders aren't found, it warns and exits 0 rather than failing.

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const PLACEHOLDER = "__BUILD_ID__";
const PRECACHE_TOKEN = "/* __PRECACHE__ */";
const ROOT = "dist";

// The app only works offline for the modules OfflineGate allows — Dashboard, POS, Inventory and
// Invoices (everything else is blocked offline). So the SW precaches the app shell + exactly the
// chunks those four routes STATICALLY need, and nothing else. Online-only pages (Suppliers,
// Reports, Team, Settings, …) and the heavy on-demand PDF-export stack (jspdf/autotable/
// html2canvas/purify, reached only via a dynamic import) are left out — they still cache on-demand
// the first time they're used online, so nothing breaks; this just keeps SW install lean and
// reliable on a flaky connection.
//
// The set is computed from Vite's build manifest (build.manifest = true) by walking each seed's
// STATIC import graph — following `imports`, never `dynamicImports` — which is exactly what a cold
// offline navigation to that route requires. Precache these routes offline:
const OFFLINE_SEEDS = [
  "index.html", // the entry chunk = React + providers + Auth + AppShell (the shell/runtime)
  "src/pages/Dashboard.tsx",
  "src/pages/POS.tsx",
  "src/pages/Inventory.tsx",
  "src/pages/Invoices.tsx",
];

function offlineClosure() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(ROOT, ".vite", "manifest.json"), "utf8"));
  } catch {
    return null; // no manifest -> caller falls back to all assets
  }
  const files = new Set();
  const seen = new Set();
  const visit = (key) => {
    if (seen.has(key) || !manifest[key]) return;
    seen.add(key);
    const node = manifest[key];
    if (node.file) files.add(`/${node.file}`);
    for (const c of node.css || []) files.add(`/${c}`);
    for (const dep of node.imports || []) visit(dep); // static deps only
  };
  for (const seed of OFFLINE_SEEDS) {
    if (!manifest[seed]) throw new Error(`stamp-sw: offline seed "${seed}" not found in the Vite manifest — did a route move?`);
    visit(seed);
  }
  return [...files];
}

// Every hashed JS/CSS bundle — the fallback when the manifest is unavailable (keeps a working, if
// larger, offline shell rather than none).
function allAssets() {
  try {
    return readdirSync(join(ROOT, "assets"))
      .filter((f) => /\.(js|css)$/.test(f))
      .map((f) => `/assets/${f}`);
  } catch {
    return [];
  }
}

function assetUrls() {
  return offlineClosure() ?? allAssets();
}

function buildId() {
  const sha = process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA;
  if (sha) return sha.slice(0, 8);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return `t${Date.now()}`;
  }
}

function findSw(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) findSw(p, out);
    else if (name === "sw.js") out.push(p);
  }
  return out;
}

const id = buildId();
const assets = assetUrls();
const precacheLiteral = assets.map((u) => JSON.stringify(u)).join(",");
let patched = 0;
for (const file of findSw(ROOT)) {
  let src = readFileSync(file, "utf8");
  let changed = false;
  if (src.includes(PLACEHOLDER)) { src = src.replaceAll(PLACEHOLDER, id); changed = true; }
  if (src.includes(PRECACHE_TOKEN)) { src = src.replace(PRECACHE_TOKEN, precacheLiteral); changed = true; }
  if (changed) {
    writeFileSync(file, src);
    patched++;
    console.log(`stamp-sw: ${file} -> ${id} (+${assets.length} precache asset${assets.length === 1 ? "" : "s"})`);
  }
}
if (!patched) console.warn(`stamp-sw: no sw.js with ${PLACEHOLDER} found under ${ROOT}/ (skipped)`);
