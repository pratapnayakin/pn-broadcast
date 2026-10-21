# PN Broadcast

![Update News Feed](https://github.com/pratapnayakin/pn-broadcast/actions/workflows/update.yml/badge.svg)

A self-updating, deduplicated RSS feed service. It fetches news from Google
News search feeds, removes near-duplicate headlines (the same story reported
by many publishers), and publishes one clean RSS 2.0 feed per topic plus a
readable index page - all hosted free on GitHub Pages, refreshed every 30 minutes.

No servers, no API keys, no cost.

Personal project, all rights reserved. View-only, no reuse without permission.

---

## Why it exists

Google News reports the same story many times - once per publisher. Follow a
topic and you see the same story from five different newspapers. RSS readers
are the cleanest way to follow news, but they need a feed URL. This project
creates those URLs automatically, keeps them duplicate-free, and refreshes
them every 30 minutes - so you never have to search Google News again.

The 30-second pitch: "A script runs every 30 minutes on GitHub for free. It reads
a list of topics I care about, fetches the latest news from Google, removes
duplicate stories, and publishes clean RSS feeds to a free website. I
subscribe to those feeds in my RSS reader. Adding a topic takes one line in
a web form, and I review the change as a pull request before it goes live."

Why these building blocks:

- **RSS** - the oldest, simplest, most universal way to subscribe; every reader supports it
- **Google News** - free, no API key, covers every topic; a query in, an RSS feed out
- **Deduplication** - Google returns the same story once per publisher; the point is "read each story once"
- **GitHub Pages** - free hosting with HTTPS; no server, no domain
- **GitHub Actions** - free scheduled runs; the refresh robot never sleeps
- **OPML** - one file imports ALL feeds into any reader in one click
- **The age filter** - Google fills quiet topics with years-old articles; this keeps feeds relevant
- **A readable web page too** - scan headlines without an RSS reader

---

## Live output

| What | URL |
|---|---|
| Index page (open in a browser - lists every feed and its URL) | https://pratapnayakin.github.io/pn-broadcast/ |
| Manage page (add/remove feeds from the browser, no JSON editing) | https://pratapnayakin.github.io/pn-broadcast/manage.html |
| One-click subscribe (OPML - import into any reader) | https://pratapnayakin.github.io/pn-broadcast/feeds.opml |
| Odisha Breaking (merged bundle - one link for all Odisha alerts) | https://pratapnayakin.github.io/pn-broadcast/odisha-breaking.xml |
| Rourkela Breaking (merged bundle - one link for all Rourkela alerts) | https://pratapnayakin.github.io/pn-broadcast/rourkela-breaking.xml |
| AI Breaking (merged bundle - one link for all AI alerts) | https://pratapnayakin.github.io/pn-broadcast/ai-breaking.xml |
| WebDev Breaking (merged bundle - one link for all web dev alerts) | https://pratapnayakin.github.io/pn-broadcast/webdev-breaking.xml |
| Jobs Breaking (merged bundle - one link for all job postings) | https://pratapnayakin.github.io/pn-broadcast/jobs-breaking.xml |

Archive pages, one per category, every story in it:

| Category | URL |
|---|---|
| Rourkela | https://pratapnayakin.github.io/pn-broadcast/category-rourkela.html |
| Odisha | https://pratapnayakin.github.io/pn-broadcast/category-odisha.html |
| AI and WebDev | https://pratapnayakin.github.io/pn-broadcast/category-ai-and-webdev.html |
| Jobs | https://pratapnayakin.github.io/pn-broadcast/category-jobs.html |
| India and World | https://pratapnayakin.github.io/pn-broadcast/category-india-and-world.html |
| Breaking (all bundles) | https://pratapnayakin.github.io/pn-broadcast/category-breaking.html |

Paste any `.xml` URL into an RSS reader (Feedly, Inoreader, NetNewsWire, ...).
The reader polls it on its normal refresh cycle; the content behind it is
regenerated every 30 minutes.

---

## How it works (architecture)

```
GitHub Actions (30-minute tick, or on every push, or manual)
        |
        v
   node dedup.js
        |
        |-- 1. reads feeds.json (feeds, bundles, categories - data, not code)
        |-- 2. for each feed: builds/fetches a Google News RSS search URL
        |-- 3. dedupes the headlines (word-overlap scoring, per feed)
        |-- 4. writes public/<filename>.xml  (clean RSS 2.0)
        |-- 5. writes public/<bundle>.xml    (merged feeds, cross-deduped)
        |-- 6. writes public/index.html      (readable index - top 10 per feed, relative time, fresh-only top stories, tab bar)
        |-- 7. writes public/category-*.html (one archive page per category, every story)
        |-- 8. writes public/feeds.opml      (one-click subscribe list)
        |-- 9. copies public/manage.html     (the add/remove feed form)
        |
        v
upload-pages-artifact --> deploy-pages
        |
        v
https://pratapnayakin.github.io/pn-broadcast/  -->  your RSS reader
```

Key idea: Google News returns the same story many times (once per publisher).
This pipeline collapses those duplicates so you read each story once.

A second, optional path goes the other way: the manage page in the browser
reads `feeds.json` through the GitHub API and writes a pull request. That is
how feeds are added without editing JSON.

---

## Project structure

| File | Purpose |
|---|---|
| `feeds.json` | **The config.** Feeds (keywords or full URLs), optional bundles, and the category list. Edited by hand or through the manage page. |
| `assets/manage.html` | The manage page markup and styles. Copied to `public/manage.html` on every build. |
| `assets/manage.js` | The manage page logic: an ES module loaded by the page. Copied to `public/manage.js`. |
| `dedup.js` | The whole engine: fetch, dedupe, write XML + HTML. ~1000 lines, commented. |
| `.github/workflows/update.yml` | The automation: runs the script and deploys to Pages. |
| `.github/workflows/tick.yml` | The metronome: keeps the 30-minute refresh on a fixed grid. |
| `notify.js` | Push notifications: finds new items since the last run and posts them to ntfy.sh. |
| `eslint.config.js` | The coding standard, enforced by `npm run lint`. |
| `package.json` | Declares the runtime dependency (`rss-parser`), the dev tooling (`eslint`), and the `npm start` / `npm test` / `npm run lint` scripts. |
| `package-lock.json` | Pins exact dependency versions. Required by `npm ci` in the workflow. **Must be committed.** |
| `.gitignore` | Keeps `node_modules/` and `public/` out of git (both are generated/restored). |
| `public/` | Generated output. Never edit, never commit - rebuilt on every run. |

---

## Requirements

Requirements:
- Node.js 18+ and npm (only for running locally; GitHub Actions provides its own Node 22)
- Git and a GitHub account
- A **public** repository (GitHub Pages is free for public repos)
- Nothing else. Google News RSS is free and needs no authentication or API key.

Optional, only if you want to use the manage page: a **fine-grained
personal access token** for this one repository, with `Contents: Read and
write` and `Pull requests: Read and write`. Everything else works without it.

---

## Local setup (from zero)

```bash
git clone https://github.com/pratapnayakin/pn-broadcast.git
cd pn-broadcast
npm install        # restores dependencies from the lock file
npm start          # same as: node dedup.js
npm test           # runs the test suite (no network needed)
npm run lint       # checks the coding standard
```

Console output looks like:

```
[ok]   Rourkela News      100 ->  60 unique  (0.7s)
[ok]   OSHB News           41 ->  36 unique  (0.3s)
...
Done: 318 items -> 205 unique. Output in public/
```

Open `public/index.html` in a browser to inspect the result before it is
deployed.

---

## Configuring feeds (`feeds.json`)

Every feed is an object with four fields, plus optional `exclude` and
`filter` lists. Two ways to define the source:

### Way 1 - keywords (recommended, scalable)

```json
{
  "filename": "oshb",
  "title": "OSHB News",
  "description": "Odisha State Housing Board updates",
  "keywords": ["Odisha State Housing Board", "OSHB"]
}
```

The script builds the Google News search URL for you: every keyword is
wrapped in quotes (exact match) and joined with `OR`, plus the locale
settings (`en-IN`, India). You never touch URL encoding.

### Way 2 - full URL (escape hatch for complex queries)

```json
{
  "filename": "bengaluru-power",
  "title": "Bengaluru Power Cuts",
  "description": "Power cuts and outages in Bengaluru",
  "url": "https://news.google.com/rss/search?q=...&hl=en-IN&gl=IN&ceid=IN:en"
}
```

Use this when the query needs things a flat keyword list cannot express:
AND-groups like `(Bengaluru OR Bangalore) (power cut OR outage)`,
or a non-Google RSS source entirely.
An explicit `url` always wins over `keywords`.

### Rules

- `filename` becomes the output file name (`<filename>.xml`) - keep it short, lowercase, no spaces
- `title` and `description` appear in the XML header and on the index page
- A feed with neither `url` nor `keywords` fails with a clear error message
- Order in the file = order on the index page
- Optional: `"exclude": ["football", "cricket"]` appends `-football -cricket`
  to the search query (keyword feeds only; `url` feeds embed their own exclusions)
- Optional: `"filter": ["Rourkela", "Raurkela"]` keeps only items whose title
  contains one of these words (case-insensitive) - slices a broad source down
  to one topic. Works on any script (e.g. Odia titles).
  Both the manage page and `feeds.json` can set this.
- Optional: `"maxAgeDays": 30` drops items older than that many days
  (default 365; change `MAX_AGE_DAYS` in `dedup.js` for a global default).
  Items with a missing date are kept.
- Optional: `"dedupeById": true` dedupes on the source id instead of the
  headline. For job postings, where two roles at one company are different
  items, not one repeated story. Off by default.
- Optional: `"type": "freehire"` reads a freehire.me JSON search endpoint
  instead of RSS. See the job feeds section below.

### Bundles - several feeds merged into one link

A bundle merges the deduped output of other feeds into one extra RSS file,
so you can subscribe to many topics through a single URL:

```json
"bundles": [
  {
    "filename": "odisha-breaking",
    "title": "Odisha Breaking - All Alerts",
    "description": "Every important Odisha story, merged from the category feeds",
    "maxItems": 100,
    "sources": ["odisha", "odisha-crime", "odisha-weather"]
  }
]
```

- `sources` lists the `filename` values of other feeds in this file
- Items are cross-deduped: the same story appearing in two source feeds
  appears once in the bundle
- Sorted newest-first, capped at `maxItems` (default 100)
- A source that failed this run is simply skipped for that run
- Bundles appear on the index page and in `feeds.opml` like normal feeds

### Categories - which section of the site a feed belongs to

`feeds.json` also carries a `categories` array. It defines the sections of
the index page, their order, their accent colour, and which feeds go in
them:

```json
"categories": [
  {
    "label": "Rourkela",
    "slug": "rourkela",
    "accent": "#e86a17",
    "full": false,
    "filenames": ["rourkela", "rourkela-crime", "rourkela-weather"]
  }
]
```

- `label` - the heading shown on the page
- `slug` - becomes `category-<slug>.html`, the archive page for that section
- `accent` - the colour used for that section
- `full` - `true` makes the section span the full page width (the Breaking
  bundles at the top do this)
- `filenames` - the feeds and bundles shown in this section

Order in this array = order on the page. Every feed in `filenames` must
exist in `feeds` or `bundles`, otherwise the build fails with a clear error.
A feed not listed anywhere still appears - it falls into a "More" section at
the bottom, so nothing is ever silently dropped.

This array is what the manage page reads to build its section dropdown, which
is why a feed added through the UI lands in a real section rather than a
catch-all bucket.

To add a feed: edit `feeds.json`, commit, push. The workflow deploys it
automatically. To remove one: delete the entry. The full every-time checklist
(including the RSS reader side) is below.

---

## The manage page (add feeds without editing JSON)

`https://pratapnayakin.github.io/pn-broadcast/manage.html` is a small web form
that adds and removes feeds from the browser - the way other RSS providers
work. It edits the same `feeds.json`; it just does not make you type JSON.

### How it works

1. You paste a personal access token (once) and press **Load feeds**.
2. The page reads `feeds.json` straight from the GitHub API - no server
   involved, the browser talks to `api.github.com` directly.
3. You fill the form: title, source type, search terms or URL, which section
   of the site it belongs to, whether to push it to your phone.
4. Press **Create pull request**. The page opens a branch, commits the new
   `feeds.json`, and opens a pull request.
5. You review the diff on GitHub and press **Merge**.
6. The next refresh picks it up (within 30 minutes).

Nothing is written to the repo until you merge the pull request. The page can
only ever open a pull request - it cannot merge one.

### Adding any topic, in any section

Every field the engine understands is on the form, so you never need to open
`feeds.json`:

| Field | What it does |
|---|---|
| **Feed title** | The name shown on the site. Also becomes the file name. |
| **Source type** | Google News search (keywords) / direct RSS or JSON URL / freehire.me job search. |
| **Search terms** | One phrase per line. Each becomes a quoted phrase, joined with `OR`. |
| **Section on the site** | Which section of the index page it belongs to. |
| **+ Create a new section** | Makes a brand new section, with its own tab and archive page. |
| **Also add to bundle** | Optionally merges it into a "Breaking" bundle. |
| **Max age in days** | Drops items older than this. |
| **Exclude these words** | Removes noise from a Google News search. |
| **Only keep items whose title mentions** | Slices a broad source down to one topic - e.g. a state-wide feed, but only your town. |
| **Push to phone** | Sends new headlines to ntfy.sh, with an optional custom topic name. |

**A new feed always lands in a real, named section** - never in a catch-all
"More" bucket. Pick an existing section, or pick **+ Create a new section**
and type a name; the page creates the section (label, slug, colour) and puts
the feed in it. That section then gets its own tab on the index and its own
archive page at `category-<slug>.html`.

**Duplicate protection.** The page refuses a feed whose title matches an
existing feed, and refuses a new section whose name matches an existing one,
with a message telling you what to do instead. A feed whose title is
different but nearly the same would otherwise pull the same stories twice.

### The token

Create a **fine-grained** personal access token:

- GitHub -> Settings -> Developer settings -> Personal access tokens ->
  Fine-grained tokens -> Generate new token
- **Resource owner**: your account
- **Repository access**: *Only select repositories* -> `pn-broadcast`
- **Repository permissions**:
  - Contents: **Read and write**
  - Pull requests: **Read and write**
- Nothing else. No account permissions, no other repositories.

The token is stored in the browser's `localStorage` and is sent only to
`api.github.com`. It never reaches this site (the site is static - there is
no server to receive it). To revoke it, delete it on GitHub.

### Things worth knowing

- **The page is public.** Anyone can open it, but without a token that can
  write to this repo, nothing happens. The token is the security boundary.
- **The diff stays small.** The page writes `feeds.json` in exactly the format
  the file already uses, so the pull request shows only the lines that
  actually changed - not the whole file rewritten.
- **Several edits, one pull request.** If you add or remove more than one feed
  before merging, they all land on the same branch and update the same pull
  request. Press **Start a new pull request** to begin a fresh one.
- **The section dropdown comes from `feeds.json`.** A new feed lands in a real
  section (Rourkela, Odisha, Jobs, ...), not a catch-all bucket. You can also
  create a new section straight from the page.
- **The RSS reader side is still manual.** After merging, add the new
  `<filename>.xml` URL to your reader yourself, or re-import `feeds.opml`.

---

## Job feeds (freehire.me)

Two feeds pull real software job postings from company career pages, via the
freehire.me public API. No key, no signup, no scraping on our side.

```json
{
  "filename": "india-tech-jobs",
  "title": "India Tech Jobs",
  "description": "Software job openings in India, straight from company career pages",
  "type": "freehire",
  "dedupeById": true,
  "maxAgeDays": 7,
  "url": "https://freehire.me/api/v1/jobs/search?limit=50&countries=IN&is_tech=tech&posted_within_days=7&sort=posted_at&order=desc"
}
```

- `"type": "freehire"` tells the engine to read JSON instead of RSS. The
  endpoint returns `{ "data": [...] }`; each job becomes an item with the
  company in the headline, the apply URL as the link, `posted_at` as the date,
  and location, skills and the source id in the description.
- `"dedupeById": true` dedupes on the source id instead of the headline, so
  two roles at the same company stay two separate postings. Headline dedupe
  would merge "Software Engineer, Backend" and "Software Engineer, Machine
  Learning" at one company, which are different jobs.
- The URL is a normal freehire search. Useful filters: `countries` (IN),
  `regions`, `cities`, `is_tech` (tech / non_tech), `work_mode`, `seniority`,
  `skills`, `posted_within_days`, `sort=posted_at&order=desc`, `limit` (max 100).
- `q` does full-text search and supports `OR`. The Odisha feed uses
  `q=Rourkela%20OR%20Odisha`.
- The API allows 600 requests per minute, keyless. A run uses two calls.
- If the API is down or changes shape, that feed logs `[fail]` and is skipped
  for the run. Every other feed still deploys.

---

## Push notifications (ntfy.sh)

Optional. When a feed has `"notify": true`, new headlines in that feed are
pushed to your phone through the free ntfy.sh service. Nothing is sent until
you opt in - the default is off.

### One-time phone setup

1. Install the free ntfy app (Android or iOS).
2. Tap the plus sign and subscribe to a topic. Topic names are automatic:
   `pn-broadcast-<filename>`, e.g. `pn-broadcast-rourkela-breaking`.
3. Repeat for each feed you want notified.

### Turning notifications on for a feed

Add `"notify": true` to that feed's entry in `feeds.json`:

```json
{
  "filename": "my-town",
  "title": "My Town News",
  "description": "Local updates for my town",
  "maxAgeDays": 30,
  "keywords": ["My Town"],
  "notify": true
}
```

- Works for bundles too: add `"notify": true` to a bundle entry.
- To use a custom topic name instead of the default, add
  `"topic": "your-own-name"` and subscribe to that name.
- To stop notifications, delete the `"notify": true` line or set it to
  `false`. The feed itself stays.

### How it behaves

- The workflow runs `node notify.js` after every feed build.
- The first run after enabling records the current items and sends nothing,
  so you do not get a flood of old headlines.
- From the second run on, every new headline in an opted-in feed is pushed
  to your phone within one refresh slot (30 minutes by default).
- Notification state is kept in the GitHub Actions cache
  (`.notify-state.json`), so the script remembers what it already sent.
- If ntfy.sh is unreachable, the notification step is skipped and the feed
  site still deploys - a notification outage never breaks the site.

---

## Refresh timing (why there are two workflows)

GitHub's own cron scheduler runs scheduled workflows late on public repos.
Measured on this repo, a `*/30` cron actually fired every 2 to 6.5 hours,
with a median gap of about 4 hours. The delay is not in the queue - every run
started instantly once created - it is in GitHub's scheduler backlog, and
no cron setting can fix it.

So the clock lives in the repository instead:

| Workflow | Job | What it does |
|---|---|---|
| `tick.yml` | `chain` | Waits on a fixed grid, then dispatches a site build and the next tick. This is the metronome. |
| `tick.yml` | `backstop` | Runs on the hourly cron. If no tick is alive, it revives the chain. It never touches a live chain. |
| `update.yml` | `build-and-deploy` | Fetches feeds, writes the XML and HTML, sends notifications, deploys to Pages. |

- `workflow_dispatch` always creates a run immediately, so the tick does not
  inherit the cron delay.
- To change the refresh rate, edit `INTERVAL_MINUTES` in `tick.yml`. Slots
  align to UTC, so 30 means :00 and :30 every hour.
- To stop everything, disable **both** workflows in the Actions tab. To
  resume, re-enable and run "Feed Tick" manually once.
- If the chain ever dies, the backstop revives it on the next hourly
  schedule fire.

---

## Coding standard

`npm run lint` runs ESLint (v10, flat config in `eslint.config.js`). It
enforces the style the existing code already uses, so the standard is
checked rather than remembered:

- `const` by default, `let` only when reassigned, **never `var`**
- arrow functions for callbacks, template literals over string concatenation
- `async`/`await` instead of promise chains
- `TextDecoder`/`TextEncoder` for base64, not the deprecated `escape`/`unescape`
- `structuredClone` for deep copies, not `JSON.parse(JSON.stringify(...))`
- DOM APIs (`textContent`, `createElement`) instead of `innerHTML`, so user
  data can never be injected as markup
- `eqeqeq`, no unused variables, no implicit globals

The lint step runs in CI as a **separate job, in parallel with the deploy**,
so a style error is visible but can never stop the feeds from publishing.
The deploy job installs production dependencies only (`npm ci --omit=dev`),
so the linter is not even present on that path.

The manage page (`assets/manage.html` + `assets/manage.js`) is linted by the
same config. Its script lives in its own file rather than inline in the HTML
precisely so a linter can read it.

Requires Node `^20.19.0 || ^22.13.0 || >=24` (ESLint 10's own requirement).

---

## Adding or removing a feed - the every-time checklist

There are two ways to do it: through the **manage page** (a form in your
browser) or by **editing `feeds.json`** directly. Both end the same way - a
change on `main`, then the next refresh deploys it.

The git side is automatic after you push; the RSS reader side is always
manual - the site updates, your reader does not.

### When you ADD a feed

1. Either use the [manage page](#the-manage-page-add-feeds-without-editing-json)
   (it opens a pull request you merge), or edit `feeds.json` - add the entry
   (keywords or url) and its `filename` to the right section's `filenames`
   list.
2. Optional but wise: run `npm start` and check `public/index.html`
3. Commit and push to `main`
4. Wait for the green workflow run (~30s) - the new `<filename>.xml` is live
5. **Manually** add `https://pratapnayakin.github.io/pn-broadcast/<filename>.xml`
   to your RSS reader - or re-import `feeds.opml`, which now includes it
   (re-import behavior varies by reader, so check for duplicates)

### When you REMOVE a feed

1. Either use the manage page (pick the feed, press **Remove selected feed**,
   merge the pull request), or delete the entry from `feeds.json` and remove
   its `filename` from any section's `filenames` list.
2. Commit and push to `main`
3. The next workflow run rebuilds `public/` from scratch - the old
   `<filename>.xml` will 404
4. **Manually** delete that URL from your RSS reader (or re-import the
   updated `feeds.opml`), or it shows fetch errors on every refresh

---

## How deduplication works

For each feed, items older than the age cutoff (365 days by default,
per-feed via `maxAgeDays`) are dropped first. Survivors are sorted
newest-first so the freshest version of each story wins dedup and the
output order stays stable across runs. Then every headline goes
through:

1. **Strip the publisher tag.** Google News appends ` - Publisher Name` to
   titles. It is removed *for comparison only* (kept in the output).
2. **Tokenize.** Lowercase, drop punctuation, split into words, drop words
   shorter than 3 characters and common stopwords (the, and, from, ...),
   then strip common suffixes (light stemming: `arrested`/`arrest` and
   `outages`/`outage` compare as one word).
3. **Score against every already-accepted headline** using the
   Sorensen-Dice coefficient:

   ```
   score = (2 x shared words) / (words in A + words in B)
   ```

4. **Threshold.** If any score is >= `SIMILARITY_THRESHOLD` (0.45, a constant
   at the top of `dedup.js`), the headline is a duplicate and is dropped.
   Otherwise it is accepted and becomes a new comparison target.

Worked example:

- `"Rourkela Excise Superintendent held with cash - Odisha TV"`
- `"Rourkela Excise Superintendent arrested - New Indian Express"`

After stripping and tokenizing they share most words, score well above 0.45,
and only the first is kept.

**Tuning direction:** lower the threshold -> more aggressive dedup (more
reworded duplicates caught, but risk of merging genuinely different stories).
Raise it -> safer, but more near-duplicates survive. 0.45 is tuned from run
data: it catches reworded duplicates of big news cycles. Going lower starts
merging genuinely different stories (real example: two unrelated "how will
the stock react" headlines share 44% of their words).

---

## How publishing works (`.github/workflows/update.yml`)

Triggers:

- **Every push to `main`** - instant feedback that the pipeline works
- **From the tick workflow** - the regular refresh, on a fixed grid
  (see "Refresh timing" above)
- **Manual** (`workflow_dispatch`) - "Run workflow" button on the Actions page

Steps on each run: checkout -> setup Node 22 -> `npm ci` -> `node dedup.js`
-> upload `public/` as an artifact -> deploy to GitHub Pages. Takes ~30
seconds.

One-time repo setting (already done for this repo):
**Settings -> Pages -> Build and deployment -> Source: "GitHub Actions"**.
Without it, the `configure-pages` step fails.

---

## Grey areas and known limitations

Read this section honestly - these are the edges of the system.

### Deduplication limits

- **It is similarity-based, not perfect.** Reworded duplicates below the
  threshold survive (real example: five differently-worded headlines about
  the same Rourkela Excise bribe arrest all appeared in one run). Lowering
  the threshold catches more but risks false merges.
- **Light stemming only.** `arrested`/`arrest` and `outages`/`outage` now
  compare as one word, but `held`/`hold` still do not. Reworded headlines
  of the same big story can still slip through - word overlap between
  same-story headlines ranges from near-zero to high, so no threshold
  separates them perfectly.
- **First-seen wins.** Items are processed in the order Google returns them;
  which publisher's headline survives is arbitrary.
- **The threshold was measured, not guessed.** A sample of 30 near-duplicate
  pairs was hand-labelled and four candidate signals were tested against it:
  plain word overlap, IDF-weighted overlap, rare-bigram overlap, and
  rare-token overlap. None separated true duplicates from false ones
  cleanly, and lowering the threshold merged unrelated stories such as
  "Meta launches Muse Wonder" with "Anthropic launches Claude Opus 5.5".
  So 0.45 stays. What changed instead: archive pages cross-dedupe across
  every feed in a category, which catches repeats the per-feed pass misses,
  and job postings dedupe on source id so two roles at one company stay
  two postings.
- **Empty-token headlines are never duplicates.** A title with no meaningful
  words left after tokenizing is always kept.

### Google News quirks

- **Links are Google redirects** (`news.google.com/rss/articles/...`), not
  direct publisher URLs. They resolve correctly, but they are long and opaque,
  and Google can change their format at any time.
- **Old articles appear - and are now filtered.** For low-volume queries
  Google fills the feed with older results (the OSHB feed once returned
  articles from 2015). Items older than 365 days are dropped automatically;
  override per feed with `maxAgeDays` in `feeds.json` (e.g. 30 for
  high-volume topics). Items with a missing date are kept, and feed order
  still does not equal recency.
- **Some titles contain literal newlines** from the source. Harmless when
  rendered, slightly ugly in the HTML source.
- **Quoted keywords are exact match.** `"OSHB"` will not match `OSHB's`.
  Unquoted keywords match more loosely.

### Feed noise (query design, not code bugs)

- **Acronym collisions.** The bare `OSHB` keyword also matches New Mexico's
  Occupational Health & Safety Bureau and a Ukrainian unit with the same
  abbreviation. Fix by requiring context, e.g. an AND-group in a `url`:
  `("Odisha State Housing Board" OR ("OSHB" AND Odisha))`.
- **Broad keywords pull spam.** Generic terms (sports, security, technology)
  attract streaming-site junk and product pages. Prefer specific phrases.
- **The LLM feed's bare `security` / `vulnerability` terms** let through
  non-AI security product pages. Tighten with AND-groups if it bothers you.

### GitHub Actions quirks

- **Scheduled runs are badly delayed.** On this repo a `*/30` cron actually
  fired every 2 to 6.5 hours, median about 4. The delay is in GitHub's
  scheduler, not the queue, and no cron setting fixes it. That is why the
  refresh clock lives in `tick.yml` instead.
- **Scheduled workflows get disabled after 60 days** of no activity in a
  public repo. Normal commits keep it alive; if it is disabled, re-enable it
  from the Actions tab.
- **`npm ci` fails without a committed `package-lock.json`.** If you change
  dependencies, run `npm install` locally and commit the updated lock file.
- **A failing feed does not fail the build.** A feed that errors (network
  hiccup, bad query) is logged as `[fail]` in the Actions log and skipped;
  the deploy proceeds and that feed is simply missing from the site until the
  next successful run. Check the log if a feed vanishes.
- **Fetch guard with retry.** Each feed has 15s timeout + 2 retries with backoff. 24 feeds fetched sequentially take ~15-30 seconds per run. A feed that still fails is skipped for that run.

### Operational notes

- `public/` and `node_modules/` are gitignored on purpose. Never commit them.
- `index.html` only contains feeds that succeeded in that particular run.
- On Windows, git prints harmless `LF will be replaced by CRLF` warnings.
  Ignore them.
- Node 20 reached end-of-life in April 2026; the workflow pins Node 22 on
  purpose.

### The manage page's security model

- **The page itself is public** and has no login. That is deliberate: a
  static site has no server to authenticate against. The real gate is the
  token, and the page can only ever open a pull request - it cannot merge
  one, and it cannot delete anything.
- **The token lives in `localStorage`**, which means any script running on
  that origin could read it. The page is static and contains no third-party
  scripts, no analytics, and no user-supplied HTML, so the practical risk is
  low. If it ever matters, use a token scoped to this one repository with
  only Contents and Pull requests, and revoke it on GitHub when you are done.
- **A token in a browser is a real trade-off.** It buys a no-server UI at the
  cost of a credential that lives outside GitHub's session controls. The
  alternative - editing `feeds.json` directly - has no such credential and
  remains fully supported. If you would rather not hold a token in the
  browser, just edit the file; nothing else changes.

---

## Maintenance cheat sheet

| Task | How |
|---|---|
| Add a feed | Use the manage page (opens a pull request), or edit `feeds.json` and commit |
| Remove a feed | Use the manage page, or delete its entry from `feeds.json` and commit |
| Add a new site section | Use the manage page ("+ Create a new section"), or add a block to `categories` in `feeds.json` |
| Force an instant refresh | Actions tab -> "Update News Feed" -> "Run workflow" |
| Check the coding standard | `npm run lint` |
| Make dedup more aggressive | Lower `SIMILARITY_THRESHOLD` in `dedup.js` (e.g. 0.40) |
| Make dedup safer | Raise `SIMILARITY_THRESHOLD` (e.g. 0.65) |
| Ignore more common words | Add to the `STOPWORDS` set in `dedup.js` |
| Exclude noisy terms from a feed | Add an `"exclude"` list to that feed in `feeds.json` |
| Slice a broad source to one topic | Add a `"filter"` list to that feed in `feeds.json` |
| Add or rename a site section | Edit the `categories` array in `feeds.json` |
| Change refresh frequency | Edit `INTERVAL_MINUTES` in `.github/workflows/tick.yml` |
| Change locale for keyword feeds | Edit `GOOGLE_NEWS_LOCALE` in `dedup.js` |
| Change the age cutoff | Set `maxAgeDays` per feed in `feeds.json`, or `MAX_AGE_DAYS` in `dedup.js` |
| Change what a bundle includes | Edit its `sources` list in `feeds.json` |
| Repo renamed? | Update `SITE_URL` in `dedup.js` (used by `feeds.opml`) |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Workflow red at "Install dependencies" | `package-lock.json` missing or out of sync | Run `npm install` locally, commit the lock file |
| Workflow red at "Setup Pages" | Pages source not set to "GitHub Actions" | Settings -> Pages -> Source: "GitHub Actions", then re-run the job |
| A feed vanished from the site | Its fetch failed that run | Check the Actions log for a `[fail]` line; it returns on the next good run |
| Feed full of old articles | Age cutoff too lenient for that topic | Set `"maxAgeDays": 30` (or lower) on that feed in `feeds.json` |
| Reader notifies for old stories | Every new subscription notifies for all items once; afterwards only unseen IDs notify | Expected on first subscribe; ongoing churn is reduced by newest-first ordering - also check the reader app notification settings |
| Too many duplicate stories | Threshold too high for that topic | Lower `SIMILARITY_THRESHOLD` slightly |
| Genuinely different stories merged | Threshold too low | Raise `SIMILARITY_THRESHOLD` slightly |
| `npm start` says "Cannot read feeds.json" | Running from the wrong directory | Run from the repo root |
| "feeds.json is not valid JSON" | Typo while editing (trailing comma, unquoted string) | Fix the JSON; the error message includes the position |
| Manage page says "Bad credentials" | The token expired, was revoked, or was pasted with spaces | Generate a new fine-grained token and paste it without spaces |
| Manage page says "could not create pull request" | Token lacks Pull requests: write | Add Pull requests: Read and write to the token's repository permissions |
| Manage page says "A feed called X already exists" | A feed with that title is already in the list | Remove it first, or give the new one a different title |
| Manage page says "A section called X already exists" | That section is already in the list | Pick it from the dropdown instead of creating a new one |
| Manage page opens but the section list is empty | `feeds.json` has no `categories` array | Add the `categories` array (see above) |
| Manage page 404s | The page is copied at build time | Push the commit and wait for a deploy; `public/` is rebuilt from scratch each run |

---

## Quick reference

- Repo: https://github.com/pratapnayakin/pn-broadcast (public)
- Site: https://pratapnayakin.github.io/pn-broadcast/
- Manage page: https://pratapnayakin.github.io/pn-broadcast/manage.html
- Engine: `dedup.js` (Node, single dependency: `rss-parser`)
- Config: `feeds.json` (feeds, bundles, categories)
- Subscribe once: import `feeds.opml` into any RSS reader
- Refresh: on a fixed grid via `tick.yml` (30 min by default) + on every push to `main`
- Cost: zero
