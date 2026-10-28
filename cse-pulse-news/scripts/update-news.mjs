// Daily news collector for CSE Pulse.
// Scrapes each source with Firecrawl, tags stories Local or Global, groups duplicates
// and writes docs/news.json, which the page in docs/index.html reads.
// Needs Node 18+ and the FIRECRAWL_API_KEY environment variable.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const KEY = process.env.FIRECRAWL_API_KEY;
const OUT = process.env.NEWS_OUT || "docs/news.json";
const MAX_AGE_DAYS = 21;
const MAX_ITEMS = 60;
const CLUSTER_WINDOW_DAYS = 4;
const MIN_SHARED_WORDS = 3; // two headlines are one story only if one is wholly contained in the other and they share at least this many meaningful words

const LOCAL_FOCUS =
  "Only stories about the Sri Lankan economy, markets, banks, listed companies, trade, energy, tourism, taxes or government economic policy.";
const GLOBAL_FOCUS =
  "Only stories that could move oil prices, the US dollar, US interest rates, tariffs and trade, global growth, shipping routes, or the Chinese and Indian economies.";

// id is used by the page; region decides the Local or Global label.
const SOURCES = [
  { id: "ft", name: "Daily FT", url: "https://www.ft.lk/", region: "Local", focus: LOCAL_FOCUS },
  { id: "lbo", name: "Lanka Business Online", url: "https://www.lankabusinessonline.com/", region: "Local", focus: LOCAL_FOCUS },
  { id: "ips", name: "IPS", url: "https://www.ips.lk/", region: "Local", focus: LOCAL_FOCUS },
  { id: "eco", name: "Economy.lk", url: "https://economy.lk/", region: "Local", focus: LOCAL_FOCUS },
  { id: "bb", name: "Bloomberg", url: "https://www.bloomberg.com/", region: "Global", focus: GLOBAL_FOCUS }
];

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          date: { type: "string" },
          summary: { type: "string" }
        },
        required: ["title"]
      }
    }
  },
  required: ["items"]
};

const colomboToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(new Date());
const dayNumber = (iso) => Math.floor(Date.parse(iso + "T00:00:00Z") / 86400000);
const absUrl = (u, base) => { try { return new URL(u, base).toString(); } catch { return null; } };
const validIso = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || "") && !Number.isNaN(Date.parse(s)) ? s : null);
const dateFromUrl = (u) => { const m = /\/(20\d{2})\/(\d{2})\/(\d{2})\//.exec(u || ""); return m ? m[1] + "-" + m[2] + "-" + m[3] : null; };

async function scrape(src) {
  const body = {
    url: src.url,
    formats: [{
      type: "json",
      schema: SCHEMA,
      prompt:
        "List up to 15 of the newest news stories or articles shown on this page. " + src.focus +
        " For each give: title (the headline as shown), url (the link to the article), date (YYYY-MM-DD if shown or visible in the link, otherwise empty)," +
        " and summary (one neutral sentence in your own words)."
    }],
    onlyMainContent: false
  };
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000)
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error("HTTP " + res.status + " " + (json.error || ""));
      const items = json.data?.json?.items;
      if (!Array.isArray(items)) throw new Error("no items in response");
      return items;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw lastError;
}

function clean(src, rawItems, today) {
  const out = [];
  for (const it of rawItems) {
    const t = String(it.title || "").replace(/\s+/g, " ").trim();
    const u = absUrl(it.url, src.url);
    if (t.length < 15 || !u) continue;
    if (u.replace(/\/$/, "") === src.url.replace(/\/$/, "")) continue; // a link back to the home page is not an article
    const d = validIso(it.date) || dateFromUrl(u) || today;
    if (dayNumber(today) - dayNumber(d) > MAX_AGE_DAYS || dayNumber(d) > dayNumber(today) + 1) continue;
    out.push({ d, r: src.region, s: src.id, u, t, sum: String(it.summary || "").replace(/\s+/g, " ").trim() });
  }
  return out;
}

const STOP = new Set("the a an and or of to in on for at by with from as is are was were be been it its this that new says say after over into amid vs up down out more than sri lanka lankan lanka's rs us bn mn per cent percent".split(" "));
function tokens(title) {
  return new Set(
    title.toLowerCase().replace(/[^a-z0-9. ]/g, " ").split(/\s+/)
      .map((w) => w.replace(/\.$/, "").replace(/s$/, ""))
      .filter((w) => w.length > 2 && !STOP.has(w))
  );
}
// Same story: every meaningful word of the shorter headline appears in the longer one.
// This keeps two different companies' look-alike headlines (e.g. two Fitch rating notices) apart.
function sameStory(a, b) {
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  const uniqueA = a.size - shared, uniqueB = b.size - shared;
  return shared >= MIN_SHARED_WORDS && Math.min(uniqueA, uniqueB) === 0;
}

// Give stories that are the same news from different sites a shared key (k). The page shows them once.
function groupDuplicates(items) {
  const reps = [];
  const seenUrl = new Map();
  for (const it of items) {
    if (seenUrl.has(it.u)) { it.k = seenUrl.get(it.u); continue; }
    const tk = tokens(it.t);
    let hit = null;
    for (const r of reps) {
      if (Math.abs(dayNumber(r.d) - dayNumber(it.d)) <= CLUSTER_WINDOW_DAYS && sameStory(tk, r.tk)) { hit = r; break; }
    }
    if (hit) it.k = hit.k;
    else { it.k = "k" + reps.length + "-" + it.d; reps.push({ k: it.k, d: it.d, tk }); }
    seenUrl.set(it.u, it.k);
  }
  return items;
}

async function readPrevious() {
  try { return JSON.parse(await readFile(OUT, "utf8")); } catch { return { items: [] }; }
}

async function main() {
  if (!KEY) { console.error("FIRECRAWL_API_KEY is not set."); process.exit(1); }
  const today = colomboToday();
  const previous = await readPrevious();
  let items = [];
  const failed = [];

  for (const src of SOURCES) {
    try {
      const got = clean(src, await scrape(src), today);
      console.log(src.name + ": " + got.length + " stories");
      items.push(...got);
    } catch (e) {
      console.error(src.name + " failed: " + e.message);
      failed.push(src.id);
      items.push(...(previous.items || []).filter((p) => p.s === src.id)); // keep the last good stories for this source
    }
  }

  if (failed.length === SOURCES.length) { console.error("Every source failed. Leaving news.json unchanged."); process.exit(1); }

  // same article link listed twice by one source counts once
  const byUrl = new Map();
  for (const it of items) if (!byUrl.has(it.u)) byUrl.set(it.u, it);
  items = [...byUrl.values()].filter((it) => dayNumber(today) - dayNumber(it.d) <= MAX_AGE_DAYS);
  items.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
  items = groupDuplicates(items).slice(0, MAX_ITEMS);

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), failed, items }, null, 1) + "\n");
  const stories = new Set(items.map((i) => i.k)).size;
  console.log("Wrote " + items.length + " headlines (" + stories + " distinct stories) to " + OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
