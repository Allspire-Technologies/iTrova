// Blog cover + inline image generator for itrova.co/blog posts.
//
//   node scripts/blog-cover.mjs --title "Is your shop actually making money?" \
//     --sub "5 numbers that tell you the truth" --tag "Money management" \
//     --image docs/knowledge/screenshots/blog/post1-raw-reports.png --out docs/knowledge/screenshots/blog --slug post1
//
//   node scripts/blog-cover.mjs --batch posts.json --out <dir>
//     posts.json = [{ slug, title, sub, tag, image, accent?, pos?, only? }, ...]
//
// Options: --accent green|amber|red (tag dot colour, default green)
//          --pos "x% y%"  which part of the screenshot the tilted cover frame shows (default "0% 22%")
//          --only cover|inline  (default: both)
// Writes <out>/<slug>-cover-1200x630.png (OG/social size) and <out>/<slug>-inline.png (1600x1000, for the article body).
// Screenshots should come from the demo-seeded app (e2e/screenshots.spec.ts) so no customer data is published.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const ACCENTS = { green: "#1D9E75", amber: "#E0A93A", red: "#E06060" };

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith("--")) continue;
    const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    a[k.slice(2)] = v;
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
const out = args.out || "docs/knowledge/screenshots/blog";
let posts;
if (args.batch) {
  posts = JSON.parse(fs.readFileSync(args.batch, "utf8"));
} else {
  if (!args.title || !args.image) {
    console.error("Need --title and --image (or --batch file.json). See header of this script.");
    process.exit(1);
  }
  posts = [args];
}
fs.mkdirSync(out, { recursive: true });

const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const dataUri = (file) => "data:image/png;base64," + fs.readFileSync(file).toString("base64");
const fonts = `<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500&display=swap" rel="stylesheet">`;
const chrome = `<div class="bar"><i></i><i></i><i></i></div>`;

const coverHtml = (p, img) => `<!doctype html><html><head><meta charset="utf-8">${fonts}<style>
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;overflow:hidden;background:#085041;font-family:"DM Sans",system-ui,sans-serif;color:#fff;position:relative}
.glow{position:absolute;width:900px;height:900px;border-radius:50%;background:radial-gradient(closest-side,rgba(29,158,117,.55),transparent);right:-250px;top:-350px}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.04) 1px,transparent 1px);background-size:40px 40px}
.txt{position:absolute;left:64px;top:64px;width:560px;height:502px;display:flex;flex-direction:column;justify-content:space-between}
.tag{display:inline-flex;align-items:center;gap:10px;font-size:15px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:#E1F5EE}
.tag i{width:10px;height:10px;border-radius:50%;background:${ACCENTS[p.accent] || ACCENTS.green};display:inline-block}
h1{font-family:Syne,system-ui,sans-serif;font-weight:800;font-size:${p.title.length > 44 ? 46 : 54}px;line-height:1.08;letter-spacing:-.01em;margin-top:26px}
.sub{font-size:22px;line-height:1.35;color:#BFE7D8;margin-top:18px;max-width:520px}
.brand{display:flex;align-items:center;gap:12px;font-family:Syne,sans-serif;font-weight:700;font-size:22px}
.brand b{width:38px;height:38px;border-radius:11px;background:#1D9E75;display:grid;place-items:center}
.brand span{color:#BFE7D8;font-family:"DM Sans";font-weight:400;font-size:16px;margin-left:6px}
.shot{position:absolute;left:660px;top:78px;width:760px;height:560px;border-radius:18px;background:#fff;box-shadow:0 40px 90px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.12);overflow:hidden;transform:rotate(-3deg);transform-origin:top left}
.bar{height:34px;background:#F3F8F6;border-bottom:1px solid #DCE9E3;display:flex;align-items:center;gap:7px;padding-left:14px}
.bar i{width:10px;height:10px;border-radius:50%}.bar i:nth-child(1){background:#F0A5A5}.bar i:nth-child(2){background:#F5D68A}.bar i:nth-child(3){background:#9ED9BE}
.shot img{width:100%;height:calc(100% - 34px);object-fit:cover;object-position:${p.pos || "0% 22%"};display:block}
</style></head><body><div class="glow"></div><div class="grid"></div>
<div class="txt"><div><div class="tag"><i></i>${esc(p.tag || "iTrova")}</div><h1>${esc(p.title)}</h1><div class="sub">${esc(p.sub)}</div></div>
<div class="brand"><b><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1-5h16l1 5"/><path d="M3 9a3 3 0 006 0 3 3 0 006 0 3 3 0 006 0"/><path d="M5 12v8h14v-8"/><path d="M10 20v-5h4v5"/></svg></b>iTrova<span>itrova.co/blog</span></div></div>
<div class="shot">${chrome}<img src="${img}"></div></body></html>`;

const inlineHtml = (img) => `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}body{width:1600px;height:1000px;background:linear-gradient(135deg,#E1F5EE,#F6FBF9 60%,#E1F5EE);display:grid;place-items:center;overflow:hidden}
.shot{width:1440px;border-radius:18px;background:#fff;box-shadow:0 30px 70px rgba(8,80,65,.22),0 0 0 1px rgba(8,80,65,.08);overflow:hidden}
.bar{height:36px;background:#F3F8F6;border-bottom:1px solid #DCE9E3;display:flex;align-items:center;gap:8px;padding-left:16px}
.bar i{width:11px;height:11px;border-radius:50%}.bar i:nth-child(1){background:#F0A5A5}.bar i:nth-child(2){background:#F5D68A}.bar i:nth-child(3){background:#9ED9BE}
img{width:100%;height:864px;object-fit:cover;object-position:top;display:block}
</style></head><body><div class="shot">${chrome}<img src="${img}"></div></body></html>`;

const browser = await chromium.launch();
try {
  for (const p of posts) {
    const slug = p.slug || path.basename(p.image, path.extname(p.image));
    const img = dataUri(p.image);
    const jobs = [];
    if (p.only !== "inline") jobs.push(["cover-1200x630", coverHtml(p, img), 1200, 630]);
    if (p.only !== "cover") jobs.push(["inline", inlineHtml(img), 1600, 1000]);
    for (const [kind, html, width, height] of jobs) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
      await page.setContent(html, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(600);
      const file = path.join(out, `${slug}-${kind}.png`);
      await page.screenshot({ path: file });
      await page.close();
      console.log("wrote", file);
    }
  }
} finally {
  await browser.close();
}
