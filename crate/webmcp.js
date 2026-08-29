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
import {
  getAgentPresenceText,
  getAgentStatusText,
  isPassiveAgentStatus,
  resolveAgentOperation
} from './agent-state.js?v=20260829-webmcp-m35';
import { diagnostics, WEBMCP_BUILD_VERSION } from './webmcp-debug.js?v=20260829-webmcp-m35';

const MAX_TOOL_OUTPUT_RECORDS = 12;
const ACTIVE_STATES = new Set(['loading', 'active', 'busy', 'standby']);
const DEBUG_QUERY_KEYS = ['webmcp_debug', 'agent_debug'];
const SESSION_HANDSHAKE_MS = 180;
const AGENT_INTRO_MS = 2400;
const DIG_PREVIEW_MS = 420;
const DRAG_MARGIN_PX = 12;
const RETURN_FOCUS_CLEAR_MS = 560;
const RETURN_TO_HUMAN_MS = 960;
const HUMAN_OVERRIDE_EXCLUSION_SELECTOR = '#agent-mode-hud, #mobile-agent-hint, #agent-debug-panel, #agent-debug-trigger, #details-panel, [data-agent-debug-action]';

let agentState = 'human';
let agentOperation = 'human';
let previewIsPlaying = false;
let standbyTimer = null;
let activityDepth = 0;
let toolRegistrationComplete = false;
let sessionStartedAt = null;
let returnTransitionId = 0;
let curatorSessionPromise = null;
let curatorSessionId = null;
let curatorSessionSequence = 0;
// Agent Mode sound cues are intentionally enabled for the first session so
// the activation handoff is audible. The user can mute them from the orb.
let agentSoundEnabled = true;
let agentAudioContext = null;
let pendingAgentActivationCue = false;
let debugActionPromise = null;
let agentIntroTimer = null;
const AGENT_BEHAVIOR_MIX = {
  // Calibrated against the preview player's reduced native level in crate.js.
  activation: 0.126,
  active: 0.108,
  busy: 0.094,
  returning: 0.094
};
let agentIntroHasShown = false;
let agentModeHasBeenEntered = false;

function dispatch(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function toHudText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function inferAgentOperation(state, text = '') {
  const normalized = String(text).toLowerCase();
  if (state === 'busy') {
    if (normalized.includes('dig') || normalized.includes('song dna')) return 'digging';
    if (normalized.includes('brows') || normalized.includes('explor')) return 'browsing';
    if (normalized.includes('search')) return 'searching';
    if (normalized.includes('inspect')) return 'inspecting';
    if (normalized.includes('orient')) return 'orienting';
    if (normalized.includes('bring') || normalized.includes('front')) return 'focusing';
    if (normalized.includes('add') || normalized.includes('remov')) return 'curating';
    if (normalized.includes('checkout')) return 'preparing';
    return 'thinking';
  }

  return resolveAgentOperation(state, '', previewIsPlaying);
}

function updateSoundControl() {
  const root = document.documentElement;
  const toggles = [...document.querySelectorAll('[data-agent-sound-toggle]')];
  root.dataset.agentSound = agentSoundEnabled ? 'on' : 'off';
  toggles.forEach(toggle => {
    toggle.hidden = agentState === 'human';
    toggle.setAttribute('aria-pressed', String(agentSoundEnabled));
    toggle.setAttribute(
      'aria-label',
      agentSoundEnabled ? 'Mute agent behavior sounds' : 'Unmute agent behavior sounds'
    );
    toggle.setAttribute(
      'title',
      agentSoundEnabled ? 'Mute agent behavior sounds' : 'Unmute agent behavior sounds'
    );
    const toggleLabel = toggle.querySelector('#agent-sound-toggle-label, .agent-sound-toggle-label');
    if (toggleLabel) toggleLabel.textContent = agentSoundEnabled ? 'Sound on' : 'Sound off';
  });
}

function getAgentAudioContext() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  if (!agentAudioContext) {
    const sharedContext = window.__SEPH_AGENT_AUDIO_CONTEXT__;
    if (sharedContext && typeof sharedContext.createGain === 'function') {
      agentAudioContext = sharedContext;
    } else {
      agentAudioContext = new AudioContext();
      window.__SEPH_AGENT_AUDIO_CONTEXT__ = agentAudioContext;
    }
  }
  return agentAudioContext;
}

// crate.js uses this shared context for agent-driven navigation textures. A
// single context keeps browser autoplay/user-gesture state consistent across
// activation cues and the sequential dig preview.
window.__SEPH_GET_AGENT_AUDIO_CONTEXT__ = getAgentAudioContext;

function playAgentCue(state, operation) {
  if (!agentSoundEnabled || state === 'human') return;
  const context = getAgentAudioContext();
  if (!context) return;

  if (state === 'loading') {
    const introDuration = AGENT_INTRO_MS / 1000;
    const playActivation = () => {
      if (!agentSoundEnabled) {
        pendingAgentActivationCue = false;
        return;
      }
      pendingAgentActivationCue = false;

      const now = context.currentTime;
      const master = context.createGain();
      const filter = context.createBiquadFilter();
      const delay = context.createDelay(1);
      const tail = context.createGain();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2200, now);
      filter.Q.setValueAtTime(0.35, now);
      master.gain.setValueAtTime(0.0001, now);
      master.gain.exponentialRampToValueAtTime(AGENT_BEHAVIOR_MIX.activation, now + 0.34);
      master.gain.exponentialRampToValueAtTime(0.0001, now + introDuration - 0.16);
      delay.delayTime.setValueAtTime(0.38, now);
      tail.gain.setValueAtTime(0.14, now);
      master.connect(filter);
      filter.connect(context.destination);
      master.connect(delay);
      delay.connect(tail);
      tail.connect(context.destination);

      [
        { frequency: 261.63, detune: -4, type: 'sine', level: 0.72 },
        { frequency: 392, detune: 3, type: 'sine', level: 0.38 },
        { frequency: 523.25, detune: -2, type: 'triangle', level: 0.14 }
      ].forEach(voice => {
        const oscillator = context.createOscillator();
        const voiceGain = context.createGain();
        oscillator.type = voice.type;
        oscillator.detune.setValueAtTime(voice.detune, now);
        oscillator.frequency.setValueAtTime(voice.frequency * 0.985, now);
        oscillator.frequency.exponentialRampToValueAtTime(voice.frequency, now + introDuration * 0.7);
        voiceGain.gain.setValueAtTime(voice.level, now);
        oscillator.connect(voiceGain);
        voiceGain.connect(master);
        oscillator.start(now);
        oscillator.stop(now + introDuration + 0.12);
      });
    };

    if (context.state === 'suspended') {
      pendingAgentActivationCue = true;
      context.resume().then(playActivation).catch(() => {});
    } else {
      playActivation();
    }
    return;
  }

  const cues = {
    active: { frequency: 246, duration: 0.24, gain: AGENT_BEHAVIOR_MIX.active, type: 'sine' },
    busy: { frequency: operation === 'digging' ? 132 : 158, duration: 0.12, gain: AGENT_BEHAVIOR_MIX.busy, type: 'triangle' },
    returning: { frequency: 196, duration: 0.34, gain: AGENT_BEHAVIOR_MIX.returning, type: 'sine', slide: 156 }
  };
  const cue = cues[state];
  if (!cue) return;
  const play = () => {
    if (!agentSoundEnabled) return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = cue.type;
    oscillator.frequency.setValueAtTime(cue.frequency, now);
    if (cue.slide) oscillator.frequency.exponentialRampToValueAtTime(cue.slide, now + cue.duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(cue.gain, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + cue.duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + cue.duration + 0.02);
  };

  if (context.state === 'suspended') {
    context.resume().then(play).catch(() => {});
  } else {
    play();
  }
}

function unlockAgentAudio(event) {
  if (event?.isTrusted !== true) return;
  const context = getAgentAudioContext();
  if (!context || context.state !== 'suspended') return;
  context.resume().then(() => {
    if (pendingAgentActivationCue && agentState !== 'human') {
      playAgentCue('loading', agentOperation);
    }
  }).catch(() => {});
}

function installAgentAudioUnlock() {
  const unlock = event => unlockAgentAudio(event);
  ['pointerdown', 'keydown', 'touchstart'].forEach(eventName => {
    window.addEventListener(eventName, unlock, { passive: true });
  });
}

function setSoundEnabled(enabled) {
  agentSoundEnabled = Boolean(enabled);
  if (!agentSoundEnabled) pendingAgentActivationCue = false;
  if (agentSoundEnabled) {
    const context = getAgentAudioContext();
    if (context?.state === 'suspended') context.resume().catch(() => {});
  }
  updateSoundControl();
  if (agentSoundEnabled) playAgentCue('active', agentOperation);
  dispatch('seph-agent-sound', {
    enabled: agentSoundEnabled,
    scope: 'site',
    mode: 'agent'
  });
}

function restoreHumanAudioAfterExit() {
  agentSoundEnabled = false;
  pendingAgentActivationCue = false;
  // Keep an already user-unlocked shared context alive across the soft handoff.
  // The sound gate above stops new Agent cues without forcing another gesture
  // when the next Agent Mode session starts.
  updateSoundControl();
  // Hand the site's audio policy back to the human surface. Agent cues stop;
  // any human preview player is unmuted for the next explicit interaction.
  dispatch('seph-agent-sound', {
    enabled: true,
    scope: 'site',
    mode: 'human'
  });
}

function installAgentSoundControl() {
  const toggles = [...document.querySelectorAll('[data-agent-sound-toggle]')];
  if (toggles.length === 0) return;
  toggles.forEach(toggle => {
    if (toggle.dataset.bound === 'true') return;
    toggle.dataset.bound = 'true';
    toggle.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      setSoundEnabled(!agentSoundEnabled);
    });
  });
  updateSoundControl();
}

function clearAgentIntro() {
  if (agentIntroTimer) {
    window.clearTimeout(agentIntroTimer);
    agentIntroTimer = null;
  }
  const intro = document.getElementById('agent-mode-intro');
  if (intro) intro.hidden = true;
  delete document.documentElement.dataset.agentIntro;
}

function triggerAgentIntro() {
  const intro = document.getElementById('agent-mode-intro');
  if (!intro) return;
  if (agentIntroTimer) window.clearTimeout(agentIntroTimer);
  intro.hidden = false;
  delete document.documentElement.dataset.agentIntro;
  requestAnimationFrame(() => {
    document.documentElement.dataset.agentIntro = 'active';
  });
  agentIntroTimer = window.setTimeout(clearAgentIntro, AGENT_INTRO_MS);
}

function updateAgentPresenceVisibility() {
  const visibility = !agentModeHasBeenEntered;
  const hud = document.getElementById('agent-mode-hud');
  const hint = document.getElementById('mobile-agent-hint');
  if (hud) hud.hidden = visibility;
  if (hint) hint.hidden = visibility;
}

function setAgentState(state, detail = {}) {
  const previousState = agentState;
  const previousOperation = agentOperation;
  if (state !== 'returning') returnTransitionId += 1;
  agentState = state;
  agentOperation = resolveAgentOperation(
    state,
    detail.operation || inferAgentOperation(state, detail.text),
    previewIsPlaying
  );
  renderAgentState(detail);

  if (previousState !== state || previousOperation !== agentOperation) {
    playAgentCue(state, agentOperation);
  }

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

function renderAgentState(detail = {}) {
  const state = agentState;
  document.documentElement.dataset.agentMode = state;
  document.documentElement.dataset.agentOperation = agentOperation;

  const hud = document.getElementById('agent-mode-hud');
  const label = document.getElementById('agent-mode-label');
  const detailEl = document.getElementById('agent-mode-detail');
  const mobileLabel = document.getElementById('mobile-agent-hint-mode');
  const live = document.getElementById('agent-mode-live');
  const labels = {
    human: 'HUMAN MODE',
    loading: 'AGENT MODE',
    active: 'AGENT MODE',
    busy: 'AGENT MODE',
    standby: 'AGENT MODE',
    override: 'HUMAN MODE',
    returning: 'AGENT MODE'
  };
  const passiveDetail = getAgentPresenceText(state, agentOperation);
  const details = {
    human: 'READY FOR YOUR SELECTION',
    loading: 'CONNECTING TO THE CRATE',
    active: passiveDetail,
    busy: detail.text || 'READING THE CRATE',
    standby: passiveDetail,
    override: 'HUMAN INPUT HAS PRIORITY',
    returning: 'RETURNING CONTROL'
  };
  const hudDetail = toHudText(detail.text || details[state] || '');

  if (hud) {
    hud.dataset.state = state;
    hud.dataset.operation = agentOperation;
    hud.setAttribute('aria-busy', String(state === 'loading' || state === 'busy'));
  }
  if (label) label.textContent = labels[state] || labels.human;
  if (detailEl) detailEl.textContent = hudDetail;
  if (mobileLabel) {
    if (state === 'human' || state === 'override') {
      mobileLabel.textContent = labels[state] || labels.human;
    } else {
      mobileLabel.textContent = getAgentStatusText(state, agentOperation);
    }
  }
  updateAgentPresenceVisibility();
  if (live && state !== 'human') {
    live.textContent = getAgentStatusText(state, agentOperation);
  }
  updateSoundControl();

  if (state === 'human') clearAgentIntro();

  dispatch('seph-agent-state', { ...detail, state, operation: agentOperation });
}

function syncAgentPlaybackPresence(isPlaying) {
  const nextIsPlaying = Boolean(isPlaying);
  if (nextIsPlaying === previewIsPlaying) return;
  previewIsPlaying = nextIsPlaying;
  if (!isPassiveAgentStatus(agentState, agentOperation)) return;

  const nextOperation = resolveAgentOperation(agentState, agentOperation, previewIsPlaying);
  if (nextOperation === agentOperation) return;
  agentOperation = nextOperation;
  // Playback changes are a passive presence update: refresh the surfaces and
  // the bridge event, but do not play an Agent action cue or restart timers.
  renderAgentState({ source: 'player' });
}

function syncAgentPlaybackFromApi(api) {
  const playerState = api?.getPlayerState?.() || api?.status?.()?.player;
  if (!playerState || typeof playerState.is_playing !== 'boolean') return;
  syncAgentPlaybackPresence(playerState.is_playing);
}

window.addEventListener('seph-player-state', event => {
  syncAgentPlaybackPresence(event.detail?.is_playing === true);
});

function nextPaint() {
  return new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function wait(milliseconds) {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds));
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
  const sessionResult = await ensureAgentSession(text);
  if (sessionResult?.ok === false) return sessionResult;

  armBusy(text);
  try {
    return await work();
  } finally {
    releaseBusy();
  }
}

async function ensureAgentSession(intent = 'resume curator request') {
  const api = getCrateApi();
  if (!api) return resultError('CRATE_API_UNAVAILABLE', 'The crate controls are not ready for Agent Mode.');
  syncAgentPlaybackFromApi(api);

  if (curatorSessionPromise) return curatorSessionPromise;

  const needsSession = !agentModeHasBeenEntered || !ACTIVE_STATES.has(agentState);
  if (needsSession) {
    return startCuratorSession(api, intent);
  }

  if (agentState === 'standby') {
    setAgentState('active', { operation: 'idle' });
  }
  return null;
}

function startCuratorSession(api, intent = '') {
  if (curatorSessionPromise) return curatorSessionPromise;

  const sessionPromise = startCuratorSessionInternal(api, intent);
  curatorSessionPromise = sessionPromise;
  sessionPromise.then(
    () => {
      if (curatorSessionPromise === sessionPromise) curatorSessionPromise = null;
    },
    () => {
      if (curatorSessionPromise === sessionPromise) curatorSessionPromise = null;
    }
  );
  return sessionPromise;
}

async function startCuratorSessionInternal(api, intent = '') {
  // The player may have started before WebMCP attached its event listener.
  // Read the authoritative API state before deriving the first passive HUD.
  syncAgentPlaybackFromApi(api);
  const enteringAgentMode = !ACTIVE_STATES.has(agentState) || !agentModeHasBeenEntered;
  if (enteringAgentMode) {
    agentModeHasBeenEntered = true;
    // Every new Agent Mode session starts audible again; muting remains a
    // session-level user choice until the agent returns control to the human.
    agentSoundEnabled = true;
    pendingAgentActivationCue = false;
    updateSoundControl();
  }
  sessionStartedAt = new Date().toISOString();
  if (enteringAgentMode || !curatorSessionId) {
    curatorSessionId = `curator-${Date.now().toString(36)}-${++curatorSessionSequence}`;
    diagnostics.setSession(curatorSessionId, {
      intent: trimText(intent, 400) || null
    });
    diagnostics.record('session', 'started', {
      session_id: curatorSessionId,
      intent: trimText(intent, 400) || null
    });
  }
  setAgentState('loading', { text: 'Connecting to the crate', operation: 'loading' });
  if (enteringAgentMode && !agentIntroHasShown) {
    agentIntroHasShown = true;
    triggerAgentIntro();
  }
  const transitionId = returnTransitionId;

  // Keep the first state on screen for one short paint window. This gives the
  // host agent's own "controlling" affordance a chance to appear alongside
  // the page-level loading signal without making the handshake feel slow.
  await Promise.all([nextPaint(), wait(SESSION_HANDSHAKE_MS)]);
  if (transitionId !== returnTransitionId) {
    return resultError('SESSION_TRANSITION_INTERRUPTED', 'The curator session was interrupted before the crate became ready.');
  }

  setAgentState('active', { operation: 'idle' });
  return {
    ok: true,
    agent_mode: 'active',
    session_started_at: sessionStartedAt,
    intent: trimText(intent, 400) || null,
    runtime: {
      build_version: WEBMCP_BUILD_VERSION,
      page_session_id: diagnostics.pageSessionId,
      curator_session_id: curatorSessionId,
      diagnostics: 'browser_download'
    },
    ...api.status(),
    next_step: 'Use search_catalog for exact metadata search or dig_by_descriptor for Song DNA metadata matching.'
  };
}

async function returnToHumanMode(api) {
  const transitionId = ++returnTransitionId;
  setAgentState('returning', {
    text: 'Returning control',
    operation: 'returning'
  });
  restoreHumanAudioAfterExit();
  await nextPaint();
  await wait(RETURN_FOCUS_CLEAR_MS);
  if (transitionId !== returnTransitionId) {
    return resultError('SESSION_TRANSITION_INTERRUPTED', 'The return to Human Mode was interrupted by a new curator session.');
  }
  api.clearAgentFocus();
  await wait(Math.max(0, RETURN_TO_HUMAN_MS - RETURN_FOCUS_CLEAR_MS));
  if (transitionId !== returnTransitionId) {
    return resultError('SESSION_TRANSITION_INTERRUPTED', 'The return to Human Mode was interrupted by a new curator session.');
  }
  setAgentState('human', { operation: 'human' });
  const endedSessionId = curatorSessionId;
  const endedSessionStartedAt = sessionStartedAt;
  diagnostics.record('session', 'ended', {
    session_id: endedSessionId,
    session_started_at: endedSessionStartedAt,
    transition: 'soft_return'
  });
  diagnostics.setSession(null);
  curatorSessionId = null;
  sessionStartedAt = null;
  return {
    ok: true,
    agent_mode: 'human',
    transition: 'soft_return',
    crate_unchanged: true
  };
}

function isDebugModeEnabled() {
  const params = new URLSearchParams(window.location.search);
  return DEBUG_QUERY_KEYS.some(key => ['1', 'true', 'on'].includes(String(params.get(key) || '').toLowerCase()));
}

function getDebugSampleIds(api, { offset = 0, count = 3 } = {}) {
  const visible = api.getVisibleCatalog?.() || api.getMasterCatalog?.() || [];
  if (visible.length === 0) return [];
  const state = api.getState?.();
  const currentIndex = typeof state?.active_index === 'number' && state.active_index >= 0
    ? state.active_index
    : 0;
  const sampleIds = [];
  for (let step = 1; step <= Math.min(count, visible.length); step += 1) {
    const item = visible[(currentIndex + step + offset - 1) % visible.length];
    const id = getRecordId(item);
    if (id && !sampleIds.includes(id)) sampleIds.push(id);
  }
  if (sampleIds.length === 0) {
    return visible.slice(0, count).map(item => getRecordId(item)).filter(Boolean);
  }
  return sampleIds;
}

function getDebugCrateRecordId(api) {
  const localIds = api.getLocalCrateRecordIds?.();
  if (Array.isArray(localIds) && localIds.length > 0) return localIds[0];
  return getDebugSampleIds(api)[0] || null;
}

async function ensureDebugSession(api) {
  if (agentState === 'human' || agentState === 'override') {
    await startCuratorSession(api, 'local visual debug');
  }
}

async function runDebugActionInternal(api, action) {
  if (action === 'start') {
    return startCuratorSession(api, 'local visual debug');
  }

  if (action === 'return') {
    return returnToHumanMode(api);
  }

  await ensureDebugSession(api);

  if (action === 'sequence') {
    await withAgentActivity('Browsing the crate', async () => {
      const ids = getDebugSampleIds(api, { offset: 1, count: 2 });
      for (const id of ids) {
        api.openRecordDetails?.(id) || api.focusRecord(id);
        await wait(280);
      }
    });
    await withAgentActivity('Thinking about the request', () => wait(760));
    return withAgentActivity('Digging through Song DNA', async () => {
      const result = scoreCatalog(getCatalog(), 'warm house groove for a late night drive', { maxResults: 5 });
      const ids = result.matches.map(match => match.record_id);
      await wait(DIG_PREVIEW_MS);
      if (ids.length > 0) api.focusRecords(ids);
      await wait(220);
      return { ok: true, debug: true, result_count: result.matches.length, focus_record_ids: ids };
    });
  }

  if (action === 'thinking') {
    return withAgentActivity('Reading the crate', () => wait(900));
  }

  if (action === 'digging') {
    return withAgentActivity('Digging through Song DNA', async () => {
      const result = scoreCatalog(getCatalog(), 'warm house groove for a late night drive', { maxResults: 5 });
      const ids = result.matches.map(match => match.record_id);
      await wait(DIG_PREVIEW_MS);
      if (ids.length > 0) api.focusRecords(ids);
      await wait(220);
      return { ok: true, debug: true, result_count: result.matches.length, focus_record_ids: ids };
    });
  }

  if (action === 'searching') {
    return withAgentActivity('Searching the crate', async () => {
      const previousQuery = window.getCurrentSearchQuery?.() || '';
      api.setSearchQuery('house');
      await wait(900);
      api.setSearchQuery(previousQuery);
      return { ok: true, debug: true, query: 'house', restored_query: previousQuery };
    });
  }

  if (action === 'browsing') {
    return withAgentActivity('Browsing the crate', async () => {
      const ids = getDebugSampleIds(api, { offset: 1, count: 3 });
      const sidebarRecordIds = [];
      for (const id of ids) {
        const focused = api.openRecordDetails?.(id) || api.focusRecord(id);
        if (focused?.ok) sidebarRecordIds.push(id);
        await wait(280);
      }
      return {
        ok: true,
        debug: true,
        browsed_record_ids: ids,
        sidebar_record_ids: sidebarRecordIds
      };
    });
  }

  if (action === 'focus') {
    return withAgentActivity('Moving selected records', async () => {
      const ids = getDebugSampleIds(api);
      if (ids.length > 0) api.focusRecords(ids);
      await wait(900);
      return { ok: true, debug: true, focus_record_ids: ids };
    });
  }

  if (action === 'add') {
    return withAgentActivity('Adding to My Crate', async () => {
      const ids = getDebugSampleIds(api);
      if (ids.length === 0) return resultError('NO_DEBUG_RECORDS', 'No local catalog records are available for the Add to Crate preview.');
      return api.manageCrate(ids[0], 'add');
    });
  }

  if (action === 'remove') {
    return withAgentActivity('Removing from My Crate', async () => {
      const id = getDebugCrateRecordId(api);
      if (!id) return resultError('NO_DEBUG_RECORDS', 'No local catalog records are available for the Remove from Crate preview.');
      return api.manageCrate(id, 'remove');
    });
  }

  if (action === 'checkout') {
    return withAgentActivity('Preparing a human checkout review', async () => {
      const checkout = api.prepareCheckout();
      if (!checkout.ok) return checkout;
      return {
        ok: true,
        debug: true,
        ...checkout,
        human_confirmation_required: true,
        next_step: 'Review the visible My Crate, then click BUY CRATE yourself.'
      };
    });
  }

  return resultError('UNKNOWN_DEBUG_ACTION', `Unknown debug action: ${action}`);
}

async function runDebugAction(api, action) {
  const call = diagnostics.startTool(`debug_${action}`, { action });
  try {
    const result = await runDebugActionInternal(api, action);
    diagnostics.finishTool(call, result);
    return result;
  } catch (error) {
    diagnostics.failTool(call, error);
    throw error;
  }
}

function installDragHandle(element, handle = element, { desktopOnly = true } = {}) {
  if (!element || !handle || handle.dataset.dragBound === 'true') return;
  handle.dataset.dragBound = 'true';

  const canDrag = () => !desktopOnly || window.matchMedia?.('(min-width: 1024px)').matches;
  const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

  handle.addEventListener('pointerdown', event => {
    if (!canDrag()) return;
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target?.closest?.('button, a, input, textarea, select')) return;

    const rect = element.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const pointerId = event.pointerId;
    const margin = DRAG_MARGIN_PX;

    element.style.left = `${rect.left}px`;
    element.style.top = `${rect.top}px`;
    element.style.right = 'auto';
    element.style.bottom = 'auto';
    element.style.transform = 'translate3d(0, 0, 0) scale(1)';
    element.classList.add('is-dragging');

    const onMove = moveEvent => {
      if (moveEvent.pointerId !== pointerId) return;
      const maxLeft = window.innerWidth - rect.width - margin;
      const maxTop = window.innerHeight - rect.height - margin;
      const nextLeft = clamp(moveEvent.clientX - offsetX, margin, maxLeft);
      const nextTop = clamp(moveEvent.clientY - offsetY, margin, maxTop);
      element.style.left = `${nextLeft}px`;
      element.style.top = `${nextTop}px`;
    };

    const onEnd = endEvent => {
      if (endEvent?.pointerId !== undefined && endEvent.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
      element.classList.remove('is-dragging');
    };

    // Listen on the window while dragging. Touch and synthetic browser drags
    // can retarget move/up events away from the small header surface.
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    handle.setPointerCapture?.(pointerId);
    event.preventDefault();
  });
}

function clampFloatingSurfaceToViewport(element, margin = DRAG_MARGIN_PX) {
  if (!element || element.hidden) return;

  const hasInlinePosition = ['left', 'top', 'right', 'bottom']
    .some(property => element.style[property] !== '');
  if (!hasInlinePosition) return;

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));
  const maxLeft = window.innerWidth - rect.width - margin;
  const maxTop = window.innerHeight - rect.height - margin;
  const nextLeft = clamp(rect.left, margin, maxLeft);
  const nextTop = clamp(rect.top, margin, maxTop);

  if (Math.abs(nextLeft - rect.left) < 0.5 && Math.abs(nextTop - rect.top) < 0.5) return;

  element.style.left = `${nextLeft}px`;
  element.style.top = `${nextTop}px`;
  element.style.right = 'auto';
  element.style.bottom = 'auto';
  element.style.transform = 'translate3d(0, 0, 0) scale(1)';
}

function installAgentHudDrag() {
  installDragHandle(document.getElementById('agent-mode-hud'));
}

function installFloatingSurfaceViewportGuard() {
  let frame = null;
  const sync = () => {
    frame = null;
    clampFloatingSurfaceToViewport(document.getElementById('agent-mode-hud'));
    clampFloatingSurfaceToViewport(document.getElementById('agent-debug-panel'));
  };
  const schedule = () => {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(sync);
  };

  window.addEventListener('resize', schedule, { passive: true });
  sync();
}

function updateDebugPanel() {
  const status = document.getElementById('agent-debug-status');
  if (!status) return;
  const currentMode = document.documentElement.dataset.agentMode || agentState;
  const currentOp = document.documentElement.dataset.agentOperation || agentOperation;
  if (currentMode === 'human' || currentMode === 'override') {
    status.textContent = 'Human Mode';
    return;
  }
  status.textContent = getAgentStatusText(currentMode, currentOp);
}

function installDebugPanel(api) {
  if (!isDebugModeEnabled()) return;

  const trigger = document.getElementById('agent-debug-trigger');
  const panel = document.getElementById('agent-debug-panel');
  const close = document.getElementById('agent-debug-close');
  const download = document.getElementById('agent-debug-download');
  const status = document.getElementById('agent-debug-status');
  const actions = [...document.querySelectorAll('[data-agent-debug-action]')];
  if (!trigger || !panel || !close || !status || actions.length === 0) return;

  document.documentElement.dataset.agentDebug = 'enabled';
  panel.hidden = false;
  trigger.hidden = true;
  // The panel header remains a real pointer surface on desktop and touch.
  installDragHandle(panel, panel.querySelector('.agent-debug-header'), { desktopOnly: false });
  clampFloatingSurfaceToViewport(panel);

  const setOpen = open => {
    panel.hidden = !open;
    trigger.hidden = open;
  };

  trigger.addEventListener('click', () => setOpen(true));
  close.addEventListener('click', () => setOpen(false));
  if (download) {
    download.addEventListener('click', event => {
      event.preventDefault();
      const result = diagnostics.download();
      if (!result.ok) status.textContent = 'Log download failed';
    });
  }
  window.addEventListener('seph-agent-state', updateDebugPanel);
  window.addEventListener('seph-agent-focus', updateDebugPanel);

  actions.forEach(button => {
    button.addEventListener('click', () => {
      if (debugActionPromise) return;
      const action = button.dataset.agentDebugAction;
      actions.forEach(item => { item.disabled = true; });
      debugActionPromise = runDebugAction(api, action)
        .catch(error => {
          console.warn('[WebMCP debug] Action failed:', error);
          status.textContent = 'Debug action failed';
        })
        .finally(() => {
          debugActionPromise = null;
          actions.forEach(item => { item.disabled = false; });
          updateDebugPanel();
        });
    });
  });

  updateDebugPanel();
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

function getTrackSummary(track) {
  return {
    track_id: String(track?.id || ''),
    title: track?.title || '',
    artist: track?.artist || '',
    duration_seconds: Number.isFinite(Number(track?.duration)) ? Number(track.duration) : null,
    preview_available: Boolean(track?.preview_url)
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
    if (debugActionPromise !== null) return;
    if (event.isTrusted === false) return;
    const eventPath = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const isExcludedSurface = event.target?.closest?.(HUMAN_OVERRIDE_EXCLUSION_SELECTOR)
      || eventPath.some(node => node?.nodeType === 1 && node.matches?.(HUMAN_OVERRIDE_EXCLUSION_SELECTOR));
    if (isExcludedSurface) return;
    setAgentState('override');
    dispatch('seph-agent-focus', { record_ids: [], source: 'human_override' });
  };
  events.forEach(eventName => window.addEventListener(eventName, onHumanInput, { passive: true }));
}

async function registerTool(modelContext, tool) {
  const instrumentedTool = {
    ...tool,
    async execute(input = {}) {
      const call = diagnostics.startTool(tool.name, input);
      try {
        const result = await tool.execute(input);
        diagnostics.finishTool(call, result);
        return result;
      } catch (error) {
        diagnostics.failTool(call, error);
        throw error;
      }
    }
  };
  await modelContext.registerTool(instrumentedTool);
  diagnostics.record('runtime', 'tool_registered', { tool: tool.name });
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
    description: 'Call this first for a new request. It is safe to call again after a resumed command: it reactivates the visible Agent Mode HUD and confirms that the page crate tools are ready. It does not purchase anything.',
    inputSchema: {
      type: 'object',
      properties: { intent: { type: 'string', maxLength: 400 } },
      additionalProperties: false
    },
    annotations: uiMutation,
    async execute(input = {}) {
      return startCuratorSession(api, input.intent);
    }
  });

  await registerTool(modelContext, {
    name: 'get_collection_stats',
    title: 'Read crate collection stats',
    description: 'Returns compact, metadata-backed collection statistics and the Song DNA dimensions currently available. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: readOnly,
    async execute() {
      return withAgentActivity('Orienting in the collection', async () => ({
        ok: true,
        ...buildCollectionStats(getCatalog())
      }));
    }
  });

  await registerTool(modelContext, {
    name: 'sort_catalog',
    title: 'Sort crate by latest, most popular or oldest',
    description: 'Changes the visible crate ordering without text search. Use sort=popular when the user asks for most popular or best-selling releases, and sort=oldest when the user asks for the oldest or earliest releases. Use sort=latest to restore newest-first order.',
    inputSchema: {
      type: 'object',
      properties: {
        sort: { type: 'string', enum: ['latest', 'popular', 'oldest'] }
      },
      required: ['sort'],
      additionalProperties: false
    },
    annotations: uiMutation,
    async execute(input = {}) {
      return withAgentActivity('Sorting the crate', async () => {
        const sort = trimText(input.sort, 20).toLowerCase();
        if (!['latest', 'popular', 'oldest'].includes(sort)) {
          return resultError('INVALID_SORT', 'sort must be latest, popular, or oldest.');
        }
        return api.setCatalogSort?.(sort)
          || resultError('CATALOG_SORT_UNAVAILABLE', 'The catalog sort controls are not available.');
      });
    }
  });

  await registerTool(modelContext, {
    name: 'search_catalog',
    title: 'Search visible catalog',
    description: 'Searches the existing crate search surface by release title or artist, updates the visible crate, and opens the first match in the existing Song sidebar. Use dig_by_descriptor for metadata DNA matching.',
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
      return withAgentActivity('Browsing the crate', async () => {
        const query = trimText(input.query, 200);
        if (!query) return resultError('INVALID_QUERY', 'A non-empty catalog query is required.');
        const results = searchCatalog(query, input.max_results);
        api.setSearchQuery(query);
        const sidebarFocus = results.length > 0
          ? (api.openRecordDetails?.(results[0].record_id) || api.focusRecord(results[0].record_id))
          : null;
        return {
          ok: true,
          query,
          search_scope: 'title_and_artist',
          results,
          result_count: results.length,
          sidebar_updated: Boolean(sidebarFocus?.ok),
          sidebar_record_id: sidebarFocus?.ok ? results[0].record_id : null
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
      return withAgentActivity('Digging through Song DNA', async () => {
        const descriptor = trimText(input.descriptor, 400);
        if (!descriptor) return resultError('INVALID_DESCRIPTOR', 'A non-empty descriptor is required.');
        const result = scoreCatalog(getCatalog(), descriptor, {
          maxResults: input.max_results,
          excludeIds: input.exclude_ids
        });
        const focusIds = result.matches.map(match => match.record_id);
        await wait(DIG_PREVIEW_MS);
        if (focusIds.length > 0) api.focusRecords(focusIds);
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
    description: 'Moves the first requested record to the front of the visible crate and records the agent focus without recolouring the artwork.',
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
      return withAgentActivity('Moving selected records', async () => {
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
      return withAgentActivity('Inspecting the record', async () => {
        const item = findItem(input.record_id);
        if (!item) return resultError('RECORD_NOT_FOUND', 'The requested record is not in the loaded catalog.');
        const focused = api.openRecordDetails?.(getRecordId(item)) || api.focusRecord(getRecordId(item));
        return {
          ok: true,
          record: getItemSummary(item),
          tracks: (Array.isArray(item.tracks) ? item.tracks : []).map(getTrackSummary),
          music_dna: buildMusicDNA(item),
          ui_focus: focused
        };
      });
    }
  });

  await registerTool(modelContext, {
    name: 'get_player_state',
    title: 'Read preview player state',
    description: 'Reads the visible preview player transport: current release and track, play/pause status, current position, duration and site audio state. It also reactivates Agent Mode when a resumed command needs it. It does not claim BPM, key or other audio analysis.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: uiMutation,
    async execute() {
      return withAgentActivity('Reading the preview player', async () => {
        const player = api.getPlayerState?.();
        return player || resultError('PLAYER_UNAVAILABLE', 'The preview player state is not available.');
      });
    }
  });

  await registerTool(modelContext, {
    name: 'play_track',
    title: 'Play a catalog preview',
    description: 'Loads and plays one catalog track preview in the visible player. Use inspect_record first to obtain track_id and record_id; omit track_id only to resume the already loaded track. Browser autoplay policy may require a user gesture. This never purchases anything.',
    inputSchema: {
      type: 'object',
      properties: {
        track_id: { type: 'string', minLength: 1, maxLength: 160 },
        record_id: { type: 'string', minLength: 1, maxLength: 160 }
      },
      additionalProperties: false
    },
    annotations: uiMutation,
    async execute(input = {}) {
      return withAgentActivity('Playing the selected preview', async () => {
        const trackId = trimText(input.track_id, 160);
        const recordId = trimText(input.record_id, 160);
        return api.playTrack?.(trackId, recordId)
          || resultError('PLAYER_UNAVAILABLE', 'The preview player controls are not available.');
      });
    }
  });

  await registerTool(modelContext, {
    name: 'pause_track',
    title: 'Pause the preview player',
    description: 'Pauses the currently loaded preview and preserves its position for a later play_track call. It never changes My Crate or checkout.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: uiMutation,
    async execute() {
      return withAgentActivity('Pausing the selected preview', async () => {
        const player = api.pauseTrack?.();
        return player || resultError('PLAYER_UNAVAILABLE', 'The preview player controls are not available.');
      });
    }
  });

  await registerTool(modelContext, {
    name: 'seek_track',
    title: 'Seek the preview player',
    description: 'Moves the currently loaded preview to an absolute position in seconds. This is explicit transport control only; automatic drop/cue-point detection is not implemented yet.',
    inputSchema: {
      type: 'object',
      properties: {
        position_seconds: { type: 'number', minimum: 0, maximum: 86400 }
      },
      required: ['position_seconds'],
      additionalProperties: false
    },
    annotations: uiMutation,
    async execute(input = {}) {
      if (typeof input.position_seconds !== 'number' || !Number.isFinite(input.position_seconds)) {
        return resultError('INVALID_POSITION', 'position_seconds must be a finite number.');
      }
      return withAgentActivity('Seeking the selected preview', async () => api.seekTrack?.(input.position_seconds)
        || resultError('PLAYER_UNAVAILABLE', 'The preview player controls are not available.'));
    }
  });

  await registerTool(modelContext, {
    name: 'set_audio_mute',
    title: 'Mute or unmute site audio',
    description: 'Sets the site-wide audio state for the current Agent Mode session, including preview playback and agent behavior cues. This is reversible and does not affect checkout.',
    inputSchema: {
      type: 'object',
      properties: { muted: { type: 'boolean' } },
      required: ['muted'],
      additionalProperties: false
    },
    annotations: uiMutation,
    async execute(input = {}) {
      if (typeof input.muted !== 'boolean') {
        return resultError('INVALID_MUTE_VALUE', 'muted must be a boolean.');
      }
      return withAgentActivity(input.muted ? 'Muting site audio' : 'Restoring site audio', async () => {
        // Keep the existing Agent Mode sound policy as the source of truth so
        // the visual toggle and the agent tool cannot drift apart.
        setSoundEnabled(!input.muted);
        const player = api.setPlayerMuted?.(input.muted) || api.getPlayerState?.();
        return {
          ok: true,
          muted: input.muted,
          scope: 'site',
          player_state: player || null
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
      return withAgentActivity(input.action === 'remove' ? 'Removing from My Crate' : 'Adding to My Crate', async () => {
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
      return withAgentActivity('Preparing a human checkout review', async () => {
        const checkout = api.prepareCheckout();
        if (!checkout.ok) return checkout;
        return {
          ok: true,
          ...checkout,
          human_confirmation_required: true,
          next_step: 'The user must review the visible crate and click BUY CRATE themselves.'
        };
      });
    }
  });

  await registerTool(modelContext, {
    name: 'end_curator_session',
    title: 'End Synesthetic Curator session',
    description: 'Returns the page to Human Mode through a soft handoff and clears agent-focused record styling. It does not alter My Crate.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: uiMutation,
    async execute() {
      return returnToHumanMode(api);
    }
  });

  toolRegistrationComplete = true;
  document.documentElement.dataset.webmcp = 'ready';
  dispatch('seph-webmcp-ready', {
    tool_count: 15,
    model_context_source: modelContextSource,
    tools: [
      'start_curator_session',
      'get_collection_stats',
      'sort_catalog',
      'search_catalog',
      'dig_by_descriptor',
      'focus_records',
      'inspect_record',
      'get_player_state',
      'play_track',
      'pause_track',
      'seek_track',
      'set_audio_mute',
      'manage_crate',
      'prepare_checkout',
      'end_curator_session'
    ]
  });
}

async function boot() {
  diagnostics.record('runtime', 'adapter_boot', {
    build_version: WEBMCP_BUILD_VERSION,
    page_session_id: diagnostics.pageSessionId
  });
  installHumanOverride();
  installAgentSoundControl();
  installAgentHudDrag();
  installAgentAudioUnlock();
  installFloatingSurfaceViewportGuard();
  try {
    const api = await waitForCrateApi();
    installDebugPanel(api);
    const modelContext = getAvailableModelContext();
    diagnostics.record('runtime', 'model_context_probe', {
      source: modelContext.source,
      available: Boolean(modelContext.context)
    });
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
