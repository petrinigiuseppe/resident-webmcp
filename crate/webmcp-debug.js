/*
 * Client-side diagnostics for the WebMCP beta.
 * SPDX-License-Identifier: MPL-2.0
 * Copyright (c) 2026 Giuseppe Petrini / Seph Martin
 *
 * The logger deliberately lives outside the model tool surface. It records a
 * bounded, sanitized event stream in memory/sessionStorage and exposes a
 * browser download API, so an agent never has to spend context summarising
 * routine transport or UI telemetry.
 */

export const WEBMCP_BUILD_VERSION = '20260831-webmcp-m48';

const DIAGNOSTICS_SCHEMA = 'sephmartin.webmcp.diagnostics.v1';
const STORAGE_KEY = 'seph.webmcp.diagnostics.v1';
const MAX_EVENTS = 1200;
const MAX_PERSISTED_EVENTS = 240;
const MAX_STORAGE_BYTES = 180 * 1024;
const URL_VALUE_KEY = /(?:^|_)(?:url|href|source)$/i;
const UI_EVENTS = [
  'seph-agent-state',
  'seph-agent-sound',
  'seph-agent-focus',
  'seph-theme-change',
  'seph-player-state',
  'seph-webmcp-ready',
  'seph-webmcp-error',
  'seph-webmcp-unsupported'
];
const SENSITIVE_KEY = /password|secret|token|cookie|authorization|api[-_]?key|private[-_]?key|refresh[-_]?key/i;

const hasWindow = typeof window !== 'undefined';
const hasDocument = typeof document !== 'undefined';
const pageSessionId = createId('page');
let curatorSessionId = null;
let eventSequence = 0;
let toolSequence = 0;
let events = [];
let sessions = [];
let toolStats = Object.create(null);
let persistTimer = null;
let storageAvailable = false;

function createId(prefix) {
  const timestamp = Date.now().toString(36);
  const entropy = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${timestamp}-${entropy}`;
}

function clockMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function truncate(value, max = 640) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function sanitizeUrl(value) {
  const text = String(value ?? '');
  if (!/^https?:\/\//i.test(text) && !text.startsWith('/')) return truncate(text);
  try {
    const base = hasWindow ? window.location.origin : 'https://sephmartin.com';
    const parsed = new URL(text, base);
    // Preview and proxy URLs can contain signed query parameters. Keep the
    // useful route for debugging, never the credential-like query string.
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return truncate(text.split(/[?#]/, 1)[0]);
  }
}

function sanitize(value, depth = 0) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return truncate(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'function') return '[function]';
  if (depth >= 4) return '[truncated]';
  if (value instanceof Error) {
    return {
      name: truncate(value.name, 120),
      message: truncate(value.message, 640),
      code: value.code ? truncate(value.code, 120) : null
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 24).map(item => sanitize(item, depth + 1));
  }
  if (typeof value === 'object') {
    const result = {};
    Object.keys(value).slice(0, 48).forEach(key => {
      result[key] = SENSITIVE_KEY.test(key)
        ? '[redacted]'
        : URL_VALUE_KEY.test(key) ? sanitizeUrl(value[key]) : sanitize(value[key], depth + 1);
    });
    return result;
  }
  return truncate(value, 120);
}

function elementSnapshot(id) {
  if (!hasDocument) return null;
  const element = document.getElementById(id);
  if (!element) return null;
  return {
    present: true,
    hidden: Boolean(element.hidden || element.classList?.contains('hidden')),
    state: element.dataset?.state || null,
    operation: element.dataset?.operation || null,
    audio_state: element.dataset?.audioState || null,
    text: truncate(element.textContent, 220)
  };
}

function getSnapshot() {
  if (!hasDocument) return null;
  const root = document.documentElement;
  const activeTrack = document.querySelector('.track-item.active');
  const playerTitle = document.getElementById('player-track-title');
  const currentTime = document.getElementById('player-current-time');
  const totalTime = document.getElementById('player-total-time');
  const buyButton = document.getElementById('buy-btn');
  const queryKeys = hasWindow
    ? [...new URLSearchParams(window.location.search).keys()].sort()
    : [];

  return {
    page: {
      pathname: hasWindow ? window.location.pathname : null,
      query_keys: queryKeys,
      visibility: document.visibilityState || null
    },
    root_data: {
      webmcp: root.dataset.webmcp || null,
      agent_mode: root.dataset.agentMode || null,
      agent_operation: root.dataset.agentOperation || null,
      agent_sound: root.dataset.agentSound || null,
      theme: root.dataset.theme || null,
      theme_preference: root.dataset.themePreference || null,
      site_audio: root.dataset.siteAudio || null,
      player_audio: root.dataset.playerAudio || null,
      agent_debug: root.dataset.agentDebug || null,
      agent_intro: root.dataset.agentIntro || null
    },
    surfaces: {
      hud: elementSnapshot('agent-mode-hud'),
      mobile_hint: elementSnapshot('mobile-agent-hint'),
      debug_panel: elementSnapshot('agent-debug-panel'),
      diagnostics_download: elementSnapshot('site-diagnostics-download'),
      player: elementSnapshot('custom-player')
    },
    player: {
      title: playerTitle ? truncate(playerTitle.textContent, 220) : null,
      current_time: currentTime ? truncate(currentTime.textContent, 40) : null,
      total_time: totalTime ? truncate(totalTime.textContent, 40) : null,
      play_button_playing: Boolean(document.getElementById('player-play-btn')?.classList.contains('is-playing')),
      active_track_id: activeTrack?.dataset?.trackId || null,
      active_release_record_id: activeTrack?.dataset?.releaseRecordId || null,
      selected_record_id: buyButton?.dataset?.slug || null,
      selected_record_title: document.getElementById('detail-title')?.textContent?.trim() || null,
      details_open: Boolean(document.getElementById('details-panel') && !document.getElementById('details-panel').classList.contains('hidden'))
    }
  };
}

function schedulePersist() {
  if (!hasWindow || persistTimer !== null) return;
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    persist();
  }, 0);
}

function persist() {
  if (!storageAvailable) return;
  try {
    const storedEvents = events.slice(-MAX_PERSISTED_EVENTS);
    const payload = {
      schema: DIAGNOSTICS_SCHEMA,
      build_version: WEBMCP_BUILD_VERSION,
      page_session_id: pageSessionId,
      sessions: sessions.slice(-24),
      tool_stats: toolStats,
      events: storedEvents
    };
    let serialized = JSON.stringify(payload);
    while (serialized.length > MAX_STORAGE_BYTES && storedEvents.length > 1) {
      storedEvents.shift();
      payload.events = storedEvents;
      serialized = JSON.stringify(payload);
    }
    window.sessionStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    storageAvailable = false;
  }
}

function loadPersistedState() {
  if (!hasWindow) return;
  try {
    const raw = window.sessionStorage?.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed?.schema !== DIAGNOSTICS_SCHEMA) return;
    if (Array.isArray(parsed.events)) events = parsed.events.slice(-MAX_EVENTS);
    if (Array.isArray(parsed.sessions)) sessions = parsed.sessions.slice(-24);
    if (parsed.tool_stats && typeof parsed.tool_stats === 'object') toolStats = parsed.tool_stats;
    eventSequence = events.reduce((max, item) => Math.max(max, Number(item?.sequence) || 0), 0);
  } catch {
    // A corrupt or unavailable session log must never affect the page.
  }
}

function record(kind, name, detail = {}, { snapshot = false } = {}) {
  try {
    const item = {
      sequence: ++eventSequence,
      at: new Date().toISOString(),
      elapsed_ms: Math.round(clockMs() * 100) / 100,
      build_version: WEBMCP_BUILD_VERSION,
      kind: truncate(kind, 80),
      name: truncate(name, 160),
      page_session_id: pageSessionId,
      curator_session_id: curatorSessionId,
      detail: sanitize(detail)
    };
    if (snapshot) item.ui = getSnapshot();
    events.push(item);
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    schedulePersist();
    if (hasWindow && typeof CustomEvent === 'function') {
      try {
        window.dispatchEvent(new CustomEvent('seph-diagnostics-event', {
          detail: {
            sequence: item.sequence,
            event_count: events.length,
            kind: item.kind,
            name: item.name
          }
        }));
      } catch {
        // Diagnostics must never interrupt the page when event notification is unavailable.
      }
    }
    return item;
  } catch {
    return null;
  }
}

function startTool(name, input = {}) {
  const normalizedName = truncate(name, 160);
  const callId = `${pageSessionId}-tool-${++toolSequence}`;
  const startedAt = clockMs();
  const stats = toolStats[normalizedName] || { calls: 0, completed: 0, failed: 0, last_duration_ms: null };
  stats.calls += 1;
  toolStats[normalizedName] = stats;
  record('tool', 'started', {
    call_id: callId,
    tool: normalizedName,
    input
  });
  return { call_id: callId, tool: normalizedName, started_at: startedAt };
}

function finishTool(call, result) {
  if (!call) return;
  const duration = Math.max(0, Math.round((clockMs() - call.started_at) * 100) / 100);
  const stats = toolStats[call.tool];
  if (stats) {
    stats.completed += 1;
    stats.last_duration_ms = duration;
  }
  record('tool', 'completed', {
    call_id: call.call_id,
    tool: call.tool,
    duration_ms: duration,
    result
  }, { snapshot: true });
}

function failTool(call, error) {
  if (!call) return;
  const duration = Math.max(0, Math.round((clockMs() - call.started_at) * 100) / 100);
  const stats = toolStats[call.tool];
  if (stats) {
    stats.failed += 1;
    stats.last_duration_ms = duration;
  }
  record('tool', 'failed', {
    call_id: call.call_id,
    tool: call.tool,
    duration_ms: duration,
    error
  }, { snapshot: true });
}

function setSession(id, detail = {}) {
  curatorSessionId = id ? truncate(id, 160) : null;
  if (curatorSessionId) {
    sessions.push({
      session_id: curatorSessionId,
      page_session_id: pageSessionId,
      build_version: WEBMCP_BUILD_VERSION,
      started_at: new Date().toISOString(),
      detail: sanitize(detail)
    });
    if (sessions.length > 24) sessions.splice(0, sessions.length - 24);
  }
  schedulePersist();
}

function getExport() {
  return {
    schema: DIAGNOSTICS_SCHEMA,
    build_version: WEBMCP_BUILD_VERSION,
    exported_at: new Date().toISOString(),
    runtime: {
      page_session_id: pageSessionId,
      curator_session_id: curatorSessionId,
      logger: 'browser_download',
      model_context_state: hasDocument ? document.documentElement.dataset.webmcp || 'unknown' : 'unknown'
    },
    current_snapshot: getSnapshot(),
    sessions: sessions.slice(),
    tool_stats: sanitize(toolStats),
    event_count: events.length,
    events: events.slice()
  };
}

function getStats() {
  return {
    schema: DIAGNOSTICS_SCHEMA,
    build_version: WEBMCP_BUILD_VERSION,
    page_session_id: pageSessionId,
    curator_session_id: curatorSessionId,
    event_count: events.length,
    session_count: sessions.length,
    tool_count: Object.keys(toolStats).length,
    storage_available: storageAvailable
  };
}

function download() {
  record('diagnostics', 'download_requested', { event_count: events.length });
  if (!hasWindow || !hasDocument || typeof Blob === 'undefined' || !window.URL?.createObjectURL) {
    return { ok: false, error: 'Browser download APIs are unavailable.' };
  }

  try {
    const payload = JSON.stringify(getExport(), null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    anchor.href = url;
    anchor.download = `sephmartin-webmcp-${WEBMCP_BUILD_VERSION}-${stamp}.json`;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body?.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
    return { ok: true, filename: anchor.download, event_count: events.length };
  } catch (error) {
    record('diagnostics', 'download_failed', { error });
    return { ok: false, error: truncate(error?.message || error, 640) };
  }
}

function clear() {
  events = [];
  sessions = [];
  toolStats = Object.create(null);
  eventSequence = 0;
  toolSequence = 0;
  try {
    window.sessionStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures; the in-memory log is still cleared.
  }
  if (hasWindow && typeof CustomEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent('seph-diagnostics-cleared', {
        detail: { event_count: 0, build_version: WEBMCP_BUILD_VERSION }
      }));
    } catch {
      // Ignore notification failures; the log is already cleared.
    }
  }
  return { ok: true };
}

loadPersistedState();
if (hasWindow) {
  try {
    storageAvailable = Boolean(window.sessionStorage);
  } catch {
    storageAvailable = false;
  }
  UI_EVENTS.forEach(eventName => {
    window.addEventListener(eventName, event => {
      record('ui', eventName, event?.detail || {}, { snapshot: true });
    });
  });
  window.addEventListener('error', event => {
    record('runtime', 'error', {
      message: event?.message || 'Unhandled browser error',
      source: event?.filename || null,
      line: event?.lineno || null,
      column: event?.colno || null,
      error: event?.error || null
    }, { snapshot: true });
  });
  window.addEventListener('unhandledrejection', event => {
    record('runtime', 'unhandled_rejection', { reason: event?.reason || null }, { snapshot: true });
  });
  window.addEventListener('pagehide', event => {
    record('page', 'pagehide', { persisted: Boolean(event?.persisted) }, { snapshot: true });
  }, { passive: true });
  window.addEventListener('online', () => {
    record('network', 'online', {}, { snapshot: true });
  }, { passive: true });
  window.addEventListener('offline', () => {
    record('network', 'offline', {}, { snapshot: true });
  }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    record('ui', 'visibilitychange', { visibility: document.visibilityState }, { snapshot: true });
  }, { passive: true });
}

export const diagnostics = {
  buildVersion: WEBMCP_BUILD_VERSION,
  pageSessionId,
  record,
  startTool,
  finishTool,
  failTool,
  setSession,
  getSnapshot,
  getStats,
  getExport,
  download,
  clear
};

if (hasWindow) window.__SEPH_WEBMCP_DIAGNOSTICS__ = diagnostics;
