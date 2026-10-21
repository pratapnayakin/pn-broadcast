#!/usr/bin/env node
/**
 * PN Broadcast (engine: feeds-dedup)
 * ---------------------------------
 * Fetches a list of RSS feeds, removes near-duplicate headlines
 * (the same story reported by many publishers), and writes:
 *
 *   public/<filename>.xml   clean RSS 2.0 feed, one per source
 *   public/index.html       readable page listing every feed
 *
 * Feeds live in feeds.json. To add one, add an entry:
 *
 *   {
 *     "filename": "my-feed",     -> becomes public/my-feed.xml
 *     "title": "My Feed",
 *     "description": "What it covers",
 *     "keywords": ["single word", "some phrase"],
 *     "exclude": ["noise", "junk"]  -> optional, appends -noise -junk
 *   }
 *
 * Keywords are matched exactly as typed (phrases stay phrases).
 * Need full control (operators, site: filters, non-Google sources)?
 * Set "url" instead of "keywords" and it is used as-is.
 *
 * Usage: npm start   (or: node dedup.js)
 */

const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONFIG_FILE = path.join(__dirname, 'feeds.json');
const OUTPUT_DIR = path.join(__dirname, 'public');

// Used to turn keywords into a Google News search URL for feeds that
// do not define their own "url".
const GOOGLE_NEWS_SEARCH = 'https://news.google.com/rss/search';
const GOOGLE_NEWS_LOCALE = { hl: 'en-IN', gl: 'IN', ceid: 'IN:en' };

// Where the site is published. Used to build absolute URLs in feeds.opml.
// If you rename the repository, update this.
const SITE_URL = 'https://pratapnayakin.github.io/pn-broadcast';

// Items older than this many days are dropped. Google News fills low-volume
// feeds with years-old articles. 365 removes multi-year filler while keeping
// low-volume topics usable; override per feed with "maxAgeDays" (e.g. 30 for
// high-volume topics).
const MAX_AGE_DAYS = 365;

// Words too common to help tell two headlines apart.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or',
  'is', 'was', 'are', 'were', 'by', 'with', 'from', 'as', 'into', 'over', 'after',
]);

// Two headlines count as the same story when they share at least this
// fraction of their meaningful words (0 = nothing matches, 1 = identical).
// 0.45, tuned from run data: catches reworded duplicates of big news cycles.
// Raise it if genuinely different stories start merging.
const SIMILARITY_THRESHOLD = 0.45;

// How many headlines per feed the index page shows. The full list stays in
// each XML feed; the index is a scannable summary so the file stays small.
const INDEX_HEADLINES_PER_FEED = 10;

// Per-feed fetch guard. Pure Node, no library option needed.
// TIMEOUT per attempt, RETRIES extra tries on fail or timeout.
const FETCH_TIMEOUT_MS = 15000;
const FETCH_RETRIES = 2;

// ---------------------------------------------------------------------------
// Feed URLs
// ---------------------------------------------------------------------------

/**
 * Resolves the URL for one feed. An explicit "url" always wins;
 * otherwise the keywords become: "a" OR "b" OR "c" on Google News.
 * An optional "exclude" list appends -term filters (keyword feeds only).
 * Multi-word terms are quoted: -"gold rate", not -gold rate.
 */
function buildFeedUrl(feed) {
  if (feed.url) return feed.url;
  if (!Array.isArray(feed.keywords) || feed.keywords.length === 0) {
    throw new Error('feed needs either "keywords" or "url"');
  }
  let query = feed.keywords.map((keyword) => `"${keyword}"`).join(' OR ');
  if (Array.isArray(feed.exclude) && feed.exclude.length > 0) {
    const parts = feed.exclude.map((term) => {
      const t = String(term || '').trim();
      return t.includes(' ') ? `-"${t}"` : `-${t}`;
    });
    query += ` ${parts.join(' ')}`;
  }
  const params = new URLSearchParams({ q: query, ...GOOGLE_NEWS_LOCALE });
  return `${GOOGLE_NEWS_SEARCH}?${params}`;
}

/**
 * True for Google News URLs. Publisher-strip applies only here.
 * Generic RSS (custom sites) keeps its hyphens intact.
 */
function isGoogleNewsUrl(url) {
  return String(url || '').includes('news.google.com');
}

/**
 * Parse one URL with timeout. Rejects if parser takes too long.
 * Uses Promise.race so no dependency on parser timeout options.
 */
function parseWithTimeout(parser, url) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`fetch timeout after ${FETCH_TIMEOUT_MS}ms`)), FETCH_TIMEOUT_MS);
  });
  const fetch = parser.parseURL(url).finally(() => {
    if (timer) clearTimeout(timer);
  });
  return Promise.race([fetch, timeout]);
}

/**
 * Fetches with retry. Retries on network fail or timeout.
 * Throws last error after all attempts, caller logs [fail].
 */
async function fetchWithRetry(parser, url) {
  let lastErr = null;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    try {
      return await parseWithTimeout(parser, url);
    } catch (err) {
      lastErr = err;
      // small backoff: 1s, 2s. Keeps hourly run fast but tolerant.
      if (attempt < FETCH_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// freehire.me JSON source
// ---------------------------------------------------------------------------

/**
 * Maps one freehire.me job to our item shape.
 * The title carries the company so the headline reads on its own.
 * Description carries location, skills and the source id, which keeps
 * postings with identical titles apart during dedupe.
 */
function mapFreehireJob(job) {
  const company = String(job.company || '').trim();
  const title = String(job.title || '').trim();
  const head = company ? `${title} at ${company}` : title;
  const location = String(job.location || '').trim();
  const skills = Array.isArray(job.skills) ? job.skills.slice(0, 8).join(', ') : '';
  const id = String(job.external_id || job.public_slug || '').trim();
  return {
    title: head,
    link: job.url || '',
    guid: job.external_id || job.public_slug || job.url || '',
    pubDate: job.posted_at || '',
    contentSnippet: [location, skills, id].filter(Boolean).join(' | '),
  };
}

/** Maps a freehire.me search response to our item list. */
function mapFreehireItems(payload) {
  const rows = Array.isArray(payload && payload.data) ? payload.data : [];
  return rows.map(mapFreehireJob).filter((it) => it.title && it.link);
}

/** GET a JSON endpoint with the same timeout guard as the RSS fetcher. */
async function fetchJsonWithTimeout(url) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`fetch timeout after ${FETCH_TIMEOUT_MS}ms`)), FETCH_TIMEOUT_MS);
  });
  // The timeout covers the whole request, not just the JSON parse.
  const req = (async () => {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'PN Broadcast (feeds-dedup)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  })();
  try {
    return await Promise.race([req, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
/** Fetches JSON with retry. Throws after all attempts, caller logs [fail]. */
async function fetchJsonWithRetry(url) {
  let lastErr = null;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    try {
      return await fetchJsonWithTimeout(url);
    } catch (err) {
      lastErr = err;
      if (attempt < FETCH_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

/**
 * Fails fast on config mistakes. Call once in main before fetching.
 * Checks duplicate filenames, unknown bundle sources, and category
 * entries that point at feeds which do not exist.
 */
function validateConfig(feeds, bundles, categories) {
  const seen = new Set();
  for (const feed of feeds) {
    if (!feed.filename) throw new Error('feed missing "filename"');
    if (seen.has(feed.filename)) throw new Error(`duplicate filename "${feed.filename}"`);
    seen.add(feed.filename);
    if (!feed.url && (!Array.isArray(feed.keywords) || feed.keywords.length === 0)) {
      throw new Error(`feed "${feed.filename}" needs either "keywords" or "url"`);
    }
  }
  const names = new Set([...seen, ...(bundles || []).map((b) => b.filename)]);
  for (const bundle of bundles || []) {
    for (const src of bundle.sources || []) {
      if (!seen.has(src)) throw new Error(`bundle "${bundle.filename}" unknown source "${src}"`);
    }
    if (names.has(bundle.filename) && seen.has(bundle.filename)) {
      throw new Error(`bundle filename "${bundle.filename}" collides with feed filename`);
    }
  }
  for (const cat of categories || []) {
    if (!cat.slug || !cat.label) throw new Error('category needs "label" and "slug"');
    for (const f of cat.filenames || []) {
      if (!names.has(f)) throw new Error(`category "${cat.slug}" unknown feed "${f}"`);
    }
  }
}

// ---------------------------------------------------------------------------
// Headline comparison
// ---------------------------------------------------------------------------

/**
 * Light stemmer: strips common English suffixes so "arrested"/"arrest" and
 * "outages"/"outage" compare as the same word. A heuristic, not linguistics.
 * No "es" rule on purpose: for headline words (outages, issues, cases,
 * releases) the "e" belongs to the stem, so stripping bare "s" is correct.
 * Non-Latin words (Odia) never match these suffixes, so they pass through.
 * Guard: keeps exceptions intact (news, business) and never returns a
 * stem shorter than 3 chars (sing stays sing, not s).
 */
const STEM_EXCEPTIONS = new Set(['news', 'business', 'status', 'this', 'does']);
function stem(word) {
  if (STEM_EXCEPTIONS.has(word)) return word;
  const out = word.replace(/(ing|ed|s)$/, '');
  return out.length >= 3 ? out : word;
}

/**
 * Turns a headline into a Set of meaningful lowercase words.
 * Strips trailing " - Publisher" only for Google News titles.
 * Generic RSS keeps hyphens, else "Rourkela - Power cut" would break.
 */
function extractTokens(title, stripPublisher = true) {
  const input = String(title || '');
  const withoutPublisher = stripPublisher
    ? input.replace(/\s*-\s*[^-]+$/, '')
    : input;
  const lowered = withoutPublisher.toLowerCase();
  const words = lowered
    // drop punctuation (Unicode-aware). \p{M} keeps combining marks - Odia
    // and other Indic vowel signs are marks, not letters, and would
    // otherwise be stripped, corrupting every word.
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word))
    .map(stem)
    .filter((word) => word.length > 2);
  return new Set(words);
}

/**
 * Sorensen-Dice score: how much two word-sets overlap.
 * 0 = nothing in common, 1 = identical.
 */
function similarityScore(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let matches = 0;
  for (const token of setA) {
    if (setB.has(token)) matches++;
  }
  return (2 * matches) / (setA.size + setB.size);
}

/** True when `tokens` matches any headline we already accepted. */
function isDuplicate(tokens, acceptedSets) {
  return acceptedSets.some(
    (seen) => similarityScore(tokens, seen) >= SIMILARITY_THRESHOLD
  );
}

/**
 * Drops items older than `maxAgeDays`. Items with a missing or unparseable
 * date are kept - we do not discard content we cannot date.
 */
function filterByAge(items, maxAgeDays) {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  return items.filter((item) => {
    const date = new Date(item.pubDate || item.isoDate || '');
    return Number.isNaN(date.getTime()) || date.getTime() >= cutoff;
  });
}

/**
 * Keeps only items whose title contains any of the filter words
 * (case-insensitive). Slices a broad source down to one topic, e.g. an
 * Odia-language agency filtered to Rourkela. No "filter" field = keep all.
 */
function filterByTitle(items, filterWords) {
  if (!Array.isArray(filterWords) || filterWords.length === 0) return items;
  const words = filterWords.map((word) => String(word).toLowerCase());
  return items.filter((item) => {
    const title = String(item.title || '').toLowerCase();
    return words.some((word) => title.includes(word));
  });
}

/** Milliseconds since epoch for sorting, or 0 when the item has no usable date. */
function dateValue(item) {
  const date = new Date(item.pubDate || item.isoDate || '');
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

// Characters that must be escaped inside XML/HTML, mapped to their
// named entities (e.g. the ampersand maps to "amp").
const XML_ENTITIES = { '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": 'apos' };

/** Escapes text so it is safe inside both XML and HTML. */
function escapeText(unsafe) {
  return String(unsafe || '').replace(
    /[&<>"']/g,
    (char) => `&${XML_ENTITIES[char]};`
  );
}

/** Short human date, e.g. "Sep 13". Empty string for missing dates. */
function shortDate(dateString) {
  const date = new Date(dateString);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Relative age for index rows, e.g. "2h ago", "5d ago". Empty when dateless. */
function relativeTime(dateString) {
  const t = new Date(dateString).getTime();
  if (Number.isNaN(t)) return '';
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** Publisher name from a Google News title suffix, e.g. " - The Hindu". */
function publisherOf(item) {
  if (!isGoogleNewsUrl(item.link)) return '';
  const m = String(item.title || '').match(/\s*-\s*([^-]+)$/);
  return m ? m[1].trim() : '';
}

/**
 * Headline for the web page: strips the trailing " - Publisher" suffix that
 * Google News appends, since the source is shown in the meta line instead.
 * RSS XML keeps the full title; this is display-only.
 */
function displayTitle(item) {
  const title = String(item.title || '');
  if (!isGoogleNewsUrl(item.link)) return title;
  return title.replace(/\s*-\s*[^-]+$/, '');
}

/** Builds one RSS 2.0 channel from a feed config and its unique items. */
function buildRssXml(feed, items) {
  // Self link for validators and readers. Base feeds carry filename,
  // bundles are passed with filename too, so prefer SITE_URL + filename.
  const selfUrl = feed.filename ? `${SITE_URL}/${feed.filename}.xml` : (feed.link || `${SITE_URL}/`);
  const itemsXml = items
    .map((item) => {
      // Fallback chain: pubDate -> isoDate -> now. Avoids empty pubDate
      // which some readers reject. Same chain as dateValue().
      const pub = item.pubDate || item.isoDate || new Date().toUTCString();
      return `
    <item>
      <title>${escapeText(item.title)}</title>
      <link>${escapeText(item.link)}</link>
      <guid isPermaLink="false">${escapeText(item.guid || item.link)}</guid>
      <pubDate>${escapeText(pub)}</pubDate>
      <description>${escapeText(item.contentSnippet || item.content || '')}</description>
    </item>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeText(feed.title)}</title>
    <link>${escapeText(feed.link || 'https://news.google.com')}</link>
    <atom:link href="${escapeText(selfUrl)}" rel="self" type="application/rss+xml" />
    <description>${escapeText(feed.description)}</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    ${itemsXml}
  </channel>
</rss>`;
}

// Note on categories: the list of site sections (label, slug, accent, and
// which feeds go in them) lives in feeds.json under "categories", not here.
// That is what lets the manage UI add a feed to a real section without
// touching this file. Order in that array = order on the page. A "full"
// category spans the full width (breaking bundles on top). Each category
// also gets its own archive page with every story in it.

/** One feed card: title, description, top headlines. "big" enlarges headlines (breaking). */
function renderFeedCard(result, big) {
  const feed = result.feed;
  const shown = result.items.slice(0, INDEX_HEADLINES_PER_FEED);
  const rows = shown
    .map((item) => {
      const pub = item.pubDate || item.isoDate || '';
      const publisher = publisherOf(item);
      const meta = [publisher, relativeTime(pub)].filter(Boolean).join(' | ');
      return `
          <li>
            <a class="headline" href="${escapeText(item.link)}">${escapeText(displayTitle(item))}</a>
            ${meta ? `<span class="meta">${escapeText(meta)}</span>` : ''}
          </li>`;
    })
    .join('');

  return `
        <section class="feed${big ? ' big' : ''}">
          <h3>
            <a href="${escapeText(feed.filename)}.xml">${escapeText(feed.title)}</a>
            <span class="count">top ${shown.length} of ${result.items.length} unique</span>
          </h3>
          <p class="desc">${escapeText(feed.description)}</p>
          <ul>${rows}
          </ul>
        </section>`;
}

/** One category block: header plus a grid of feed cards. Empty feeds are hidden. */
function renderCategory(cat, results, totalItems) {
  const nonEmpty = results.filter((r) => r.items.length > 0);
  if (nonEmpty.length === 0) return '';
  const cards = nonEmpty.map((r) => renderFeedCard(r, cat.full)).join('\n');
  const allLink = totalItems
    ? `<a class="all-link" href="category-${cat.slug}.html">All ${totalItems} stories</a>`
    : '';
  return `
      <section class="category" id="cat-${cat.slug}" data-cat="${cat.slug}" style="--cat:${cat.accent}">
        <div class="cat-head">
          <h2>${escapeText(cat.label)}</h2>
          ${allLink}
        </div>
        <div class="grid${cat.full ? ' full' : ''}">${cards}
        </div>
      </section>`;
}

/** Sticky tab bar. Plain anchors scroll without JS; the inline script below
 * upgrades them to filter tabs. */
function renderTabs(cats) {
  const tabs = [{ slug: 'all', label: 'All' }]
    .concat(cats.map((c) => ({ slug: c.slug, label: c.label })));
  const links = tabs
    .map((t) => `<a href="#${t.slug === 'all' ? 'top' : `cat-${t.slug}`}" data-tab="${t.slug}">${escapeText(t.label)}</a>`)
    .join('\n          ');
  return `
      <nav class="tabs">
          ${links}
      </nav>`;
}

/** Top stories for the lead strip: only fresh items qualify. A topic with
 * nothing fresh sits out instead of filling with stale items. At most
 * HERO_AREA_CAP slots per area, so no busy topic sweeps the strip.
 * Covers all 32 feeds: breaking bundles plus the feeds that sit in no bundle. */
const HERO_MAX_ITEMS = 10;
const HERO_FRESH_HOURS = 1;
const HERO_AREA_CAP = 2;
const HERO_AREA_OF = {
  'rourkela-breaking': 'rourkela',
  'odisha-breaking': 'odisha',
  'ai-breaking': 'ai',
  'webdev-breaking': 'webdev',
  'jobs-breaking': 'jobs',
  'oshb': 'odisha',
  'bhubaneswar-crime': 'odisha',
  'bengaluru-power': 'india-world',
  'india-breaking': 'india-world',
  'world-breaking': 'india-world',
};
function buildHero(results, byFilename) {
  // Source topic per item: bundle items are the same objects as their base
  // feed items, so the first feed holding an item names its topic.
  const sourceOf = new Map();
  for (const r of results || []) {
    const title = r.feed && r.feed.title;
    for (const it of r.items || []) {
      if (!sourceOf.has(it)) sourceOf.set(it, title || '');
    }
  }
  const bundleNames = ['rourkela-breaking', 'odisha-breaking', 'ai-breaking', 'webdev-breaking', 'jobs-breaking'];
  const orphanNames = ['oshb', 'bengaluru-power', 'bhubaneswar-crime', 'india-breaking', 'world-breaking'];
  const perSource = [];
  for (const name of bundleNames) {
    const r = byFilename[name];
    if (r) perSource.push({ area: HERO_AREA_OF[name], items: r.items.slice(0, 3) });
  }
  for (const name of orphanNames) {
    const r = byFilename[name];
    if (r) perSource.push({ area: HERO_AREA_OF[name], items: r.items.slice(0, 3) });
  }
  const cutoff = Date.now() - HERO_FRESH_HOURS * 60 * 60 * 1000;
  const candidates = [];
  for (const s of perSource) {
    for (const item of s.items) candidates.push({ area: s.area, item });
  }
  candidates.sort((a, b) => dateValue(b.item) - dateValue(a.item));
  const seen = [];
  const areaCount = {};
  const hero = [];
  for (const c of candidates) {
    if (hero.length >= HERO_MAX_ITEMS) break;
    if (dateValue(c.item) < cutoff) continue;
    if ((areaCount[c.area] || 0) >= HERO_AREA_CAP) continue;
    const strip = isGoogleNewsUrl(c.item.link);
    const tokens = itemTokens(c.item, strip);
    if (isDuplicate(tokens, seen)) continue;
    seen.push(tokens);
    areaCount[c.area] = (areaCount[c.area] || 0) + 1;
    hero.push({ item: c.item, source: sourceOf.get(c.item) || '' });
  }
  return hero;
}

/**
 * All stories of one category, newest first, cross-deduped across its feeds.
 * Job postings are kept by id: two roles at one company are different items.
 */
function buildCategoryItems(cat, byFilename) {
  const seen = [];
  const seenIds = new Set();
  const items = [];
  for (const filename of cat.filenames || []) {
    const result = byFilename[filename];
    if (!result) continue;
    for (const item of result.items) {
      if (item._dedupeById) {
        const id = item.guid || item.link;
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        items.push(item);
        continue;
      }
      const strip = isGoogleNewsUrl(item.link);
      const tokens = itemTokens(item, strip);
      if (!isDuplicate(tokens, seen)) {
        seen.push(tokens);
        items.push(item);
      }
    }
  }
  items.sort((a, b) => dateValue(b) - dateValue(a));
  return items;
}

/**
 * One archive page per category: every story in that category, newest first.
 * The front page stays a scannable summary; this is the full list.
 */
function buildArchiveHtml(cat, items) {
  const rows = items
    .map((item) => {
      const pub = item.pubDate || item.isoDate || '';
      const publisher = publisherOf(item);
      const meta = [publisher, relativeTime(pub)].filter(Boolean).join(' | ');
      return `
          <li>
            <a class="headline" href="${escapeText(item.link)}">${escapeText(displayTitle(item))}</a>
            ${meta ? `<span class="meta">${escapeText(meta)}</span>` : ''}
          </li>`;
    })
    .join('');

  const updated = new Date().toUTCString();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="All ${escapeText(String(items.length))} ${escapeText(cat.label)} stories, deduplicated. PN Broadcast.">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%23e86a17'/><circle cx='10' cy='22' r='3' fill='white'/><path d='M6 14a10 10 0 0 1 10 10' stroke='white' stroke-width='3' fill='none' stroke-linecap='round'/><path d='M6 7a17 17 0 0 1 17 17' stroke='white' stroke-width='3' fill='none' stroke-linecap='round'/></svg>">
  <title>${escapeText(cat.label)} - all stories - PN Broadcast</title>
  <style>${PAGE_CSS}</style>
</head>
<body>
  <div class="wrap" id="top">
    <header class="masthead">
      <h1 class="brand">${escapeText(cat.label)}</h1>
      <p class="tagline">All ${items.length} stories, deduplicated. Updated ${escapeText(updated)}.</p>
      <div class="mast-row">
        <a class="subscribe" href="./">Back to PN Broadcast</a>
        <a class="all-link" href="feeds.opml">Subscribe to all feeds</a>
      </div>
    </header>
    <section class="archive">
      <ul>${rows}
      </ul>
    </section>
    <footer>Generated by PN Broadcast. Personal project, view-only.</footer>
  </div>
</body>
</html>`;
}

/** Lead story strip under the masthead. Each row names its topic. */function renderHero(entries) {
  if (entries.length === 0) return '';
  const rows = entries
    .map((w) => {
      const item = w.item;
      const pub = item.pubDate || item.isoDate || '';
      const publisher = publisherOf(item);
      const meta = [publisher, w.source, relativeTime(pub)].filter(Boolean).join(' | ');
      return `
          <li>
            <a class="hero-headline" href="${escapeText(item.link)}">${escapeText(displayTitle(item))}</a>
            ${meta ? `<span class="meta">${escapeText(meta)}</span>` : ''}
          </li>`;
    })
    .join('');
  return `
      <section class="hero">
        <h2 class="hero-label">Top Stories</h2>
        <ol class="hero-list">${rows}
        </ol>
      </section>`;
}

// Shared styles for the index page and the category archive pages.
const PAGE_CSS = `
    :root {
      --bg: #fafafa;
      --fg: #1a1a1a;
      --muted: #6b7280;
      --card: #ffffff;
      --border: #e5e7eb;
      --accent: #e86a17;
      --font-head: Georgia, 'Times New Roman', serif;
      --font-body: system-ui, -apple-system, 'Segoe UI', sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #101418;
        --fg: #e7e9ec;
        --muted: #9aa3ad;
        --card: #171c22;
        --border: #262d35;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--font-body);
      background: var(--bg);
      color: var(--fg);
      line-height: 1.5;
    }
    .wrap { max-width: 74rem; margin: 0 auto; padding: 0 1.25rem 4rem; }
    .masthead { padding: 2rem 0 1.25rem; border-bottom: 1px solid var(--border); }
    .brand { font-family: var(--font-head); font-size: 1.9rem; font-weight: 700; margin: 0; letter-spacing: -0.01em; }
    .tagline { color: var(--muted); margin: 0.25rem 0 0; }
    .mast-row { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; justify-content: space-between; margin-top: 0.9rem; }
    .updated { color: var(--muted); font-size: 0.9rem; }
    .subscribe {
      display: inline-block;
      background: var(--accent);
      color: #fff;
      text-decoration: none;
      padding: 0.45rem 0.95rem;
      border-radius: 6px;
      font-size: 0.9rem;
      font-weight: 600;
    }
    .tabs {
      position: sticky;
      top: 0;
      z-index: 10;
      background: var(--bg);
      padding: 0.6rem 0;
      border-bottom: 1px solid var(--border);
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
    }
    .tabs a {
      color: var(--muted);
      text-decoration: none;
      font-size: 0.85rem;
      font-weight: 600;
      padding: 0.35rem 0.7rem;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--card);
    }
    .tabs a.active { color: #fff; background: var(--accent); border-color: var(--accent); }
    .hero { margin-top: 1.5rem; }
    .hero-label {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.95rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      margin: 0 0 0.5rem;
    }
    .hero-label::before { content: ''; width: 5px; height: 1.05em; background: var(--accent); border-radius: 2px; }
    .hero-list { list-style: none; margin: 0; padding: 0; }
    .hero-list li { padding: 0.8rem 0; border-bottom: 1px solid var(--border); }
    .hero-list li:first-child { padding-top: 0.25rem; }
    .hero-list a.hero-headline {
      font-family: var(--font-head);
      font-size: 1.35rem;
      line-height: 1.3;
      color: var(--fg);
      text-decoration: none;
      display: block;
    }
    .hero-list a.hero-headline:hover { text-decoration: underline; }
    .category { margin-top: 2.25rem; }
    .category h2 {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.95rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      margin: 0 0 0.75rem;
    }
    .category h2::before { content: ''; width: 5px; height: 1.05em; background: var(--cat); border-radius: 2px; }
    .cat-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.75rem; }
    .cat-head h2 { margin: 0 0 0.75rem; }
    .all-link { color: var(--accent); font-size: 0.85rem; font-weight: 600; text-decoration: none; }
    .all-link:hover { text-decoration: underline; }
    .grid { display: grid; grid-template-columns: 1fr; gap: 1.25rem; }
    @media (min-width: 900px) {
      .grid { grid-template-columns: 1fr 1fr; }
      .grid.full { grid-template-columns: 1fr; }
    }
    .feed { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 1rem 1.1rem; }
    .feed h3 { margin: 0 0 0.15rem; font-size: 1.05rem; }
    .feed h3 a { color: var(--fg); text-decoration: none; }
    .feed h3 a:hover { text-decoration: underline; }
    .feed .count { color: var(--muted); font-size: 0.8rem; font-weight: normal; margin-left: 0.4rem; }
    .feed .desc { color: var(--muted); font-size: 0.85rem; margin: 0 0 0.6rem; }
    .feed ul { list-style: none; margin: 0; padding: 0; }
    .feed li { padding: 0.5rem 0; border-top: 1px solid var(--border); }
    .feed li:first-child { border-top: 0; }
    .feed li a.headline { color: var(--fg); text-decoration: none; font-family: var(--font-head); font-size: 0.98rem; line-height: 1.35; }
    .feed li a.headline:hover { text-decoration: underline; }
    .feed.big li a.headline { font-size: 1.12rem; }
    .feed .meta { display: block; color: var(--muted); font-size: 0.78rem; margin-top: 0.15rem; }
    .archive { margin-top: 1.5rem; }
    .archive ul { list-style: none; margin: 0; padding: 0; }
    .archive li { padding: 0.6rem 0; border-bottom: 1px solid var(--border); }
    .archive li a.headline { color: var(--fg); text-decoration: none; font-family: var(--font-head); font-size: 1rem; line-height: 1.35; }
    .archive li a.headline:hover { text-decoration: underline; }
    .archive .meta { display: block; color: var(--muted); font-size: 0.78rem; margin-top: 0.15rem; }
    footer { margin-top: 3rem; color: var(--muted); font-size: 0.85rem; text-align: center; }
    footer a { color: var(--muted); }
`;

/**
 * Builds the index page and one archive page per category.
 * Returns { html, archives } where archives is a list of
 * { filename, html } pairs to write to public/.
 * categories comes from feeds.json so the manage UI can edit it.
 */
function buildPages(results, categories) {
  const byFilename = {};
  for (const result of results) byFilename[result.feed.filename] = result;

  // A config without categories is allowed: every feed falls into "More".
  const cats = Array.isArray(categories) ? categories : [];
  const sections = [];
  const shownCats = [];
  const archives = [];
  for (const cat of cats) {
    const catResults = cat.filenames.map((f) => byFilename[f]).filter(Boolean);
    if (catResults.length > 0) {
      const items = buildCategoryItems(cat, byFilename);
      archives.push({ filename: `category-${cat.slug}.html`, html: buildArchiveHtml(cat, items) });
      const html = renderCategory(cat, catResults, items.length);
      if (html) {
        sections.push(html);
        shownCats.push(cat);
      }
    }
  }
  // Safety net: any feed not listed above still appears.
  const known = new Set(cats.flatMap((c) => c.filenames));
  const leftovers = results.filter((r) => !known.has(r.feed.filename));
  if (leftovers.length > 0) {
    const more = { label: 'More', slug: 'more', accent: '#607d8b', full: false, filenames: leftovers.map((r) => r.feed.filename) };
    const items = buildCategoryItems(more, byFilename);
    archives.push({ filename: `category-${more.slug}.html`, html: buildArchiveHtml(more, items) });
    const html = renderCategory(more, leftovers, items.length);
    if (html) {
      sections.push(html);
      shownCats.push(more);
    }
  }

  const updated = new Date().toUTCString();
  const hero = renderHero(buildHero(results, byFilename));
  const tabs = renderTabs(shownCats);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="PN Broadcast - deduped RSS feeds for Rourkela, Odisha, AI and web dev. Same story, many publishers, one headline.">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%23e86a17'/><circle cx='10' cy='22' r='3' fill='white'/><path d='M6 14a10 10 0 0 1 10 10' stroke='white' stroke-width='3' fill='none' stroke-linecap='round'/><path d='M6 7a17 17 0 0 1 17 17' stroke='white' stroke-width='3' fill='none' stroke-linecap='round'/></svg>">
  <title>PN Broadcast</title>
  <style>${PAGE_CSS}</style>
</head>
<body>
  <div class="wrap" id="top">
    <header class="masthead">
      <h1 class="brand">PN Broadcast</h1>
      <p class="tagline">Same story, many publishers - one headline.</p>
      <div class="mast-row">
        <span class="updated">Updated ${escapeText(updated)}</span>
        <a class="subscribe" href="feeds.opml">Subscribe to all feeds</a>
      </div>
    </header>
    ${tabs}
    ${hero}
    ${sections.join('\n')}
    <footer>Generated by PN Broadcast. Personal project, view-only. <a href="manage.html">Manage feeds</a></footer>
  </div>
<script>
(() => {
  const tabs = [...document.querySelectorAll('.tabs a')];
  const sections = [...document.querySelectorAll('.category')];
  const show = (name) => {
    for (const tab of tabs) {
      tab.classList.toggle('active', tab.getAttribute('data-tab') === name);
    }
    for (const section of sections) {
      const visible = name === 'all' || section.getAttribute('data-cat') === name;
      section.style.display = visible ? '' : 'none';
    }
  };
  for (const tab of tabs) {
    tab.addEventListener('click', (event) => {
      event.preventDefault();
      const name = tab.getAttribute('data-tab');
      show(name);
      try { history.replaceState(null, '', '#' + name); } catch { /* older browsers */ }
    });
  }
  const raw = (location.hash || '#all').slice(1);
  const initial = raw.startsWith('cat-') ? raw.slice(4) : raw;
  const known = tabs.some((tab) => tab.getAttribute('data-tab') === initial);
  show(known ? initial : 'all');
})();
</script>
</body>
</html>`;
  return { html, archives };
}

/**
 * Builds an OPML 2.0 subscription list from the feed config. RSS readers
 * can import this single file instead of adding each feed URL by hand.
 * Derived from config alone, so it is valid even if a fetch fails.
 */
function buildOpml(feeds, bundles) {
  const outlines = feeds.concat(bundles)
    .map((feed) => {
      const xmlUrl = `${SITE_URL}/${feed.filename}.xml`;
      return `    <outline type="rss" text="${escapeText(feed.title)}" title="${escapeText(feed.title)}" xmlUrl="${escapeText(xmlUrl)}" htmlUrl="${escapeText(`${SITE_URL}/`)}"/>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>PN Broadcast</title>
    <dateCreated>${new Date().toUTCString()}</dateCreated>
  </head>
  <body>
${outlines}
  </body>
</opml>`;
}

// ---------------------------------------------------------------------------
// Bundles
// ---------------------------------------------------------------------------

/**
 * Merges the deduped items of a bundle's source feeds into one list.
 * Cross-dedupes across sources (the same story in two feeds collapses),
 * sorts newest-first, and caps the length.
 */
/**
 * Tokens for dedupe. Title only: one headline per story. Job postings use
 * id-dedupe instead, since two roles at one company are different items.
 */
function itemTokens(item, strip) {
  return extractTokens(item.title || '', strip);
}

function buildBundleItems(bundle, resultsByFilename) {
  const seen = [];
  const seenIds = new Set();
  const merged = [];
  for (const filename of bundle.sources || []) {
    const result = resultsByFilename[filename];
    if (!result) continue; // source failed this run - the bundle skips it
    for (const item of result.items) {
      // Id-dedupe items (job postings) are kept as-is: same company, different
      // role is a different item, not a repeat of one story.
      if (item._dedupeById) {
        const id = item.guid || item.link;
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        merged.push(item);
        continue;
      }
      // Per-item decision: only Google News links get publisher-strip.
      // Mixed bundles (Google + custom RSS) stay correct.
      const strip = isGoogleNewsUrl(item.link);
      const tokens = itemTokens(item, strip);
      if (!isDuplicate(tokens, seen)) {
        seen.push(tokens);
        merged.push(item);
      }
    }
  }
  merged.sort((a, b) => dateValue(b) - dateValue(a));
  const maxItems = Number.isFinite(bundle.maxItems) ? bundle.maxItems : 100;
  return merged.slice(0, maxItems);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** Loads and validates feeds.json. */
function loadConfig() {
  let raw;
  try {
    raw = fs.readFileSync(CONFIG_FILE, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read feeds.json: ${err.message}`, { cause: err });
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`feeds.json is not valid JSON: ${err.message}`, { cause: err });
  }
}

/** Fetches one feed, drops off-topic and old items, dedupes, returns the result (no writing). */
async function processFeed(feed, parser) {
  const url = buildFeedUrl(feed);
  const strip = isGoogleNewsUrl(url);
  // JSON sources (freehire.me) are fetched directly, RSS goes through the parser.
  const parsed = feed.type === 'freehire'
    ? { items: mapFreehireItems(await fetchJsonWithRetry(url)) }
    : await fetchWithRetry(parser, url);

  const titleFiltered = filterByTitle(parsed.items, feed.filter);
  const titleDropped = parsed.items.length - titleFiltered.length;

  const maxAgeDays = Number.isFinite(feed.maxAgeDays)
    ? feed.maxAgeDays
    : MAX_AGE_DAYS;
  const recentItems = filterByAge(titleFiltered, maxAgeDays);
  const ageDropped = titleFiltered.length - recentItems.length;

  // Newest first, so the freshest version of each story wins dedup and the
  // output order stays stable across runs (less re-notify churn in readers).
  recentItems.sort((a, b) => dateValue(b) - dateValue(a));

  // Id-dedupe sources keep every posting: two roles at the same company are
  // different jobs, not the same story, so title overlap must not merge them.
  if (feed.dedupeById) {
    for (const item of recentItems) item._dedupeById = true;
  }

  const acceptedSets = [];
  const seenIds = new Set();
  const uniqueItems = [];
  for (const item of recentItems) {
    if (item._dedupeById) {
      const id = item.guid || item.link;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      uniqueItems.push(item);
      continue;
    }
    const tokens = itemTokens(item, strip);
    if (!isDuplicate(tokens, acceptedSets)) {
      acceptedSets.push(tokens);
      uniqueItems.push(item);
    }
  }
  return { feed, items: uniqueItems, total: parsed.items.length, ageDropped, titleDropped };
}

async function main() {
  const config = loadConfig();
  const feeds = Array.isArray(config.feeds) ? config.feeds : [];
  const bundles = Array.isArray(config.bundles) ? config.bundles : [];
  // Category list lives in feeds.json so the manage UI can edit it.
  const categories = Array.isArray(config.categories) ? config.categories : [];
  // Fail fast on typos: duplicate filenames, unknown bundle sources.
  validateConfig(feeds, bundles, categories);
  if (feeds.length === 0) {
    console.log('No feeds found in feeds.json - nothing to do.');
    return;
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const parser = new Parser();
  const results = [];

  // The subscription list comes from config alone, so it is written even
  // if every feed fetch below fails.
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'feeds.opml'),
    buildOpml(feeds, bundles),
    'utf8'
  );

  for (const feed of feeds) {
    const startedAt = Date.now();
    try {
      const result = await processFeed(feed, parser);
      results.push(result);

      fs.writeFileSync(
        path.join(OUTPUT_DIR, `${feed.filename}.xml`),
        buildRssXml(feed, result.items),
        'utf8'
      );

      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      const ageNote = result.ageDropped > 0 ? ` (-${result.ageDropped} old)` : '';
      const offNote = result.titleDropped > 0 ? ` (-${result.titleDropped} off-topic)` : '';
      console.log(
        `[ok]   ${String(feed.title).padEnd(18)} ` +
          `${String(result.total).padStart(3)}${offNote}${ageNote} -> ${String(result.items.length).padStart(3)} unique  (${seconds}s)`
      );
    } catch (err) {
      console.error(`[fail] ${feed.title || feed.filename}: ${err.message}`);
    }
  }

  // Bundles merge the deduped output of their source feeds into one XML.
  const resultsByFilename = {};
  for (const result of results) {
    resultsByFilename[result.feed.filename] = result;
  }

  const bundleResults = [];
  for (const bundle of bundles) {
    const items = buildBundleItems(bundle, resultsByFilename);
    fs.writeFileSync(
      path.join(OUTPUT_DIR, `${bundle.filename}.xml`),
      buildRssXml({ ...bundle, link: `${SITE_URL}/` }, items),
      'utf8'
    );
    const totalIn = (bundle.sources || []).reduce(
      (sum, f) => sum + (resultsByFilename[f] ? resultsByFilename[f].items.length : 0),
      0
    );
    bundleResults.push({ feed: bundle, items, total: totalIn, ageDropped: 0 });
    console.log(
      `[ok]   ${String(bundle.title).padEnd(18)} ` +
        `${String(totalIn).padStart(3)} -> ${String(items.length).padStart(3)} merged`
    );
  }

  if (results.length + bundleResults.length > 0) {
    const pages = buildPages(results.concat(bundleResults), categories);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), pages.html, 'utf8');
    for (const archive of pages.archives) {
      fs.writeFileSync(path.join(OUTPUT_DIR, archive.filename), archive.html, 'utf8');
    }
    console.log(`Wrote index.html + ${pages.archives.length} category archive pages.`);
  }

  // The manage UI is a static page kept in assets/ and copied here, since
  // public/ is gitignored and rebuilt from scratch on every run. It is
  // copied even if every feed failed, so the page stays reachable.
  // The page loads manage.js as a module, so both files must be copied.
  for (const name of ['manage.html', 'manage.js']) {
    const src = path.join(__dirname, 'assets', name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(OUTPUT_DIR, name));
    }
  }

  const totalIn = results.reduce((sum, r) => sum + r.total, 0);
  const totalOut = results.reduce((sum, r) => sum + r.items.length, 0);
  console.log(`\nDone: ${totalIn} items -> ${totalOut} unique. Output in public/`);

  // HTTP keep-alive sockets keep the event loop alive after the work is
  // done, so the process would hang here without an explicit exit.
  process.exit(0);
}

// Only run the pipeline when executed directly (node dedup.js / npm start).
// Requiring this file (e.g. from tests) must not trigger a fetch run.
if (require.main === module) {
  main().catch((err) => {
    console.error('Script failed:', err.message);
    process.exit(1);
  });
}

// Exported for tests.
module.exports = {
  extractTokens,
  similarityScore,
  isDuplicate,
  filterByAge,
  filterByTitle,
  escapeText,
  shortDate,
  relativeTime,
  publisherOf,
  displayTitle,
  buildRssXml,
  buildFeedUrl,
  buildBundleItems,
  buildHero,
  mapFreehireJob,
  mapFreehireItems,
  buildPages,
  isGoogleNewsUrl,
  validateConfig,
};
