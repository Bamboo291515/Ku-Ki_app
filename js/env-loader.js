// Hydrates window.__env__ by fetching kuki.env assets before other modules run.
const globalScope = typeof globalThis !== 'undefined' ? globalThis : window;

const STRIP_QUOTE = /^['"]|['"]$/g;
const RELATIVE_SOURCE_FILES = [
  '../kuki.env',
];
const META_ENV_URL = 'kuki-env-url';
const META_ENV_BRANCH = 'kuki-env-branch';
const GITHUB_HOST_SUFFIX = '.github.io';

function uniqueStrings(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function queryMetaValues(name) {
  const doc = globalScope.document;
  if (!doc) return [];
  return Array.from(doc.querySelectorAll(`meta[name="${name}"]`))
    .map((meta) => meta.getAttribute('content')?.trim())
    .filter(Boolean);
}

function collectExplicitEnvUrls() {
  const urls = [];
  urls.push(...queryMetaValues(META_ENV_URL));

  const inline = globalScope.__KUKI_ENV_URL__;
  if (typeof inline === 'string') {
    urls.push(inline);
  } else if (Array.isArray(inline)) {
    urls.push(...inline);
  }
  return urls;
}

function collectGithubBranchHints() {
  const hints = [];
  hints.push(...queryMetaValues(META_ENV_BRANCH));

  const inline = globalScope.__KUKI_ENV_BRANCH__;
  if (typeof inline === 'string') {
    hints.push(inline);
  } else if (Array.isArray(inline)) {
    hints.push(...inline);
  }

  // Reasonable defaults for common GitHub Pages setups
  hints.push('main', 'gh-pages');
  return uniqueStrings(hints);
}

function buildGithubEnvUrls() {
  const location = globalScope.location;
  if (!location?.hostname?.endsWith(GITHUB_HOST_SUFFIX)) return [];

  const owner = location.hostname.slice(0, -GITHUB_HOST_SUFFIX.length);
  const repo = (location.pathname?.split('/').filter(Boolean) ?? [])[0];
  if (!owner || !repo) return [];

  const branches = collectGithubBranchHints();
  const files = ['kuki.env'];
  const urls = [];

  for (const branch of branches) {
    for (const fileName of files) {
      urls.push(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${fileName}`);
    }
  }
  return urls;
}

function normalizeSourceList(candidates) {
  const normalized = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      normalized.push(new URL(candidate, import.meta.url).toString());
    } catch (error) {
      console?.warn?.('Ku-Ki: Skipping invalid env source candidate.', candidate, error);
    }
  }
  return uniqueStrings(normalized);
}

function buildSourceCandidates() {
  const rawCandidates = [
    ...collectExplicitEnvUrls(),
    ...RELATIVE_SOURCE_FILES,
    ...buildGithubEnvUrls(),
    // GitHub Pages のリポジトリサブディレクトリ対応
    getGithubPagesRepositoryPath() + '/kuki.env',
  ];
  return normalizeSourceList(rawCandidates);
}

function getGithubPagesRepositoryPath() {
  const location = globalScope.location;
  if (!location?.hostname?.endsWith(GITHUB_HOST_SUFFIX)) return '';
  
  const pathname = location.pathname || '';
  const parts = pathname.split('/').filter(Boolean);
  
  // <owner>.github.io: root
  // <owner>.github.io/<repo>: /repo
  if (parts.length === 0) return '';
  if (parts[0] === 'Ku-Ki_app' || parts[0] === 'ku-ki_app' || parts[0].toLowerCase().includes('kuki')) {
    return '/' + parts[0];
  }
  return '';
}

function parseDotEnv(rawText) {
  if (!rawText) return {};
  const envMap = {};
  const lines = rawText.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    if (!key) continue;
    const value = trimmed.slice(eqIndex + 1).trim().replace(STRIP_QUOTE, '');
    envMap[key] = value;
  }
  return envMap;
}

async function fetchEnvFile(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to load ${url}`);
  const text = await response.text();
  return parseDotEnv(text);
}

async function hydrateEnvMap() {
  if (globalScope.__env__ && Object.keys(globalScope.__env__).length > 0) {
    return globalScope.__env__;
  }

  let lastError = null;
  const seenSources = new Set();
  for (const candidateUrl of buildSourceCandidates()) {
    try {
      if (seenSources.has(candidateUrl)) continue;
      seenSources.add(candidateUrl);

      const envMap = await fetchEnvFile(candidateUrl);
      if (Object.keys(envMap).length === 0) {
        continue;
      }
      globalScope.__env__ = { ...(globalScope.__env__ ?? {}), ...envMap };
      return globalScope.__env__;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    console.warn('Ku-Ki: Unable to load kuki.env configuration; falling back to placeholders.', lastError);
  }
  globalScope.__env__ = globalScope.__env__ ?? {};
  return globalScope.__env__;
}

const envReadyPromise = hydrateEnvMap();

export { envReadyPromise };
export function ensureEnvLoaded() {
  return envReadyPromise;
}
export function getEnvMap() {
  return globalScope.__env__ ?? {};
}
