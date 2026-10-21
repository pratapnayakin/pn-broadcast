// Pure logic for the manage page: turning form input into a feeds.json
// entry, and applying that entry to a config.
//
// Nothing here touches the DOM or the network, so it can be unit tested
// directly (see test.js). The browser code in manage.js imports it.
//
// This file is an ES module. The repo's package.json has no "type" field,
// so assets/package.json marks this folder as ESM for Node. That lets
// test.js require() it while the browser loads it with import.

/** Sentinel value for the "create a new section" option in the picker. */
export const NEW_SECTION = '__new_section__';

/** Turns a title into a safe file name. */
export const slugify = (value) =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

/** Splits a comma separated field into a trimmed list of non-empty parts. */
export const splitList = (value) =>
  String(value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

/**
 * Builds a feed entry from the form's values.
 *
 * fields is a plain object so this can be tested without a DOM:
 *   { title, kind, keywords, url, maxAge, exclude, filter, notify, topic }
 *
 * kind is one of: 'keywords', 'url', 'freehire'.
 * Throws an Error with a message meant for the user.
 */
export const buildEntry = (fields) => {
  const title = String(fields.title ?? '').trim();
  const kind = fields.kind;
  if (!title) throw new Error('Feed title is required.');
  const entry = { filename: slugify(title), title, description: title };

  if (kind === 'keywords') {
    const keywords = String(fields.keywords ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (!keywords.length) throw new Error('Add at least one search term.');
    entry.keywords = keywords;
  } else {
    const url = String(fields.url ?? '').trim();
    if (!url) throw new Error('Feed URL is required.');
    entry.url = url;
    if (kind === 'freehire') {
      entry.type = 'freehire';
      entry.dedupeById = true;
    }
  }

  const maxAgeDays = parseInt(fields.maxAge, 10);
  if (!Number.isNaN(maxAgeDays) && maxAgeDays > 0) entry.maxAgeDays = maxAgeDays;

  const exclude = splitList(fields.exclude);
  if (exclude.length) entry.exclude = exclude;

  const filter = splitList(fields.filter);
  if (filter.length) entry.filter = filter;

  if (fields.notify === 'yes') {
    entry.notify = true;
    const topic = String(fields.topic ?? '').trim();
    if (topic) entry.topic = topic;
  }
  return entry;
};

/**
 * Applies a new feed to a copy of the config.
 *
 * The feed always lands in a real, named category - never the "More"
 * fallback. If sectionSlug is NEW_SECTION, the section is created here
 * (label, slug, accent) and the feed goes into it.
 *
 * options: { newSectionLabel, newSectionAccent }
 */
export const applyEntry = (config, entry, sectionSlug, bundleName, options = {}) => {
  const cfg = structuredClone(config);
  for (const existing of cfg.feeds ?? []) {
    if (existing.filename === entry.filename) {
      throw new Error(`A feed named "${entry.filename}" already exists.`);
    }
    // The filename is derived from the title, so an existing feed with the
    // same title would get a near-identical filename and pull the same
    // content twice. Catch it here rather than shipping a double feed.
    if (existing.title?.trim().toLowerCase() === entry.title.trim().toLowerCase()) {
      throw new Error(
        `A feed called "${existing.title}" already exists. ` +
        'Remove it first, or give this one a different title.'
      );
    }
  }
  cfg.categories ??= [];

  if (sectionSlug === NEW_SECTION) {
    const label = String(options.newSectionLabel ?? '').trim();
    if (!label) throw new Error('Give the new section a name.');
    const slug = slugify(label);
    if (!slug) throw new Error('That section name has no usable letters.');
    if (cfg.categories.some((cat) => cat.slug === slug)) {
      throw new Error(`A section called "${label}" already exists. Pick it from the list instead.`);
    }
    cfg.categories.push({
      label,
      slug,
      accent: options.newSectionAccent || '#c2185b',
      full: false,
      filenames: [entry.filename],
    });
  } else {
    if (!sectionSlug) {
      throw new Error('Choose a section for this feed (or create a new one).');
    }
    const target = cfg.categories.find((cat) => cat.slug === sectionSlug);
    if (!target) throw new Error(`Section "${sectionSlug}" no longer exists. Reload the feeds.`);
    target.filenames ??= [];
    if (!target.filenames.includes(entry.filename)) target.filenames.push(entry.filename);
  }

  cfg.feeds ??= [];
  cfg.feeds.push(entry);
  for (const bundle of cfg.bundles ?? []) {
    if (bundle.filename !== bundleName) continue;
    bundle.sources ??= [];
    if (!bundle.sources.includes(entry.filename)) bundle.sources.push(entry.filename);
  }
  return cfg;
};

/**
 * Removes a feed from a copy of the config: from the feed list, from every
 * section's filenames, and from every bundle's sources.
 */
export const removeFeed = (config, filename) => {
  const cfg = structuredClone(config);
  cfg.feeds = (cfg.feeds ?? []).filter((feed) => feed.filename !== filename);
  for (const cat of cfg.categories ?? []) {
    cat.filenames = (cat.filenames ?? []).filter((file) => file !== filename);
  }
  for (const bundle of cfg.bundles ?? []) {
    bundle.sources = (bundle.sources ?? []).filter((file) => file !== filename);
  }
  return cfg;
};

/**
 * Formats JSON the way feeds.json is already written: two-space indent,
 * objects expanded, arrays of plain values on one line. This keeps the
 * pull request diff to just the lines that actually changed.
 */
export const formatJson = (value, indent) => {
  const pad = '  '.repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    const allPlain = value.every((item) => item === null || typeof item !== 'object');
    if (allPlain) {
      return `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
    }
    return `[\n${value
      .map((item) => `${pad}  ${formatJson(item, indent + 1)}`)
      .join(',\n')}\n${pad}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (!keys.length) return '{}';
    return `{\n${keys
      .map((key) => `${pad}  ${JSON.stringify(key)}: ${formatJson(value[key], indent + 1)}`)
      .join(',\n')}\n${pad}}`;
  }
  return JSON.stringify(value);
};

/** The whole config as a string, in the repo's own format. */
export const serialize = (config) => `${formatJson(config, 0)}\n`;

/** Encodes text as base64, safe for non-ASCII characters. */
export const encodeBase64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

/** Decodes the base64 content field of a GitHub contents response. */
export const decodeBase64 = (base64) => {
  const binary = atob(base64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};
