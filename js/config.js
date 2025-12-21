// 設定・DB操作

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// 設定

const PLACEHOLDER_URL = '__REPLACE_WITH_SUPABASE_URL__';
const PLACEHOLDER_ANON_KEY = '__REPLACE_WITH_SUPABASE_ANON_KEY__';

const runtimeGlobal = typeof globalThis !== 'undefined' ? globalThis : {};

function readValue(key, fallback) {
  // .env から読み込む
  const env = runtimeGlobal.__env__ ?? runtimeGlobal.env;
  if (env && key in env && env[key] !== undefined && env[key] !== '') return env[key];
  return fallback;
}

const DEFAULT_STORAGE_KEY = 'kuki_client_id';

function resolveSupabaseSettings() {
  return {
    url: readValue('SUPABASE_URL', PLACEHOLDER_URL),
    anonKey: readValue('SUPABASE_ANON_KEY', PLACEHOLDER_ANON_KEY),
    storageKey: readValue('KUKI_CLIENT_STORAGE_KEY', DEFAULT_STORAGE_KEY),
  };
}

function getStorageKey() {
  return readValue('KUKI_CLIENT_STORAGE_KEY', DEFAULT_STORAGE_KEY);
}

// テーブル定義

const TABLES = {
  sessions: 'sessions',
  participants: 'participants',
  events: 'events',
};

// Supabaseクライアント

function getSafeLocalStorage() {
  if (typeof globalThis === 'undefined' || !globalThis.localStorage) return null;
  try {
    const storage = globalThis.localStorage;
    const probeKey = '__kuki_probe__';
    storage.setItem(probeKey, '1');
    storage.removeItem(probeKey);
    return storage;
  } catch (error) {
    console?.warn('Ku-Ki: localStorage is not available in this context.', error);
    return null;
  }
}

const localStorageRef = getSafeLocalStorage();
let _clientIdCache = null;

const isPlaceholderValue = (val) => !val || String(val).toUpperCase().includes('REPLACE');
let supabaseClient = null;
let supabaseClientSignature = null;
let warnedMissingConfig = false;

function initializeSupabaseClient(settings) {
  return createClient(settings.url, settings.anonKey, {
    global: { headers: { 'x-kuki-config': 'controller-v2' } },
  });
}

function ensureSupabaseClient() {
  const settings = resolveSupabaseSettings();
  if (isPlaceholderValue(settings.url) || isPlaceholderValue(settings.anonKey)) {
    if (!warnedMissingConfig) {
      console?.warn('Supabase: provide SUPABASE_URL and SUPABASE_ANON_KEY via window.__env__ or #kuki-env script.');
      warnedMissingConfig = true;
    }
    return null;
  }

  const signature = `${settings.url}::${settings.anonKey}`;
  if (!supabaseClient || supabaseClientSignature !== signature) {
    supabaseClient = initializeSupabaseClient(settings);
    supabaseClientSignature = signature;
    warnedMissingConfig = false;
  }
  return supabaseClient;
}

function getClient() {
  const client = ensureSupabaseClient();
  if (!client) {
    throw new Error('Supabase client not configured. Provide SUPABASE_URL and SUPABASE_ANON_KEY.');
  }
  return client;
}

// Client ID 管理

function generateClientId() {
  const crypto = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (crypto?.randomUUID) return crypto.randomUUID();
  const rand = Math.random().toString(36).slice(2, 10);
  return `client-${Date.now()}-${rand}`;
}

export function getOrCreateClientId() {
  if (_clientIdCache) return _clientIdCache;

  // localStorageから読み込み試行
  if (localStorageRef) {
    try {
      const stored = localStorageRef.getItem(getStorageKey());
      if (stored) {
        _clientIdCache = stored;
        return _clientIdCache;
      }
    } catch (e) {
      // 失敗時は生成フローに進む
    }
  }

  // 生成して保存
  _clientIdCache = generateClientId();
  if (localStorageRef) {
    try {
      localStorageRef.setItem(getStorageKey(), _clientIdCache);
    } catch (e) {
      // 保存失敗時も _clientIdCache は有効
    }
  }

  return _clientIdCache;
}

export function refreshClientId() {
  _clientIdCache = generateClientId();
  if (localStorageRef) {
    try {
      localStorageRef.setItem(getStorageKey(), _clientIdCache);
    } catch (e) {
      // 失敗時も _clientIdCache は有効
    }
  }
  return _clientIdCache;
}

// Session ID 管理

export const DEFAULT_SESSION_ID = '119af2e3-6a49-41df-a648-81c215b1cbfd';
let sessionFallbackNotified = false;

export function getSessionIdFromUrl() {
  if (!globalThis?.location?.search) return null;
  return new URLSearchParams(globalThis.location.search).get('sid');
}

function ensureSessionId() {
  const sid = getSessionIdFromUrl();
  if (sid && sid.trim()) return sid;

  if (!sessionFallbackNotified) {
    console?.info?.('Ku-Ki: sid missing, falling back to DEFAULT_SESSION_ID.');
    sessionFallbackNotified = true;
  }
  return DEFAULT_SESSION_ID;
}

// 共通コンテキスト

function buildContext() {
  return {
    session_id: ensureSessionId(),
    client_id: getOrCreateClientId(),
  };
}

// Session操作

export async function fetchSession(sessionId) {
  const { data, error } = await getClient()
    .from(TABLES.sessions)
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function ensureSession(sessionId = ensureSessionId(), { title } = {}) {
  if (!sessionId) throw new Error('Cannot ensure session without an id');

  const existing = await fetchSession(sessionId);
  if (existing) return existing;

  const payload = { id: sessionId };
  if (title !== undefined) payload.title = title;

  const { data, error } = await getClient()
    .from(TABLES.sessions)
    .insert(payload)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

// Participant操作

export async function upsertParticipant({ avatarId } = {}) {
  await ensureSession();

  const { data, error } = await getClient()
    .from(TABLES.participants)
    .upsert(
      { ...buildContext(), avatar_id: avatarId ?? null },
      { onConflict: ['session_id', 'client_id'] }
    )
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

// Event操作

export async function insertEvent(type) {
  await ensureSession();

  const { data, error } = await getClient()
    .from(TABLES.events)
    .insert({ ...buildContext(), type });
  if (error) throw error;
  return data;
}

// ヘルパー

export function hasSupabaseClient() {
  return Boolean(ensureSupabaseClient());
}

export function getSupabaseClientIfAvailable() {
  return ensureSupabaseClient();
}

export function getSupabaseSettings() {
  return Object.freeze(resolveSupabaseSettings());
}

export const tableNames = TABLES;
