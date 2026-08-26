/*
 * WebMCP adapter for the Synesthetic Curator demo.
 * SPDX-License-Identifier: MPL-2.0
 * Copyright (c) 2026 Giuseppe Petrini / Seph Martin
 *
 * WebMCP is intentionally page-level here: the tools read and mutate the
 * same visible crate the user is looking at.  The adapter talks to the small
 * window.__CRATE_API__ facade exposed by crate.js and never reaches into
 * Three.js internals or checkout endpoints directly.
 */

import { buildCollectionStats, buildMusicDNA, getRecordId, scoreCatalog } from './song-dna.js';

const MAX_TOOL_OUTPUT_RECORDS = 12;
const ACTIVE_STATES = new Set(['loading', 'active', 'busy', 'standby']);

let agentState = 'human';
let standbyTimer = null;
let activityDepth = 0;
let toolRegistrationComplete = false;
let sessionStartedAt = null;

function dispatch(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function setAgentState(state, detail = {}) {
  agentState = state;
  document.documentElement.dataset.agentMode = state;

  const hud = document.getElementById('agent-mode-hud');
  const label = document.getElementById('agent-mode-label');
  const detailEl = document.getElementById('agent-mode-detail');
  const live = document.getElementById('agent-mode-live');
  const labels = {
    human: 'Human Mode',
    loading: 'Agent Mode Loading...',
    active: 'Agent Mode Active',
    busy: 'Agent Mode Working...',
    standby: 'Agent Mode Standby',
    override: 'Manual Override'
  };
  const details = {
    human: 'WEBMCP // DORMANT',
    loading: 'CONNECTING TO PAGE TOOLS',
    active: 'SYNTHETIC CURATOR // READY',
    busy: detail.text || 'READING THE CRATE',
    standby: 'WAITING FOR THE NEXT DIRECTION',
    override: 'HUMAN INPUT HAS PRIORITY'
  };

  if (hud) hud.dataset.state = state;
  if (label) label.textContent = labels[state] || labels.human;
  if (detailEl) detailEl.textContent = detail.text || details[state] || '';
  if (live && state !== 'human') live.textContent = labels[state] || '';

  dispatch('seph-agent-state', { state, ...detail });

  if (standbyTimer) {
    clearTimeout(standbyTimer);
    standbyTimer = null;
  }
  if (state === 'active') {
    standbyTimer = window.setTimeout(() => {
      if (agentState === 'active') {
        setAgentState('standby');
      }
    }, 12000);
  }
}

function nextPaint() {
  return new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function getCrateApi() {
  return window.__CRATE_API__ || null;
}

async function waitForCrateApi() {
  if (getCrateApi()) return getCrateApi();
  if (window.__CRATE_API_READY_PROMISE__) {
    try {
      await window.__CRATE_API_READY_PROMISE__;
    } catch (error) {
      throw new Error(`Crate API unavailable: ${error?.message || error}`);
    }
  }
  const api = getCrateApi();
  if (!api) throw new Error('Crate API unavailable');
  return api;
}

function resultError(code, message, extra = {}) {
  return { ok: false, error: { code, message }, ...extra };
}

function trimText(value, max = 400) {
  return String(value ?? '').trim().slice(0, max);
}

function armBusy(text) {
  activityDepth += 1;
  if (activityDepth === 1 && agentState !== 'override') {
    setAgentState('busy', { text });
  }
}

function releaseBusy() {
  activityDepth = Math.max(0, activityDepth - 1);
  if (activityDepth === 0 && agentState === 'busy') {
    setAgentState('active');
  }
}

async function withAgentActivity(text, work) {
  armBusy(text);
  try {
    return await work();
  } finally {
    releaseBusy();
  }
}

function getCatalog() {
  return getCrateApi()?.getMasterCatalog?.() || [];
}

function getItemSummary(item) {
  if (!item) return null;
  return {
    record_id: getRecordId(item),
    catalog_slug: String(item.slug || getRecordId(item)),
    title: item.title || '',
    artist: item.artist || '',
    label: item.site_name || '',
    type: item.type || 'album',
    page_url: item.page_url || '',
    price_text: item.price_text || '',
    tags: Array.isArray(item.bandcamp_tags)
      ? item.bandcamp_tags
      : Array.isArray(item.tags) ? item.tags : [],
    release_date: item.release_date || null,
    track_count: Array.isArray(item.tracks) ? item.tracks.length : 0
  };
}

function searchCatalog(query, maxResults = MAX_TOOL_OUTPUT_RECORDS) {
  const normalized = trimText(query, 200).toLowerCase();
  if (!normalized) return [];
  return getCatalog()
    .filter(item => {
      const title = String(item.title || '').toLowerCase();
      const artist = String(item.artist || '').toLowerCase();
      return title.includes(normalized) || artist.includes(normalized);
    })
    .slice(0, Math.max(1, Math.min(24, Number(maxResults) || MAX_TOOL_OUTPUT_RECORDS)))
    .map(getItemSummary);
}

function findItem(recordId) {
  const normalized = trimText(recordId, 160);
  if (!normalized) return null;
  return getCatalog().find(item => {
    const id = getRecordId(item);
    return id === normalized || String(item.slug || '') === normalized || String(item.page_url || '') === normalized;
  }) || null;
}

function installHumanOverride() {
  const events = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
  const onHumanInput = event => {
    if (!ACTIVE_STATES.has(agentState)) return;
    if (event.isTrusted === false) return;
    if (event.target?.closest?.('#agent-mode-hud')) return;
    setAgentState('override');
    dispatch('seph-agent-focus', { record_ids: [], source: 'human_override' });
  };
  events.forEach(eventName => window.addEventListener(eventName, onHumanInput, { passive: true }));
}

async function registerTool(modelContext, tool) {
  await modelContext.registerTool(tool);
}

function getAvailableModelContext() {
  try {
    if (document.modelContext && typeof document.modelContext.registerTool === 'function') {
      return { context: document.modelContext, source: 'document.modelContext' };
    }
  } catch (error) {
    console.warn('[WebMCP] document.modelContext probe failed:', error);
  }

  try {
    if (globalThis.navigator?.modelContext && typeof globalThis.navigator.modelContext.registerTool === 'function') {
      return { context: globalThis.navigator.modelContext, source: 'navigator.modelContext' };
    }
  } catch (error) {
    console.warn('[WebMCP] navigator.modelContext probe failed:', error);
  }

  return { context: null, source: 'none' };
}

async function registerWebMCPTools(api, modelContext, modelContextSource) {
  if (toolRegistrationComplete) return;

  const readOnly = {
    readOnlyHint: true,
    untrustedContentHint: true
  };
  const uiMutation = {
    readOnlyHint: false,
    untrustedContentHint: true
  };

  await registerTool(modelContext, {
    name: 'start_curator_session',
    title: 'Start Synesthetic Curator session',
    description: 'Call this first. Activates the visible Agent Mode HUD and confirms that the page crate tools are ready. It does not purchase anything.',
    inputSchema: {
      type: 'object',
      properties: { intent: { type: 'string', maxLength: 400 } },
      additionalProperties: false
    },
    annotations: uiMutation,
    async execute(input = {}) {
      return withAgentActivity('INITIALIZING PAGE TOOLS', async () => {
        sessionStartedAt = new Date().toISOString();
        setAgentState('loading', { text: 'CONNECTING TO PAGE TOOLS' });
        await nextPaint();
        setAgentState('active');
        const status = api.status();
        return {
          ok: true,
          agent_mode: 'active',
          session_started_at: sessionStartedAt,
          intent: trimText(input.intent, 400) || null,
          ...status,
          next_step: 'Use search_catalog for exact metadata search or dig_by_descriptor for Song DNA metadata matching.'
        };
      });
    }
  });

  await registerTool(modelContext, {
    name: 'get_collection_stats',
    title: 'Read crate collection stats',
    description: 'Returns compact, metadata-backed collection statistics and the Song DNA dimensions currently available. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: readOnly,
    async execute() {
      return withAgentActivity('ORIENTING IN THE COLLECTION', async () => ({
        ok: true,
        ...buildCollectionStats(getCatalog())
      }));
    }
  });

  await registerTool(modelContext, {
    name: 'search_catalog',
    title: 'Search visible catalog',
    description: 'Searches the existing crate search surface by release title or artist and updates the visible crate. Use dig_by_descriptor for metadata DNA matching.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 200 },
        max_results: { type: 'integer', minimum: 1, maximum: 24 }
      },
      required: ['query'],
      additionalProperties: false
    },
    annotations: uiMutation,
    async execute(input = {}) {
      return withAgentActivity('SEARCHING THE CRATE', async () => {
        const query = trimText(input.query, 200);
        if (!query) return resultError('INVALID_QUERY', 'A non-empty catalog query is required.');
        const results = searchCatalog(query, input.max_results);
        api.setSearchQuery(query);
        if (results.length > 0) api.focusRecord(results[0].record_id);
        return {
          ok: true,
          query,
          search_scope: 'title_and_artist',
          results,
          result_count: results.length
        };
      });
    }
  });

  await registerTool(modelContext, {
    name: 'dig_by_descriptor',
    title: 'Dig by Song DNA descriptor',
    description: 'Ranks catalog records against a natural-language producer descriptor using conservative metadata Song DNA signals, then focuses the top records in the visible crate. It does not claim audio analysis.',
    inputSchema: {
      type: 'object',
      properties: {
        descriptor: { type: 'string', minLength: 2, maxLength: 400 },
        max_results: { type: 'integer', minimum: 1, maximum: 24 },
        exclude_ids: { type: 'array', items: { type: 'string', maxLength: 160 }, maxItems: 24 }
      },
      required: ['descriptor'],
      additionalProperties: false
    },
    annotations: uiMutation,
    async execute(input = {}) {
      return withAgentActivity('DIGGING THROUGH SONG DNA', async () => {
        const descriptor = trimText(input.descriptor, 400);
        if (!descriptor) return resultError('INVALID_DESCRIPTOR', 'A non-empty descriptor is required.');
        const result = scoreCatalog(getCatalog(), descriptor, {
          maxResults: input.max_results,
          excludeIds: input.exclude_ids
        });
        const focusIds = result.matches.map(match => match.record_id);
        if (focusIds.length > 0) {
          api.focusRecords(focusIds);
        }
        return {
          ok: true,
          ...result,
          focus_record_ids: focusIds
        };
      });
    }
  });

  await registerTool(modelContext, {
    name: 'focus_records',
    title: 'Focus records in crate',
    description: 'Moves the first requested record to the front of the visible crate and gives the requested records the agent-curated visual treatment.',
    inputSchema: {
      type: 'object',
      properties: {
        record_ids: { type: 'array', items: { type: 'string', maxLength: 160 }, minItems: 1, maxItems: 12 },
        label: { type: 'string', maxLength: 80 }
      },
      required: ['record_ids'],
      additionalProperties: false
    },
    annotations: uiMutation,
    async execute(input = {}) {
      return withAgentActivity('BRINGING PICKS TO THE FRONT', async () => {
        const ids = [...new Set((input.record_ids || []).map(value => trimText(value, 160)).filter(Boolean))];
        if (ids.length === 0) return resultError('INVALID_RECORD_IDS', 'At least one record_id is required.');
        const focused = api.focusRecords(ids);
        if (!focused.ok) return focused;
        return { ok: true, ...focused, label: trimText(input.label, 80) || null };
      });
    }
  });

  await registerTool(modelContext, {
    name: 'inspect_record',
    title: 'Inspect Song DNA record',
    description: 'Opens a record in the existing detail panel and returns its catalog metadata plus conservative Song DNA Lite provenance and missing dimensions. Read-only with visible focus.',
    inputSchema: {
      type: 'object',
      properties: { record_id: { type: 'string', minLength: 1, maxLength: 160 } },
      required: ['record_id'],
      additionalProperties: false
    },
    annotations: { ...readOnly, readOnlyHint: false },
    async execute(input = {}) {
      return withAgentActivity('INSPECTING THE RECORD', async () => {
        const item = findItem(input.record_id);
        if (!item) return resultError('RECORD_NOT_FOUND', 'The requested record is not in the loaded catalog.');
        const focused = api.focusRecord(getRecordId(item));
        return {
          ok: true,
          record: getItemSummary(item),
          music_dna: buildMusicDNA(item),
          ui_focus: focused
        };
      });
    }
  });

  await registerTool(modelContext, {
    name: 'manage_crate',
    title: 'Add or remove a record from My Crate',
    description: 'Changes the local My Crate using the existing Add to Crate control. This is reversible, does not call checkout, and does not purchase anything.',
    inputSchema: {
      type: 'object',
      properties: {
        record_id: { type: 'string', minLength: 1, maxLength: 160 },
        action: { type: 'string', enum: ['add', 'remove'] }
      },
      required: ['record_id', 'action'],
      additionalProperties: false
    },
    annotations: uiMutation,
    async execute(input = {}) {
      return withAgentActivity(input.action === 'remove' ? 'REMOVING FROM MY CRATE' : 'ADDING TO MY CRATE', async () => {
        if (!['add', 'remove'].includes(input.action)) {
          return resultError('INVALID_ACTION', 'Action must be add or remove.');
        }
        const item = findItem(input.record_id);
        if (!item) return resultError('RECORD_NOT_FOUND', 'The requested record is not in the loaded catalog.');
        return api.manageCrate(getRecordId(item), input.action);
      });
    }
  });

  await registerTool(modelContext, {
    name: 'prepare_checkout',
    title: 'Prepare human checkout review',
    description: 'Shows My Crate and returns a checkout summary for human review. It never opens checkout, creates a payment session, or completes a purchase.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: uiMutation,
    async execute() {
      return withAgentActivity('PREPARING A HUMAN CHECKOUT REVIEW', async () => ({
        ok: true,
        ...api.prepareCheckout(),
        human_confirmation_required: true,
        next_step: 'The user must review the visible crate and click BUY CRATE themselves.'
      }));
    }
  });

  await registerTool(modelContext, {
    name: 'end_curator_session',
    title: 'End Synesthetic Curator session',
    description: 'Returns the page to Human Mode and clears agent-focused record styling. It does not alter My Crate.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: uiMutation,
    async execute() {
      setAgentState('human');
      api.clearAgentFocus();
      sessionStartedAt = null;
      return { ok: true, agent_mode: 'human', crate_unchanged: true };
    }
  });

  toolRegistrationComplete = true;
  document.documentElement.dataset.webmcp = 'ready';
  dispatch('seph-webmcp-ready', {
    tool_count: 9,
    model_context_source: modelContextSource,
    tools: [
      'start_curator_session',
      'get_collection_stats',
      'search_catalog',
      'dig_by_descriptor',
      'focus_records',
      'inspect_record',
      'manage_crate',
      'prepare_checkout',
      'end_curator_session'
    ]
  });
}

async function boot() {
  installHumanOverride();
  try {
    const api = await waitForCrateApi();
    const modelContext = getAvailableModelContext();
    if (!modelContext.context) {
      document.documentElement.dataset.webmcp = 'unsupported';
      dispatch('seph-webmcp-unsupported', {
        reason: 'No supported modelContext producer API is available',
        checked: ['document.modelContext', 'navigator.modelContext']
      });
      return;
    }
    await registerWebMCPTools(api, modelContext.context, modelContext.source);
  } catch (error) {
    document.documentElement.dataset.webmcp = 'error';
    console.warn('[WebMCP] Adapter did not initialize:', error);
    dispatch('seph-webmcp-error', { message: String(error?.message || error) });
  }
}

boot();
