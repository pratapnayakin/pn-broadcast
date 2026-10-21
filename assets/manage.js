/**
 * manage.js
 * ---------
 * The manage page: add and remove feeds from the browser.
 *
 * Reads feeds.json through the GitHub API, applies the change, then opens a
 * branch and a pull request. The user reviews the diff and merges it.
 *
 * The pure logic (building a feed entry, applying it to a config, writing
 * the config back out) lives in manage-core.js so it can be unit tested.
 * This file is the browser half: DOM wiring and the GitHub API calls.
 */

import {
  NEW_SECTION,
  applyEntry,
  buildEntry,
  decodeBase64,
  encodeBase64,
  removeFeed,
  serialize,
} from './manage-core.js';

const REPO = 'pratapnayakin/pn-broadcast';
const API = 'https://api.github.com';
const FILE = 'feeds.json';

// headBranch is the branch the current pull request lives on. When it is
// set, the next change is pushed onto that branch instead of starting a
// new one, so several edits made in one session end up in one pull
// request instead of overwriting each other.
const state = {
  token: '',
  branch: 'main',
  config: null,
  sha: null,
  fileSha: null,
  selected: null,
  headBranch: null,
  prUrl: null,
  prNumber: null,
  changes: [],
};

const $ = (id) => document.getElementById(id);
const tokenInput = $('token');
const branchInput = $('branch');
const savedToken = localStorage.getItem('pnBroadcastToken');
if (savedToken) tokenInput.value = savedToken;

/** Builds an element. Props are applied as properties, except class/text. */
const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('aria-') || key === 'role') node.setAttribute(key, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node[key] = value;
  }
  node.append(...children.flat().filter((child) => child !== null && child !== undefined));
  return node;
};

/** Shows a message box. Content is text or a node - never raw HTML. */
const show = (target, content, kind) => {
  target.className = `msg show ${kind}`;
  target.replaceChildren(
    ...(typeof content === 'string' ? [document.createTextNode(content)] : [content])
  );
};

const hide = (target) => {
  target.className = 'msg';
};

/** Calls the GitHub API and returns the parsed body. Throws on failure. */
const api = async (path, { method = 'GET', body } = {}) => {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) {
    const error = new Error(data?.message || res.statusText);
    error.status = res.status;
    throw error;
  }
  return data;
};

// ---------------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------------

$('connect').addEventListener('click', async () => {
  state.token = tokenInput.value.trim();
  state.branch = branchInput.value.trim() || 'main';
  hide($('connectMsg'));
  if (!state.token) {
    show($('connectMsg'), 'Paste a personal access token first.', 'err');
    return;
  }
  $('connect').disabled = true;
  $('connect').textContent = 'Loading...';
  try {
    const data = await api(
      `/repos/${REPO}/contents/${FILE}?ref=${encodeURIComponent(state.branch)}`
    );
    state.sha = data.sha;
    state.fileSha = data.sha;
    state.headBranch = null;
    state.prUrl = null;
    state.prNumber = null;
    state.changes = [];
    state.config = JSON.parse(decodeBase64(data.content));
    localStorage.setItem('pnBroadcastToken', state.token);
    $('repoLabel').textContent = `Connected to ${REPO}`;
    show($('connectMsg'), `Connected. ${state.config.feeds.length} feeds loaded.`, 'ok');
    $('editorCard').style.display = '';
    $('listCard').style.display = '';
    fillPickers();
    renderList();
  } catch (err) {
    const hint =
      err.status === 401 || err.status === 403 ? ' - check the token and its permissions.' : '';
    show($('connectMsg'), `Could not load feeds.json: ${err.message}${hint}`, 'err');
  } finally {
    $('connect').disabled = false;
    $('connect').textContent = 'Load feeds';
  }
});

// ---------------------------------------------------------------------------
// Pickers
// ---------------------------------------------------------------------------

const fillPickers = (keepSection) => {
  const sec = $('section');
  const prev = keepSection ?? sec.value;
  sec.replaceChildren();
  const cats = state.config.categories ?? [];
  if (!cats.length) {
    sec.append(el('option', { value: '', text: 'No sections defined' }));
  }
  for (const cat of cats) {
    sec.append(el('option', { value: cat.slug, text: cat.label }));
  }
  // Option to create a brand new section rather than pick an existing one.
  sec.append(el('option', { value: NEW_SECTION, text: '+ Create a new section...' }));
  // Keep the user's choice across a refresh.
  if (prev && [...sec.options].some((option) => option.value === prev)) {
    sec.value = prev;
  }

  const bun = $('bundle');
  bun.replaceChildren(el('option', { value: '', text: 'None' }));
  for (const bundle of state.config.bundles ?? []) {
    bun.append(el('option', { value: bundle.filename, text: bundle.title }));
  }
  syncSection();
};

/** Shows the new-section fields only when that option is picked. */
const syncSection = () => {
  $('newSectionBox').style.display = $('section').value === NEW_SECTION ? '' : 'none';
};
$('section').addEventListener('change', syncSection);

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

/** The section a feed currently sits in. */
const sectionOf = (filename) => {
  let found = 'More';
  for (const cat of state.config.categories ?? []) {
    if (cat.filenames?.includes(filename)) found = cat.label;
  }
  return found;
};

/** The display label for a section slug. */
const sectionLabel = (slug) => {
  const cat = (state.config.categories ?? []).find((c) => c.slug === slug);
  return cat ? cat.label : slug;
};

const renderList = () => {
  const rows = $('feedRows');
  rows.replaceChildren();
  for (const feed of state.config.feeds) {
    const name = feed.filename;
    const radio = el('input', {
      type: 'radio',
      name: 'pick',
      value: name,
      'aria-label': `Select ${feed.title || name}`,
    });
    radio.checked = state.selected === name;
    radio.addEventListener('change', () => {
      state.selected = radio.value;
      $('removeBtn').disabled = false;
    });
    rows.append(
      el('tr', {},
        el('td', { text: feed.title || name }),
        el('td', {}, el('code', { text: name })),
        el('td', { text: sectionOf(name) }),
        el('td', {}, el('span', { class: feed.notify ? 'pill on' : 'pill', text: feed.notify ? 'push' : 'no' })),
        el('td', {}, radio)
      )
    );
  }
};

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

/** The current form values, in the shape buildEntry expects. */
const formValues = () => ({
  title: $('title').value,
  kind: $('kind').value,
  keywords: $('keywords').value,
  url: $('url').value,
  maxAge: $('maxAge').value,
  exclude: $('exclude').value,
  filter: $('filter').value,
  notify: $('notify').value,
  topic: $('topic').value,
});

/** Applies the current form to a copy of the config. */
const applyForm = () =>
  applyEntry(
    state.config,
    buildEntry(formValues()),
    $('section').value,
    $('bundle').value,
    {
      newSectionLabel: $('newSection').value,
      newSectionAccent: $('newSectionAccent').value,
    }
  );

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

$('preview').addEventListener('click', () => {
  hide($('saveMsg'));
  try {
    show(
      $('saveMsg'),
      el('div', {},
        el('strong', { text: 'Preview of feeds.json' }),
        el('pre', { class: 'preview', text: serialize(applyForm()) })
      ),
      'ok'
    );
  } catch (err) {
    show($('saveMsg'), err.message, 'err');
  }
});

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

/**
 * Pushes a changed feeds.json onto the working branch and keeps one pull
 * request open for the whole session. The first change creates the branch
 * and the pull request; every later change just adds a commit to that
 * branch, so the pull request ends up showing every edit made here.
 * cfg is the full new config, commitMessage the git message, title and
 * note describe the change for the pull request.
 */
const pushChange = async (cfg, commitMessage, title, note) => {
  const first = !state.headBranch;
  let branchName = state.headBranch;
  state.changes.push(note);

  if (first) {
    const ref = await api(
      `/repos/${REPO}/git/ref/heads/${encodeURIComponent(state.branch)}`
    );
    branchName = `feeds-ui/${Date.now()}`;
    await api(`/repos/${REPO}/git/refs`, {
      method: 'POST',
      body: { ref: `refs/heads/${branchName}`, sha: ref.object.sha },
    });
  }

  const put = await api(`/repos/${REPO}/contents/${FILE}`, {
    method: 'PUT',
    body: {
      message: commitMessage,
      content: encodeBase64(serialize(cfg)),
      branch: branchName,
      sha: state.fileSha,
    },
  });
  state.headBranch = branchName;
  state.fileSha = put.content.sha;
  state.config = cfg;

  const prTitle =
    state.changes.length === 1 ? title : `Update feed list (${state.changes.length} changes)`;
  const prBody = [
    'Changed from the PN Broadcast manage page.',
    '',
    ...state.changes.map((change) => `- ${change}`),
    '',
    'The next refresh picks this up within 30 minutes.',
  ].join('\n');

  const pr = first
    ? await api(`/repos/${REPO}/pulls`, {
      method: 'POST',
      body: { title: prTitle, head: branchName, base: state.branch, body: prBody },
    })
    : await api(`/repos/${REPO}/pulls/${state.prNumber}`, {
      method: 'PATCH',
      body: { title: prTitle, body: prBody },
    });

  if (pr?.html_url) {
    state.prUrl = pr.html_url;
    state.prNumber = pr.number;
  }
  $('reset').style.display = '';
  return state.prUrl;
};

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

$('save').addEventListener('click', async () => {
  hide($('saveMsg'));
  let entry;
  let cfg;
  try {
    entry = buildEntry(formValues());
    cfg = applyForm();
  } catch (err) {
    show($('saveMsg'), err.message, 'err');
    return;
  }
  $('save').disabled = true;
  $('save').textContent = 'Creating...';
  const picked = $('section').value;
  const note =
    picked === NEW_SECTION
      ? `Added feed "${entry.title}" and created a new section "${$('newSection').value.trim()}"`
      : `Added feed "${entry.title}" to the ${sectionLabel(picked)} section`;
  try {
    const prUrl = await pushChange(
      cfg,
      `Add feed: ${entry.title}`,
      `Add feed: ${entry.title}`,
      note
    );
    show(
      $('saveMsg'),
      el('span', {},
        'Pull request ready: ',
        el('a', { href: prUrl, target: '_blank', rel: 'noopener', text: prUrl }),
        el('br'),
        'Review the diff and tap Merge. The feed goes live within 30 minutes.'
      ),
      'ok'
    );
    $('title').value = '';
    $('keywords').value = '';
    $('url').value = '';
    $('filter').value = '';
    $('newSection').value = '';
    // The section list may have gained a new entry.
    fillPickers(picked === NEW_SECTION ? '' : picked);
    renderList();
  } catch (err) {
    const hint =
      err.status === 403 ? ' - the token may lack Contents: write or Pull requests: write.' : '';
    show($('saveMsg'), `Failed: ${err.message}${hint}`, 'err');
  } finally {
    $('save').disabled = false;
    // Once a pull request is open, further edits join it.
    $('save').textContent = state.prUrl ? 'Add to pull request' : 'Create pull request';
  }
});

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------

$('removeBtn').addEventListener('click', async () => {
  hide($('removeMsg'));
  const name = state.selected;
  if (!name) return;
  const cfg = removeFeed(state.config, name);
  $('removeBtn').disabled = true;
  try {
    const prUrl = await pushChange(
      cfg,
      `Remove feed: ${name}`,
      `Remove feed: ${name}`,
      `Removed feed "${name}"`
    );
    show(
      $('removeMsg'),
      el('span', {},
        'Pull request ready: ',
        el('a', { href: prUrl, target: '_blank', rel: 'noopener', text: prUrl }),
        el('br'),
        'Review and tap Merge to remove the feed.'
      ),
      'ok'
    );
    state.selected = null;
    renderList();
  } catch (err) {
    show($('removeMsg'), `Failed: ${err.message}`, 'err');
  } finally {
    $('removeBtn').disabled = true;
  }
});

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

$('reset').addEventListener('click', () => {
  // Start over: forget the open pull request and reload the live config.
  state.headBranch = null;
  state.prUrl = null;
  state.prNumber = null;
  state.changes = [];
  $('save').textContent = 'Create pull request';
  $('reset').style.display = 'none';
  hide($('saveMsg'));
  hide($('removeMsg'));
  $('connect').click();
});

// ---------------------------------------------------------------------------
// Kind Toggle
// ---------------------------------------------------------------------------

const syncKind = () => {
  const kind = $('kind').value;
  $('kwBox').style.display = kind === 'keywords' ? '' : 'none';
  $('urlBox').style.display = kind === 'keywords' ? 'none' : '';
  $('kindHint').textContent =
    kind === 'freehire'
      ? 'A freehire.me search URL. It is used as-is, and the feed dedupes on job id so two roles at one company both show.'
      : kind === 'url'
        ? 'Used as-is. Any RSS feed that serves valid XML works.'
        : 'Each line becomes a quoted phrase. Great for topics like "Rourkela power cut".';
};
$('kind').addEventListener('change', syncKind);
syncKind();

$('notify').addEventListener('change', () => {
  $('topicBox').style.display = $('notify').value === 'yes' ? '' : 'none';
});
