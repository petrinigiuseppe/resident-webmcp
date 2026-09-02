/* --- 3D Vinyl Crate digging (Beta) crate.js --- */
import * as THREE from './vendor/three.module.js';
import { diagnostics, WEBMCP_BUILD_VERSION } from './webmcp-debug.js?v=20260831-webmcp-m73';

diagnostics.record('runtime', 'crate_module_loaded', { build_version: WEBMCP_BUILD_VERSION });

// Fallback catalog in case the API fetch fails or is blocked
const FALLBACK_CATALOG = [
  {
    "title": "Madonna & Sabrina - Bring Your Love (Remixes)",
    "artist": "Seph Martin",
    "image": "/api/media/products/madonna-sabrina-bring-your-love-seph-martin-remixes/cover.webp",
    "price_text": "€5.00 EUR",
    "tags": ["house", "disco house", "remixes"],
    "description": "Club-ready reworks of Madonna & Sabrina Carpenter. Includes the Remix, Dub Mix and Extended Mix.",
    "page_url": "/album/bring-your-love-seph-martin-remixes",
    "tracks": [
      { "id": "madsab-01", "number": 1, "title": "Bring Your Love (Seph Martin Remix)", "duration": 210, "preview_url": "https://sephmartin.com/api/preview/madsab-01" },
      { "id": "madsab-02", "number": 2, "title": "Bring Your Love (Seph Martin Dub Mix)", "duration": 386, "preview_url": "https://sephmartin.com/api/preview/madsab-02" },
      { "id": "madsab-03", "number": 3, "title": "Bring Your Love (Seph Martin Extended Mix)", "duration": 335, "preview_url": "https://sephmartin.com/api/preview/madsab-03" }
    ]
  },
  {
    "title": "Unreleased Tech House Bangers III",
    "artist": "Seph Martin",
    "image": "/api/media/products/unreleased-tech-house-bangers-iii/cover.webp",
    "price_text": "€9.99 EUR",
    "tags": ["tech house", "techno", "house"],
    "description": "The third chapter of the Unreleased Tech House Bangers series collects seven direct, club-focused tools built around rolling drums, raw hooks, and peak-time pressure.",
    "page_url": "/album/unreleased-tech-house-bangers-iii",
    "tracks": [
      { "id": "uthb3-01", "number": 1, "title": "Shot", "duration": 305, "preview_url": "https://sephmartin.com/api/preview/uthb3-01" },
      { "id": "uthb3-02", "number": 2, "title": "Pulsing", "duration": 372, "preview_url": "https://sephmartin.com/api/preview/uthb3-02" }
    ]
  }
];

// App State
let catalog = [];
let masterCatalog = [];
const DEFAULT_CATALOG_CATEGORY_LABELS = Object.freeze({
  original: 'Original by Seph',
  remixes: 'Remixes',
  edits: 'Edits',
  mixed: 'Mixed release',
  unclassified: 'Needs classification'
});
let catalogCuration = {
  schema_version: 'catalog-curation.v1',
  categories: { ...DEFAULT_CATALOG_CATEGORY_LABELS },
  releases: {}
};
let bestSellersMap = new Map();
let textureCache = new Map();
let currentFilter = 'latest';
let currentSearchQuery = '';
let activeIndex = 0;
let isSelected = false;
let recordsData = []; // Store references to Three.js meshes and their layout targets

// Three.js variables
let scene, camera, renderer;
let crateGroup, userCrateGroup;
let textureLoader;
let raycaster, mouse;
let dirLight, spotLight, ambientLight, hemiLight;
let stickyNoteMesh;
let floor;
let woodMaterial;

// Personal user crate and animations state
let userRecordsData = [];
let activeAnimations = [];
let globalCamXOffset = 0;
let isUserCrateViewActive = false;
let userActiveIndex = 0;
let userIsSelected = false;
let hasInteracted = false;
let checkoutInFlight = false;
let lemonJsLoadPromise = null;
let lemonSqueezySetupDone = false;
const lemonOverlayCallbacks = {
  onClose: null,
  onSuccess: null
};
const DEMO_ACCOUNT_STORAGE_KEY = 'sm_demo_checkout_account_v1';
const DEMO_PURCHASES_STORAGE_KEY = 'sm_demo_checkout_purchases_v1';
const DEMO_ACCOUNT_DEFAULTS = Object.freeze({
  account_type: 'demo',
  display_name: 'Seph Martin',
  email: 'music@sephmartin.com',
  payment_label: 'VISA',
  payment_last4: '4242',
  address_line1: 'Via Roma 42',
  address_line2: '00100 Roma RM · IT'
});
let demoCheckoutSelection = [];
let demoCheckoutStep = 'checkout';
let demoCheckoutLastFocus = null;
let demoCheckoutRequestedByAgent = false;
let demoCheckoutAutoReturnTimer = null;
let demoCompletionLastFocus = null;
let demoCompletionAutoCloseTimer = null;
const DEMO_END_MESSAGE = 'YOU REACHED THE END OF THIS WORLD — WELL PLAYED :)';
const DEMO_COMPLETION_AUTO_CLOSE_MS = 8000;
const demoCompletedRecordIds = new Set();

function isLemonOverlayEnabled() {
  try {
    // The embedded checkout is a demo/local surface only. The live domain
    // must keep its normal hosted redirect even if a query flag is present.
    if (typeof window === 'undefined' || !/^(127\.0\.0\.1|localhost|demo\.sephmartin\.com)$/.test(window.location.hostname)) return false;
    if (window.__LEMON_OVERLAY_ENABLED__ === true) return true;
    const params = new URLSearchParams(window.location.search);
    if (params.get('lemon_overlay') === '1' || params.get('checkout_overlay') === '1') return true;
    if (params.get('lemon_overlay') === '0' || params.get('checkout_overlay') === '0') return false;
    return localStorage.getItem('sm_lemon_overlay') === '1' || localStorage.getItem('sm_checkout_overlay') === '1';
  } catch {
    return false;
  }
}

function loadLemonJs() {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.LemonSqueezy?.Url?.Open) return Promise.resolve(window.LemonSqueezy);
  if (lemonJsLoadPromise) return lemonJsLoadPromise;

  lemonJsLoadPromise = new Promise((resolve, reject) => {
    if (typeof window.createLemonSqueezy === 'function') {
      try {
        window.createLemonSqueezy();
        if (window.LemonSqueezy?.Url?.Open) return resolve(window.LemonSqueezy);
      } catch {}
    }

    const existing = document.querySelector('script[src*="lemonsqueezy.com/js/lemon.js"]');
    if (existing) {
      const resolveExisting = () => {
        if (typeof window.createLemonSqueezy === 'function') window.createLemonSqueezy();
        if (window.LemonSqueezy?.Url?.Open) resolve(window.LemonSqueezy);
        else reject(new Error('LemonSqueezy.Url.Open unavailable after script load'));
      };
      if (window.LemonSqueezy?.Url?.Open) {
        resolveExisting();
        return;
      }
      existing.addEventListener('load', resolveExisting, { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load Lemon.js')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://app.lemonsqueezy.com/js/lemon.js';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      try {
        if (typeof window.createLemonSqueezy === 'function') {
          window.createLemonSqueezy();
        }
        if (window.LemonSqueezy?.Url?.Open) {
          resolve(window.LemonSqueezy);
        } else {
          reject(new Error('LemonSqueezy.Url.Open unavailable'));
        }
      } catch (err) {
        reject(err);
      }
    };
    script.onerror = () => reject(new Error('Failed to load Lemon.js'));
    document.head.appendChild(script);
  });

  return lemonJsLoadPromise;
}

async function openLemonOverlay(checkoutUrl, callbacks = {}) {
  lemonOverlayCallbacks.onClose = callbacks.onClose || null;
  lemonOverlayCallbacks.onSuccess = callbacks.onSuccess || null;

  const lemon = await loadLemonJs();
  if (!lemon || typeof lemon.Url?.Open !== 'function') {
    throw new Error('LemonSqueezy.Url.Open is not available');
  }

  if (!lemonSqueezySetupDone && typeof lemon.Setup === 'function') {
    try {
      lemon.Setup({
        eventHandler: (event) => {
          const eventName = typeof event === 'string' ? event : event?.event;
          const isCloseEvent = event === 'close'
            || eventName === 'close'
            || eventName === 'Checkout.Closed'
            || eventName === 'PaymentMethodUpdate.Closed';
          if (isCloseEvent) {
            if (typeof lemonOverlayCallbacks.onClose === 'function') {
              lemonOverlayCallbacks.onClose(event?.data);
            }
          } else if (eventName === 'Checkout.Success') {
            if (typeof lemonOverlayCallbacks.onSuccess === 'function') {
              lemonOverlayCallbacks.onSuccess(event?.data);
            }
          }
        }
      });
      lemonSqueezySetupDone = true;
    } catch (e) {
      console.warn('LemonSqueezy.Setup warning:', e);
    }
  }

  lemon.Url.Open(checkoutUrl);
  return true;
}

// Agent-native visual state. WebMCP owns the state transition; the renderer
// only responds to it so the normal human interaction path stays intact.
let agentVisualState = 'human';
let agentVisualOperation = 'human';
let agentVisualNavigationMode = 'preview';
let agentFocusRecordIds = new Set();
let agentFocusRevision = 0;
let baseSpotLightIntensity = 2.5;
let agentDigPreviewTimer = null;
let agentDigPreviewToken = 0;
let agentDigPreviewIndex = -1;
let agentDigPreviewSnapshot = null;

function isAgentNavigationOperationActive() {
  return agentVisualState === 'busy'
    && (agentVisualOperation === 'digging' || agentVisualOperation === 'browsing');
}

function isAgentNavigationPreviewActive() {
  return isAgentNavigationOperationActive()
    && agentVisualNavigationMode !== 'targeted'
    && !isUserCrateViewActive;
}

// The agent frame is projected from the actual crate silhouette instead of
// being a viewport-shaped decoration. These local-space points follow the
// outer crate edges for both the shop and personal crate meshes.
const AGENT_CRATE_FRAME_POINTS = [
  [-0.18, 0.12, -0.18],
  [0.18, 0.12, -0.18],
  [0.18, 0, 0.18],
  [0.18, -0.165, 0.18],
  [-0.18, -0.165, 0.18],
  [-0.18, 0, 0.18]
];
const agentFrameProjection = new THREE.Vector3();
let agentFrameViewBox = '';

// The first frame implementation was an HTML SVG overlay. Keep that
// projection for diagnostics/fallback, while the soft ambient aura is rendered in Three.js.
let agentCrateAuraInstances = [];
let agentAuraTexture = null;

let resolveCrateApiReady;
window.__CRATE_API_READY_PROMISE__ = new Promise(resolve => {
  resolveCrateApiReady = resolve;
});

// Camera selection shift animation state (to balance sidebar space)
let currentCamX = 0;
let targetCamX = 0;

// Interactivity state
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartIndex = 0;
let hasDragged = false;
let wasDeselectedDuringDrag = false;
let dragAccumulator = 0;
const DRAG_THRESHOLD = 50; // pixels to flip a record (for mousewheel only)

// Audio Player state
const PREVIEW_AUDIO_VOLUME = 0.34;
let audio = new Audio();
audio.volume = PREVIEW_AUDIO_VOLUME;
let currentPlayingTrackId = null;
let currentPlayingReleaseId = null;
let currentPlayingTrack = null;
let currentPlayingTrackItem = null;
let playerHomeParent = null;
let playerHomeNextSibling = null;
let playerError = null;
let siteAudioEnabled = true;
let uiAudioContext = null;
let lastNavigationTickAt = 0;
let navigationAudioUnlockInstalled = false;
let pendingPlayback = null;
let pendingPlaybackResumeInFlight = false;
let playbackRequestToken = 0;
const AGENT_ORB_VISUAL_MODES = Object.freeze(['cover', 'disco_ball']);
const AGENT_ORB_DISCO_ROTATION_SPEED = 0.24;
let agentOrbVisualMode = 'cover';
let agentOrbDiscoCanvas = null;
let agentOrbDiscoRenderer = null;
let agentOrbDiscoScene = null;
let agentOrbDiscoCamera = null;
let agentOrbDiscoRoot = null;
let agentOrbDiscoAnimationFrame = 0;
let agentOrbDiscoResizeObserver = null;
let agentOrbDiscoLastTimestamp = 0;
const AGENT_NAVIGATION_MIX = {
  // Kept below the behavior cues, but no longer buried under mastered previews.
  human: 0.099,
  agent: 0.126
};

// Ignore the pre-beta theme lock once: the device preference is the default
// unless the current WebMCP surface explicitly chooses a theme again.
const THEME_STORAGE_KEY = 'sephmartin.theme.v2';
const THEME_PREFERENCES = new Set(['light', 'dark', 'system']);
let activeThemePreference = 'system';

function normalizeThemePreference(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return THEME_PREFERENCES.has(normalized) ? normalized : 'system';
}

function getThemePreference() {
  try {
    const stored = String(window.localStorage?.getItem(THEME_STORAGE_KEY) || '').trim().toLowerCase();
    if (THEME_PREFERENCES.has(stored)) {
      activeThemePreference = stored;
      return stored;
    }
  } catch (error) {
    // Continue with the in-memory preference when storage is restricted.
  }
  return activeThemePreference;
}

function getSystemTheme() {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch (error) {
    return 'dark';
  }
}

function getResolvedTheme(preference = getThemePreference()) {
  return preference === 'system' ? getSystemTheme() : preference;
}

function syncThemeStylesheet(preference, resolvedTheme) {
  const lightStylesheet = document.getElementById('crate-light-stylesheet');
  if (!lightStylesheet) return;
  lightStylesheet.media = preference === 'system'
    ? '(prefers-color-scheme: light)'
    : (resolvedTheme === 'light' ? 'all' : 'not all');
}

function getThemeState() {
  const preference = getThemePreference();
  return {
    preference,
    theme: getResolvedTheme(preference),
    system_theme: getSystemTheme()
  };
}

function setTheme(theme, { persist = true, source = 'webmcp', record = true } = {}) {
  const preference = normalizeThemePreference(theme);
  if (!THEME_PREFERENCES.has(String(theme || '').trim().toLowerCase())) {
    return {
      ok: false,
      error: { code: 'INVALID_THEME', message: 'theme must be light, dark, or system.' }
    };
  }

  const resolvedTheme = getResolvedTheme(preference);
  const root = document.documentElement;
  activeThemePreference = preference;
  root.dataset.themePreference = preference;
  if (preference === 'system') delete root.dataset.theme;
  else root.dataset.theme = preference;
  root.style.colorScheme = resolvedTheme;
  syncThemeStylesheet(preference, resolvedTheme);

  if (persist) {
    try {
      window.localStorage?.setItem(THEME_STORAGE_KEY, preference);
    } catch (error) {
      // A storage restriction must not prevent a live theme change.
    }
  }
  syncThemeWithBrowser();

  const result = {
    ok: true,
    preference,
    theme: resolvedTheme,
    system_theme: getSystemTheme(),
    persisted: Boolean(persist)
  };
  if (record) {
    diagnostics.record('ui', 'theme_changed', { ...result, source }, { snapshot: true });
    window.dispatchEvent(new CustomEvent('seph-theme-change', { detail: { ...result, source } }));
  }
  return result;
}

function initializeTheme() {
  const preference = getThemePreference();
  setTheme(preference, { persist: false, source: 'initial', record: false });
}

function installSystemThemeListener() {
  try {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    const handleChange = () => {
      if (getThemePreference() === 'system') {
        setTheme('system', { persist: false, source: 'system', record: true });
      }
    };
    if (typeof mediaQuery.addEventListener === 'function') mediaQuery.addEventListener('change', handleChange);
    else if (typeof mediaQuery.addListener === 'function') mediaQuery.addListener(handleChange);
  } catch (error) {
    // A missing media-query API must not prevent the site from loading.
  }
}

initializeTheme();
installSystemThemeListener();

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  initUI();
  handleUrlLoginVerification();
  loadCatalogData();
});

window.addEventListener('seph-agent-state', event => {
  const nextState = event.detail?.state;
  if (nextState) agentVisualState = nextState;
  agentVisualOperation = event.detail?.operation || 'human';
  agentVisualNavigationMode = event.detail?.navigation_mode || 'preview';
  syncAgentOrbSurface();
  const helper = document.getElementById('interaction-helper');
  const humanSurface = agentVisualState === 'human' || agentVisualState === 'override';
  if (!humanSurface) {
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
    if (helper) helper.classList.add('fade-out');
  } else {
    resetInactivityTimer();
  }
  if (isAgentNavigationPreviewActive()) {
    startAgentDigPreview();
  } else {
    stopAgentDigPreview({ restore: false });
  }
});

window.addEventListener('seph-agent-sound', event => {
  const enabled = event.detail?.enabled;
  if (typeof enabled !== 'boolean') return;
  siteAudioEnabled = enabled;
  audio.muted = !siteAudioEnabled;
  document.documentElement.dataset.siteAudio = siteAudioEnabled ? 'on' : 'off';
  emitPlayerState('site_audio_changed');
});

function getUiAudioContext() {
  if (!siteAudioEnabled) return null;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  if (!uiAudioContext) {
    try {
      const sharedContext = typeof window.__SEPH_GET_AGENT_AUDIO_CONTEXT__ === 'function'
        ? window.__SEPH_GET_AGENT_AUDIO_CONTEXT__()
        : window.__SEPH_AGENT_AUDIO_CONTEXT__;
      if (sharedContext && typeof sharedContext.createGain === 'function') {
        uiAudioContext = sharedContext;
      } else {
        uiAudioContext = new AudioContext();
        window.__SEPH_AGENT_AUDIO_CONTEXT__ = uiAudioContext;
      }
    } catch (error) {
      return null;
    }
  }
  return uiAudioContext;
}

// Purchase confirmation is a short generated cue rather than a fetched cash-register
// sample: it keeps the demo self-contained, avoids provenance/licensing surprises and
// shares the same user-gesture-gated context as the rest of the site's UI sounds.
function playPurchaseConfirmationSound() {
  if (!siteAudioEnabled) {
    diagnostics.record('audio', 'purchase_confirmation_skipped', {
      reason: 'site_audio_disabled'
    });
    return false;
  }
  const context = getUiAudioContext();
  if (!context || context.state === 'closed') {
    diagnostics.record('audio', 'purchase_confirmation_skipped', {
      reason: !context ? 'audio_context_unavailable' : 'audio_context_closed'
    });
    return false;
  }

  const play = () => {
    if (!siteAudioEnabled || context.state !== 'running') return false;
    const now = context.currentTime;
    const master = context.createGain();
    const filter = context.createBiquadFilter();
    const delay = context.createDelay(1);
    const tail = context.createGain();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3000, now);
    filter.Q.setValueAtTime(0.45, now);
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.12, now + 0.035);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    delay.delayTime.setValueAtTime(0.24, now);
    tail.gain.setValueAtTime(0.08, now);
    master.connect(filter);
    filter.connect(context.destination);
    master.connect(delay);
    delay.connect(tail);
    tail.connect(context.destination);

    [
      { frequency: 392, offset: 0, duration: 0.3, level: 0.72, type: 'sine' },
      { frequency: 523.25, offset: 0.12, duration: 0.42, level: 0.56, type: 'sine' },
      { frequency: 659.25, offset: 0.24, duration: 0.55, level: 0.38, type: 'triangle' }
    ].forEach(voice => {
      const oscillator = context.createOscillator();
      const voiceGain = context.createGain();
      const start = now + voice.offset;
      oscillator.type = voice.type;
      oscillator.frequency.setValueAtTime(voice.frequency, start);
      voiceGain.gain.setValueAtTime(0.0001, start);
      voiceGain.gain.exponentialRampToValueAtTime(voice.level, start + 0.025);
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, start + voice.duration);
      oscillator.connect(voiceGain);
      voiceGain.connect(master);
      oscillator.start(start);
      oscillator.stop(start + voice.duration + 0.04);
    });
    diagnostics.record('audio', 'purchase_confirmation_played', {
      duration_ms: 700,
      context_state: context.state
    });
    return true;
  };

  if (context.state === 'suspended') {
    context.resume().then(play).catch(error => {
      diagnostics.record('audio', 'purchase_confirmation_failed', {
        reason: 'audio_context_resume_failed',
        error: String(error?.message || error)
      });
    });
    return true;
  }
  return play();
}

// Navigation feedback is a subtle, tactile mechanical crate tick.
// It follows the site-wide sound toggle and routes through the shared AudioContext,
// providing clear auditory feedback for human browsing and sequential agent digging.
function playNavigationTickNow(direction, agent, context) {
  if (!siteAudioEnabled || !context || context.state !== 'running') return;
  const now = context.currentTime;
  const duration = agent ? 0.065 : 0.048;
  const frameCount = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const samples = buffer.getChannelData(0);
  let lowFrequencyNoise = 0;
  const baseFreq = agent
    ? (direction > 0 ? 680 : 540)
    : (direction > 0 ? 760 : 620);
  const decayRate = 28 / duration;

  for (let index = 0; index < frameCount; index += 1) {
    const t = index / context.sampleRate;
    const whiteNoise = Math.random() * 2 - 1;
    lowFrequencyNoise = lowFrequencyNoise * 0.72 + whiteNoise * 0.28;
    const env = Math.exp(-t * decayRate);
    const tone = Math.sin(2 * Math.PI * (baseFreq - t * 350) * t);
    samples[index] = (tone * 0.65 + lowFrequencyNoise * 0.35) * env;
  }

  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(agent ? 2200 : 2600, now);
  filter.Q.setValueAtTime(0.7, now);
  const peakGain = agent ? AGENT_NAVIGATION_MIX.agent : AGENT_NAVIGATION_MIX.human;
  gain.gain.setValueAtTime(peakGain, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  source.start(now);
  source.stop(now + duration + 0.01);
  diagnostics.record('audio', 'navigation_tick_played', {
    direction: direction > 0 ? 1 : -1,
    agent: Boolean(agent),
    duration_ms: Math.round(duration * 1000),
    context_state: context.state
  });
}

function playCrateNavigationTick(direction = 1, { agent = false, force = false } = {}) {
  if (!siteAudioEnabled) {
    diagnostics.record('audio', 'navigation_tick_skipped', { reason: 'site_audio_disabled' });
    return;
  }
  const normalizedDirection = direction > 0 ? 1 : -1;
  const nowWall = performance.now();
  const throttleMs = agent ? 90 : 45;
  if (!force && nowWall - lastNavigationTickAt < throttleMs) return;

  const context = getUiAudioContext();
  if (!context || context.state === 'closed') {
    diagnostics.record('audio', 'navigation_tick_unavailable', {
      reason: !context ? 'audio_context_unavailable' : 'audio_context_closed'
    });
    return;
  }
  if (context.state !== 'running') {
    diagnostics.record('audio', 'navigation_tick_blocked', {
      direction: normalizedDirection,
      agent: Boolean(agent),
      context_state: context.state,
      reason: 'audio_context_not_unlocked',
      unlock: 'trusted_pointer_or_key_gesture',
      queued: false
    });
    lastNavigationTickAt = nowWall;
    return;
  }

  lastNavigationTickAt = nowWall;
  playNavigationTickNow(normalizedDirection, Boolean(agent), context);
}

function unlockNavigationAudio(event) {
  if (event?.isTrusted !== true || !siteAudioEnabled) return;
  const context = getUiAudioContext();
  if (!context || context.state === 'closed') return;
  if (context.state === 'running') return;
  diagnostics.record('audio', 'navigation_unlock_attempt', {
    event_type: event.type,
    context_state: context.state
  });
  const resume = context.state === 'running'
    ? Promise.resolve()
    : context.resume?.() || Promise.resolve();
  resume.then(() => {
    diagnostics.record('audio', 'navigation_unlock_succeeded', {
      event_type: event.type,
      context_state: context.state
    });
  }).catch(error => {
    diagnostics.record('audio', 'navigation_unlock_failed', {
      event_type: event.type,
      context_state: context.state,
      error
    });
  });
}

function installNavigationAudioUnlock() {
  if (navigationAudioUnlockInstalled) return;
  navigationAudioUnlockInstalled = true;
  const unlock = event => unlockNavigationAudio(event);
  // Wheel/scroll is not a portable browser user-activation signal. It never
  // queues a tick; only a trusted pointer, touch or keyboard gesture can
  // resume a suspended AudioContext for the next navigation event.
  ['pointerdown', 'keydown', 'touchstart', 'touchend'].forEach(eventName => {
    window.addEventListener(eventName, unlock, { passive: true });
  });
}

window.addEventListener('seph-agent-focus', event => {
  agentFocusRecordIds = new Set(
    (event.detail?.record_ids || [])
      .map(value => String(value).trim())
      .filter(Boolean)
  );
  syncAgentFocusVisuals();
});

function getCatalogProductSlug(item) {
  const itemSlug = String(item?.slug || '').trim();
  if (itemSlug) return itemSlug;

  const pageUrl = String(item?.page_url || '').trim();
  const parts = pageUrl.split('/').filter(Boolean);
  const pageSlug = parts[parts.length - 1] || '';
  if (parts[0] === 'album' || parts[0] === 'track') return `${parts[0]}-${pageSlug}`;
  return pageSlug;
}

function getCatalogCurationEntry(item) {
  const slug = getCatalogProductSlug(item);
  return slug ? catalogCuration?.releases?.[slug] || null : null;
}

function applyCatalogCuration(item) {
  if (!item || typeof item !== 'object') return item;
  const entry = getCatalogCurationEntry(item);
  const category = String(entry?.release_category || item.release_category || 'unclassified').trim().toLowerCase();
  const categoryLabel = String(
    entry?.release_category_label
      || item.release_category_label
      || catalogCuration?.categories?.[category]?.label
      || DEFAULT_CATALOG_CATEGORY_LABELS[category]
      || category
  ).trim();
  return {
    ...item,
    ...(entry || {}),
    release_category: category,
    release_category_label: categoryLabel
  };
}

async function loadCatalogCuration() {
  try {
    const response = await fetch('/shop/catalog-curation.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Curation HTTP ${response.status}`);
    const parsed = await response.json();
    if (!parsed || typeof parsed !== 'object' || !parsed.releases || typeof parsed.releases !== 'object') {
      throw new Error('Invalid catalog curation payload');
    }
    catalogCuration = {
      ...parsed,
      categories: { ...DEFAULT_CATALOG_CATEGORY_LABELS, ...(parsed.categories || {}) },
      releases: parsed.releases
    };
    diagnostics.record('catalog', 'curation_loaded', {
      schema_version: catalogCuration.schema_version,
      release_count: Object.keys(catalogCuration.releases).length
    });
  } catch (error) {
    diagnostics.record('catalog', 'curation_unavailable', { message: String(error?.message || error) });
  }
  return catalogCuration;
}

function getCatalogPopularity(item) {
  const aliases = [
    getCatalogProductSlug(item),
    getCrateRecordId(item),
    String(item?.page_url || '').replace(/^\//, '').replace(/\//g, '-')
  ].map(value => String(value || '').trim()).filter(Boolean);
  return aliases.reduce((highest, alias) => Math.max(highest, Number(bestSellersMap.get(alias) || 0)), 0);
}

function getCatalogLatestPriority(item) {
  const value = Number(item?.latest_priority);
  return Number.isFinite(value) ? value : 0;
}

function compareCatalogItems(a, b) {
  const dateA = a?.release_date ? new Date(a.release_date).getTime() : 0;
  const dateB = b?.release_date ? new Date(b.release_date).getTime() : 0;

  if (currentFilter === 'oldest') return dateA - dateB;
  if (currentFilter === 'popular') {
    const popularityA = getCatalogPopularity(a);
    const popularityB = getCatalogPopularity(b);
    if (popularityB !== popularityA) return popularityB - popularityA;

    const priorityA = typeof a?.sort_priority === 'number' ? a.sort_priority : 0;
    const priorityB = typeof b?.sort_priority === 'number' ? b.sort_priority : 0;
    if (priorityB !== priorityA) return priorityB - priorityA;
  }

  if (currentFilter === 'latest') {
    const latestPriorityA = getCatalogLatestPriority(a);
    const latestPriorityB = getCatalogLatestPriority(b);
    if (latestPriorityB !== latestPriorityA) return latestPriorityB - latestPriorityA;
  }

  return dateB - dateA;
}

function getRecordStackIndex(recordId) {
  const normalizedId = String(recordId || '').trim();
  if (!normalizedId) return -1;
  const record = recordsData.find((entry, index) => {
    if (String(entry?.recordId || '').trim() !== normalizedId) return false;
    if (!Number.isFinite(Number(entry.stackIndex))) entry.stackIndex = index;
    return true;
  });
  if (!record) return -1;
  const fallbackIndex = recordsData.indexOf(record);
  return Number.isFinite(Number(record.stackIndex)) ? Number(record.stackIndex) : fallbackIndex;
}

function preservePhysicalRecordOrder(nextCatalog) {
  if (!Array.isArray(nextCatalog) || nextCatalog.length === 0 || recordsData.length === 0 || nextCatalog.length > recordsData.length) {
    return false;
  }

  const slotsByRecordId = new Map();
  recordsData.forEach((record, index) => {
    const recordId = String(record?.recordId || '').trim();
    if (!recordId || slotsByRecordId.has(recordId)) return;
    if (!Number.isFinite(Number(record.stackIndex))) record.stackIndex = index;
    slotsByRecordId.set(recordId, record);
  });

  const nextRecordIds = nextCatalog.map(getCrateRecordId);
  if (new Set(nextRecordIds).size !== nextRecordIds.length) return false;
  if (nextRecordIds.some(recordId => !slotsByRecordId.has(recordId))) return false;

  const visibleRecordIds = new Set(nextRecordIds);
  const visibleRecords = nextRecordIds.map(recordId => slotsByRecordId.get(recordId));
  const hiddenRecords = recordsData
    .filter(record => !visibleRecordIds.has(String(record?.recordId || '').trim()))
    .sort((a, b) => Number(a.stackIndex) - Number(b.stackIndex));

  recordsData = [...visibleRecords, ...hiddenRecords].map((record, logicalIndex) => {
    const recordId = String(record?.recordId || '').trim();
    record.mesh.userData = {
      ...record.mesh.userData,
      index: logicalIndex,
      record_id: recordId,
      stack_index: record.stackIndex
    };
    record.mesh.visible = logicalIndex < nextCatalog.length;
    return record;
  });
  window.recordsData = recordsData;
  syncAgentFocusVisuals();
  return true;
}

function filterAndSortCatalog(skipApply = false, {
  preservePlayer = true,
  preservePhysicalOrder = false
} = {}) {
  const previousCatalog = catalog;
  const previousActiveItem = !isUserCrateViewActive ? previousCatalog[activeIndex] : null;
  const previousActiveRecordId = previousActiveItem ? getCrateRecordId(previousActiveItem) : null;
  const localItems = readLocalCrateItems();
  let workingList = getDigitalCatalog().filter(item => {
    return !localItems.includes(getCrateRecordId(item));
  });

  // 1. Sort logic
  workingList.sort(compareCatalogItems);

  // 2. Search filter logic (Only search in title and artist to prevent tag matching false positives)
  if (currentSearchQuery) {
    workingList = workingList.filter(item => {
      const titleMatch = item.title && item.title.toLowerCase().includes(currentSearchQuery);
      const artistMatch = item.artist && item.artist.toLowerCase().includes(currentSearchQuery);
      return titleMatch || artistMatch;
    });
  }

  catalog = workingList;
  window.catalog = catalog;

  let physicalOrderPreserved = false;
  if (!skipApply) {
    physicalOrderPreserved = preservePhysicalOrder && preservePhysicalRecordOrder(catalog);
    if (physicalOrderPreserved) {
      const preservedIndex = previousActiveRecordId
        ? catalog.findIndex(item => getCrateRecordId(item) === previousActiveRecordId)
        : -1;
      activeIndex = preservedIndex >= 0
        ? preservedIndex
        : Math.max(0, Math.min(activeIndex, catalog.length - 1));
      if (isSelected && !isUserCrateViewActive) showRecordDetails(activeIndex);
      updateRecordHeights();
    } else {
      applyCatalogUpdates({ preservePlayer });
    }
  }
  rebuildUserCrateRecords();
  return { physical_order_preserved: physicalOrderPreserved };
}

function setCatalogSort(sort, { preservePhysicalOrder = false } = {}) {
  const normalized = String(sort || '').trim().toLowerCase();
  if (!['latest', 'popular', 'oldest'].includes(normalized)) {
    return {
      ok: false,
      error: { code: 'INVALID_SORT', message: 'sort must be latest, popular, or oldest.' }
    };
  }

  currentFilter = normalized;
  const latestBtn = document.getElementById('sort-latest');
  const popularBtn = document.getElementById('sort-popular');
  const filterPill = document.querySelector('.filter-switcher-pill');
  if (latestBtn) latestBtn.classList.toggle('active', currentFilter === 'latest');
  if (popularBtn) popularBtn.classList.toggle('active', currentFilter === 'popular');
  if (filterPill) filterPill.classList.toggle('active-popular', currentFilter === 'popular');
  const update = filterAndSortCatalog(false, {
    preservePlayer: true,
    preservePhysicalOrder
  });
  return {
    ok: true,
    sort: currentFilter,
    visible_count: catalog.length,
    physical_order_preserved: Boolean(update?.physical_order_preserved),
    first_record: catalog[0] ? summarizeCrateItem(catalog[0]) : null,
    last_record: catalog.length > 0 ? summarizeCrateItem(catalog[catalog.length - 1]) : null
  };
}

function getLegacyPageSlug(item) {
  const pageUrl = String(item?.page_url || '');
  const pageSlug = pageUrl.split('/').filter(Boolean).pop();
  return String(pageSlug || item?.slug || '').trim();
}

function getCrateRecordId(item) {
  const explicitId = String(item?.record_id || '').trim();
  if (explicitId) return explicitId;

  const pageSlug = getLegacyPageSlug(item);
  if (!pageSlug) return String(item?.slug || '').trim();

  // Keep existing album crate IDs stable, but separate a merch listing that
  // shares the same Bandcamp page URL (for example Sade's vinyl edition).
  return String(item?.type || '').toLowerCase() === 'merch'
    ? `${pageSlug}--merch`
    : pageSlug;
}

function isPhysicalVinylItem(item) {
  return String(item?.type || '').trim().toLowerCase() === 'merch';
}

function getDigitalCatalog() {
  return masterCatalog.filter(item => !isPhysicalVinylItem(item));
}

function getPhysicalCatalog() {
  return masterCatalog.filter(isPhysicalVinylItem);
}

function findMasterCatalogItem(recordId) {
  const normalized = String(recordId || '').trim();
  if (!normalized) return null;
  return masterCatalog.find(item => (
    getCrateRecordId(item) === normalized ||
    getLegacyPageSlug(item) === normalized ||
    String(item?.slug || '') === normalized ||
    String(item?.page_url || '') === normalized
  )) || null;
}

const LOCAL_COVER_API_ORIGIN = 'https://sephmartin.com';

function isLocalPreviewHost() {
  return /^(127\.0\.0\.1|localhost)$/i.test(String(window.location.hostname || ''));
}

function isCrossOriginCatalogImage(imageUrl) {
  try {
    return new URL(imageUrl, window.location.href).origin !== window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Resolve catalog artwork for every surface that consumes it. The static
 * localhost preview has no Worker API route, so its relative media/proxy
 * URLs must use the public API origin; production keeps the same-origin
 * paths, which avoids changing the live asset contract.
 */
function resolveCatalogImageUrl(rawImageUrl) {
  const raw = String(rawImageUrl || '').trim();
  if (!raw) return '';

  let parsed;
  try {
    parsed = new URL(raw, window.location.href);
  } catch {
    return raw;
  }

  const isApiMedia = parsed.pathname.startsWith('/api/media/');
  const isApiProxy = parsed.pathname === '/api/proxy-image';
  const isSameSiteApi = /^https?:$/i.test(parsed.protocol)
    && /^(?:www\.)?(?:sephmartin\.com|demo\.sephmartin\.com)$/i.test(parsed.hostname)
    && (isApiMedia || isApiProxy);

  if (isLocalPreviewHost() && (parsed.origin === window.location.origin || isSameSiteApi)) {
    return `${LOCAL_COVER_API_ORIGIN}${parsed.pathname}${parsed.search}`;
  }

  if (isSameSiteApi) return parsed.toString();

  if (/^https?:$/i.test(parsed.protocol) && parsed.origin !== window.location.origin) {
    const proxyOrigin = isLocalPreviewHost() ? LOCAL_COVER_API_ORIGIN : '';
    const proxyPath = `${proxyOrigin}/api/proxy-image?url=${encodeURIComponent(parsed.toString())}`;
    return proxyPath;
  }

  return parsed.origin === window.location.origin
    ? `${parsed.pathname}${parsed.search}${parsed.hash}`
    : parsed.toString();
}

// The downloaded Crystal Ball-ifier archive contains a standalone React app.
// Reuse only its useful part here: a low-count sphere made from flat mirror
// tiles. The atmospheric particles, extra transparent shells and global light
// effects stay out of the page so disco mode cannot affect the main UI layers.
function createAgentDiscoBallGeometry(rings = 36) {
  const positions = [];
  const normals = [];
  const colors = [];
  const sphereRadius = 1;
  const tileHeight = Math.PI / rings;

  for (let row = 1; row < rings; row += 1) {
    const phi = (row / rings) * Math.PI;
    const ringRadius = Math.sin(phi) * sphereRadius;
    const segments = Math.max(14, Math.round(((2 * Math.PI * ringRadius) / tileHeight) * 1.12));
    const angleStep = (2 * Math.PI) / segments;
    const tileAngularWidth = angleStep * 0.92;
    const tileAngularHeight = tileHeight * 0.9;

    for (let column = 0; column < segments; column += 1) {
      const theta = column * angleStep;
      const center = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta) * sphereRadius,
        Math.cos(phi) * sphereRadius,
        Math.sin(phi) * Math.sin(theta) * sphereRadius
      );
      const normal = center.clone().normalize();
      const corners = [
        [phi - tileAngularHeight / 2, theta - tileAngularWidth / 2],
        [phi - tileAngularHeight / 2, theta + tileAngularWidth / 2],
        [phi + tileAngularHeight / 2, theta + tileAngularWidth / 2],
        [phi + tileAngularHeight / 2, theta - tileAngularWidth / 2]
      ].map(([cornerPhi, cornerTheta]) => {
        const cornerRadius = Math.sin(cornerPhi) * (sphereRadius + 0.008);
        return new THREE.Vector3(
          cornerRadius * Math.cos(cornerTheta),
          Math.cos(cornerPhi) * (sphereRadius + 0.008),
          cornerRadius * Math.sin(cornerTheta)
        );
      });

      // Add a cheap view-facing falloff and a few fixed reflection biases so
      // the flat tiles still read as a sphere without an HDR environment or a
      // second full-page effect. The real lights below still provide the
      // moving specular response as the group rotates.
      const viewFacing = Math.max(0, normal.z);
      const keyFacing = Math.max(0, (normal.x * -0.34) + (normal.y * 0.52) + (normal.z * 0.78));
      const coolFacing = Math.max(0, (normal.x * 0.78) + (normal.y * -0.24) + (normal.z * 0.56));
      const tileVariance = 0.94 + (((row * 37 + column * 17) % 17) / 212);
      const tileBrightness = (0.38 + (0.28 * Math.sqrt(viewFacing)) + (0.2 * keyFacing) + (0.1 * coolFacing)) * tileVariance;
      // Keep the mirror field neutral. The physical-looking colour shifts
      // come from the studio lights, not from a tinted tile grid.
      const tileColor = [tileBrightness, tileBrightness, tileBrightness];
      [0, 1, 2, 0, 2, 3].forEach(index => {
        const point = corners[index];
        positions.push(point.x, point.y, point.z);
        normals.push(normal.x, normal.y, normal.z);
        colors.push(tileColor[0], tileColor[1], tileColor[2]);
      });
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function resizeAgentOrbDiscoScene() {
  if (!agentOrbDiscoRenderer || !agentOrbDiscoCamera || !agentOrbDiscoCanvas) return;
  const host = agentOrbDiscoCanvas.parentElement;
  if (!host) return;

  const width = Math.max(1, host.clientWidth);
  const height = Math.max(1, host.clientHeight);
  agentOrbDiscoRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  agentOrbDiscoRenderer.setSize(width, height, false);
  agentOrbDiscoCamera.aspect = width / height;
  agentOrbDiscoCamera.updateProjectionMatrix();
}

function ensureAgentOrbDiscoScene() {
  const canvas = document.getElementById('agent-orb-disco-canvas');
  if (!canvas) return false;
  if (agentOrbDiscoRenderer && agentOrbDiscoCanvas === canvas) return true;

  agentOrbDiscoCanvas = canvas;
  agentOrbDiscoScene = new THREE.Scene();
  agentOrbDiscoCamera = new THREE.PerspectiveCamera(28, 1, 0.1, 10);
  agentOrbDiscoCamera.position.set(0, 0, 3.25);

  const ball = new THREE.Group();
  ball.scale.setScalar(1.08);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.987, 32, 20),
    new THREE.MeshStandardMaterial({
      color: 0x050509,
      metalness: 0.08,
      roughness: 0.88
    })
  );
  const tiles = new THREE.Mesh(
    createAgentDiscoBallGeometry(),
    new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      metalness: 0.9,
      roughness: 0.12,
      emissive: 0x11141b,
      emissiveIntensity: 0.06,
      vertexColors: true,
      flatShading: true
    })
  );
  tiles.renderOrder = 1;
  ball.add(core, tiles);
  agentOrbDiscoRoot = ball;
  agentOrbDiscoScene.add(ball);

  const ambient = new THREE.HemisphereLight(0xd8e2f0, 0x090a10, 0.72);
  const key = new THREE.DirectionalLight(0xffffff, 3.5);
  key.position.set(-2.8, 3.2, 4.8);
  const frontFill = new THREE.DirectionalLight(0xf7fbff, 1.65);
  frontFill.position.set(1.2, -0.6, 4.7);
  const coolFill = new THREE.PointLight(0xb5ddff, 0.85, 6, 2);
  coolFill.position.set(2.5, -1.2, 2.2);
  const warmFill = new THREE.PointLight(0xffe1ae, 0.5, 6, 2);
  warmFill.position.set(-2.4, 1.1, 2.8);
  const pinkRim = new THREE.PointLight(0xffb8df, 0.3, 6, 2);
  pinkRim.position.set(-2.1, -1.7, 1.5);
  agentOrbDiscoScene.add(ambient, key, frontFill, coolFill, warmFill, pinkRim);

  try {
    agentOrbDiscoRenderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'low-power'
    });
    agentOrbDiscoRenderer.setClearColor(0x000000, 0);
    agentOrbDiscoRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    agentOrbDiscoRenderer.toneMappingExposure = 1.05;
    if (THREE.SRGBColorSpace) agentOrbDiscoRenderer.outputColorSpace = THREE.SRGBColorSpace;
  } catch (error) {
    console.warn('Agent orb disco renderer unavailable:', error);
    agentOrbDiscoRenderer = null;
    return false;
  }

  if (typeof ResizeObserver === 'function' && canvas.parentElement) {
    agentOrbDiscoResizeObserver = new ResizeObserver(() => {
      if (agentOrbVisualMode === 'disco_ball') resizeAgentOrbDiscoScene();
    });
    agentOrbDiscoResizeObserver.observe(canvas.parentElement);
  }
  resizeAgentOrbDiscoScene();
  return true;
}

function renderAgentOrbDiscoFrame(timestamp) {
  agentOrbDiscoAnimationFrame = 0;
  const hud = document.getElementById('agent-mode-hud');
  if (!hud || hud.hidden || agentOrbVisualMode !== 'disco_ball' || !agentOrbDiscoRenderer || !agentOrbDiscoRoot) {
    agentOrbDiscoLastTimestamp = 0;
    return;
  }

  const delta = agentOrbDiscoLastTimestamp
    ? Math.min(0.05, Math.max(0.001, (timestamp - agentOrbDiscoLastTimestamp) / 1000))
    : 1 / 60;
  agentOrbDiscoLastTimestamp = timestamp;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const isPlaying = Boolean(currentPlayingTrackId
    && (audio.currentSrc || audio.src)
    && !audio.paused
    && !audio.ended);
  if (isPlaying && !reducedMotion) {
    agentOrbDiscoRoot.rotation.y += delta * AGENT_ORB_DISCO_ROTATION_SPEED;
    agentOrbDiscoRoot.rotation.x = 0.08;
    agentOrbDiscoRoot.rotation.z = -0.035;
  }
  agentOrbDiscoRenderer.render(agentOrbDiscoScene, agentOrbDiscoCamera);

  if (isPlaying && !reducedMotion) {
    agentOrbDiscoAnimationFrame = window.requestAnimationFrame(renderAgentOrbDiscoFrame);
  }
}

function syncAgentOrbDiscoSurface() {
  const hud = document.getElementById('agent-mode-hud');
  const shouldRender = Boolean(hud && !hud.hidden && agentOrbVisualMode === 'disco_ball');
  const shouldAnimate = Boolean(shouldRender
    && currentPlayingTrackId
    && (audio.currentSrc || audio.src)
    && !audio.paused
    && !audio.ended
    && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  if (!shouldRender) {
    if (agentOrbDiscoAnimationFrame) {
      window.cancelAnimationFrame(agentOrbDiscoAnimationFrame);
      agentOrbDiscoAnimationFrame = 0;
    }
    agentOrbDiscoLastTimestamp = 0;
    return;
  }

  if (!ensureAgentOrbDiscoScene()) return;
  resizeAgentOrbDiscoScene();

  // Keep the ball visible as a still object when no preview is loaded or the
  // user pauses. Only an actively playing preview owns the rAF loop.
  if (!shouldAnimate) {
    if (agentOrbDiscoAnimationFrame) {
      window.cancelAnimationFrame(agentOrbDiscoAnimationFrame);
      agentOrbDiscoAnimationFrame = 0;
    }
    agentOrbDiscoLastTimestamp = 0;
    renderAgentOrbDiscoFrame(performance.now());
    return;
  }

  if (!agentOrbDiscoAnimationFrame) {
    agentOrbDiscoLastTimestamp = 0;
    agentOrbDiscoAnimationFrame = window.requestAnimationFrame(renderAgentOrbDiscoFrame);
  }
}

function getAgentOrbVisualState() {
  const hud = document.getElementById('agent-mode-hud');
  const release = currentPlayingReleaseId ? findMasterCatalogItem(currentPlayingReleaseId) : null;
  const trackLoaded = Boolean(currentPlayingTrackId && (audio.currentSrc || audio.src));

  return {
    mode: agentOrbVisualMode,
    available_modes: [...AGENT_ORB_VISUAL_MODES],
    cover_record_id: release ? getCrateRecordId(release) : null,
    cover_url: resolveCatalogImageUrl(release?.image) || null,
    track_id: currentPlayingTrackId,
    track_loaded: trackLoaded,
    is_playing: Boolean(trackLoaded && !audio.paused),
    interactive: Boolean(hud && !hud.hidden),
    disco_rotation_y: Number(agentOrbDiscoRoot?.rotation?.y || 0),
    disco_animation_active: Boolean(agentOrbDiscoAnimationFrame)
  };
}

function syncAgentOrbSurface() {
  const root = document.documentElement;
  const hud = document.getElementById('agent-mode-hud');
  const cover = document.getElementById('agent-mode-cover');
  const playButton = document.getElementById('agent-mode-play-btn');
  const discoToggle = document.getElementById('agent-orb-disco-toggle');
  const playIcon = document.querySelector('.agent-orb-play-icon');
  const pauseIcon = document.querySelector('.agent-orb-pause-icon');
  const release = currentPlayingReleaseId ? findMasterCatalogItem(currentPlayingReleaseId) : null;
  const coverUrl = resolveCatalogImageUrl(release?.image);
  const trackLoaded = Boolean(currentPlayingTrackId && (audio.currentSrc || audio.src));
  const isPlaying = Boolean(trackLoaded && !audio.paused);

  root.dataset.agentOrbVisual = agentOrbVisualMode;
  if (hud) {
    hud.dataset.orbVisual = agentOrbVisualMode;
    hud.dataset.trackLoaded = trackLoaded ? 'true' : 'false';
    hud.dataset.trackPlaying = isPlaying ? 'true' : 'false';
  }

  if (cover) {
    if (coverUrl) {
      if (cover.getAttribute('src') !== coverUrl) cover.setAttribute('src', coverUrl);
      cover.alt = `${release?.title || 'Current release'} cover`;
      cover.hidden = false;
    } else {
      cover.hidden = true;
      cover.removeAttribute('src');
      cover.alt = '';
    }
  }

  if (playButton) {
    playButton.hidden = !trackLoaded;
    playButton.classList.toggle('is-playing', isPlaying);
    playButton.setAttribute(
      'aria-label',
      isPlaying
        ? 'Pause preview'
        : pendingPlayback ? 'Play preview (tap or click to start)' : 'Play preview'
    );
    playButton.title = isPlaying ? 'Pause preview' : 'Play preview';
  }
  if (playIcon) playIcon.classList.toggle('hidden', isPlaying);
  if (pauseIcon) pauseIcon.classList.toggle('hidden', !isPlaying);

  if (discoToggle) {
    const nextLabel = agentOrbVisualMode === 'disco_ball'
      ? 'Switch orb to cover'
      : 'Switch orb to disco ball';
    discoToggle.setAttribute('aria-pressed', String(agentOrbVisualMode === 'disco_ball'));
    discoToggle.setAttribute('aria-label', nextLabel);
    discoToggle.title = nextLabel;
    const label = document.getElementById('agent-orb-disco-toggle-label');
    if (label) label.textContent = nextLabel;
  }

  syncPlayerTransportControls();
  syncAgentOrbDiscoSurface();
}

function setAgentOrbVisual(mode, { source = 'agent' } = {}) {
  const normalized = String(mode || '').trim().toLowerCase();
  if (!AGENT_ORB_VISUAL_MODES.includes(normalized)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_ORB_VISUAL',
        message: 'mode must be cover or disco_ball.'
      },
      orb: getAgentOrbVisualState()
    };
  }

  const previousMode = agentOrbVisualMode;
  agentOrbVisualMode = normalized;
  syncAgentOrbSurface();
  const orb = getAgentOrbVisualState();
  diagnostics.record('agent_orb', 'visual_mode_changed', {
    previous_mode: previousMode,
    mode: normalized,
    source
  }, { snapshot: true });
  window.dispatchEvent(new CustomEvent('seph-agent-orb-state', {
    detail: { event: 'visual_mode_changed', source, ...orb }
  }));
  return { ok: true, previous_mode: previousMode, orb };
}

function syncBuyButtonLabel(buyBtn, item, inCrate) {
  if (!buyBtn) return;
  const label = buyBtn.querySelector('.buy-button-label') || buyBtn.querySelector('span');
  const price = buyBtn.querySelector('.buy-button-price');
  const priceText = String(item?.price_text || buyBtn.dataset.priceText || '').trim();

  if (inCrate) {
    if (label) label.textContent = 'In Crate (Remove)';
    if (price) price.textContent = '';
  } else {
    if (label) label.textContent = 'Add to Crate';
    if (price) price.textContent = priceText ? `(${priceText})` : '';
  }
  buyBtn.classList.toggle('in-crate', Boolean(inCrate));
}

function summarizeCrateItem(item) {
  if (!item) return null;
  return {
    record_id: getCrateRecordId(item),
    catalog_slug: String(item.slug || getCrateRecordId(item)),
    title: item.title || '',
    artist: item.artist || '',
    label: item.site_name || '',
    type: item.type || 'album',
    page_url: item.page_url || '',
    price_text: item.price_text || '',
    tags: Array.isArray(item.bandcamp_tags)
      ? item.bandcamp_tags
      : Array.isArray(item.tags) ? item.tags : [],
    release_category: item.release_category || 'unclassified',
    release_category_label: item.release_category_label || DEFAULT_CATALOG_CATEGORY_LABELS[item.release_category] || 'Needs classification',
    latest_priority: getCatalogLatestPriority(item),
    release_date: item.release_date || null,
    track_count: Array.isArray(item.tracks) ? item.tracks.length : 0
  };
}

function setSearchQuery(query, { preservePhysicalOrder = false } = {}) {
  const normalized = String(query || '').toLowerCase().trim().slice(0, 200);
  currentSearchQuery = normalized;

  const searchInput = document.getElementById('crate-search');
  const clearBtn = document.getElementById('search-clear');
  if (searchInput && searchInput.value !== normalized) searchInput.value = normalized;
  if (clearBtn) clearBtn.classList.toggle('hidden', !normalized);

  filterAndSortCatalog(false, { preservePhysicalOrder });
  diagnostics.record('ui', 'catalog_search', {
    query: normalized,
    visible_count: catalog.length
  }, { snapshot: true });
  return { ok: true, query: normalized, visible_count: catalog.length };
}

function setAgentFocusRecords(recordIds) {
  agentFocusRevision += 1;
  agentFocusRecordIds = new Set(
    (recordIds || [])
      .map(value => String(value).trim())
      .filter(Boolean)
  );
  syncAgentFocusVisuals();
  window.dispatchEvent(new CustomEvent('seph-agent-focus', {
    detail: { record_ids: [...agentFocusRecordIds], source: 'agent' }
  }));
  return [...agentFocusRecordIds];
}

function clearAgentFocusRecords() {
  setAgentFocusRecords([]);
}

function syncAgentFocusVisuals() {
  const update = rec => {
    const frontMaterial = rec?.mesh?.material?.[4];
    if (!frontMaterial) return;
    const recordId = rec.recordId || rec.slug;
    const isFocused = recordId && agentFocusRecordIds.has(recordId);
    // Focus is intentionally stored on the sleeve for future spatial cues,
    // but never recolours the cover or vinyl. The agent presence belongs in
    // the ambient aura around the crate, not inside the artwork.
    rec.mesh.userData.agentFocused = Boolean(isFocused);
    if (frontMaterial.emissive) {
      frontMaterial.emissive.setHex(0x000000);
      frontMaterial.emissiveIntensity = 0;
    }
  };

  recordsData.forEach(update);
  userRecordsData.forEach(update);
}

function focusRecordById(recordId) {
  const item = findMasterCatalogItem(recordId);
  if (!item) {
    return { ok: false, error: { code: 'RECORD_NOT_FOUND', message: 'Record is not in the loaded catalog.' } };
  }

  const normalizedId = getCrateRecordId(item);
  let visibleIndex = catalog.findIndex(entry => getCrateRecordId(entry) === normalizedId);

  if (visibleIndex === -1 && readLocalCrateItems().includes(normalizedId)) {
    if (currentSearchQuery) setSearchQuery('');
    showMyCrateView();
    const orderedUserItems = getOrderedUserCrateSlugs({ excludeAnimating: false });
    const userIndex = orderedUserItems.indexOf(normalizedId);
    if (userIndex === -1) {
      return { ok: false, error: { code: 'RECORD_NOT_VISIBLE', message: 'Record is not visible in My Crate.' } };
    }
    userActiveIndex = userIndex;
    selectRecord(userIndex);
    return { ok: true, record: summarizeCrateItem(item), view: 'my_crate' };
  }

  // A previous human/agent search may have hidden the requested record. Clear
  // only that transient search so a tool call can always bring its target up.
  if (visibleIndex === -1 && currentSearchQuery) {
    setSearchQuery('');
    visibleIndex = catalog.findIndex(entry => getCrateRecordId(entry) === normalizedId);
  }

  if (visibleIndex === -1) {
    return { ok: false, error: { code: 'RECORD_NOT_VISIBLE', message: 'Record is not visible in the current crate state.' } };
  }

  // A browsing preview may temporarily move through sleeves before the tool
  // settles on its final record. Mark explicit agent navigation as intentional
  // so the preview cleanup does not restore and close the previous sidebar.
  if (isAgentNavigationOperationActive()) agentFocusRevision += 1;

  const previousShopRecordId = !isUserCrateViewActive && catalog[activeIndex]
    ? getCrateRecordId(catalog[activeIndex])
    : '';
  const previousShopIndex = !isUserCrateViewActive ? activeIndex : -1;
  const previousStackIndex = getRecordStackIndex(previousShopRecordId);
  isUserCrateViewActive = false;
  globalCamXOffset = 0;
  const shopBtn = document.getElementById('view-shop-btn');
  const myCrateBtn = document.getElementById('view-mycrate-btn');
  if (shopBtn) shopBtn.classList.add('active');
  if (myCrateBtn) myCrateBtn.classList.remove('active');
  selectRecord(visibleIndex);
  const focusedStackIndex = getRecordStackIndex(normalizedId);
  if ((focusedStackIndex !== previousStackIndex || visibleIndex !== previousShopIndex)
    && !isAgentNavigationPreviewActive()) {
    const direction = focusedStackIndex >= 0 && previousStackIndex >= 0
      ? (focusedStackIndex >= previousStackIndex ? 1 : -1)
      : (visibleIndex >= previousShopIndex ? 1 : -1);
    playCrateNavigationTick(direction, { agent: agentVisualState !== 'human' });
  }
  return { ok: true, record: summarizeCrateItem(item), view: 'shop', index: visibleIndex };
}

function showMyCrateView() {
  const finish = result => {
    diagnostics.record('ui', 'crate_view', {
      view: result?.view || 'shop',
      ok: Boolean(result?.ok),
      cart_count: result?.cart_count ?? null,
      checkout_available: result?.checkout_available ?? null
    }, { snapshot: true });
    return result;
  };
  const checkoutSummary = getCheckoutSummary();
  if (!checkoutSummary.checkout_available) {
    if (isUserCrateViewActive) {
      isUserCrateViewActive = false;
      globalCamXOffset = 0;
      const shopBtn = document.getElementById('view-shop-btn');
      const myCrateBtn = document.getElementById('view-mycrate-btn');
      if (shopBtn) shopBtn.classList.add('active');
      if (myCrateBtn) myCrateBtn.classList.remove('active');
    }
    updateUIControlsState();
    return finish({
      ok: false,
      error: { code: 'EMPTY_MY_CRATE', message: 'My Crate is empty. Add at least one record before checkout.' },
      view: 'shop',
      cart_count: 0,
      checkout_available: false
    });
  }

  const myCrateBtn = document.getElementById('view-mycrate-btn');
  if (myCrateBtn && !myCrateBtn.classList.contains('hidden')) {
    myCrateBtn.click();
  } else {
    isUserCrateViewActive = true;
    globalCamXOffset = 1.3;
    const shopBtn = document.getElementById('view-shop-btn');
    if (shopBtn) shopBtn.classList.remove('active');
  }
  return finish({ ok: true, view: 'my_crate', cart_count: checkoutSummary.cart_count });
}

function showMainCrateView({ preservePhysicalOrder = false } = {}) {
  const finish = result => {
    diagnostics.record('ui', 'crate_view', {
      view: result?.view || 'shop',
      ok: Boolean(result?.ok),
      cart_count: result?.cart_count ?? null,
      checkout_available: result?.checkout_available ?? null
    }, { snapshot: true });
    return result;
  };

  isUserCrateViewActive = false;
  globalCamXOffset = 0;
  const shopBtn = document.getElementById('view-shop-btn');
  const myCrateBtn = document.getElementById('view-mycrate-btn');
  const viewSwitcher = document.querySelector('.view-switcher-pill');
  if (shopBtn) shopBtn.classList.add('active');
  if (myCrateBtn) myCrateBtn.classList.remove('active');
  if (viewSwitcher) viewSwitcher.classList.remove('active-mycrate');

  if (currentSearchQuery) {
    currentSearchQuery = '';
    const searchInput = document.getElementById('crate-search');
    const clearBtn = document.getElementById('search-clear');
    if (searchInput) searchInput.value = '';
    if (clearBtn) clearBtn.classList.add('hidden');
  }
  filterAndSortCatalog(false, {
    preservePlayer: true,
    preservePhysicalOrder
  });
  deselectRecord({ preservePlayer: true });
  updateUIControlsState();
  return finish({
    ok: true,
    view: 'shop',
    cart_count: readLocalCrateItems().length,
    visible_count: catalog.length,
    player_preserved: Boolean(currentPlayingTrackId)
  });
}

function browseCatalog({ direction = 'next', steps = 1, start_record_id = '' } = {}) {
  const normalizedDirection = String(direction || '').trim().toLowerCase();
  if (!['next', 'previous'].includes(normalizedDirection)) {
    return {
      ok: false,
      error: { code: 'INVALID_BROWSE_DIRECTION', message: 'direction must be next or previous.' }
    };
  }

  const requestedSteps = Number(steps);
  if (!Number.isInteger(requestedSteps) || requestedSteps < 1 || requestedSteps > 12) {
    return {
      ok: false,
      error: { code: 'INVALID_BROWSE_STEPS', message: 'steps must be an integer between 1 and 12.' }
    };
  }

  if (isUserCrateViewActive || currentSearchQuery) {
    showMainCrateView({ preservePhysicalOrder: true });
  }
  if (catalog.length === 0) {
    return {
      ok: false,
      error: { code: 'EMPTY_CATALOG', message: 'No shop records are available to browse.' }
    };
  }

  const requestedStart = String(start_record_id || '').trim();
  let currentIndex = requestedStart
    ? catalog.findIndex(item => getCrateRecordId(item) === requestedStart)
    : activeIndex;
  if (requestedStart && currentIndex < 0) {
    return {
      ok: false,
      error: { code: 'RECORD_NOT_VISIBLE', message: 'The requested browse starting record is not visible in the shop.' }
    };
  }
  currentIndex = Math.max(0, Math.min(catalog.length - 1, currentIndex));

  const delta = normalizedDirection === 'next' ? 1 : -1;
  const browsedRecords = [];
  for (let step = 0; step < requestedSteps; step += 1) {
    const nextIndex = Math.max(0, Math.min(catalog.length - 1, currentIndex + delta));
    if (nextIndex === currentIndex) break;
    currentIndex = nextIndex;
    const item = catalog[currentIndex];
    browsedRecords.push(summarizeCrateItem(item));
    playCrateNavigationTick(delta, { agent: agentVisualState !== 'human' });
  }

  activeIndex = currentIndex;
  selectRecord(activeIndex);
  const currentRecord = catalog[activeIndex];
  return {
    ok: true,
    view: 'shop',
    sort: currentFilter,
    direction: normalizedDirection,
    requested_steps: requestedSteps,
    steps: browsedRecords.length,
    reached_boundary: browsedRecords.length < requestedSteps,
    browsed_record_ids: browsedRecords.map(item => item.record_id),
    browsed_records: browsedRecords,
    index: activeIndex,
    current_record: currentRecord ? summarizeCrateItem(currentRecord) : null
  };
}

async function browseToRecord(recordId, { maxSteps = 4 } = {}) {
  const item = findMasterCatalogItem(recordId);
  if (!item) {
    return {
      ok: false,
      error: { code: 'RECORD_NOT_FOUND', message: 'Record is not in the loaded catalog.' }
    };
  }

  const requestedMaxSteps = Number(maxSteps);
  if (!Number.isInteger(requestedMaxSteps) || requestedMaxSteps < 1 || requestedMaxSteps > 12) {
    return {
      ok: false,
      error: { code: 'INVALID_BROWSE_STEPS', message: 'max_steps must be an integer between 1 and 12.' }
    };
  }

  if (isUserCrateViewActive || currentSearchQuery) {
    showMainCrateView({ preservePhysicalOrder: true });
  }

  const normalizedId = getCrateRecordId(item);
  const targetIndex = catalog.findIndex(entry => getCrateRecordId(entry) === normalizedId);
  if (targetIndex < 0) {
    return {
      ok: false,
      error: { code: 'RECORD_NOT_VISIBLE', message: 'The target record is not visible in the Shop crate.' }
    };
  }

  const startIndex = Math.max(0, Math.min(catalog.length - 1, activeIndex));
  const targetDistance = Math.abs(targetIndex - startIndex);
  const delta = targetIndex >= startIndex ? 1 : -1;
  const direction = delta > 0 ? 'next' : 'previous';
  const browsedRecords = [];

  if (targetDistance > requestedMaxSteps) {
    const focused = focusRecordById(normalizedId);
    return {
      ok: Boolean(focused?.ok),
      record: focused?.record || summarizeCrateItem(item),
      view: focused?.view || 'shop',
      navigation: {
        mode: 'direct_fallback',
        reason: 'target_beyond_max_steps',
        direction,
        target_record_id: normalizedId,
        target_distance: targetDistance,
        max_steps: requestedMaxSteps,
        steps: 0,
        reached_target: Boolean(focused?.ok),
        browsed_record_ids: [],
        browsed_records: []
      },
      ...(focused?.error ? { error: focused.error } : {})
    };
  }

  for (let step = 0; step < targetDistance; step += 1) {
    const fromIndex = activeIndex;
    const nextIndex = fromIndex + delta;
    activeIndex = nextIndex;
    selectRecord(activeIndex);
    const nextItem = catalog[activeIndex];
    const nextRecord = summarizeCrateItem(nextItem);
    if (nextRecord) browsedRecords.push(nextRecord);
    playCrateNavigationTick(delta, { agent: true, force: true });
    diagnostics.record('ui', 'crate_navigation', {
      source: 'agent',
      operation: 'digging',
      mode: 'targeted',
      view: 'shop',
      from_index: fromIndex,
      to_index: nextIndex,
      target_record_id: normalizedId
    }, { snapshot: true });
    if (step < targetDistance - 1) {
      await new Promise(resolve => window.setTimeout(resolve, 145));
    }
  }

  if (targetDistance === 0) selectRecord(targetIndex);
  const currentRecord = catalog[targetIndex];
  return {
    ok: true,
    record: summarizeCrateItem(currentRecord),
    view: 'shop',
    index: targetIndex,
    navigation: {
      mode: 'digging',
      direction,
      target_record_id: normalizedId,
      target_distance: targetDistance,
      max_steps: requestedMaxSteps,
      steps: browsedRecords.length,
      reached_target: true,
      browsed_record_ids: browsedRecords.map(record => record.record_id),
      browsed_records: browsedRecords
    }
  };
}

function parsePriceCents(priceText) {
  const numeric = String(priceText || '').replace(/[^\d.,]/g, '').replace(',', '.');
  const parsed = Number.parseFloat(numeric);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function getCheckoutSummary() {
  const recordIds = readLocalCrateItems();
  const lines = recordIds.map(recordId => {
    const item = findMasterCatalogItem(recordId);
    if (!item) return null;
    return {
      record_id: getCrateRecordId(item),
      title: item.title || '',
      artist: item.artist || '',
      price_text: item.price_text || '',
      price_cents: parsePriceCents(item.price_text)
    };
  }).filter(Boolean);

  return {
    cart_count: lines.length,
    lines,
    total_cents: lines.reduce((sum, line) => sum + line.price_cents, 0),
    checkout_available: lines.length > 0,
    human_confirmation_required: true
  };
}

function isDemoCheckoutSimulatorEnabled() {
  try {
    if (typeof window === 'undefined') return false;
    const hostname = String(window.location.hostname || '').toLowerCase();
    const isDemoHost = hostname === 'demo.sephmartin.com';
    const isLocalHost = hostname === '127.0.0.1' || hostname === 'localhost';
    if (!isDemoHost && !isLocalHost) return false;

    const params = new URLSearchParams(window.location.search);
    if (params.get('demo_checkout') === '0') return false;
    // The real Lemon overlay remains an explicit escape hatch for QA and
    // provider-event testing, even on the demo host.
    if (isLemonOverlayEnabled()) return false;
    if (params.get('demo_checkout') === '1') return true;
    return isDemoHost || isLocalHost;
  } catch {
    return false;
  }
}

function readDemoStorage(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeDemoStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function readDemoAccount() {
  const account = readDemoStorage(DEMO_ACCOUNT_STORAGE_KEY, null);
  if (!account || typeof account !== 'object') return null;
  const email = String(account.email || '').trim().toLowerCase();
  return email ? { ...account, email } : null;
}

function ensureDemoAccount() {
  const existing = readDemoAccount();
  const account = {
    ...DEMO_ACCOUNT_DEFAULTS,
    ...(existing || {}),
    email: ['demo@sephmartin.test', 'seph@sephmartin.test'].includes(existing?.email)
      ? DEMO_ACCOUNT_DEFAULTS.email
      : (existing?.email || DEMO_ACCOUNT_DEFAULTS.email),
    payment_label: ['DEMO CARD', 'CARD'].includes(existing?.payment_label)
      ? DEMO_ACCOUNT_DEFAULTS.payment_label
      : (existing?.payment_label || DEMO_ACCOUNT_DEFAULTS.payment_label),
    address_line1: existing?.address_line1 === 'Via Demo 42'
      ? DEMO_ACCOUNT_DEFAULTS.address_line1
      : (existing?.address_line1 || DEMO_ACCOUNT_DEFAULTS.address_line1),
    account_type: 'demo',
    created_at: existing?.created_at || new Date().toISOString()
  };
  if (!existing || Object.keys(DEMO_ACCOUNT_DEFAULTS).some(key => account[key] !== existing[key])) {
    writeDemoStorage(DEMO_ACCOUNT_STORAGE_KEY, account);
  }
  return account;
}

function readDemoPurchaseLedger() {
  const ledger = readDemoStorage(DEMO_PURCHASES_STORAGE_KEY, null);
  if (!ledger || typeof ledger !== 'object' || !Array.isArray(ledger.orders)) {
    return { schema_version: 'demo-purchases.v1', orders: [] };
  }
  return {
    schema_version: 'demo-purchases.v1',
    orders: ledger.orders.filter(order => order && typeof order === 'object')
  };
}

function getDemoPurchaseForRecord(item) {
  const recordId = getCrateRecordId(item);
  if (!recordId) return null;
  const ledger = readDemoPurchaseLedger();
  for (let index = ledger.orders.length - 1; index >= 0; index -= 1) {
    const order = ledger.orders[index];
    if (Array.isArray(order.record_ids) && order.record_ids.map(String).includes(recordId)) {
      return order;
    }
  }
  return null;
}

function formatDemoEuro(cents) {
  return `€${(Math.max(0, Number(cents) || 0) / 100).toFixed(2)}`;
}

function getDemoCheckoutCoverUrl(item) {
  const image = String(item?.image || '').trim();
  if (!image) return '';
  try {
    return new URL(image, window.location.origin).href;
  } catch {
    return image;
  }
}

function getDemoCheckoutCoverFallbackUrl(item) {
  const image = String(item?.image || '').trim();
  const isLocalPreview = /^(127\.0\.0\.1|localhost)$/.test(window.location.hostname);
  if (!isLocalPreview || !image.startsWith('/api/')) return '';
  return `https://sephmartin.com${image}`;
}

function setDemoCheckoutError(message = '') {
  const error = document.getElementById('demo-checkout-error');
  if (!error) return;
  error.textContent = String(message || '');
  error.classList.toggle('hidden', !message);
}

function setDemoCheckoutStep(step) {
  demoCheckoutStep = step;
  const steps = {
    checkout: document.getElementById('demo-checkout-checkout-step'),
    success: document.getElementById('demo-checkout-success-step')
  };
  Object.entries(steps).forEach(([name, element]) => {
    if (element) element.classList.toggle('hidden', name !== step);
  });
  const successMark = document.getElementById('demo-checkout-success-mark');
  if (successMark) successMark.classList.toggle('hidden', step !== 'success');
  const title = document.getElementById('demo-checkout-title');
  if (title) title.textContent = step === 'success' ? 'PURCHASE COMPLETE' : 'YOUR CRATE, READY.';
  const description = document.getElementById('demo-checkout-description');
  if (description) {
    description.textContent = step === 'success'
      ? ''
      : 'Your saved profile is ready. Review the crate, then complete your purchase.';
    description.classList.toggle('hidden', step === 'success');
  }
  const modal = document.getElementById('demo-checkout-modal');
  if (modal) modal.dataset.step = step;
}

function renderDemoCheckoutReview() {
  const list = document.getElementById('demo-checkout-lines');
  if (list) {
    list.replaceChildren();
    demoCheckoutSelection.forEach(item => {
      const line = document.createElement('li');
      line.className = 'demo-checkout-line';
      line.dataset.recordId = getCrateRecordId(item);

      const cover = document.createElement('img');
      cover.className = 'demo-checkout-line-cover';
      cover.alt = `${item.title || 'Release'} cover`;
      cover.loading = 'lazy';
      const coverUrl = getDemoCheckoutCoverUrl(item);
      const fallbackCoverUrl = getDemoCheckoutCoverFallbackUrl(item);
      if (coverUrl) cover.src = coverUrl;
      cover.addEventListener('error', () => {
        if (fallbackCoverUrl && cover.src !== fallbackCoverUrl) {
          cover.src = fallbackCoverUrl;
          return;
        }
        cover.hidden = true;
      });
      line.appendChild(cover);

      const lineContent = document.createElement('span');
      lineContent.className = 'demo-checkout-line-content';
      const title = document.createElement('span');
      title.className = 'demo-checkout-line-title';
      title.textContent = item.title || 'Untitled release';
      lineContent.appendChild(title);
      const meta = document.createElement('span');
      meta.className = 'demo-checkout-line-meta';
      meta.textContent = `${item.artist || 'Seph Martin'} · MP3`;
      lineContent.appendChild(meta);
      line.appendChild(lineContent);

      const lineActions = document.createElement('span');
      lineActions.className = 'demo-checkout-line-actions';
      const price = document.createElement('span');
      price.className = 'demo-checkout-line-price';
      price.textContent = formatDemoEuro(parsePriceCents(item.price_text));
      lineActions.appendChild(price);

      const removeButton = document.createElement('button');
      removeButton.className = 'demo-checkout-line-remove';
      removeButton.type = 'button';
      removeButton.setAttribute('aria-label', `Remove ${item.title || 'release'} from My Crate`);
      removeButton.title = 'Remove from My Crate';
      removeButton.textContent = '×';
      removeButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        removeDemoCheckoutLine(getCrateRecordId(item));
      });
      lineActions.appendChild(removeButton);
      line.appendChild(lineActions);
      list.appendChild(line);
    });
  }

  const total = demoCheckoutSelection.reduce(
    (sum, item) => sum + parsePriceCents(item.price_text),
    0
  );
  const totalElement = document.getElementById('demo-checkout-total');
  if (totalElement) totalElement.textContent = formatDemoEuro(total);
  const subtotalElement = document.getElementById('demo-checkout-subtotal');
  if (subtotalElement) subtotalElement.textContent = formatDemoEuro(total);
  const countElement = document.getElementById('demo-checkout-count');
  if (countElement) countElement.textContent = `${demoCheckoutSelection.length} release${demoCheckoutSelection.length === 1 ? '' : 's'}`;
  const account = ensureDemoAccount();
  const accountElement = document.getElementById('demo-checkout-account-email');
  if (accountElement) accountElement.textContent = account?.email || 'sephmartin account';
  const nameElement = document.getElementById('demo-checkout-profile-name');
  if (nameElement) nameElement.textContent = account?.display_name || DEMO_ACCOUNT_DEFAULTS.display_name;
  const paymentElement = document.getElementById('demo-checkout-payment');
  if (paymentElement) paymentElement.textContent = `${account?.payment_label || DEMO_ACCOUNT_DEFAULTS.payment_label} ···· ${account?.payment_last4 || DEMO_ACCOUNT_DEFAULTS.payment_last4}`;
  const addressLineOne = document.getElementById('demo-checkout-address-line1');
  if (addressLineOne) addressLineOne.textContent = account?.address_line1 || DEMO_ACCOUNT_DEFAULTS.address_line1;
  const addressLineTwo = document.getElementById('demo-checkout-address-line2');
  if (addressLineTwo) addressLineTwo.textContent = account?.address_line2 || DEMO_ACCOUNT_DEFAULTS.address_line2;
}

function removeDemoCheckoutLine(recordId) {
  const normalizedId = String(recordId || '').trim();
  const item = findMasterCatalogItem(normalizedId);
  if (!item) return false;

  const result = manageCrateRecord(normalizedId, 'remove');
  if (!result?.ok) {
    setDemoCheckoutError('THIS RELEASE COULD NOT BE REMOVED FROM MY CRATE.');
    return false;
  }

  demoCheckoutSelection = demoCheckoutSelection.filter(
    selectionItem => getCrateRecordId(selectionItem) !== normalizedId
  );
  diagnostics.record('ui', 'demo_checkout_line_removed', {
    record_id: normalizedId,
    cart_count: result.cart_count ?? demoCheckoutSelection.length
  }, { snapshot: true });

  if (demoCheckoutSelection.length === 0) {
    closeDemoCheckoutModal({ reason: 'crate_empty' });
    return true;
  }

  const view = showMyCrateView();
  if (!view?.ok) {
    closeDemoCheckoutModal({ reason: 'crate_empty' });
    return true;
  }
  renderDemoCheckoutReview();
  updateUIControlsState();
  return true;
}

function openDemoCheckoutModal(items) {
  const modal = document.getElementById('demo-checkout-modal');
  if (!modal) return false;
  const selection = (items || []).filter(Boolean);
  if (selection.length === 0) return false;

  demoCheckoutSelection = selection;
  const source = demoCheckoutRequestedByAgent ? 'agent' : 'human';
  demoCheckoutRequestedByAgent = false;
  demoCheckoutLastFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  setDemoCheckoutError('');
  renderDemoCheckoutReview();
  ensureDemoAccount();

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  modal.dataset.source = source;
  setDemoCheckoutStep('checkout');
  diagnostics.record('ui', 'demo_checkout_opened', {
    cart_count: selection.length,
    total_cents: selection.reduce((sum, item) => sum + parsePriceCents(item.price_text), 0),
    account_exists: true,
    source,
    checkout_surface: 'demo_simulator'
  }, { snapshot: true });
  window.dispatchEvent(new CustomEvent('seph-demo-checkout-opened', {
    detail: {
      source,
      cart_count: selection.length,
      checkout_surface: 'demo_simulator'
    }
  }));

  window.requestAnimationFrame(() => {
    document.getElementById('demo-checkout-confirm')?.focus();
  });
  return true;
}

function closeDemoCheckoutModal({ reason = 'dismissed' } = {}) {
  const modal = document.getElementById('demo-checkout-modal');
  if (!modal || modal.classList.contains('hidden')) return false;
  if (demoCheckoutAutoReturnTimer) {
    window.clearTimeout(demoCheckoutAutoReturnTimer);
    demoCheckoutAutoReturnTimer = null;
  }
  const source = modal.dataset.source || 'human';
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  clearDemoConfetti('demo-checkout-confetti-layer');
  setDemoCheckoutError('');
  demoCheckoutSelection = [];
  setDemoCheckoutStep('checkout');
  modal.dataset.source = '';
  diagnostics.record('ui', 'demo_checkout_closed', { reason, source }, { snapshot: true });
  window.dispatchEvent(new CustomEvent('seph-demo-checkout-closed', {
    detail: { reason, source, checkout_surface: 'demo_simulator' }
  }));
  if (demoCheckoutLastFocus?.isConnected) demoCheckoutLastFocus.focus();
  demoCheckoutLastFocus = null;
  return true;
}

function completeDemoCheckout() {
  const account = ensureDemoAccount();
  if (!account || demoCheckoutSelection.length === 0) {
    setDemoCheckoutStep('checkout');
    setDemoCheckoutError('THE SAVED PROFILE IS NOT AVAILABLE.');
    return false;
  }

  const recordIds = [...new Set(demoCheckoutSelection.map(getCrateRecordId).filter(Boolean))];
  const totalCents = demoCheckoutSelection.reduce(
    (sum, item) => sum + parsePriceCents(item.price_text),
    0
  );
  const order = {
    order_id: `ORDER-${Date.now().toString(36).toUpperCase()}`,
    account_type: 'demo',
    email: account.email,
    purchased_at: new Date().toISOString(),
    record_ids: recordIds,
    total_cents: totalCents
  };
  const ledger = readDemoPurchaseLedger();
  ledger.orders = [...ledger.orders, order].slice(-20);
  if (!writeDemoStorage(DEMO_PURCHASES_STORAGE_KEY, ledger)) {
    setDemoCheckoutError('THIS BROWSER BLOCKED CHECKOUT STORAGE.');
    return false;
  }

  const orderIdElement = document.getElementById('demo-checkout-order-id');
  if (orderIdElement) orderIdElement.textContent = order.order_id;
  const purchasedCountElement = document.getElementById('demo-checkout-purchased-count');
  if (purchasedCountElement) {
    purchasedCountElement.textContent = `${recordIds.length} release${recordIds.length === 1 ? '' : 's'} added to My Crate`;
  }

  diagnostics.record('ui', 'demo_checkout_completed', {
    order_id: order.order_id,
    account_type: 'demo',
    cart_count: recordIds.length,
    total_cents: totalCents,
    checkout_surface: 'demo_simulator'
  }, { snapshot: true });
  setDemoCheckoutError('');
  setDemoCheckoutStep('success');
  updateUIControlsState();
  playPurchaseConfirmationSound();
  const confettiCount = triggerDemoConfetti('demo-checkout-confetti-layer');
  const source = document.getElementById('demo-checkout-modal')?.dataset.source || 'human';
  window.dispatchEvent(new CustomEvent('seph-demo-checkout-completed', {
    detail: {
      source,
      order_id: order.order_id,
      checkout_surface: 'demo_simulator',
      purchase_complete: true,
      confetti_count: confettiCount
    }
  }));
  return true;
}

// WebMCP's final purchase action is deliberately limited to the on-site
// simulator. It completes the visible review surface without touching Lemon,
// payment providers, or any real checkout session.
function completeDemoCheckoutFromAgent() {
  if (!isDemoCheckoutSimulatorEnabled()) {
    return {
      ok: false,
      status: 'purchase_confirmation_required',
      purchase_started: false,
      purchase_complete: false,
      human_confirmation_required: true,
      checkout_surface: isLemonOverlayEnabled() ? 'lemon_overlay' : 'lemon_redirect',
      error: {
        code: 'REAL_PURCHASE_HUMAN_REQUIRED',
        message: 'The final purchase must be completed by the user in the live checkout.'
      },
      next_step: 'Complete the purchase in the visible Lemon checkout surface.'
    };
  }

  const modal = document.getElementById('demo-checkout-modal');
  if (!modal || modal.classList.contains('hidden')) {
    return {
      ok: false,
      status: 'demo_checkout_not_open',
      purchase_started: false,
      purchase_complete: false,
      human_confirmation_required: false,
      checkout_surface: 'demo_simulator',
      error: {
        code: 'DEMO_CHECKOUT_NOT_OPEN',
        message: 'Open the visible demo checkout before completing the purchase.'
      },
      next_step: 'Call start_checkout first, then call complete_purchase.'
    };
  }

  if (modal.dataset.step === 'success') {
    return {
      ok: true,
      status: 'demo_purchase_completed',
      purchase_started: false,
      purchase_complete: true,
      already_completed: true,
      human_confirmation_required: false,
      checkout_surface: 'demo_simulator',
      order_id: document.getElementById('demo-checkout-order-id')?.textContent?.trim() || null,
      demo_complete: false,
      download_requested: false,
      next_step: 'Purchase Complete is shown. Wait for a separate, explicit user request to finish or download the demo; do not call download_release automatically.'
    };
  }

  if (modal.dataset.step !== 'checkout' || demoCheckoutSelection.length === 0) {
    return {
      ok: false,
      status: 'demo_checkout_unavailable',
      purchase_started: false,
      purchase_complete: false,
      human_confirmation_required: false,
      checkout_surface: 'demo_simulator',
      error: {
        code: 'DEMO_CHECKOUT_REVIEW_UNAVAILABLE',
        message: 'The demo checkout is not ready for completion.'
      },
      next_step: 'Review the visible checkout and try complete_purchase again.'
    };
  }

  const recordIds = [...new Set(demoCheckoutSelection.map(getCrateRecordId).filter(Boolean))];
  const totalCents = demoCheckoutSelection.reduce(
    (sum, item) => sum + parsePriceCents(item.price_text),
    0
  );
  const completed = completeDemoCheckout();
  if (!completed) {
    return {
      ok: false,
      status: 'demo_purchase_failed',
      purchase_started: false,
      purchase_complete: false,
      human_confirmation_required: false,
      checkout_surface: 'demo_simulator',
      record_ids: recordIds,
      total_cents: totalCents,
      error: {
        code: 'DEMO_PURCHASE_FAILED',
        message: document.getElementById('demo-checkout-error')?.textContent?.trim()
          || 'The demo purchase could not be completed.'
      }
    };
  }

  return {
    ok: true,
    status: 'demo_purchase_completed',
    purchase_started: true,
    purchase_complete: true,
    already_completed: false,
    human_confirmation_required: false,
    checkout_surface: 'demo_simulator',
    order_id: document.getElementById('demo-checkout-order-id')?.textContent?.trim() || null,
    record_ids: recordIds,
    cart_count: recordIds.length,
    total_cents: totalCents,
    demo_complete: false,
    download_requested: false,
    next_step: 'Purchase Complete is shown. Wait for a separate, explicit user request to finish or download the demo; do not call download_release automatically.'
  };
}

function openDemoMyCrateAfterPurchase(recordId = '') {
  const firstRecordId = recordId || (demoCheckoutSelection[0]
    ? getCrateRecordId(demoCheckoutSelection[0])
    : '');
  closeDemoCheckoutModal({ reason: 'opened_my_crate' });
  const view = showMyCrateView();
  if (!view?.ok || !firstRecordId) return view;

  const orderedItems = getOrderedUserCrateSlugs({ excludeAnimating: false });
  const index = orderedItems.indexOf(firstRecordId);
  if (index >= 0 && index < userRecordsData.length) {
    userActiveIndex = index;
    selectRecord(index);
  }
  return { ...view, focused_record_id: firstRecordId };
}

function getDemoCompletionState() {
  const modal = document.getElementById('demo-completion-modal');
  const open = Boolean(modal && !modal.classList.contains('hidden'));
  return {
    open,
    message: open
      ? String(document.getElementById('demo-completion-message')?.textContent || '').trim() || null
      : null,
    record_id: open ? String(modal.dataset.recordId || '').trim() || null : null,
    source: open ? String(modal.dataset.source || '').trim() || null : null,
    order_id: open ? String(modal.dataset.orderId || '').trim() || null : null
  };
}

function clearDemoConfetti(layerId) {
  document.getElementById(layerId)?.replaceChildren();
}

function triggerDemoConfetti(layerId) {
  const layer = document.getElementById(layerId);
  if (!layer) return 0;

  layer.replaceChildren();
  let reducedMotion = false;
  try {
    reducedMotion = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  } catch {}
  if (reducedMotion) return 0;

  const colors = ['#03ff00', '#ff2d78', '#64d8cb', '#f5f5f7', '#ff9f43', '#1d1d1f'];
  const count = 42;
  for (let index = 0; index < count; index += 1) {
    const piece = document.createElement('span');
    const angle = (Math.PI * 2 * index) / count + (Math.random() - 0.5) * 0.24;
    const distance = 120 + Math.random() * 150;
    piece.className = 'demo-confetti-piece';
    piece.style.setProperty('--confetti-x', `${(Math.cos(angle) * distance).toFixed(1)}px`);
    piece.style.setProperty('--confetti-y', `${(Math.sin(angle) * distance).toFixed(1)}px`);
    piece.style.setProperty('--confetti-rotation', `${Math.round(Math.random() * 720 - 360)}deg`);
    piece.style.setProperty('--confetti-delay', `${(Math.random() * 0.14).toFixed(2)}s`);
    piece.style.setProperty('--confetti-color', colors[index % colors.length]);
    piece.style.setProperty('--confetti-scale', (0.72 + Math.random() * 0.5).toFixed(2));
    layer.appendChild(piece);
  }
  window.setTimeout(() => layer.replaceChildren(), 1900);
  return count;
}

function openDemoCompletionModal({ source = 'human', recordId = '', orderId = '', message = DEMO_END_MESSAGE } = {}) {
  const modal = document.getElementById('demo-completion-modal');
  if (!modal) return false;
  if (demoCompletionAutoCloseTimer) {
    window.clearTimeout(demoCompletionAutoCloseTimer);
    demoCompletionAutoCloseTimer = null;
  }
  if (modal.classList.contains('hidden')) {
    demoCompletionLastFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  }
  const text = String(message || DEMO_END_MESSAGE).trim() || DEMO_END_MESSAGE;
  const messageElement = document.getElementById('demo-completion-message');
  if (messageElement) messageElement.textContent = text;
  modal.dataset.recordId = String(recordId || '');
  modal.dataset.orderId = String(orderId || '');
  modal.dataset.source = String(source || 'human');
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  const confettiCount = triggerDemoConfetti('demo-completion-confetti-layer');
  const detail = {
    source: modal.dataset.source,
    record_id: modal.dataset.recordId || null,
    order_id: modal.dataset.orderId || null,
    message: text,
    completion_modal_open: true,
    confetti_count: confettiCount
  };
  diagnostics.record('ui', 'demo_completion_opened', detail, { snapshot: true });
  window.dispatchEvent(new CustomEvent('seph-demo-completion-opened', { detail }));
  window.requestAnimationFrame(() => {
    document.getElementById('demo-completion-close')?.focus();
  });
  demoCompletionAutoCloseTimer = window.setTimeout(() => {
    demoCompletionAutoCloseTimer = null;
    closeDemoCompletionModal({ reason: 'auto_close' });
  }, DEMO_COMPLETION_AUTO_CLOSE_MS);
  return true;
}

function closeDemoCompletionModal({ reason = 'dismissed' } = {}) {
  const modal = document.getElementById('demo-completion-modal');
  if (!modal || modal.classList.contains('hidden')) return false;
  if (demoCompletionAutoCloseTimer) {
    window.clearTimeout(demoCompletionAutoCloseTimer);
    demoCompletionAutoCloseTimer = null;
  }
  const detail = {
    reason,
    source: modal.dataset.source || 'human',
    record_id: modal.dataset.recordId || null,
    order_id: modal.dataset.orderId || null,
    completion_modal_open: false
  };
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  clearDemoConfetti('demo-completion-confetti-layer');
  modal.dataset.recordId = '';
  modal.dataset.orderId = '';
  modal.dataset.source = '';
  diagnostics.record('ui', 'demo_completion_closed', detail, { snapshot: true });
  window.dispatchEvent(new CustomEvent('seph-demo-completion-closed', { detail }));
  if (demoCompletionLastFocus?.isConnected) demoCompletionLastFocus.focus();
  demoCompletionLastFocus = null;
  return true;
}

function completeDemoReleasePreview(item, { source = 'human' } = {}) {
  const purchase = getDemoPurchaseForRecord(item);
  const recordId = getCrateRecordId(item);
  if (!item || !purchase || !recordId) {
    return {
      ok: false,
      status: 'demo_download_unavailable',
      demo_complete: false,
      download_started: false,
      download_available: false,
      record_id: recordId || null,
      next_step: 'Select a purchased release before reaching the demo boundary.'
    };
  }

  demoCompletedRecordIds.add(recordId);
  updateUIControlsState();
  const completionModalOpen = openDemoCompletionModal({
    source,
    recordId,
    orderId: purchase.order_id,
    message: DEMO_END_MESSAGE
  });

  const detail = {
    source,
    order_id: purchase.order_id,
    record_id: recordId,
    status: 'demo_complete',
    delivery: 'none',
    audio_available: false,
    message: DEMO_END_MESSAGE,
    completion_modal_open: completionModalOpen
  };
  diagnostics.record('ui', 'demo_preview_completed', detail, { snapshot: true });
  window.dispatchEvent(new CustomEvent('seph-demo-preview-completed', { detail }));
  return {
    ok: true,
    status: 'demo_complete',
    demo_complete: true,
    download_started: false,
    download_available: false,
    media_delivery: 'none',
    record_id: recordId,
    order_id: purchase.order_id,
    message: DEMO_END_MESSAGE,
    completion_modal_open: completionModalOpen,
    next_step: 'The demo has reached its end. No audio file is available from this preview.'
  };
}

function downloadDemoRelease(recordId = '') {
  if (!isDemoCheckoutSimulatorEnabled()) {
    return {
      ok: false,
      status: 'download_unavailable',
      demo_complete: false,
      download_requested: false,
      download_started: false,
      download_available: false,
      audio_download_available: false,
      demo_only: true,
      error: {
        code: 'DEMO_BOUNDARY_ONLY',
        message: 'The WebMCP download boundary is available only in the on-site demo.'
      }
    };
  }

  const normalizedRecordId = String(recordId || '').trim();
  let returnedToMyCrate = false;
  const checkoutModal = document.getElementById('demo-checkout-modal');
  // The agent can continue directly from the visible Purchase Complete state.
  // Mirror the human RETURN TO MY CRATE step before opening the final demo
  // boundary, so the canonical WebMCP sequence can be start -> complete ->
  // download without leaving two modal surfaces stacked on one another.
  if (checkoutModal && !checkoutModal.classList.contains('hidden') && checkoutModal.dataset.step === 'success') {
    const purchasedRecordId = normalizedRecordId
      || (demoCheckoutSelection[0] ? getCrateRecordId(demoCheckoutSelection[0]) : '');
    returnedToMyCrate = Boolean(openDemoMyCrateAfterPurchase(purchasedRecordId)?.ok);
  }
  const item = normalizedRecordId
    ? findMasterCatalogItem(normalizedRecordId)
    : getActiveUserCrateItem();
  if (!item) {
    return {
      ok: false,
      status: 'demo_download_unavailable',
      demo_complete: false,
      download_requested: false,
      download_started: false,
      download_available: false,
      audio_download_available: false,
      demo_only: true,
      error: {
        code: 'DEMO_DOWNLOAD_UNAVAILABLE',
        message: 'Select a purchased release before reaching the demo boundary.'
      },
      next_step: 'Select a purchased release in My Crate, then call download_release again.'
    };
  }

  return {
    ...completeDemoReleasePreview(item, { source: 'agent' }),
    download_requested: true,
    audio_download_available: false,
    demo_only: true,
    returned_to_my_crate: returnedToMyCrate,
    next_step: 'The demo has reached its end. No audio file is available from this preview.'
  };
}

function getActiveUserCrateItem() {
  if (!isUserCrateViewActive || !userIsSelected) return null;
  const entry = userRecordsData[userActiveIndex];
  return entry ? findMasterCatalogItem(entry.recordId || entry.slug) : null;
}

function syncDemoCheckoutButton(button, purchasedItem) {
  if (!button) return;
  const shouldDownload = Boolean(purchasedItem);
  if (shouldDownload) {
    if (!button.dataset.demoDefaultContent) button.dataset.demoDefaultContent = button.innerHTML;
    const recordId = getCrateRecordId(purchasedItem);
    const demoComplete = demoCompletedRecordIds.has(recordId);
    button.innerHTML = demoComplete ? '<span>DEMO COMPLETE</span>' : '<span>DOWNLOAD</span>';
    button.classList.add('demo-download-cta');
    button.classList.toggle('demo-complete-cta', demoComplete);
    button.dataset.demoDownload = 'true';
    button.dataset.demoComplete = String(demoComplete);
    button.title = demoComplete
      ? 'The demo preview has reached its end'
      : 'Reach the end of the demo preview';
    return;
  }

  if (button.dataset.demoDownload === 'true') {
    if (button.dataset.demoDefaultContent) button.innerHTML = button.dataset.demoDefaultContent;
    button.classList.remove('demo-download-cta', 'demo-complete-cta');
    button.dataset.demoDownload = 'false';
    button.dataset.demoComplete = 'false';
    button.title = 'Review checkout for the records in My Crate';
  }
}

function initDemoCheckoutUI() {
  const modal = document.getElementById('demo-checkout-modal');
  if (!modal || modal.dataset.bound === 'true') return;
  modal.dataset.bound = 'true';

  const closeButton = document.getElementById('demo-checkout-close');
  const confirmButton = document.getElementById('demo-checkout-confirm');
  const continueButton = document.getElementById('demo-checkout-continue');
  const completionModal = document.getElementById('demo-completion-modal');
  const completionCloseButton = document.getElementById('demo-completion-close');
  const completionReturnButton = document.getElementById('demo-completion-return');

  closeButton?.addEventListener('click', () => closeDemoCheckoutModal());
  confirmButton?.addEventListener('click', completeDemoCheckout);
  continueButton?.addEventListener('click', () => {
    const firstRecordId = demoCheckoutSelection[0]
      ? getCrateRecordId(demoCheckoutSelection[0])
      : '';
    openDemoMyCrateAfterPurchase(firstRecordId);
  });
  modal.addEventListener('click', event => {
    if (event.target === modal) closeDemoCheckoutModal();
  });
  completionCloseButton?.addEventListener('click', () => closeDemoCompletionModal());
  completionReturnButton?.addEventListener('click', () => {
    const recordId = completionModal?.dataset.recordId || '';
    closeDemoCompletionModal({ reason: 'returned_to_crate' });
    openDemoMyCrateAfterPurchase(recordId);
  });
  completionModal?.addEventListener('click', event => {
    if (event.target === completionModal) closeDemoCompletionModal();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (completionModal && !completionModal.classList.contains('hidden')) {
      closeDemoCompletionModal({ reason: 'escape' });
      return;
    }
    if (!modal.classList.contains('hidden')) {
      closeDemoCheckoutModal({ reason: 'escape' });
    }
  });
}

function manageCrateRecord(recordId, action) {
  const finish = result => {
    diagnostics.record('ui', 'crate_mutation', {
      record_id: String(recordId || '').slice(0, 160),
      action: String(action || '').slice(0, 40),
      ok: Boolean(result?.ok),
      changed: result?.changed ?? null,
      cart_count: result?.cart_count ?? null
    }, { snapshot: true });
    return result;
  };
  const item = findMasterCatalogItem(recordId);
  if (!item) {
    return finish({ ok: false, error: { code: 'RECORD_NOT_FOUND', message: 'Record is not in the loaded catalog.' } });
  }

  const normalizedId = getCrateRecordId(item);
  const existingItems = readLocalCrateItems();
  const alreadyInCrate = existingItems.includes(normalizedId);
  if (action === 'add' && alreadyInCrate) {
    return finish({ ok: true, changed: false, action, record: summarizeCrateItem(item), cart_count: existingItems.length });
  }
  if (action === 'remove' && !alreadyInCrate) {
    return finish({ ok: true, changed: false, action, record: summarizeCrateItem(item), cart_count: existingItems.length });
  }

  const focused = focusRecordById(normalizedId);
  if (!focused.ok) return finish(focused);

  const buyBtn = document.getElementById('buy-btn');
  if (!buyBtn) {
    return finish({ ok: false, error: { code: 'CRATE_CONTROL_UNAVAILABLE', message: 'The existing Add to Crate control is unavailable.' } });
  }

  // Reuse the existing UI handler so local storage, animation, badge and
  // account-sync behavior remain one code path. This never reaches checkout.
  buyBtn.click();
  const updatedItems = readLocalCrateItems();
  return finish({
    ok: true,
    changed: true,
    action,
    record: summarizeCrateItem(item),
    cart_count: updatedItems.length,
    purchase_started: false
  });
}

function startCheckoutFromAgent() {
  const activeDemoItemBeforeView = getActiveUserCrateItem();
  const view = showMyCrateView();
  if (!view.ok) return view;

  const checkoutSummary = getCheckoutSummary();
  const trigger = [
    document.getElementById('panel-checkout-btn'),
    document.getElementById('checkout-btn')
  ].find(button => button && !button.disabled && !button.classList.contains('hidden'));

  if (!trigger) {
    return {
      ok: false,
      ...checkoutSummary,
      view: 'my_crate',
      error: {
        code: 'CHECKOUT_CONTROL_UNAVAILABLE',
        message: 'The visible BUY CRATE control is unavailable.'
      }
    };
  }

  const overlayActive = isLemonOverlayEnabled();
  const demoSimulatorActive = isDemoCheckoutSimulatorEnabled();
  const activeDemoItem = getActiveUserCrateItem()
    || activeDemoItemBeforeView;

  if (demoSimulatorActive && activeDemoItem && !userIsSelected) {
    const orderedItems = getOrderedUserCrateSlugs({ excludeAnimating: false });
    const itemIndex = orderedItems.indexOf(getCrateRecordId(activeDemoItem));
    if (itemIndex >= 0) {
      userActiveIndex = itemIndex;
      selectRecord(itemIndex);
    }
  }

  diagnostics.record('ui', 'checkout_trigger_activated', {
    source: 'agent',
    trigger: trigger.id,
    cart_count: checkoutSummary.cart_count,
    total_cents: checkoutSummary.total_cents
  }, { snapshot: true });

  // Agent checkout stops at the same visible review surface as a human click.
  // Even in the no-payment simulator, the final action remains behind an
  // explicit confirmation. The agent can open review, but must not purchase
  // merely because the user asked to inspect or start checkout.
  if (demoSimulatorActive) {
    const validItems = readLocalCrateItems().map(findMasterCatalogItem).filter(Boolean);
    demoCheckoutRequestedByAgent = true;
    const opened = openDemoCheckoutModal(validItems);
    if (!opened) {
      return {
        ok: false,
        ...checkoutSummary,
        view: 'my_crate',
        error: {
          code: 'DEMO_CHECKOUT_UNAVAILABLE',
          message: 'The demo checkout surface is unavailable.'
        }
      };
    }
    return {
      ok: true,
      ...checkoutSummary,
      view: 'my_crate',
      status: 'demo_checkout_opened',
      checkout_started: true,
      purchase_started: false,
      human_confirmation_required: true,
      checkout_surface: 'demo_simulator',
      next_step: 'Review the visible demo checkout and wait for explicit confirmation; then call complete_purchase with confirmed=true.'
    };
  }
  demoCheckoutRequestedByAgent = false;
  trigger.click();

  return {
    ok: true,
    ...checkoutSummary,
    view: 'my_crate',
    status: demoSimulatorActive ? 'demo_checkout_opened' : 'starting',
    checkout_started: true,
    purchase_started: false,
    human_confirmation_required: true,
    checkout_surface: demoSimulatorActive
      ? 'demo_simulator'
      : overlayActive ? 'lemon_overlay' : 'lemon_redirect',
    next_step: demoSimulatorActive
      ? 'Review the visible demo checkout and wait for explicit confirmation; then call complete_purchase with confirmed=true.'
      : overlayActive
      ? 'Complete the purchase in the Lemon checkout overlay.'
      : 'Complete the purchase on the Lemon checkout page.'
  };
}

function publishCrateApi() {
  const api = {
    status: () => ({
      ready: masterCatalog.length > 0,
      catalog_loaded: masterCatalog.length > 0,
      item_count: masterCatalog.length,
      digital_item_count: getDigitalCatalog().length,
      hidden_format_item_count: getPhysicalCatalog().length,
      visible_item_count: catalog.length,
      cart_count: readLocalCrateItems().length,
      site_audio_enabled: siteAudioEnabled,
      player: getPlayerState(),
      ui_context: getUiContext(),
      webgl: Boolean(renderer),
      webmcp_candidate: Boolean(document.modelContext),
      checkout_surface: isDemoCheckoutSimulatorEnabled()
        ? 'demo_simulator'
        : isLemonOverlayEnabled() ? 'lemon_overlay' : 'lemon_redirect',
      purchase_automation: false
    }),
    getMasterCatalog: () => masterCatalog.slice(),
    getDigitalCatalog: () => getDigitalCatalog(),
    getPhysicalCatalog: () => getPhysicalCatalog(),
    getVisibleCatalog: () => catalog.slice(),
    setCatalogSort,
    getTheme: getThemeState,
    setTheme,
    getUiContext,
    getAgentOrbVisual: getAgentOrbVisualState,
    setAgentOrbVisual,
    getPlayerState,
    setPlayerVolume,
    playTrack: playTrackById,
    pauseTrack: pauseAudio,
    previousTrack: () => playPreviousTrack('agent'),
    nextTrack: () => playNextTrack('agent'),
    previousRelease: () => focusAdjacentRelease(-1, { source: 'agent' }),
    nextRelease: () => focusAdjacentRelease(1, { source: 'agent' }),
    seekTrack: seekPlayer,
    browseCatalog,
    browseToRecord,
    setPlayerMuted: muted => setSiteAudioEnabled(!Boolean(muted)),
    searchCatalog: (query, maxResults = 12) => {
      const normalized = String(query || '').toLowerCase().trim();
      return getDigitalCatalog()
        .filter(item => (
          String(item.title || '').toLowerCase().includes(normalized) ||
          String(item.artist || '').toLowerCase().includes(normalized) ||
          String(item.release_category || '').toLowerCase().includes(normalized) ||
          String(item.release_category_label || '').toLowerCase().includes(normalized)
        ))
        .slice(0, Math.max(1, Math.min(24, Number(maxResults) || 12)))
        .map(summarizeCrateItem);
    },
    setSearchQuery,
    focusRecord: focusRecordById,
    openRecordDetails: focusRecordById,
    playNavigationTick: (direction = 1, options = { agent: true }) => playCrateNavigationTick(direction, options),
    getLocalCrateRecordIds: () => readLocalCrateItems().slice(),
    focusRecords: recordIds => {
      const normalizedIds = [...new Set((recordIds || []).map(value => String(value).trim()).filter(Boolean))];
      if (normalizedIds.length === 0) {
        clearAgentFocusRecords();
        return { ok: false, error: { code: 'INVALID_RECORD_IDS', message: 'No record IDs supplied.' } };
      }
      setAgentFocusRecords(normalizedIds);
      const focused = focusRecordById(normalizedIds[0]);
      if (!focused.ok) return focused;
      return { ok: true, focused_record_ids: normalizedIds, primary: focused.record, view: focused.view };
    },
    clearAgentFocus: clearAgentFocusRecords,
    manageCrate: manageCrateRecord,
    showMyCrate: showMyCrateView,
    showMainCrate: showMainCrateView,
    startCheckout: startCheckoutFromAgent,
    completePurchase: completeDemoCheckoutFromAgent,
    downloadDemoRelease,
    prepareCheckout: () => {
      const view = showMyCrateView();
      if (!view.ok) return view;
      return { ok: true, ...getCheckoutSummary() };
    }
  };

  window.__CRATE_API__ = api;
  if (resolveCrateApiReady) resolveCrateApiReady(api);
  return api;
}

function applyCatalogUpdates({ preservePlayer = true } = {}) {
  const count = catalog.length;

  recordsData.forEach((rec, idx) => {
    if (idx < count) {
      const item = catalog[idx];

      // Make mesh visible and update its index pointer
      rec.mesh.visible = true;
      rec.recordId = getCrateRecordId(item);
      rec.stackIndex = idx;
      rec.mesh.userData = { index: idx, record_id: rec.recordId, stack_index: rec.stackIndex };
      syncAgentFocusVisuals();

      // Staggered ripple shuffle drop (idx * 25ms delay)
      const delay = idx * 25;
      setTimeout(() => {
        // Trigger a drop from above
        rec.currentYOffset = 0.25;
        rec.targetYOffset = 0;
        rec.targetRotX = -0.20;

        // Update texture map
        const imageUrl = resolveCatalogImageUrl(item.image);
        const isExternal = isCrossOriginCatalogImage(imageUrl);

        const cachedTexture = textureCache.get(imageUrl);
        if (cachedTexture) {
          const frontMat = rec.mesh.material[4];
          frontMat.color.setHex(0xffffff);
          frontMat.map = cachedTexture;
          frontMat.needsUpdate = true;

          applyBorderColorFromTexture(
            cachedTexture,
            rec.mesh.material[0],
            rec.mesh.material[1],
            rec.mesh.material[2],
            rec.mesh.material[3]
          );
        } else {
          textureLoader.crossOrigin = isExternal ? 'anonymous' : '';
          textureLoader.load(imageUrl, (texture) => {
            textureCache.set(imageUrl, texture);
            texture.colorSpace = THREE.SRGBColorSpace;
            if (renderer) {
              texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
            }

            const frontMat = rec.mesh.material[4];
            frontMat.color.setHex(0xffffff);
            frontMat.map = texture;
            frontMat.needsUpdate = true;

            applyBorderColorFromTexture(
              texture,
              rec.mesh.material[0],
              rec.mesh.material[1],
              rec.mesh.material[2],
              rec.mesh.material[3]
            );
          }, undefined, (err) => {
            console.error('Texture load failed during shuffle:', imageUrl, err);
          });
        }
      }, delay);
    } else {
      // Hide unused record meshes immediately
      rec.mesh.visible = false;
      // Reset layout offsets just in case
      rec.currentYOffset = 0;
      rec.targetYOffset = 0;
    }
  });

  // Reset selected/inspected record to index 0 and close details panel to prevent input overlap
  activeIndex = 0;
  deselectRecord({ preservePlayer });
}

// Load catalog from API or fallback
async function loadCatalogData() {
  const curationPromise = loadCatalogCuration();
  // Fetch best sellers data for real-time popularity sorting
  try {
    let bsResponse = await fetch('/data/bandcamp-sales-summary.json');
    if (!bsResponse.ok) {
      bsResponse = await fetch('/api/best-sellers');
    }
    if (bsResponse.ok) {
      const bsData = await bsResponse.json();
      (bsData.items || []).forEach(item => {
        if (item.slug) {
          bestSellersMap.set(String(item.slug), Number(item.units_sold || 0));
        }
      });
    }
  } catch (error) {
    console.warn('Failed to load best-sellers data:', error);
  }

  try {
    const response = await fetch('/api/catalog');
    if (!response.ok) throw new Error('Network response was not ok');
    const rawCatalog = await response.json();
    await curationPromise;
    catalog = (Array.isArray(rawCatalog) ? rawCatalog : []).map(applyCatalogCuration);
    console.log('Catalog loaded from API:', catalog);
  } catch (error) {
    console.warn('API Catalog fetch failed. Using fallback catalog:', error);
    await curationPromise;
    catalog = FALLBACK_CATALOG.map(applyCatalogCuration);
  }

  // Format/sanitize catalog data
  catalog = catalog.filter(item => item.tracks && item.tracks.length > 0);

  if (catalog.length === 0) {
    catalog = FALLBACK_CATALOG.map(applyCatalogCuration);
  }

  masterCatalog = [...catalog];
  filterAndSortCatalog(true); // Initial sort (newest release date first)
  publishCrateApi();
  // The first UI pass runs before the async catalog load. Reconcile the
  // persisted crate now that masterCatalog is available so its compact filter
  // control is correct immediately after a refresh.
  updateMyCrateBadge();



  // QA fallback URL switch check (?fallback=1 or ?no3d=1)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('fallback') || urlParams.has('no3d')) {
    console.log('QA fallback switch triggered via URL.');
    triggerStaticFallback('manual');
    return;
  }

  // Only check whether the browser exposes WebGL. Creating a test context here
  // can make iOS Safari reject the renderer context created immediately after.
  if (!hasWebGLApi()) {
    triggerStaticFallback('no-webgl');
    return;
  }

  // 6-second loader timeout failsafe
  const fallbackTimeout = setTimeout(() => {
    console.warn('WebGL/API loading timeout. Triggering fallback.');
    triggerStaticFallback('timeout');
  }, 6000);

  try {
    initThree();
  } catch (err) {
    console.error('3D renderer initialization crashed:', err);
    window.__crateLastFailure = { reason: 'renderer-init', message: String(err?.message || err) };
    clearTimeout(fallbackTimeout);
    triggerStaticFallback('renderer-init');
    return;
  }

  try {
    buildCrate();
  } catch (err) {
    console.error('3D crate scene construction crashed:', err);
    window.__crateLastFailure = { reason: 'crate-build', message: String(err?.message || err) };
    clearTimeout(fallbackTimeout);
    triggerStaticFallback('crate-build');
    return;
  }

  buildRecords().then(() => {
      clearTimeout(fallbackTimeout);
      dismissLoader();
      syncAgentFocusVisuals();
      animate();
      startStaggeredLoading();
      
      // Initialize existing user crate records and check url verify tokens
      rebuildUserCrateRecords();
      handleUrlLoginVerification();
  }).catch(err => {
    console.error('Error preloading priority records:', err);
    window.__crateLastFailure = { reason: 'error-assets', message: String(err?.message || err) };
    clearTimeout(fallbackTimeout);
    triggerStaticFallback('error-assets');
  });

  // Expose variables on window for debugging/inspection
  window.scene = scene;
  window.camera = camera;
  window.recordsData = recordsData;
  window.catalog = catalog;
  window.stickyNoteMesh = stickyNoteMesh;
  window.showStickyNoteModal = showStickyNoteModal;
  window.getUserRecordsData = () => userRecordsData;
  window.getCurrentSearchQuery = () => currentSearchQuery;
  window.masterCatalog = masterCatalog;
  window.__CRATE_API__ = window.__CRATE_API__ || publishCrateApi();
  window.selectRecord = selectRecord;
  window.deselectRecord = deselectRecord;
  window.THREE = THREE;
}

function hasWebGLApi() {
  return Boolean(window.WebGLRenderingContext || window.WebGL2RenderingContext);
}

function dismissLoader() {
  const loader = document.getElementById('loader');
  window.__crateReady = true;
  if (!loader || !window.__crateCssReady) return;

  loader.classList.add('fade-out');

  // Show scroll helper after loader starts fading out
  const helper = document.getElementById('interaction-helper');
  if (helper) {
    setTimeout(() => {
      const detailsPanel = document.getElementById('details-panel');
      const detailsOpen = detailsPanel && !detailsPanel.classList.contains('hidden');
      const currentlySelected = isUserCrateViewActive ? userIsSelected : isSelected;
      const humanSurface = agentVisualState === 'human' || agentVisualState === 'override';
      if (humanSurface && !currentlySelected && !detailsOpen) {
        hasInteracted = false;
        helper.classList.remove('fade-out');
        resetInactivityTimer();
      }
    }, 500);
  }

  window.setTimeout(() => {
    if (window.__crateReady && !window.__crateFallbackTriggered) {
      loader.style.display = 'none';
    }
  }, 550);
}
window.__dismissCrateLoader = dismissLoader;

window.addEventListener('pageshow', () => {
  if (window.__crateReady) dismissLoader();
});

function triggerStaticFallback(reason = 'unknown') {
  console.warn(`WebGL/API load failure (${reason}). Showing fallback options...`);
  
  // 1. Get elements
  const loader = document.getElementById('loader');
  const fallbackCard = document.getElementById('loader-fallback-card');
  const fallbackReasonText = document.getElementById('fallback-card-reason');
  const retryBtn = document.getElementById('fallback-retry-btn');
  const legacyLink = document.getElementById('fallback-legacy-link');
  
  // 2. Set the reason description
  if (fallbackReasonText) {
    let text = "The interactive 3D Crate could not be loaded.";
    if (reason === 'no-webgl') {
      text = "WebGL graphics are not supported or are disabled in this browser.";
    } else if (reason === 'timeout') {
      text = "Connection speed or API timeout loading the 3D assets.";
    } else if (reason === 'renderer-init') {
      text = "3D graphics could not start in this browser.";
    } else if (reason === 'crate-build') {
      text = "The 3D crate scene could not be built.";
    } else if (reason === 'error-assets') {
      text = "Failed to load 3D assets from catalog database.";
    } else if (reason === 'styles') {
      text = "The visual interface stylesheet could not be restored by this browser.";
    } else if (reason === 'manual') {
      text = "Requested manually via URL parameter.";
    }
    fallbackReasonText.textContent = text;
  }
  
  // 3. Update legacy link URL with reason
  if (legacyLink) {
    legacyLink.href = `/terminal?fallback=1&reason=${reason}`;
  }
  
  // 4. Bind retry button action
  if (retryBtn && !retryBtn.hasListener) {
    retryBtn.hasListener = true;
    retryBtn.addEventListener('click', () => {
      window.location.reload();
    });
  }
  
  // 5. Trigger CSS transition classes
  if (loader) {
    window.__crateReady = false;
    loader.style.removeProperty('display');
    loader.classList.remove('fade-out'); // Keep it visible
    loader.classList.add('fallback-active');
  }
  if (fallbackCard) {
    fallbackCard.classList.remove('hidden');
    // Force browser reflow to trigger opacity transition
    void fallbackCard.offsetWidth;
    fallbackCard.classList.add('visible');
  }
  
  // Expose fallback state globally
  window.__crateFallbackTriggered = true;
}
window.__crateFallback = triggerStaticFallback;

// Digging Drag/Swipe Physics handlers
function handleDragStart(x, y) {
  isDragging = true;
  dragStartX = x;
  dragStartY = y;
  dragStartIndex = isUserCrateViewActive ? userActiveIndex : activeIndex;
  hasDragged = false;
  wasDeselectedDuringDrag = false;
  hideHelper();
}

function handleDragMove(x, y) {
  if (!isDragging) return;
  const deltaX = x - dragStartX;
  const deltaY = y - dragStartY;

  // If dragged more than 8 pixels, mark as dragged (to prevent tap/click trigger)
  if (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8) {
    hasDragged = true;
  }

  // Scroll mapping: 15px vertically per record (finger pulls down -> records pull down/forward)
  const recordSensitivity = 15;
  const indexOffset = Math.round(deltaY / recordSensitivity);
  
  const count = isUserCrateViewActive ? userRecordsData.length : catalog.length;
  if (count === 0) return;

  // Allow one resting step past the end so the final sleeve can fall forward too.
  const maxVal = count;
  const newIndex = Math.max(0, Math.min(maxVal, dragStartIndex + indexOffset));

  if (isUserCrateViewActive) {
    if (newIndex !== userActiveIndex) {
      const previousIndex = userActiveIndex;
      userActiveIndex = newIndex;
      diagnostics.record('ui', 'crate_navigation', {
        source: 'human',
        view: 'my_crate',
        from_index: previousIndex,
        to_index: newIndex
      }, { snapshot: true });
      playCrateNavigationTick(newIndex > previousIndex ? 1 : -1);
      if (navigator.vibrate) {
        try { navigator.vibrate(12); } catch (e) {}
      }
      if (userIsSelected) {
        if (userActiveIndex >= count) {
          deselectRecord();
          wasDeselectedDuringDrag = true;
        } else {
          showRecordDetails(userActiveIndex);
          updateRecordHeights();
        }
      }
    }
  } else {
    if (newIndex !== activeIndex) {
      const previousIndex = activeIndex;
      activeIndex = newIndex;
      diagnostics.record('ui', 'crate_navigation', {
        source: 'human',
        view: 'shop',
        from_index: previousIndex,
        to_index: newIndex
      }, { snapshot: true });
      playCrateNavigationTick(newIndex > previousIndex ? 1 : -1);
      if (navigator.vibrate) {
        try { navigator.vibrate(12); } catch (e) {}
      }
      if (isSelected) {
        if (activeIndex >= count) {
          deselectRecord();
          wasDeselectedDuringDrag = true;
        } else {
          showRecordDetails(activeIndex);
          updateRecordHeights();
        }
      }
    }
  }
}

// UI Elements Event Listeners
function initUI() {
  installNavigationAudioUnlock();

  // Sliding Filter Switcher Event Listeners
  const latestBtn = document.getElementById('sort-latest');
  const popularBtn = document.getElementById('sort-popular');
  const filterPill = document.querySelector('.filter-switcher-pill');

  if (latestBtn && popularBtn) {
    latestBtn.addEventListener('click', () => {
      if (currentFilter === 'latest') {
        collapseFilterSwitcher();
        return;
      }
      setCatalogSort('latest');
      collapseFilterSwitcher();
    });

    popularBtn.addEventListener('click', () => {
      if (currentFilter === 'popular') {
        collapseFilterSwitcher();
        return;
      }
      setCatalogSort('popular');
      collapseFilterSwitcher();
    });
  }

  // Search Input Event Listener (Classic Input inside search-pill)
  const searchInput = document.getElementById('crate-search');
  const clearBtn = document.getElementById('search-clear');
  
  if (searchInput) {
    let debounceTimer = null;
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      currentSearchQuery = query;

      if (clearBtn) {
        if (query) {
          clearBtn.classList.remove('hidden');
        } else {
          clearBtn.classList.add('hidden');
        }
      }

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        filterAndSortCatalog();
      }, 220);
    });

    if (clearBtn) {
      clearBtn.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Keep input focused
      });
      clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        currentSearchQuery = '';
        clearBtn.classList.add('hidden');
        filterAndSortCatalog();
      });
    }
  }

  // Keyboard navigation and global preview transport. Space is intentionally
  // handled only on the page surface: native buttons/links and editable
  // fields keep their browser behavior.
  window.addEventListener('keydown', (e) => {
    hideHelper();
    const target = e.target?.nodeType === 1 ? e.target : document.activeElement;
    const activeElement = document.activeElement;
    const isEditableTarget = element => Boolean(
      element?.isContentEditable
      || element?.closest?.('input, textarea, select, [contenteditable]')
    );
    const isNativeControl = element => Boolean(
      element?.closest?.('button, a, [role="button"]')
    );
    const editable = isEditableTarget(target) || isEditableTarget(activeElement);
    const nativeControl = isNativeControl(target) || isNativeControl(activeElement);
    const isSpace = e.code === 'Space' || e.key === ' ';

    if (isSpace) {
      if (editable || nativeControl) return;
      e.preventDefault();
      if (e.repeat) return;
      diagnostics.record('input', 'space_transport', {
        action: audio.paused ? 'play' : 'pause',
        pending_playback: Boolean(pendingPlayback),
        track_id: currentPlayingTrackId,
        release_record_id: currentPlayingReleaseId
      }, { snapshot: true });
      if (pendingPlayback) {
        notifyHumanPlayerInput('keyboard_space');
        resumePendingPlayback(e);
      } else {
        notifyHumanPlayerInput('keyboard_space');
        toggleAudioPlayback('keyboard_space');
      }
      return;
    }

    if (editable) {
      if (e.key === 'Escape') {
        collapseSearch();
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      navigateCrate(-1);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      navigateCrate(1);
    } else if (e.key === 'Escape') {
      deselectRecord();
    } else if (e.key === 'Enter') {
      if (isUserCrateViewActive) {
        if (!userIsSelected) {
          selectRecord(userActiveIndex);
        } else {
          deselectRecord();
        }
      } else {
        if (!isSelected) {
          selectRecord(activeIndex);
        } else {
          deselectRecord();
        }
      }
    }
  });

  // Close Details Panel
  document.getElementById('close-details').addEventListener('click', () => {
    deselectRecord();
  });

  // Description Accordion Toggle
  const descToggleBtn = document.getElementById('desc-toggle-btn');
  const detailDesc = document.getElementById('detail-description');
  if (descToggleBtn && detailDesc) {
    descToggleBtn.addEventListener('click', () => {
      if (detailDesc.classList.contains('collapsed')) {
        detailDesc.classList.remove('collapsed');
        descToggleBtn.innerText = "READ LESS";
      } else {
        detailDesc.classList.add('collapsed');
        descToggleBtn.innerText = "READ MORE";
      }
    });
  }

  // Credits Modal Trigger
  const creditsTrigger = document.getElementById('credits-trigger');
  const creditsTriggerDesktop = document.getElementById('credits-trigger-desktop');
  const creditsPopup = document.getElementById('credits-popup');
  const closeCreditsBtn = document.getElementById('close-credits');

  const openCredits = (e) => {
    e.preventDefault();
    if (creditsPopup) creditsPopup.classList.remove('hidden');
  };

  if (creditsTrigger && creditsPopup) {
    creditsTrigger.addEventListener('click', openCredits);
  }
  if (creditsTriggerDesktop && creditsPopup) {
    creditsTriggerDesktop.addEventListener('click', openCredits);
  }

  if (closeCreditsBtn && creditsPopup) {
    closeCreditsBtn.addEventListener('click', () => {
      creditsPopup.classList.add('hidden');
    });
  }

  if (creditsPopup) {
    creditsPopup.addEventListener('click', (e) => {
      if (e.target === creditsPopup) {
        creditsPopup.classList.add('hidden');
      }
    });
  }



  // Custom Audio Player Listeners
  const playPauseBtn = document.getElementById('player-play-btn');
  if (playPauseBtn) {
    playPauseBtn.addEventListener('click', () => {
      notifyHumanPlayerInput('player_button');
      void toggleAudioPlayback('player_button');
    });
  }

  const previousTransportButton = document.getElementById('agent-orb-prev-btn');
  if (previousTransportButton) {
    previousTransportButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      notifyHumanPlayerInput('orb_previous');
      void playAdjacentPreview(-1, 'orb_previous');
    });
  }

  const nextTransportButton = document.getElementById('agent-orb-next-btn');
  if (nextTransportButton) {
    nextTransportButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      notifyHumanPlayerInput('orb_next');
      void playAdjacentPreview(1, 'orb_next');
    });
  }

  const orbPlayButton = document.getElementById('agent-mode-play-btn');
  if (orbPlayButton) {
    orbPlayButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      notifyHumanPlayerInput('orb_play_pause');
      void toggleAudioPlayback('agent_orb');
    });
  }

  const orbDiscoToggle = document.getElementById('agent-orb-disco-toggle');
  if (orbDiscoToggle) {
    orbDiscoToggle.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      setAgentOrbVisual(
        agentOrbVisualMode === 'disco_ball' ? 'cover' : 'disco_ball',
        { source: 'human_orb_control' }
      );
    });
  }

  syncAgentOrbSurface();
  installPendingPlaybackGesture();

  const handlePlayerReleaseFocus = (e) => {
    e.preventDefault();
    const recordId = e.currentTarget?.dataset.recordId
      || getCrateRecordId(findReleaseByTrackId(currentPlayingTrackId))
      || getCrateRecordId(catalog && catalog[activeIndex]);
    if (recordId) {
      focusRecordById(recordId);
    }
  };

  const playerCoverLink = document.getElementById('player-cover-link');
  const playerReleaseLink = document.getElementById('player-release-link');
  if (playerCoverLink) playerCoverLink.addEventListener('click', handlePlayerReleaseFocus);
  if (playerReleaseLink) playerReleaseLink.addEventListener('click', handlePlayerReleaseFocus);

  audio.addEventListener('timeupdate', () => {
    const fill = document.getElementById('player-progress-fill');
    const currentTimeEl = document.getElementById('player-current-time');

    if (audio.duration) {
      const pct = (audio.currentTime / audio.duration) * 100;
      if (fill) fill.style.width = `${pct}%`;
      if (currentTimeEl) currentTimeEl.innerText = formatTime(audio.currentTime);
    }
  });

  audio.addEventListener('loadedmetadata', () => {
    const totalTimeEl = document.getElementById('player-total-time');
    if (totalTimeEl) totalTimeEl.innerText = formatTime(audio.duration);
    emitPlayerState('metadata_loaded');
  });

  audio.addEventListener('ended', () => {
    setPlayerUiPlaying(false);

    // Clear active track state in lists
    if (currentPlayingTrackItem) {
      currentPlayingTrackItem.classList.remove('active');
    }

    emitPlayerState('playback_ended');

    // Auto-play next track if available
    playNextTrack();
  });

  audio.addEventListener('play', () => {
    playerError = null;
    clearPendingPlayback();
    setPlayerUiPlaying(true);
    updateTrackListIcons();
    emitPlayerState('playback_started');
  });
  audio.addEventListener('pause', () => {
    setPlayerUiPlaying(false);
    updateTrackListIcons();
    emitPlayerState('playback_paused');
  });
  audio.addEventListener('error', () => {
    clearPendingPlayback();
    playerError = {
      code: 'PREVIEW_LOAD_FAILED',
      message: 'The selected preview could not be loaded.'
    };
    setPlayerUiPlaying(false);
    updateTrackListIcons();
    emitPlayerState('preview_load_failed');
  });

  // Progress bar scrub
  const progressBar = document.getElementById('player-progress-bar');
  if (progressBar) progressBar.addEventListener('click', (e) => {
    const rect = progressBar.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const pct = clickX / width;

    if (audio.duration) seekPlayer(pct * audio.duration);
  });

  // Wheel listener for digging
  window.addEventListener('wheel', (e) => {
    // Only scroll crate if mouse is not over details panel
    if (e.target.closest('#details-panel')) return;

    // Hide instructions helper on scroll
    hideHelper();

    dragAccumulator += e.deltaY;
    if (Math.abs(dragAccumulator) >= DRAG_THRESHOLD) {
      const direction = dragAccumulator > 0 ? 1 : -1;
      navigateCrate(direction);
      dragAccumulator = 0;
    }
  }, { passive: true });

  // Mouse Dragging Event Listeners
  window.addEventListener('mousedown', (e) => {
    if (e.target.closest('#ui-overlay') || e.target.closest('#details-panel')) return;
    handleDragStart(e.clientX, e.clientY);
  });

  window.addEventListener('mousemove', (e) => {
    handleDragMove(e.clientX, e.clientY);
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
  });

  // Touch Swiping Event Listeners
  window.addEventListener('touchstart', (e) => {
    if (e.target.closest('#ui-overlay') || e.target.closest('#details-panel')) return;
    if (e.touches.length === 1) {
      handleDragStart(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1) {
      handleDragMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: true });

  window.addEventListener('touchend', () => {
    isDragging = false;
  });

  // Global click / touchstart listener to hide helper and reset inactivity timer on any interaction
  window.addEventListener('click', () => {
    hideHelper();
  }, { passive: true });

  // Expand/Collapse mobile bottom sheet drawer (supports click/tap and drag gestures)
  const detailsHandle = document.getElementById('details-handle');
  const releaseHeader = document.querySelector('.release-header');

  let sheetStartY = 0;
  let sheetHasDragged = false;
  let sheetDirection = 0; // -1 for up, 1 for down

  const handleSheetTouchStart = (e) => {
    if (e.touches.length === 1) {
      sheetStartY = e.touches[0].clientY;
      sheetHasDragged = false;
      sheetDirection = 0;
    }
  };

  const handleSheetTouchMove = (e) => {
    if (e.touches.length === 1) {
      const currentY = e.touches[0].clientY;
      const diffY = currentY - sheetStartY;
      if (Math.abs(diffY) > 10) {
        sheetHasDragged = true;
        sheetDirection = diffY > 0 ? 1 : -1;
      }
    }
  };

  const handleSheetTouchEnd = (e) => {
    if (sheetHasDragged) {
      const panel = document.getElementById('details-panel');
      if (sheetDirection === -1) {
        // Dragged UP -> Expand
        if (panel.classList.contains('show-collapsed')) {
          panel.classList.remove('show-collapsed');
          panel.classList.add('show-expanded');
        }
      } else if (sheetDirection === 1) {
        // Dragged DOWN -> Collapse or Close
        if (panel.classList.contains('show-expanded')) {
          panel.classList.remove('show-expanded');
          panel.classList.add('show-collapsed');
        } else if (panel.classList.contains('show-collapsed')) {
          deselectRecord();
        }
      }
    } else {
      // Tap trigger on mobile
      if (window.innerWidth < 1024) {
        toggleDrawerState();
      }
    }
  };

  [detailsHandle, releaseHeader].forEach(el => {
    if (el) {
      el.addEventListener('click', (e) => {
        // Fallback for desktop clicks on close/expand trigger, ignore duplicate click events on mobile
        if (window.innerWidth >= 1024) {
          toggleDrawerState();
        }
      });
      el.addEventListener('touchstart', handleSheetTouchStart, { passive: true });
      el.addEventListener('touchmove', handleSheetTouchMove, { passive: true });
      el.addEventListener('touchend', handleSheetTouchEnd);
    }
  });

  // Buy / Add to Crate action
  const buyBtn = document.getElementById('buy-btn');
  if (buyBtn) {
    buyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const slug = buyBtn.getAttribute('data-slug');
      if (!slug) return;
      
      const localCrateData = localStorage.getItem('seph_martin_crate');
      let localItems = [];
      try {
        if (localCrateData) {
          localItems = JSON.parse(localCrateData);
        }
      } catch (err) {}
      
      const idx = localItems.indexOf(slug);
      const promptEl = document.getElementById('crate-save-prompt');
      
      if (idx > -1) {
        localItems.splice(idx, 1);
        localStorage.setItem('seph_martin_crate', JSON.stringify(localItems));
        syncBuyButtonLabel(buyBtn, findMasterCatalogItem(slug), false);
        
        rebuildUserCrateRecords();
        filterAndSortCatalog();
        updateMyCrateBadge();
        
        if (currentUser) {
          checkUserSessionAndSync();
        }
      } else {
        localItems.push(slug);
        localStorage.setItem('seph_martin_crate', JSON.stringify(localItems));
        syncBuyButtonLabel(buyBtn, findMasterCatalogItem(slug), true);
        
        // Pan camera to center on user's crate
        isUserCrateViewActive = true;
        const orderedUserItems = getOrderedUserCrateSlugs({ excludeAnimating: false });
        const addedUserIndex = orderedUserItems.indexOf(slug);
        userActiveIndex = addedUserIndex > -1 ? addedUserIndex : Math.max(0, localItems.length - 1);
        globalCamXOffset = 1.3;
        const myCrateBtn = document.getElementById('view-mycrate-btn');
        if (myCrateBtn) myCrateBtn.classList.add('active');
        const shopBtn = document.getElementById('view-shop-btn');
        if (shopBtn) shopBtn.classList.remove('active');
        
        const animationStarted = triggerVinylFlyAnimation(slug, () => {
          filterAndSortCatalog(false, { preservePlayer: true });
          deselectRecord({ preservePlayer: true });
        });
        updateMyCrateBadge();

        if (!animationStarted) {
          filterAndSortCatalog(false, { preservePlayer: true });
          deselectRecord({ preservePlayer: true });
        }
        
        if (currentUser) {
          checkUserSessionAndSync();
        }
      }
    });
  }

  const shopBtn = document.getElementById('view-shop-btn');
  const myCrateBtn = document.getElementById('view-mycrate-btn');
  const viewSwitcher = document.querySelector('.view-switcher-pill');

  if (shopBtn && myCrateBtn) {
    shopBtn.addEventListener('click', () => {
      showMainCrateView();
    });

    myCrateBtn.addEventListener('click', () => {
      isUserCrateViewActive = true;
      globalCamXOffset = 1.3;
      shopBtn.classList.remove('active');
      myCrateBtn.classList.add('active');
      if (viewSwitcher) viewSwitcher.classList.add('active-mycrate');
      deselectRecord();
      updateUIControlsState();
    });
  }

  // 1. Compact Filter Icon Button Toggler
  const filterCompactBtn = document.getElementById('filter-compact-btn');
  const filterSwitcher = document.querySelector('.filter-switcher-pill');
  if (filterCompactBtn && filterSwitcher && viewSwitcher) {
    filterCompactBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isCollapsed = filterSwitcher.classList.contains('hidden');
      if (isCollapsed) {
        filterCompactBtn.classList.add('expanded');
        filterSwitcher.classList.remove('hidden');
        viewSwitcher.classList.add('hidden-by-filter');
      } else {
        collapseFilterSwitcher();
      }
    });
  }

  const searchPill = document.getElementById('search-pill-container');

  const collapseSearch = () => {
    const isMobile = window.innerWidth <= 768;
    const isCollapsible = isMobile || isUserCrateViewActive;
    if (!isCollapsible) return;

    if (searchPill && !searchPill.classList.contains('collapsed')) {
      searchPill.classList.add('collapsed');
      searchPill.classList.remove('search-active');
      const viewSwitcher = document.querySelector('.view-switcher-pill');
      if (viewSwitcher) viewSwitcher.classList.remove('hidden-by-filter');
      searchInput.blur();
      if (searchInput.value) {
        searchInput.value = '';
        currentSearchQuery = '';
        const clearBtn = document.getElementById('search-clear');
        if (clearBtn) clearBtn.classList.add('hidden');
        filterAndSortCatalog();
      }
    }
  };

  // 2. Compact Search Icon Toggler & click-outside listeners
  const searchIconBtn = document.getElementById('search-icon-btn');
  if (searchIconBtn && searchInput && searchPill) {
    // Expand or collapse search pill when clicking on it
    searchPill.addEventListener('click', (e) => {
      const isMobile = window.innerWidth <= 768;
      const isCollapsible = isMobile || isUserCrateViewActive;
      
      const isCollapsed = searchPill.classList.contains('collapsed');
      const viewSwitcher = document.querySelector('.view-switcher-pill');
      
      if (isCollapsed) {
        // Clicked anywhere on the collapsed circle -> Expand it!
        e.stopPropagation();
        searchPill.classList.remove('collapsed');
        searchPill.classList.add('search-active');
        if (viewSwitcher) viewSwitcher.classList.add('hidden-by-filter');
        searchInput.focus();
      } else if (isCollapsible && e.target !== searchInput && !searchInput.contains(e.target) && e.target.id !== 'search-clear') {
        // Clicked anywhere on the expanded container except input/clear -> Collapse it!
        e.stopPropagation();
        collapseSearch();
      }
    });

    // Global listener to collapse search when clicking outside
    document.addEventListener('click', (e) => {
      if (searchPill && !searchPill.classList.contains('collapsed')) {
        if (!searchPill.contains(e.target)) {
          collapseSearch();
        }
      }
    });
  }

  // 3. Checkout Button Action (Cart checkout endpoint integration). Both
  // visible entry points delegate to this one path so the sidebar cannot
  // create a different request or a duplicate checkout session.
  const checkoutBtn = document.getElementById('checkout-btn');
  const panelCheckoutBtn = document.getElementById('panel-checkout-btn');
  const checkoutTriggers = [checkoutBtn, panelCheckoutBtn].filter(Boolean);
  const checkoutDefaultContent = new Map(
    checkoutTriggers.map(button => [button, button.innerHTML])
  );

  const handleCheckout = async triggerButton => {
    if (checkoutInFlight) {
      return {
        ok: false,
        error: { code: 'CHECKOUT_IN_FLIGHT', message: 'A checkout request is already in progress.' }
      };
    }

    const localItems = readLocalCrateItems();
    const validItems = localItems.map(findMasterCatalogItem).filter(Boolean);
    if (validItems.length === 0) {
      updateUIControlsState();
      return;
    }

    const isDemoBoundaryAction = isDemoCheckoutSimulatorEnabled()
      && triggerButton?.dataset.demoDownload === 'true';
    if (isDemoBoundaryAction) {
      const activeDemoItem = getActiveUserCrateItem();
      const activeDemoPurchase = activeDemoItem ? getDemoPurchaseForRecord(activeDemoItem) : null;
      if (!activeDemoItem || !activeDemoPurchase) {
        return {
          ok: false,
          error: {
            code: 'DEMO_DOWNLOAD_UNAVAILABLE',
            message: 'Select a purchased release before reaching the demo boundary.'
          }
        };
      }
      return {
        ...completeDemoReleasePreview(activeDemoItem, { source: 'human' }),
        checkout_started: false,
        purchase_started: false,
        checkout_surface: 'demo_simulator'
      };
    }

    if (isDemoCheckoutSimulatorEnabled()) {
      const opened = openDemoCheckoutModal(validItems);
      if (!opened) {
        return {
          ok: false,
          error: { code: 'DEMO_CHECKOUT_UNAVAILABLE', message: 'The demo checkout surface is unavailable.' }
        };
      }
      const summary = getCheckoutSummary();
      return {
        ok: true,
        status: 'demo_checkout_opened',
        checkout_started: true,
        purchase_started: false,
        human_confirmation_required: true,
        checkout_surface: 'demo_simulator',
        cart_count: summary.cart_count,
        total_cents: summary.total_cents,
        next_step: 'Confirm the demo purchase in the on-site checkout simulator.'
      };
    }

    checkoutInFlight = true;
    checkoutTriggers.forEach(button => {
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
    });
    const originalContent = checkoutDefaultContent.get(triggerButton) || triggerButton.innerHTML;
    triggerButton.innerText = "PREPARING...";

    try {
      let sumCents = 0;
      const cartLines = [];
      const titles = [];
      validItems.forEach(item => {
        titles.push(item.title);
        const digits = item.price_text.replace(/[^\d.,]/g, '').replace(',', '.');
        const price = parseFloat(digits);
        const priceCents = isFinite(price) ? Math.round(price * 100) : 0;
        sumCents += priceCents;

        cartLines.push({
          // The Crate sells complete releases. Per-track lines belong to the legacy shop.
          type: "product",
          slug: item.slug,
          qty: 1
        });
      });

      const firstItem = validItems[0];
      const validSlugs = validItems.map(getCatalogProductSlug);
      const baseSlug = getCatalogProductSlug(firstItem) || validSlugs[0];

      const overlayEnabled = isLemonOverlayEnabled();
      const checkoutTheme = overlayEnabled ? getResolvedTheme() : '';

      const params = new URLSearchParams();
      params.set('slug', baseSlug);
      params.set('cart_items', String(validItems.length));
      params.set('cart_total_cents', String(sumCents));
      params.set('cart_slugs', validSlugs.join(','));
      params.set('cart_lines', JSON.stringify(cartLines));
      params.set('return_to', '/');
      if (overlayEnabled) {
        params.set('embed', '1');
        params.set('checkout_theme', checkoutTheme);
      }

      const customName = (titles.length > 1 ? `Crate: ${titles.join(', ')}` : (firstItem ? firstItem.title : '')).slice(0, 140);
      if (customName) {
        params.set('custom_name', customName);
      }

      const res = await fetch(`/api/lemon-checkout?${params.toString()}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();

      if (data && data.url) {
        // Analytics must never hold the user on the crate after the checkout
        // session is ready. Keep it best-effort and let the browser carry it
        // in the background while the redirect starts immediately.
        fetch('/api/analytics-event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: overlayEnabled ? 'checkout_overlay_requested' : 'checkout_redirect',
            session_id: localStorage.getItem('seph_martin_session') || '',
            item_slug: baseSlug
          }),
          keepalive: true
        }).catch(() => {});

        pauseAudio();

        if (overlayEnabled) {
          try {
            const opened = await openLemonOverlay(data.url, {
              onClose: () => {
                checkoutInFlight = false;
                checkoutTriggers.forEach(button => {
                  const defaultContent = checkoutDefaultContent.get(button);
                  if (defaultContent) button.innerHTML = defaultContent;
                  button.disabled = false;
                  button.removeAttribute('aria-disabled');
                });
                updateUIControlsState();
                diagnostics.record('ui', 'checkout_overlay_closed', {
                  cart_count: validItems.length,
                  total_cents: sumCents
                }, { snapshot: true });
              },
              onSuccess: (eventData) => {
                diagnostics.record('ui', 'checkout_overlay_success', {
                  cart_count: validItems.length,
                  total_cents: sumCents,
                  event_data: eventData
                }, { snapshot: true });
              }
            });

            if (opened) {
              diagnostics.record('ui', 'checkout_overlay_opened', {
                source: triggerButton.id,
                cart_count: validItems.length,
                total_cents: sumCents,
                theme: checkoutTheme,
                destination: 'lemon_overlay'
              }, { snapshot: true });
              return {
                ok: true,
                status: 'overlay_opened',
                checkout_started: true,
                purchase_started: false,
                cart_count: validItems.length,
                total_cents: sumCents,
                checkout_theme: checkoutTheme
              };
            }
          } catch (overlayErr) {
            console.warn("Lemon overlay open failed, falling back to hosted redirect:", overlayErr);
            diagnostics.record('ui', 'checkout_overlay_fallback_redirect', {
              reason: String(overlayErr?.message || overlayErr)
            });
          }
        }

        diagnostics.record('ui', 'checkout_redirect_started', {
          source: triggerButton.id,
          cart_count: validItems.length,
          total_cents: sumCents,
          destination: 'lemon_checkout'
        }, { snapshot: true });
        window.location.href = data.url;
        return {
          ok: true,
          status: 'redirecting',
          checkout_started: true,
          purchase_started: false,
          cart_count: validItems.length,
          total_cents: sumCents
        };
      } else {
        throw new Error("Invalid response payload");
      }
    } catch (err) {
      console.error("Checkout failed:", err);
      showTopErrorNotification(`CHECKOUT ERROR: ${err.message || 'Please try again.'}`);
      triggerButton.innerHTML = originalContent;
      checkoutInFlight = false;
      updateUIControlsState();
      return {
        ok: false,
        error: { code: 'CHECKOUT_FAILED', message: String(err?.message || 'Please try again.') }
      };
    }
  };

  checkoutTriggers.forEach(button => {
    button.addEventListener('click', () => {
      const summary = getCheckoutSummary();
      diagnostics.record('ui', 'checkout_trigger_clicked', {
        source: button.id,
        cart_count: summary.cart_count,
        total_cents: summary.total_cents
      }, { snapshot: true });
      void handleCheckout(button);
    });
  });

  // Handle browser back-forward cache pageshow reload to restore checkout button state
  window.addEventListener('pageshow', (event) => {
    checkoutInFlight = false;
    checkoutTriggers.forEach(button => {
      const defaultContent = checkoutDefaultContent.get(button);
      if (defaultContent && button.innerHTML !== defaultContent) button.innerHTML = defaultContent;
    });
    updateUIControlsState();
  });

  function showTopErrorNotification(message) {
    let container = document.getElementById('top-error-notification');
    if (!container) {
      container = document.createElement('div');
      container.id = 'top-error-notification';
      container.style.position = 'fixed';
      container.style.top = '0';
      container.style.left = '0';
      container.style.right = '0';
      container.style.background = 'rgba(255, 0, 85, 0.95)';
      container.style.color = '#ffffff';
      container.style.textAlign = 'center';
      container.style.padding = '12px 24px';
      container.style.fontSize = '14px';
      container.style.fontFamily = 'monospace';
      container.style.zIndex = '99999';
      container.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
      container.style.backdropFilter = 'blur(8px)';
      container.style.transition = 'transform 0.3s ease';
      container.style.transform = 'translateY(-100%)';
      document.body.appendChild(container);
    }
    container.innerText = message;
    container.style.display = 'block';
    container.offsetHeight; // Force reflow
    container.style.transform = 'translateY(0)';
    setTimeout(() => {
      container.style.transform = 'translateY(-100%)';
    }, 5000);
  }

  updateMyCrateBadge();

  // Initialize auth UI action listeners
  initAuthUI();
  initDemoCheckoutUI();
}

// Toggles between collapsed and expanded drawer state on mobile viewport
function toggleDrawerState() {
  const panel = document.getElementById('details-panel');
  if (panel.classList.contains('show-collapsed')) {
    panel.classList.remove('show-collapsed');
    panel.classList.add('show-expanded');
  } else if (panel.classList.contains('show-expanded')) {
    panel.classList.remove('show-expanded');
    panel.classList.add('show-collapsed');
  }
}

let inactivityTimer = null;
const INACTIVITY_DELAY = 12000; // 12 seconds of inactivity

function showHelper() {
  const helper = document.getElementById('interaction-helper');
  if (agentVisualState !== 'human' && agentVisualState !== 'override') {
    if (helper) helper.classList.add('fade-out');
    return;
  }
  const detailsPanel = document.getElementById('details-panel');
  const detailsOpen = detailsPanel && !detailsPanel.classList.contains('hidden');
  const currentlySelected = isUserCrateViewActive ? userIsSelected : isSelected;

  if (helper && !currentlySelected && !detailsOpen) {
    helper.classList.remove('fade-out');
  }
}

function resetInactivityTimer() {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }

  if (agentVisualState !== 'human' && agentVisualState !== 'override') return;
  
  const detailsPanel = document.getElementById('details-panel');
  const detailsOpen = detailsPanel && !detailsPanel.classList.contains('hidden');
  const currentlySelected = isUserCrateViewActive ? userIsSelected : isSelected;

  if (!currentlySelected && !detailsOpen) {
    inactivityTimer = setTimeout(showHelper, INACTIVITY_DELAY);
  }
}

function hideHelper() {
  hasInteracted = true;
  const helper = document.getElementById('interaction-helper');
  if (helper) {
    helper.classList.add('fade-out');
  }
  resetInactivityTimer();
}

// 3D Scene Initialization
function initThree() {
  const container = document.getElementById('canvas-container');

  scene = new THREE.Scene();

  // Charcoal grey background to create contrast with the dark MDF crate box
  scene.background = new THREE.Color(0x0c0c0e);
  scene.fog = new THREE.FogExp2(0x0c0c0e, 0.35);

  // Responsive camera setup
  camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 10);

  // Position camera dynamically based on aspect ratio
  updateCameraPosition();

  // WebGL Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);

  // Textures
  textureLoader = new THREE.TextureLoader();

  // Raycasting for clicking
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  // Direct interaction listeners on WebGL canvas to bypass Safari mobile click bugs
  renderer.domElement.addEventListener('click', onCanvasClick);
  renderer.domElement.addEventListener('touchend', onCanvasTouchEnd);

  // Lighting
  // Slightly higher ambient/hemi fill lights for clean cardboard render
  ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
  scene.add(ambientLight);

  hemiLight = new THREE.HemisphereLight(0xffffff, 0x111122, 0.55);
  scene.add(hemiLight);

  // Key directional light casting shadows (positioned to hit front/right wall edges)
  dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
  dirLight.position.set(0.0, 1.7, 0.85);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048; // sharper shadows
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.bias = -0.001;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 4;
  dirLight.shadow.camera.left = -0.4;
  dirLight.shadow.camera.right = 0.4;
  dirLight.shadow.camera.top = 0.4;
  dirLight.shadow.camera.bottom = -0.4;
  scene.add(dirLight);
  scene.add(dirLight.target);

  // Spotlight (warm white/yellow) to highlight the active vinyl cover in their true colors
  spotLight = new THREE.SpotLight(0xfffaed, 2.5, 5, Math.PI / 3.2, 0.3, 1);
  spotLight.position.set(0.0, 1.6, 1.0);
  spotLight.target.position.set(0, 0.1, 0);
  scene.add(spotLight);
  scene.add(spotLight.target);

  // Sync lighting and background with prefers-color-scheme
  syncThemeWithBrowser();

  // Responsive resizing
  window.addEventListener('resize', onWindowResize);
}

function syncThemeWithBrowser() {
  if (!scene) return;
  const isLightMode = getResolvedTheme() === 'light';
  const isMobile = window.innerWidth < 1024;
  syncAgentCrateAuraTheme(isLightMode);

  if (isLightMode) {
    const lightColor = new THREE.Color(0xf5f5f7);
    scene.background = lightColor;
    if (scene.fog) {
      scene.fog.color = lightColor;
      scene.fog.density = 0.05; // Drastically reduced from 0.35 to eliminate milky satin fog patina
    }
    if (ambientLight) ambientLight.intensity = isMobile ? 0.42 : 0.48;
    if (hemiLight) {
      hemiLight.intensity = isMobile ? 0.38 : 0.42;
      hemiLight.color.setHex(0xffffff);
      hemiLight.groundColor.setHex(0xbbbbbb);
    }
    if (dirLight) dirLight.intensity = isMobile ? 1.2 : 1.4;
    baseSpotLightIntensity = isMobile ? 1.5 : 1.8;
    if (spotLight) spotLight.intensity = baseSpotLightIntensity;
    if (floor) floor.material.color.setHex(0xf5f5f7);
    if (woodMaterial) {
      woodMaterial.color.setHex(0x24242a); // Keep dark charcoal MDF crate
      woodMaterial.roughness = 0.55;
      woodMaterial.metalness = 0.15;
    }
  } else {
    const darkColor = new THREE.Color(0x0c0c0e);
    scene.background = darkColor;
    if (scene.fog) {
      scene.fog.color = darkColor;
      scene.fog.density = 0.35;
    }
    if (ambientLight) ambientLight.intensity = 0.45;
    if (hemiLight) {
      hemiLight.intensity = 0.55;
      hemiLight.color.setHex(0xffffff);
      hemiLight.groundColor.setHex(0x111122);
    }
    if (dirLight) dirLight.intensity = 1.6;
    baseSpotLightIntensity = 2.5;
    if (spotLight) spotLight.intensity = baseSpotLightIntensity;
    if (floor) floor.material.color.setHex(0x070709);
    if (woodMaterial) {
      woodMaterial.color.setHex(0x24242a); // Charcoal dark MDF in Dark Mode
      woodMaterial.roughness = 0.55;
      woodMaterial.metalness = 0.15;
    }
  }
}

function updateCameraPosition() {
  const container = document.getElementById('canvas-container');
  const aspect = container.clientWidth / container.clientHeight;

  let camY, camZ;
  if (aspect < 1.0) {
    // Portrait mobile: scale camera position to fit the 36cm crate width
    const scale = Math.max(1.0, Math.min(2.2, 0.82 / aspect));
    camY = 0.36 * scale;
    camZ = 0.56 * scale;
  } else {
    // Desktop landscape: pull back slightly to prevent top record clipping when raised
    camY = 0.42;
    camZ = 0.64;
  }

  camera.position.set(currentCamX, camY, camZ);
  // Center the view on the current active crate by matching camera focus to currentCamX
  camera.lookAt(currentCamX, -0.07, 0);
}

function syncAgentCrateFrame() {
  const container = document.getElementById('canvas-container');
  const frame = document.getElementById('agent-crate-frame');
  const path = frame?.querySelector('path');
  const activeGroup = isUserCrateViewActive ? userCrateGroup : crateGroup;
  if (!container || !frame || !path || !activeGroup || !camera) return;

  const width = container.clientWidth;
  const height = container.clientHeight;
  if (width <= 0 || height <= 0) return;

  const viewBox = `0 0 ${width} ${height}`;
  if (viewBox !== agentFrameViewBox) {
    frame.setAttribute('viewBox', viewBox);
    agentFrameViewBox = viewBox;
  }

  activeGroup.updateWorldMatrix(true, false);
  camera.updateMatrixWorld();
  const projected = AGENT_CRATE_FRAME_POINTS.map(([x, y, z]) => {
    agentFrameProjection.set(x, y, z);
    activeGroup.localToWorld(agentFrameProjection);
    agentFrameProjection.project(camera);
    return {
      x: (agentFrameProjection.x * 0.5 + 0.5) * width,
      y: (-agentFrameProjection.y * 0.5 + 0.5) * height
    };
  });

  if (projected.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return;

  path.setAttribute('d', projected.map((point, index) => {
    const command = index === 0 ? 'M' : 'L';
    return `${command} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }).join(' ') + ' Z');
  frame.dataset.crateView = isUserCrateViewActive ? 'my-crate' : 'shop';
}

function getAgentAuraTexture() {
  if (agentAuraTexture) return agentAuraTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(128, 230, 154, 0.95)');
  gradient.addColorStop(0.3, 'rgba(128, 230, 154, 0.58)');
  gradient.addColorStop(0.6, 'rgba(128, 230, 154, 0.18)');
  gradient.addColorStop(0.85, 'rgba(128, 230, 154, 0.03)');
  gradient.addColorStop(1, 'rgba(128, 230, 154, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  agentAuraTexture = new THREE.CanvasTexture(canvas);
  return agentAuraTexture;
}

function createAgentCrateAura(group) {
  if (!group) return;
  const texture = getAgentAuraTexture();
  const geometry = new THREE.PlaneGeometry(0.78, 0.78);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: 0x80e69a,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  const auraPlane = new THREE.Mesh(geometry, material);
  auraPlane.rotation.x = -Math.PI / 2;
  // Placed at the crate base to provide a soft aura attached to the 3D crate without clipping sleeves
  auraPlane.position.set(0, -0.164, 0);
  auraPlane.renderOrder = 1;
  auraPlane.frustumCulled = false;
  auraPlane.visible = false;
  group.add(auraPlane);
  agentCrateAuraInstances.push({ group, mesh: auraPlane, material });
}

function syncAgentCrateAura(now = performance.now(), reducedMotion = false) {
  const activeStates = ['loading', 'active', 'busy', 'standby', 'returning'];
  const isActive = activeStates.includes(agentVisualState);
  const activeGroup = isUserCrateViewActive ? userCrateGroup : crateGroup;
  const pulse = reducedMotion ? 1 : 0.5 + (Math.sin(now * 0.00065) * 0.5 + 0.5) * 0.5;

  agentCrateAuraInstances.forEach(({ group, mesh, material }) => {
    const visible = isActive && group === activeGroup;
    mesh.visible = visible;
    if (!visible) return;

    const busyBoost = agentVisualState === 'busy' ? 1.12 : 1;
    material.opacity = (0.22 + pulse * 0.12) * busyBoost;
  });
}

function syncAgentCrateAuraTheme(isLightMode) {
  const color = isLightMode ? 0x1f7f3a : 0x80e69a;
  agentCrateAuraInstances.forEach(({ material }) => {
    material.color.setHex(color);
  });
}

function onWindowResize() {
  const container = document.getElementById('canvas-container');
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
  updateCameraPosition();
  syncAgentCrateFrame();
  syncAgentCrateAura();
  syncThemeWithBrowser();
  resizeAgentOrbDiscoScene();
}

function createStickyNoteTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // Bright post-it yellow
  ctx.fillStyle = '#fff48f';
  ctx.fillRect(0, 0, 512, 512);

  // Shadowed/curled bottom edge effect to look like paper
  ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
  ctx.fillRect(0, 480, 512, 32);

  // Center alignment for all text elements
  ctx.textAlign = 'center';

  // Premium Monospace style text (matches Space Mono loaded on page)
  ctx.fillStyle = '#1c1c24';
  ctx.font = '700 38px "Space Mono", monospace';
  ctx.fillText('DIGGERS ONLY', 256, 150);

  ctx.fillStyle = '#d62828'; // Red ink
  ctx.font = '700 68px "Space Mono", monospace';
  ctx.fillText('DIGGER20', 256, 265);

  ctx.fillStyle = '#2b2b35';
  ctx.font = '700 36px "Space Mono", monospace';
  ctx.fillText('20% OFF SHOP', 256, 370);

  ctx.fillStyle = '#777777';
  ctx.font = '700 24px "Space Mono", monospace';
  ctx.fillText('[ CLICK TO ZOOM ]', 256, 425);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

// Build the physical crate box (Schallplattenturm Top Crate)
function buildCrate() {
  crateGroup = new THREE.Group();
  scene.add(crateGroup);

  userCrateGroup = new THREE.Group();
  userCrateGroup.position.set(1.3, -0.05, 0); // Position user crate to the right
  scene.add(userCrateGroup);

  // MDF Material: Dark charcoal MDF crate box
  woodMaterial = new THREE.MeshStandardMaterial({
    color: 0x24242a,
    roughness: 0.55,
    metalness: 0.15
  });

  const wallThickness = 0.015; // 15mm MDF
  const crateWidth = 0.36;     // 36cm outer
  const crateDepth = 0.36;     // 36cm outer
  const backHeight = 0.270;

  const createCrateBox = (group, isMain = true) => {
    // Bottom board (36 x 36 x 1.5 cm)
    const bottomGeo = new THREE.BoxGeometry(crateWidth, wallThickness, crateDepth);
    const bottom = new THREE.Mesh(bottomGeo, woodMaterial);
    bottom.position.y = -0.15 - (wallThickness / 2);
    bottom.receiveShadow = true;
    group.add(bottom);

    if (isMain) {
      // Handwritten Sticky Note on the Back Wall (Spalla)
      const stickyWidth = 0.07;
      const stickyHeight = 0.07;
      const stickyGeo = new THREE.PlaneGeometry(stickyWidth, stickyHeight);
      const stickyMat = new THREE.MeshBasicMaterial({
        map: createStickyNoteTexture(),
        side: THREE.DoubleSide
      });
      stickyNoteMesh = new THREE.Mesh(stickyGeo, stickyMat);
      stickyNoteMesh.position.set(0, backHeight - 0.15 - 0.05, -(crateDepth / 2) + wallThickness + 0.001);
      stickyNoteMesh.rotation.z = 0.03;
      group.add(stickyNoteMesh);
    }

    // Back board (36 x 22.0 x 1.5 cm)
    const backGeo = new THREE.BoxGeometry(crateWidth, backHeight, wallThickness);
    const backWall = new THREE.Mesh(backGeo, woodMaterial);
    backWall.position.set(0, (backHeight / 2) - 0.15, -(crateDepth / 2) + (wallThickness / 2));
    backWall.castShadow = true;
    backWall.receiveShadow = true;
    group.add(backWall);

    // Front board (36 x 15 x 1.5 cm) - Slanted lower side
    const frontHeight = 0.15;
    const frontGeo = new THREE.BoxGeometry(crateWidth, frontHeight, wallThickness);
    const frontWall = new THREE.Mesh(frontGeo, woodMaterial);
    frontWall.position.set(0, (frontHeight / 2) - 0.15, (crateDepth / 2) - (wallThickness / 2));
    frontWall.castShadow = true;
    frontWall.receiveShadow = true;
    group.add(frontWall);

    // Slanted Left & Right Boards (Trapezoids)
    const shape = new THREE.Shape();
    const halfDepth = crateDepth / 2;
    shape.moveTo(-halfDepth, 0);
    shape.lineTo(halfDepth, 0);
    shape.lineTo(halfDepth, frontHeight);
    shape.lineTo(-halfDepth, backHeight);
    shape.closePath();

    const extrudeSettings = {
      depth: wallThickness,
      bevelEnabled: false
    };

    const sideGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    sideGeo.translate(0, -0.15, 0);

    // Left Wall
    const leftWall = new THREE.Mesh(sideGeo, woodMaterial);
    leftWall.rotation.y = -Math.PI / 2;
    leftWall.position.set(-(crateWidth / 2) + wallThickness, 0, 0);
    leftWall.castShadow = true;
    leftWall.receiveShadow = true;
    group.add(leftWall);

    // Right Wall
    const rightWall = new THREE.Mesh(sideGeo, woodMaterial);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.set((crateWidth / 2), 0, 0);
    rightWall.castShadow = true;
    rightWall.receiveShadow = true;
    group.add(rightWall);
  };

  createCrateBox(crateGroup, true);
  createCrateBox(userCrateGroup, false);
  createAgentCrateAura(crateGroup);
  createAgentCrateAura(userCrateGroup);

  // 0. Add a dark floor plane to receive shadows and ground the crate in space
  const floorGeo = new THREE.PlaneGeometry(10, 5); // Expanded width to fit both crates
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x070709,
    roughness: 0.85,
    metalness: 0.0
  });
  floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.15 - wallThickness - 0.05 - 0.005;
  floor.receiveShadow = true;
  scene.add(floor);

  crateGroup.position.y = -0.05;
  syncThemeWithBrowser();
}

// Generates a procedural fibrous paper/cardboard edge texture for sleeve sides
function createCardboardEdgeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  // Base color is off-white (so it can be tinted by the edge material color multiplication)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 128, 128);

  // Draw soft, blurry horizontal paper fibers to avoid sharp aliasing bands
  for (let i = 0; i < 15; i++) {
    const y = Math.random() * 128;
    const h = 1 + Math.random() * 3;
    const opacity = 0.04 + Math.random() * 0.06;
    ctx.fillStyle = `rgba(0, 0, 0, ${opacity})`;
    ctx.fillRect(0, y, 128, h);
  }

  // Draw a few subtle white scuffs (exposed raw paper fibers / edge wear)
  for (let i = 0; i < 8; i++) {
    const y = Math.random() * 128;
    const h = 1 + Math.random() * 2;
    const opacity = 0.1 + Math.random() * 0.15;
    ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
    ctx.fillRect(0, y, 128, h);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 1); // low repeat to avoid tiling artifacts

  // Explicitly generate mipmaps and use LinearMipmapLinearFilter to eliminate Moire/pixelation at distance
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

// Build the vinyl sleeves dynamically from catalog
// Helper to extract border color directly from loaded cover texture
function applyBorderColorFromTexture(texture, rightMat, leftMat, topMat, bottomMat) {
  try {
    const img = texture.image;
    if (img) {
      const w = img.naturalWidth || img.width || 300;
      const h = img.naturalHeight || img.height || 300;

      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d');

      // Sample top 5% slice for topMat at full scale (1.0) so top edge matches cover seamless
      ctx.drawImage(img, 0, 0, w, Math.max(1, Math.floor(h * 0.05)), 0, 0, 1, 1);
      const topData = ctx.getImageData(0, 0, 1, 1).data;
      topMat.color.setRGB(topData[0] / 255, topData[1] / 255, topData[2] / 255);

      // Sample general cover average for side/bottom edges
      ctx.drawImage(img, 0, 0, w, h, 0, 0, 1, 1);
      const data = ctx.getImageData(0, 0, 1, 1).data;
      const r = data[0] / 255;
      const g = data[1] / 255;
      const b = data[2] / 255;
      const scale = 0.75;
      rightMat.color.setRGB(r * scale, g * scale, b * scale);
      leftMat.color.setRGB(r * scale, g * scale, b * scale);
      bottomMat.color.setRGB(r * scale, g * scale, b * scale);
    }
  } catch (err) {
    console.warn('Could not extract average color for record edge', err);
  }
}

// Build the vinyl sleeves dynamically from catalog
function buildRecords() {
  return new Promise((resolve, reject) => {
    const count = catalog.length;
    const edgeTexture = createCardboardEdgeTexture();

    // Vinyl constraints
    const H = 0.31; // height (31cm sleeve)
    const W = 0.315; // width (31.5cm sleeve)
    const T = 0.0022; // thickness (2.2mm sleeve)

    const startZ = -0.125;
    const endZ = 0.08;
    const rangeZ = endZ - startZ;

    const spacing = count > 1 ? Math.min(0.015, rangeZ / (count - 1)) : 0;
    const actualZOffset = count > 1 ? Math.max(0, (rangeZ - (spacing * (count - 1))) / 2) : 0;

    const sleeveGeo = new THREE.BoxGeometry(W, H, T);

    const backSleeveMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.85,
      metalness: 0.05
    });

    const priorityLimit = Math.min(4, count);
    let priorityLoaded = 0;

    // Set initial 15% progress for immediate visual feedback
    const fgLogo = document.querySelector('.loader-fg-logo');
    if (fgLogo) {
      fgLogo.style.clipPath = 'inset(0 85% 0 0)';
    }

    const checkPriorityResolve = () => {
      priorityLoaded++;
      const basePct = 15;
      const remainingPct = 100 - basePct;
      const pct = basePct + (priorityLoaded / priorityLimit) * remainingPct;

      const fgLogo = document.querySelector('.loader-fg-logo');
      if (fgLogo) {
        fgLogo.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
      }
      if (priorityLoaded >= priorityLimit) {
        resolve();
      }
    };

    if (count === 0) {
      if (fgLogo) fgLogo.style.clipPath = 'inset(0 0 0 0)';
      resolve();
      return;
    }

    for (let i = 0; i < count; i++) {
      const item = catalog[i];

      const frontMaterial = new THREE.MeshStandardMaterial({
        color: i < priorityLimit ? 0xffffff : 0x111111, // dark placeholder for background ones
        roughness: 0.5,
        metalness: 0.05
      });

      const rightMat = new THREE.MeshStandardMaterial({
        color: 0x333333,
        map: edgeTexture,
        bumpMap: edgeTexture,
        bumpScale: 0.0012,
        roughness: 0.95,
        metalness: 0.0
      });
      const leftMat = new THREE.MeshStandardMaterial({
        color: 0x333333,
        map: edgeTexture,
        bumpMap: edgeTexture,
        bumpScale: 0.0012,
        roughness: 0.95,
        metalness: 0.0
      });
      const topMat = new THREE.MeshStandardMaterial({
        color: 0x333333,
        map: edgeTexture,
        bumpMap: edgeTexture,
        bumpScale: 0.0012,
        roughness: 0.95,
        metalness: 0.0
      });
      const bottomMat = new THREE.MeshStandardMaterial({
        color: 0x333333,
        map: edgeTexture,
        bumpMap: edgeTexture,
        bumpScale: 0.0012,
        roughness: 0.95,
        metalness: 0.0
      });

      const materials = [
        rightMat,
        leftMat,
        topMat,
        bottomMat,
        frontMaterial,
        backSleeveMaterial
      ];

      const sleeveMesh = new THREE.Mesh(sleeveGeo, materials);
      sleeveMesh.castShadow = true;
      sleeveMesh.receiveShadow = true;
      sleeveMesh.userData = { index: i };

      const baseZ = endZ - actualZOffset - (i * spacing);
      sleeveMesh.position.set(0, -0.15 + (H / 2), baseZ);

      // Hide non-priority meshes initially to make them cascade in nicely later
      if (i >= priorityLimit) {
        sleeveMesh.visible = false;
      }

      crateGroup.add(sleeveMesh);

      recordsData.push({
        mesh: sleeveMesh,
        recordId: getCrateRecordId(item),
        stackIndex: i,
        baseZ: baseZ,
        currentYOffset: 0,
        targetYOffset: 0,
        currentRotX: -0.20,
        targetRotX: -0.20
      });

      // Only load priority covers immediately
      if (i < priorityLimit) {
        const imageUrl = resolveCatalogImageUrl(item.image);
        const isExternal = isCrossOriginCatalogImage(imageUrl);

        textureLoader.crossOrigin = isExternal ? 'anonymous' : '';
        textureLoader.load(imageUrl, (texture) => {
          textureCache.set(imageUrl, texture);
          texture.colorSpace = THREE.SRGBColorSpace;
          if (renderer) {
            texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
          }
          frontMaterial.map = texture;
          frontMaterial.needsUpdate = true;

          applyBorderColorFromTexture(texture, rightMat, leftMat, topMat, bottomMat);
          checkPriorityResolve();
        }, undefined, (err) => {
          console.error('Priority texture load failed:', imageUrl, err);
          checkPriorityResolve(); // Resolve anyway to prevent loader blocking
        });
      }
    }
  });
}

// Staggered load and cascade animation for the remaining records
function startStaggeredLoading() {
  const count = catalog.length;
  if (count <= 4) return;

  for (let i = 4; i < count; i++) {
    const item = catalog[i];
    const rec = recordsData[i];
    const delay = (i - 4) * 45; // 45ms cascade step for organic tempo

    setTimeout(() => {
      const imageUrl = resolveCatalogImageUrl(item.image);
      const isExternal = isCrossOriginCatalogImage(imageUrl);

      textureLoader.crossOrigin = isExternal ? 'anonymous' : '';
      textureLoader.load(imageUrl, (texture) => {
        textureCache.set(imageUrl, texture);
        texture.colorSpace = THREE.SRGBColorSpace;
        if (renderer) {
          texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        }

        const frontMat = rec.mesh.material[4];
        frontMat.color.setHex(0xffffff); // Restore full color visibility
        frontMat.map = texture;
        frontMat.needsUpdate = true;

        applyBorderColorFromTexture(
          texture,
          rec.mesh.material[0],
          rec.mesh.material[1],
          rec.mesh.material[2],
          rec.mesh.material[3]
        );

        // Make visible and cascade from the top
        rec.mesh.visible = true;
        rec.currentYOffset = 0.5; // Starts 50cm above resting height
      }, undefined, (err) => {
        console.error('Staggered texture load failed for:', imageUrl, err);
        // Fallback: make visible as grey sleeve anyway
        rec.mesh.visible = true;
        rec.currentYOffset = 0.5;
      });
    }, delay);
  }
}

// Helper to update record mesh heights based on selection state
function updateRecordHeights() {
  const agentPreviewActive = isAgentNavigationPreviewActive();
  recordsData.forEach((rec, idx) => {
    if (agentPreviewActive && idx === agentDigPreviewIndex) {
      rec.targetYOffset = 0.12;
      rec.targetRotX = 0;
    } else if (isSelected && idx === activeIndex && !isUserCrateViewActive) {
      rec.targetYOffset = 0.12; // Raise active record
      rec.targetRotX = 0;       // Face vertically straight
    } else {
      rec.targetYOffset = 0;    // Rest of records stay down
    }
  });

  userRecordsData.forEach((rec, idx) => {
    if (userIsSelected && idx === userActiveIndex && isUserCrateViewActive) {
      rec.targetYOffset = 0.12; // Raise active user record
      rec.targetRotX = 0;
    } else {
      rec.targetYOffset = 0;
    }
  });
}

function getActiveShopStackIndex() {
  const activeItem = catalog[activeIndex];
  const activeRecordId = activeItem ? getCrateRecordId(activeItem) : '';
  const stackIndex = getRecordStackIndex(activeRecordId);
  return stackIndex >= 0 ? stackIndex : activeIndex;
}

function stopAgentDigPreview({ restore = true } = {}) {
  const previewIndex = agentDigPreviewIndex;
  const snapshot = agentDigPreviewSnapshot;
  const focusChanged = snapshot && agentFocusRevision !== snapshot.focusRevision;
  agentDigPreviewToken += 1;
  if (agentDigPreviewTimer) window.clearTimeout(agentDigPreviewTimer);
  agentDigPreviewTimer = null;
  agentDigPreviewIndex = -1;
  delete document.documentElement.dataset.agentDigPreviewIndex;
  agentDigPreviewSnapshot = null;

  // If a dig is interrupted or returns no matches, do not leave the crate and
  // Song sidebar parked on an arbitrary preview sleeve. A successful focus
  // changes the agent focus set and intentionally keeps the final selection.
  if (restore && snapshot && previewIndex >= 0 && !focusChanged) {
    if (snapshot.isUserCrateViewActive) {
      isUserCrateViewActive = true;
      globalCamXOffset = 1.3;
      const shopBtn = document.getElementById('view-shop-btn');
      const myCrateBtn = document.getElementById('view-mycrate-btn');
      if (shopBtn) shopBtn.classList.remove('active');
      if (myCrateBtn) myCrateBtn.classList.add('active');
      userActiveIndex = snapshot.userActiveIndex;
      userIsSelected = snapshot.userIsSelected;
      if (userIsSelected) showRecordDetails(userActiveIndex);
      else deselectRecord();
    } else {
      isUserCrateViewActive = false;
      globalCamXOffset = 0;
      const shopBtn = document.getElementById('view-shop-btn');
      const myCrateBtn = document.getElementById('view-mycrate-btn');
      if (shopBtn) shopBtn.classList.add('active');
      if (myCrateBtn) myCrateBtn.classList.remove('active');
      activeIndex = snapshot.activeIndex;
      isSelected = snapshot.isSelected;
      if (isSelected) showRecordDetails(activeIndex);
      else deselectRecord();
    }
  }
  updateRecordHeights();
}

function startAgentDigPreview() {
  stopAgentDigPreview({ restore: false });
  if (recordsData.length === 0) return;

  agentDigPreviewSnapshot = {
    isUserCrateViewActive,
    activeIndex,
    isSelected,
    userActiveIndex,
    userIsSelected,
    focusRevision: agentFocusRevision
  };

  // An agent navigation preview is a shop-wide operation. If the user was looking at My
  // Crate, move to the shop surface before the first preview sleeve rises.
  if (isUserCrateViewActive) {
    const shopBtn = document.getElementById('view-shop-btn');
    if (shopBtn) shopBtn.click();
    else {
      isUserCrateViewActive = false;
      globalCamXOffset = 0;
    }
  }

  const previewToken = ++agentDigPreviewToken;
  let cursor = Math.max(0, activeIndex);

  const tick = () => {
    if (
      previewToken !== agentDigPreviewToken
      || !isAgentNavigationPreviewActive()
    ) return;

    const availableIndexes = recordsData
      .map((record, index) => index < catalog.length && record.mesh.visible ? index : -1)
      .filter(index => index >= 0);
    if (availableIndexes.length === 0) {
      agentDigPreviewTimer = window.setTimeout(tick, 140);
      return;
    }

    const previousPreviewIndex = agentDigPreviewIndex;
    agentDigPreviewIndex = availableIndexes[cursor % availableIndexes.length];
    activeIndex = agentDigPreviewIndex;
    isSelected = true;
    document.documentElement.dataset.agentDigPreviewIndex = String(agentDigPreviewIndex);
    showRecordDetails(agentDigPreviewIndex);
    updateRecordHeights();
    diagnostics.record('ui', 'crate_navigation', {
      source: 'agent',
      operation: agentVisualOperation,
      view: 'shop',
      from_index: previousPreviewIndex,
      to_index: agentDigPreviewIndex
    }, { snapshot: true });
    if (previousPreviewIndex >= 0) {
      playCrateNavigationTick(agentDigPreviewIndex > previousPreviewIndex ? 1 : -1, { agent: true });
    }
    cursor += 1;
    agentDigPreviewTimer = window.setTimeout(tick, 220);
  };

  tick();
}

// Navigate to a specific index in the crate
function navigateCrateToIndex(targetIndex) {
  if (isUserCrateViewActive) {
    if (targetIndex < 0 || targetIndex >= userRecordsData.length) return;
    const prevIndex = userActiveIndex;
    userActiveIndex = targetIndex;
    if (prevIndex !== userActiveIndex && navigator.vibrate) {
      try { navigator.vibrate(12); } catch (e) {}
    }
    selectRecord(targetIndex);
  } else {
    if (targetIndex < 0 || targetIndex >= catalog.length) return;
    const prevIndex = activeIndex;
    activeIndex = targetIndex;
    if (prevIndex !== activeIndex && navigator.vibrate) {
      try { navigator.vibrate(12); } catch (e) {}
    }
    selectRecord(targetIndex);
  }
}

function navigateCrate(direction) {
  if (isUserCrateViewActive) {
    const count = userRecordsData.length;
    if (count === 0) return;
    const prevIndex = userActiveIndex;
    
    // Allow one resting step past the end so the final sleeve can fall forward too.
    const maxVal = count;
    const targetIdx = Math.max(0, Math.min(maxVal, userActiveIndex + direction));
    
    if (targetIdx !== userActiveIndex) {
      userActiveIndex = targetIdx;
      playCrateNavigationTick(targetIdx > prevIndex ? 1 : -1);
      if (navigator.vibrate) {
        try { navigator.vibrate(12); } catch (e) {}
      }
      if (userIsSelected) {
        if (userActiveIndex >= count) {
          deselectRecord();
        } else {
          showRecordDetails(userActiveIndex);
          updateRecordHeights();
        }
      }
    }
  } else {
    const count = catalog.length;
    if (count === 0) return;
    const prevIndex = activeIndex;
    
    // Allow one resting step past the end so the final sleeve can fall forward too.
    const maxVal = count;
    const targetIdx = Math.max(0, Math.min(maxVal, activeIndex + direction));
    
    if (targetIdx !== activeIndex) {
      activeIndex = targetIdx;
      playCrateNavigationTick(targetIdx > prevIndex ? 1 : -1);
      if (navigator.vibrate) {
        try { navigator.vibrate(12); } catch (e) {}
      }
      if (isSelected) {
        if (activeIndex >= count) {
          deselectRecord();
        } else {
          showRecordDetails(activeIndex);
          updateRecordHeights();
        }
      }
    }
  }
}

// Select/Inspect active record
function selectRecord(index) {
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }
  if (isUserCrateViewActive) {
    if (index < 0 || index >= userRecordsData.length) {
      deselectRecord();
      return;
    }
    userActiveIndex = index;
    userIsSelected = true;
    updateRecordHeights();
    showRecordDetails(userActiveIndex);
  } else {
    if (index < 0 || index >= catalog.length) {
      deselectRecord();
      return;
    }
    activeIndex = index;
    isSelected = true;
    updateRecordHeights();
    showRecordDetails(activeIndex);
  }
}

// Deselect / Put record back in crate
function deselectRecord({ preservePlayer = true } = {}) {
  isSelected = false;
  userIsSelected = false;
  updateRecordHeights();

  const panel = document.getElementById('details-panel');
  panel.classList.add('hidden');
  panel.classList.remove('show-collapsed', 'show-expanded');
  if (preservePlayer) floatPlayerInViewport();
  else pauseAudio();
  resetInactivityTimer();
}

// Render details panel info
function showRecordDetails(index) {
  const count = isUserCrateViewActive ? userRecordsData.length : catalog.length;
  if (index < 0 || index >= count) {
    deselectRecord();
    return;
  }
  const item = isUserCrateViewActive
    ? findMasterCatalogItem(userRecordsData[index].slug)
    : catalog[index];
  if (!item) return;

  restorePlayerToPanel();

  // Set elements
  document.getElementById('detail-cover').src = resolveCatalogImageUrl(item.image);
  document.getElementById('detail-title').innerText = item.title;
  document.getElementById('detail-artist').innerText = item.artist;
  document.getElementById('detail-price').innerText = item.price_text || 'Buy';
  const descEl = document.getElementById('detail-description');
  const toggleBtn = document.getElementById('desc-toggle-btn');
  if (descEl) {
    descEl.innerText = item.description || 'No description available.';
    descEl.classList.remove('collapsed');
    if (toggleBtn) {
      toggleBtn.classList.add('hidden');
      toggleBtn.innerText = "READ MORE";
    }
    
    // Defer height check to next tick to ensure browser layout is correct
    setTimeout(() => {
      const isMobile = window.innerWidth < 1024;
      // 3 lines threshold on mobile (~75px), 4 lines threshold on desktop (~99px)
      const limit = isMobile ? 75 : 99;
      
      const fullHeight = descEl.scrollHeight;
      descEl.style.setProperty('--expanded-height', `${fullHeight}px`);
      
      if (fullHeight > limit) {
        descEl.classList.add('collapsed');
        if (toggleBtn) {
          toggleBtn.classList.remove('hidden');
        }
      }
    }, 0);
  }

  const dateEl = document.getElementById('detail-date');
  if (dateEl) {
    if (item.release_date) {
      try {
        const dateObj = new Date(item.release_date);
        const formattedDate = dateObj.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          timeZone: 'UTC'
        });
        dateEl.innerText = `Released: ${formattedDate}`;
        dateEl.style.display = 'block';
      } catch (err) {
        dateEl.innerText = `Released: ${item.release_date}`;
        dateEl.style.display = 'block';
      }
    } else {
      dateEl.style.display = 'none';
    }
  }

  // Tags
  const tagsContainer = document.getElementById('detail-tags');
  tagsContainer.innerHTML = '';
  if (item.tags) {
    item.tags.forEach(t => {
      const span = document.createElement('span');
      span.className = 'tag';
      span.innerText = t;
      tagsContainer.appendChild(span);
    });
  }

  // Populate tracklist
  const tracklistEl = document.getElementById('tracks-list');
  tracklistEl.innerHTML = '';

  item.tracks.forEach((track, tIdx) => {
    const li = document.createElement('li');
    li.className = 'track-item';
    // Keep the release context on the row. Track IDs are not globally unique
    // across the catalog (a compilation may include a track from another
    // release), so playback must retain the release the user actually opened.
    li.dataset.releaseRecordId = getCrateRecordId(item);
    li.dataset.trackId = String(track.id || '');
    if (currentPlayingTrackId === String(track.id) && currentPlayingReleaseId === li.dataset.releaseRecordId) {
      li.classList.add('active');
      currentPlayingTrackItem = li;
    }

    // Duration format
    const durMin = Math.floor(track.duration / 60);
    const durSec = String(Math.floor(track.duration % 60)).padStart(2, '0');
    const durStr = `${durMin}:${durSec}`;

    const isPlaying = (currentPlayingTrackId === String(track.id)
      && currentPlayingReleaseId === li.dataset.releaseRecordId
      && !audio.paused);
    const pathD = isPlaying ? 'M6 19h4V5H6v14zm8-14v14h4V5h-4z' : 'M8 5v14l11-7z';

    li.innerHTML = `
      <div class="track-main">
        <span class="track-num">${track.number || tIdx + 1}</span>
        <span class="track-name">${track.title}</span>
      </div>
      <div class="track-end">
        <span class="track-duration">${durStr}</span>
        <div class="track-play-indicator">
          <svg class="track-play-icon" viewBox="0 0 24 24">
            <path class="play-path" d="${pathD}"/>
          </svg>
        </div>
      </div>
    `;

    li.addEventListener('click', () => {
      playTrack(track, li);
    });

    tracklistEl.appendChild(li);
  });

  // Crate Toggle Setup
  const buyBtn = document.getElementById('buy-btn');
  const slug = getCrateRecordId(item);
  buyBtn.setAttribute('data-slug', slug);
  buyBtn.dataset.priceText = String(item.price_text || '');
  
  const localCrateData = localStorage.getItem('seph_martin_crate');
  let localItems = [];
  try {
    if (localCrateData) {
      localItems = JSON.parse(localCrateData);
    }
  } catch (e) {}
  
  const promptEl = document.getElementById('crate-save-prompt');
  
  if (localItems.includes(slug)) {
    syncBuyButtonLabel(buyBtn, item, true);
    if (!currentUser && promptEl) {
      promptEl.classList.remove('hidden');
    } else if (promptEl) {
      promptEl.classList.add('hidden');
    }
  } else {
    syncBuyButtonLabel(buyBtn, item, false);
    if (promptEl) {
      promptEl.classList.add('hidden');
    }
  }
  updateUIControlsState();

  // Display Panel
  const panel = document.getElementById('details-panel');
  panel.classList.remove('hidden');
  if (window.innerWidth < 1024) {
    panel.classList.remove('show-expanded');
    panel.classList.add('show-collapsed');
  } else {
    panel.classList.remove('show-collapsed');
    panel.classList.add('show-expanded');
  }
}

// Handle clicking / tapping on 3D objects
function handleCanvasInteraction(clientX, clientY) {
  const container = document.getElementById('canvas-container');
  const rect = container.getBoundingClientRect();

  mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  let meshes = [];
  if (isUserCrateViewActive) {
    meshes = userRecordsData.map(r => r.mesh);
  } else {
    meshes = recordsData.map(r => r.mesh);
    if (stickyNoteMesh) {
      meshes.push(stickyNoteMesh);
    }
  }
  const intersects = raycaster.intersectObjects(meshes, true); // recursive check to intersect plastic shell child

  if (intersects.length > 0) {
    let clickedMesh = intersects[0].object;
    if (clickedMesh === stickyNoteMesh || (clickedMesh.parent && clickedMesh.parent === stickyNoteMesh)) {
      showStickyNoteModal();
      return;
    }
    // Resolve sleeve index if we clicked the outer plastic wrap child mesh
    if (clickedMesh.userData.index === undefined && clickedMesh.parent && clickedMesh.parent.userData.index !== undefined) {
      clickedMesh = clickedMesh.parent;
    }

    if (clickedMesh.userData.isUserCrate) {
      const clickedIndex = clickedMesh.userData.index;
      if (clickedIndex === userActiveIndex) {
        if (userIsSelected) {
          deselectRecord();
        } else {
          selectRecord(clickedIndex);
        }
      } else {
        selectRecord(clickedIndex);
      }
      return;
    }

    const clickedIndex = clickedMesh.userData.index;

    if (clickedIndex === activeIndex) {
      if (isSelected) {
        deselectRecord();
      } else {
        selectRecord(clickedIndex);
      }
    } else {
      selectRecord(clickedIndex);
    }
  } else {
    // Clicked on empty space! If a record is selected, deselect it to close details panel (helpful on mobile)
    if (isSelected || userIsSelected) {
      deselectRecord();
    }
  }
}

let lastTouchInteractionTime = 0;

function onCanvasClick(e) {
  if (wasDeselectedDuringDrag) {
    wasDeselectedDuringDrag = false;
    return;
  }
  const currentActiveIdx = isUserCrateViewActive ? userActiveIndex : activeIndex;
  if (hasDragged && dragStartIndex !== currentActiveIdx) return; // ignore only if user scrolled to a different record
  // Prevent mobile browser double-trigger (ignore click event if we just handled a touch interaction)
  if (Date.now() - lastTouchInteractionTime < 600) return;
  handleCanvasInteraction(e.clientX, e.clientY);
}

function onCanvasTouchEnd(e) {
  if (wasDeselectedDuringDrag) {
    wasDeselectedDuringDrag = false;
    return;
  }
  const currentActiveIdx = isUserCrateViewActive ? userActiveIndex : activeIndex;
  if (hasDragged && dragStartIndex !== currentActiveIdx) return; // ignore only if user scrolled to a different record
  if (e.changedTouches.length === 1) {
    lastTouchInteractionTime = Date.now();
    const touch = e.changedTouches[0];
    handleCanvasInteraction(touch.clientX, touch.clientY);
  }
}

function findReleaseByTrackId(trackId) {
  if (!trackId) return null;
  const list = (masterCatalog && masterCatalog.length > 0) ? masterCatalog : catalog;
  return list.find(release => release.tracks && release.tracks.some(t => t.id === trackId)) || null;
}

function getCurrentPlayingRelease() {
  return (currentPlayingReleaseId && findMasterCatalogItem(currentPlayingReleaseId))
    || findReleaseByTrackId(currentPlayingTrackId)
    || null;
}

function getAdjacentTrack(direction = 1) {
  const parentRelease = getCurrentPlayingRelease();
  const tracks = Array.isArray(parentRelease?.tracks) ? parentRelease.tracks : [];
  const currentIndex = tracks.findIndex(track => String(track?.id || '') === String(currentPlayingTrackId || ''));
  const targetIndex = currentIndex + (Number(direction) < 0 ? -1 : 1);
  if (!parentRelease || currentIndex < 0 || targetIndex < 0 || targetIndex >= tracks.length) return null;

  const track = tracks[targetIndex];
  const recordId = getCrateRecordId(parentRelease);
  return {
    release: parentRelease,
    recordId,
    track,
    trackIndex: targetIndex,
    trackItemElement: findTrackElement(recordId, track?.id)
  };
}

function getNavigationAnchorRecordId({ selectionFirst = false } = {}) {
  const visibleRecords = isUserCrateViewActive
    ? userRecordsData.map(entry => findMasterCatalogItem(entry?.recordId || entry?.slug)).filter(Boolean)
    : catalog;
  const activeRecordIndex = isUserCrateViewActive ? userActiveIndex : activeIndex;
  const selectedRecordId = getCrateRecordId(visibleRecords[activeRecordIndex]);
  if (selectionFirst && selectedRecordId) return selectedRecordId;
  if (currentPlayingReleaseId) return String(currentPlayingReleaseId).trim();
  return selectedRecordId;
}

function getAdjacentRelease(direction = 1, { anchorRecordId = '' } = {}) {
  const delta = Number(direction) < 0 ? -1 : 1;
  const visibleReleases = Array.isArray(catalog) ? catalog : [];
  if (visibleReleases.length === 0) return null;

  const anchorId = String(anchorRecordId || getNavigationAnchorRecordId()).trim();
  const buildTarget = (release, index) => {
    if (!release) return null;
    return {
      release,
      recordId: getCrateRecordId(release),
      releaseIndex: index
    };
  };

  const visibleAnchorIndex = anchorId
    ? visibleReleases.findIndex(release => getCrateRecordId(release) === anchorId)
    : -1;
  if (visibleAnchorIndex >= 0) {
    return buildTarget(visibleReleases[visibleAnchorIndex + delta], visibleAnchorIndex + delta);
  }

  // A release can disappear from Shop after it is added to My Crate. Keep
  // release navigation useful by resolving the nearest visible neighbour in
  // the complete digital catalog instead of guessing from activeIndex.
  if (anchorId) {
    const allReleases = getDigitalCatalog();
    const allAnchorIndex = allReleases.findIndex(release => getCrateRecordId(release) === anchorId);
    if (allAnchorIndex >= 0) {
      for (let index = allAnchorIndex + delta; index >= 0 && index < allReleases.length; index += delta) {
        const candidateId = getCrateRecordId(allReleases[index]);
        const visibleIndex = visibleReleases.findIndex(release => getCrateRecordId(release) === candidateId);
        if (visibleIndex >= 0) return buildTarget(visibleReleases[visibleIndex], visibleIndex);
      }
    }
  }

  const fallbackIndex = Math.max(0, Math.min(visibleReleases.length - 1, activeIndex));
  const targetIndex = fallbackIndex + delta;
  return buildTarget(visibleReleases[targetIndex], targetIndex);
}

function focusAdjacentRelease(direction = 1, { source = 'agent', anchorRecordId = '' } = {}) {
  const delta = Number(direction) < 0 ? -1 : 1;
  const anchor = String(anchorRecordId || getNavigationAnchorRecordId({ selectionFirst: true })).trim();
  if (isUserCrateViewActive || currentSearchQuery) {
    showMainCrateView({ preservePhysicalOrder: true });
  }

  const target = getAdjacentRelease(delta, { anchorRecordId: anchor });
  if (!target) {
    const label = delta < 0 ? 'previous' : 'next';
    return {
      ok: false,
      error: {
        code: delta < 0 ? 'NO_PREVIOUS_RELEASE' : 'NO_NEXT_RELEASE',
        message: `There is no ${label} release in the visible Shop crate.`
      }
    };
  }

  const focused = focusRecordById(target.recordId);
  if (!focused.ok) return focused;
  diagnostics.record('ui', 'release_navigation', {
    source,
    direction: delta < 0 ? 'previous' : 'next',
    from_record_id: anchor || null,
    to_record_id: target.recordId
  }, { snapshot: true });
  return {
    ok: true,
    ...focused,
    navigation: {
      mode: 'release',
      direction: delta < 0 ? 'previous' : 'next',
      from_record_id: anchor || null,
      to_record_id: target.recordId
    }
  };
}

function syncPlayerTransportControls() {
  const previousButton = document.getElementById('agent-orb-prev-btn');
  const nextButton = document.getElementById('agent-orb-next-btn');
  const adjacent = {
    previousTrack: getAdjacentTrack(-1),
    nextTrack: getAdjacentTrack(1),
    previousRelease: getAdjacentRelease(-1),
    nextRelease: getAdjacentRelease(1)
  };

  [
    [previousButton, adjacent.previousTrack || adjacent.previousRelease, adjacent.previousTrack ? 'Previous track' : adjacent.previousRelease ? 'Previous release' : 'Previous track or release'],
    [nextButton, adjacent.nextTrack || adjacent.nextRelease, adjacent.nextTrack ? 'Next track' : adjacent.nextRelease ? 'Next release' : 'Next track or release']
  ].forEach(([button, target, label]) => {
    if (!button) return;
    const available = Boolean(target);
    button.disabled = !available;
    button.setAttribute('aria-disabled', String(!available));
    button.setAttribute('aria-label', available ? label : `${label} unavailable`);
    button.title = available ? label : `${label} unavailable`;
  });
}

function notifyHumanPlayerInput(source) {
  window.dispatchEvent(new CustomEvent('seph-human-player-input', {
    detail: {
      source,
      track_id: currentPlayingTrackId,
      release_record_id: currentPlayingReleaseId
    }
  }));
}

function rememberPlayerHome() {
  const player = document.getElementById('custom-player');
  if (!player || !player.parentNode) return null;
  if (!playerHomeParent) {
    playerHomeParent = player.parentNode;
    playerHomeNextSibling = player.nextSibling;
  }
  return player;
}

function restorePlayerToPanel() {
  const player = rememberPlayerHome();
  if (!player || !playerHomeParent) return;
  if (player.parentNode !== playerHomeParent) {
    if (playerHomeNextSibling?.parentNode === playerHomeParent) {
      playerHomeParent.insertBefore(player, playerHomeNextSibling);
    } else {
      playerHomeParent.appendChild(player);
    }
  }
  player.classList.remove('is-floating');
  delete document.documentElement.dataset.playerFloating;
}

function floatPlayerInViewport() {
  const player = rememberPlayerHome();
  const host = document.getElementById('global-player-host');
  if (!player || !host || !currentPlayingTrackId || !(audio.currentSrc || audio.src)) return;
  if (player.classList.contains('hidden')) return;
  if (player.parentNode !== host) host.appendChild(player);
  player.classList.add('is-floating');
  document.documentElement.dataset.playerFloating = 'true';
}

function getPendingPlaybackSummary() {
  return pendingPlayback ? { ...pendingPlayback } : null;
}

function getPlayerVolume() {
  const volume = Number(audio.volume);
  return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : PREVIEW_AUDIO_VOLUME;
}

function syncPlayerVolumeControl() {
  // Volume is intentionally controlled through WebMCP only. Keep this hook so
  // existing player-state updates remain stable without reintroducing a UI
  // slider or a second mute-looking control in the orb.
}

function setPlayerVolume(value, { source = 'agent' } = {}) {
  const requested = Number(value);
  if (!Number.isFinite(requested) || requested < 0 || requested > 1) {
    return playerErrorResult('INVALID_VOLUME', 'volume must be a number between 0 and 1.');
  }

  audio.volume = requested;
  syncPlayerVolumeControl();
  diagnostics.record('audio', 'preview_volume_changed', {
    source,
    volume: requested,
    volume_percent: Math.round(requested * 100)
  }, { snapshot: true });
  return {
    ok: true,
    volume: requested,
    volume_percent: Math.round(requested * 100),
    ...emitPlayerState('volume_changed')
  };
}

function getUiContext() {
  const view = isUserCrateViewActive ? 'my_crate' : 'shop';
  const visibleRecords = isUserCrateViewActive
    ? userRecordsData.map(entry => findMasterCatalogItem(entry?.recordId || entry?.slug)).filter(Boolean)
    : catalog;
  const activeRecordIndex = isUserCrateViewActive ? userActiveIndex : activeIndex;
  const recordIsSelected = isUserCrateViewActive ? userIsSelected : isSelected;
  const activeRecord = visibleRecords[activeRecordIndex] || null;
  const detailsPanel = document.getElementById('details-panel');
  const detailsOpen = Boolean(recordIsSelected && detailsPanel && !detailsPanel.classList.contains('hidden'));
  const openRecord = detailsOpen ? activeRecord : null;
  const checkoutModal = document.getElementById('demo-checkout-modal');
  const checkoutOpen = Boolean(checkoutModal && !checkoutModal.classList.contains('hidden'));
  const checkoutSurface = isDemoCheckoutSimulatorEnabled()
    ? 'demo_simulator'
    : isLemonOverlayEnabled() ? 'lemon_overlay' : 'lemon_redirect';
  const demoCompletion = getDemoCompletionState();
  const activeRecordId = activeRecord ? getCrateRecordId(activeRecord) : '';
  const demoBoundaryReached = Boolean(
    (activeRecordId && demoCompletedRecordIds.has(activeRecordId))
      || (demoCompletion.record_id && demoCompletedRecordIds.has(demoCompletion.record_id))
  );
  const myCrateIds = readLocalCrateItems();
  const previousTrack = getAdjacentTrack(-1);
  const nextTrack = getAdjacentTrack(1);
  const releaseNavigationAnchor = getNavigationAnchorRecordId({ selectionFirst: true });
  const previousRelease = getAdjacentRelease(-1, { anchorRecordId: releaseNavigationAnchor });
  const nextRelease = getAdjacentRelease(1, { anchorRecordId: releaseNavigationAnchor });
  const previousPlayingRelease = getAdjacentRelease(-1);
  const nextPlayingRelease = getAdjacentRelease(1);

  return {
    view,
    sort: currentFilter,
    search_query: currentSearchQuery || null,
    visible_index: Number.isInteger(activeRecordIndex) ? activeRecordIndex : null,
    visible_count: visibleRecords.length,
    selected: Boolean(recordIsSelected),
    details_open: detailsOpen,
    active_record_id: activeRecord ? getCrateRecordId(activeRecord) : null,
    active_record: activeRecord ? summarizeCrateItem(activeRecord) : null,
    open_record_id: openRecord ? getCrateRecordId(openRecord) : null,
    open_record: openRecord ? summarizeCrateItem(openRecord) : null,
    my_crate: {
      active: view === 'my_crate',
      count: myCrateIds.length,
      checkout_available: myCrateIds.some(recordId => Boolean(findMasterCatalogItem(recordId)))
    },
    checkout: {
      open: checkoutOpen,
      step: checkoutOpen ? checkoutModal?.dataset.step || 'checkout' : null,
      purchase_complete: checkoutOpen && checkoutModal?.dataset.step === 'success',
      source: checkoutOpen ? checkoutModal?.dataset.source || 'human' : null,
      surface: checkoutSurface
    },
    demo: isDemoCheckoutSimulatorEnabled()
      ? {
        simulator: true,
        preview_boundary_reached: demoBoundaryReached,
        preview_boundary_message: demoBoundaryReached
          ? demoCompletion.message || DEMO_END_MESSAGE
          : null,
        completion_modal_open: demoCompletion.open,
        completion_modal_record_id: demoCompletion.record_id,
        download_tool: 'download_release',
        audio_download_available: false
      }
      : { simulator: false },
    agent_focus_record_ids: [...agentFocusRecordIds],
    orb: getAgentOrbVisualState(),
    release_navigation: {
      previous_available: Boolean(previousRelease),
      next_available: Boolean(nextRelease),
      previous_record_id: previousRelease?.recordId || null,
      next_record_id: nextRelease?.recordId || null
    },
    player: {
      track_id: currentPlayingTrackId,
      track_title: currentPlayingTrack?.title || null,
      release_record_id: currentPlayingReleaseId,
      is_playing: Boolean(currentPlayingTrackId && !audio.paused),
      previous_available: Boolean(previousTrack),
      next_available: Boolean(nextTrack),
      previous_release_available: Boolean(previousPlayingRelease),
      next_release_available: Boolean(nextPlayingRelease),
      volume: getPlayerVolume(),
      floating: document.documentElement.dataset.playerFloating === 'true',
      cover_url: resolveCatalogImageUrl(getCurrentPlayingRelease()?.image) || null
    }
  };
}

function syncPendingPlaybackState() {
  const requiresGesture = Boolean(pendingPlayback);
  const player = document.getElementById('custom-player');
  const playPauseBtn = document.getElementById('player-play-btn');

  document.documentElement.dataset.playerAudio = requiresGesture ? 'gesture-required' : 'ready';
  if (player) player.dataset.audioState = requiresGesture ? 'gesture-required' : 'ready';
  if (playPauseBtn) {
    playPauseBtn.setAttribute(
      'aria-label',
      requiresGesture ? 'Play preview (tap or click to start)' : 'Play/Pause'
    );
  }
  syncAgentOrbSurface();
}

function setPendingPlayback() {
  if (!currentPlayingTrackId) return;
  pendingPlayback = {
    track_id: currentPlayingTrackId,
    release_record_id: currentPlayingReleaseId,
    track_title: currentPlayingTrack?.title || null,
    reason: 'user_gesture_required'
  };
  syncPendingPlaybackState();
  diagnostics.record('audio', 'preview_playback_pending', {
    track_id: currentPlayingTrackId,
    release_record_id: currentPlayingReleaseId,
    reason: 'user_gesture_required'
  }, { snapshot: true });
}

function clearPendingPlayback() {
  if (!pendingPlayback) return;
  const previous = pendingPlayback;
  pendingPlayback = null;
  syncPendingPlaybackState();
  diagnostics.record('audio', 'preview_playback_pending_cleared', {
    track_id: previous.track_id,
    release_record_id: previous.release_record_id
  });
}

function isPendingPlaybackGestureExcluded(event) {
  const target = event?.target;
  return Boolean(target?.closest?.(
    '#player-play-btn, #agent-debug-panel, #agent-mode-hud, #agent-debug-trigger, [data-agent-debug-action], button, a, input, textarea, select'
  ));
}

function resumePendingPlayback(event) {
  if (event?.isTrusted !== true || !pendingPlayback || !siteAudioEnabled) return;
  if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
  if (isPendingPlaybackGestureExcluded(event) || pendingPlaybackResumeInFlight) return;

  pendingPlaybackResumeInFlight = true;
  Promise.resolve(startAudioPlayback()).finally(() => {
    pendingPlaybackResumeInFlight = false;
  });
}

function installPendingPlaybackGesture() {
  ['pointerdown', 'keydown', 'touchstart'].forEach(eventName => {
    window.addEventListener(eventName, resumePendingPlayback, { passive: true });
  });
}

function getPlayerState() {
  const audioDuration = Number(audio.duration);
  const declaredDuration = Number(currentPlayingTrack?.duration);
  const durationSeconds = Number.isFinite(audioDuration) && audioDuration > 0
    ? audioDuration
    : Number.isFinite(declaredDuration) && declaredDuration > 0 ? declaredDuration : null;
  const currentTime = Number(audio.currentTime);
  const volume = getPlayerVolume();
  const currentRelease = currentPlayingReleaseId ? findMasterCatalogItem(currentPlayingReleaseId) : null;
  let status = 'idle';
  if (currentPlayingTrackId) {
    if (playerError || audio.error) status = 'error';
    else if (audio.ended) status = 'ended';
    else if (!audio.paused) status = 'playing';
    else if (audio.readyState >= 1) status = 'paused';
    else status = 'loading';
  }

  return {
    ok: true,
    status,
    is_loaded: Boolean(currentPlayingTrackId && (audio.currentSrc || audio.src)),
    is_playing: status === 'playing',
    current_time_seconds: Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : 0,
    duration_seconds: durationSeconds,
    declared_duration_seconds: Number.isFinite(declaredDuration) && declaredDuration > 0 ? declaredDuration : null,
    track_id: currentPlayingTrackId,
    track_title: currentPlayingTrack?.title || null,
    release_record_id: currentPlayingReleaseId,
    release_title: currentRelease?.title || null,
    muted: Boolean(audio.muted || !siteAudioEnabled),
    site_audio_enabled: siteAudioEnabled,
    volume,
    volume_percent: Math.round(volume * 100),
    requires_user_gesture: Boolean(pendingPlayback),
    pending_playback: getPendingPlaybackSummary(),
    source: audio.currentSrc || audio.src || currentPlayingTrack?.preview_url || null,
    ready_state: audio.readyState,
    error: playerError,
    ui_context: getUiContext()
  };
}

function emitPlayerState(event = 'state_changed') {
  const state = getPlayerState();
  window.dispatchEvent(new CustomEvent('seph-player-state', {
    detail: { event, ...state }
  }));
  return state;
}

function setPlayerUiPlaying(isPlaying) {
  const playIcon = document.querySelector('.play-icon');
  const pauseIcon = document.querySelector('.pause-icon');
  const playPauseBtn = document.getElementById('player-play-btn');
  if (playIcon) playIcon.classList.toggle('hidden', Boolean(isPlaying));
  if (pauseIcon) pauseIcon.classList.toggle('hidden', !isPlaying);
  if (playPauseBtn) playPauseBtn.classList.toggle('is-playing', Boolean(isPlaying));
  syncAgentOrbSurface();
}

function playerErrorResult(code, message, extra = {}) {
  return {
    ok: false,
    error: { code, message },
    player_state: getPlayerState(),
    ...extra
  };
}

function getTrackCandidates(trackId, recordId = '') {
  const normalizedTrackId = String(trackId || '').trim();
  const normalizedRecordId = String(recordId || '').trim();
  const list = (masterCatalog && masterCatalog.length > 0) ? masterCatalog : catalog;
  let releases = list;

  if (normalizedRecordId) {
    releases = list.filter(release => getCrateRecordId(release) === normalizedRecordId
      || String(release?.slug || '') === normalizedRecordId
      || String(release?.page_url || '') === normalizedRecordId);
  }

  return releases.flatMap(release => (Array.isArray(release?.tracks) ? release.tracks : [])
    .filter(track => String(track?.id || '').trim() === normalizedTrackId)
    .map(track => ({ release, track })));
}

function resolveTrackForPlayback(trackId, recordId = '') {
  const normalizedTrackId = String(trackId || '').trim();
  const normalizedRecordId = String(recordId || '').trim();
  if (!normalizedTrackId) {
    if (!currentPlayingTrackId) {
      return playerErrorResult('NO_TRACK_LOADED', 'No track is loaded. Supply a track_id from inspect_record first.');
    }
    const currentCandidates = getTrackCandidates(currentPlayingTrackId, currentPlayingReleaseId);
    const current = currentCandidates.find(candidate => getCrateRecordId(candidate.release) === currentPlayingReleaseId)
      || currentCandidates[0];
    if (current) return { ok: true, ...current };
    if (currentPlayingTrack) {
      return {
        ok: true,
        track: currentPlayingTrack,
        release: currentPlayingReleaseId ? findMasterCatalogItem(currentPlayingReleaseId) : null
      };
    }
    return playerErrorResult('TRACK_NOT_FOUND', 'The currently loaded track is no longer present in the catalog.');
  }

  const candidates = getTrackCandidates(normalizedTrackId, normalizedRecordId);
  if (candidates.length === 0) {
    return playerErrorResult(
      normalizedRecordId ? 'TRACK_NOT_FOUND_IN_RELEASE' : 'TRACK_NOT_FOUND',
      normalizedRecordId
        ? 'The requested track is not present in the requested release.'
        : 'The requested track is not present in the loaded catalog.'
    );
  }
  if (candidates.length === 1) return { ok: true, ...candidates[0] };

  const detailSlug = document.getElementById('buy-btn')?.getAttribute('data-slug');
  const detailCandidate = candidates.find(candidate => String(candidate.release?.slug || '') === detailSlug
    || getCrateRecordId(candidate.release) === detailSlug);
  if (detailCandidate) return { ok: true, ...detailCandidate };

  return playerErrorResult('AMBIGUOUS_TRACK', 'The track ID exists in multiple releases. Supply record_id to select the correct sleeve.', {
    candidates: candidates.slice(0, 12).map(candidate => ({
      track_id: String(candidate.track?.id || ''),
      track_title: candidate.track?.title || '',
      record_id: getCrateRecordId(candidate.release),
      release_title: candidate.release?.title || ''
    }))
  });
}

function findTrackElement(releaseId, trackId) {
  return [...document.querySelectorAll('.track-item')]
    .find(element => element.dataset.releaseRecordId === String(releaseId || '')
      && element.dataset.trackId === String(trackId || '')) || null;
}

function invalidatePlaybackRequests() {
  playbackRequestToken += 1;
}

function supersededPlaybackResult() {
  return {
    ok: false,
    error: {
      code: 'PLAYBACK_REQUEST_SUPERSEDED',
      message: 'The playback request was superseded by a newer player action.'
    },
    superseded: true,
    player_state: getPlayerState()
  };
}

function startAudioPlayback() {
  const requestToken = ++playbackRequestToken;
  const requestedTrackId = currentPlayingTrackId;
  if (!currentPlayingTrackId || !(audio.currentSrc || audio.src)) {
    return Promise.resolve(playerErrorResult('NO_TRACK_LOADED', 'No track is loaded in the player.'));
  }

  diagnostics.record('audio', 'preview_play_attempt', {
    track_id: requestedTrackId,
    release_record_id: currentPlayingReleaseId,
    ready_state: audio.readyState,
    paused: audio.paused
  });

  const isCurrentRequest = () => requestToken === playbackRequestToken
    && requestedTrackId === currentPlayingTrackId;

  playerError = null;
  if (audio.ended) {
    try {
      audio.currentTime = 0;
    } catch (error) {
      // Let the native play() promise provide the actionable playback error.
    }
  }
  const handlePlaybackFailure = error => {
    if (!isCurrentRequest()) return supersededPlaybackResult();
    const blocked = error?.name === 'NotAllowedError';
    if (blocked) setPendingPlayback();
    else clearPendingPlayback();
    playerError = {
      code: blocked ? 'PLAYBACK_BLOCKED' : 'PLAYBACK_FAILED',
      message: blocked
        ? 'The browser requires a user gesture before audio playback can start.'
        : String(error?.message || 'The preview could not be played.')
    };
    setPlayerUiPlaying(false);
    updateTrackListIcons();
    emitPlayerState('playback_failed');
    diagnostics.record('audio', 'preview_play_failed', {
      track_id: requestedTrackId,
      release_record_id: currentPlayingReleaseId,
      code: playerError.code,
      error
    }, { snapshot: true });
    return playerErrorResult(playerError.code, playerError.message, {
      requires_user_gesture: blocked,
      pending_playback: getPendingPlaybackSummary(),
      user_message: blocked
        ? 'Audio cannot start until you tap or click the page once.'
        : null,
      next_step: blocked
        ? 'Tap or click the page, then retry the preview or press Play.'
        : null
    });
  };

  try {
    return Promise.resolve(audio.play())
    .then(() => {
      if (!isCurrentRequest()) return supersededPlaybackResult();
      clearPendingPlayback();
      setPlayerUiPlaying(true);
      diagnostics.record('audio', 'preview_play_started', {
        track_id: requestedTrackId,
        release_record_id: currentPlayingReleaseId
      });
      updateTrackListIcons();
      return { ok: true, ...emitPlayerState('playback_started') };
    })
    .catch(handlePlaybackFailure);
  } catch (error) {
    return Promise.resolve(handlePlaybackFailure(error));
  }
}

function seekPlayer(positionSeconds) {
  const requested = Number(positionSeconds);
  if (!Number.isFinite(requested) || requested < 0 || requested > 86400) {
    return playerErrorResult('INVALID_POSITION', 'position_seconds must be a finite number between 0 and 86400.');
  }
  if (!currentPlayingTrackId || !(audio.currentSrc || audio.src)) {
    return playerErrorResult('NO_TRACK_LOADED', 'Load a track before seeking.');
  }

  const audioDuration = Number(audio.duration);
  const declaredDuration = Number(currentPlayingTrack?.duration);
  const duration = Number.isFinite(audioDuration) && audioDuration > 0
    ? audioDuration
    : Number.isFinite(declaredDuration) && declaredDuration > 0 ? declaredDuration : null;
  const target = duration === null ? requested : Math.min(requested, duration);

  try {
    audio.currentTime = target;
    playerError = null;
    setPlayerUiPlaying(!audio.paused);
    updateTrackListIcons();
    return {
      ok: true,
      requested_position_seconds: requested,
      applied_position_seconds: target,
      clamped: target !== requested,
      ...emitPlayerState('seeked')
    };
  } catch (error) {
    return playerErrorResult('SEEK_FAILED', String(error?.message || 'The player rejected this seek request.'));
  }
}

function setSiteAudioEnabled(enabled) {
  siteAudioEnabled = Boolean(enabled);
  audio.muted = !siteAudioEnabled;
  if (!siteAudioEnabled) {
    invalidatePlaybackRequests();
    clearPendingPlayback();
  }
  document.documentElement.dataset.siteAudio = siteAudioEnabled ? 'on' : 'off';
  return emitPlayerState('site_audio_changed');
}

async function playTrackById(trackId, recordId = '') {
  const resolved = resolveTrackForPlayback(trackId, recordId);
  if (!resolved.ok) return resolved;

  const releaseId = resolved.release ? getCrateRecordId(resolved.release) : currentPlayingReleaseId;
  if (releaseId) {
    const focused = focusRecordById(releaseId);
    if (!focused.ok) return focused;
  }
  const trackItemElement = findTrackElement(releaseId, resolved.track.id);
  return playTrack(resolved.track, trackItemElement, { toggleIfCurrent: false, recordId: releaseId });
}

// Audio Player Functionality
function playTrack(track, trackItemElement, { toggleIfCurrent = true, recordId = '' } = {}) {
  const player = document.getElementById('custom-player');
  const playerTitle = document.getElementById('player-track-title');
  const playerCover = document.getElementById('player-play-cover');
  const playerCoverLink = document.getElementById('player-cover-link');
  const playerReleaseLink = document.getElementById('player-release-link');

  const requestedRecordId = String(recordId || trackItemElement?.dataset?.releaseRecordId || '').trim();
  if (currentPlayingTrackId === String(track.id) && currentPlayingReleaseId === requestedRecordId) {
    if (toggleIfCurrent) return toggleAudioPlayback();
    return startAudioPlayback();
  }

  if (currentPlayingTrackItem) {
    currentPlayingTrackItem.classList.remove('active');
  }

  invalidatePlaybackRequests();
  clearPendingPlayback();
  currentPlayingTrackItem = trackItemElement;
  if (currentPlayingTrackItem) {
    currentPlayingTrackItem.classList.add('active');
  }
  currentPlayingTrackId = String(track.id);
  currentPlayingReleaseId = requestedRecordId || null;
  currentPlayingTrack = track;
  playerError = null;

  // Resolve the parent from the visible tracklist first. Track IDs can repeat
  // in compilation records, so a global ID lookup alone can choose the wrong
  // cover and make the player link return to the wrong sleeve.
  const rowRelease = trackItemElement?.dataset?.releaseRecordId
    ? findMasterCatalogItem(trackItemElement.dataset.releaseRecordId)
    : null;
  const detailSlug = document.getElementById('buy-btn')?.getAttribute('data-slug');
  const detailRelease = detailSlug ? findMasterCatalogItem(detailSlug) : null;
  const requestedRelease = requestedRecordId ? findMasterCatalogItem(requestedRecordId) : null;
  const parentRelease = requestedRelease
    || rowRelease
    || detailRelease
    || (track.release_id ? findMasterCatalogItem(track.release_id) : null)
    || findReleaseByTrackId(track.id)
    || (catalog && catalog[activeIndex])
    || null;

  if (parentRelease) {
    const recordId = getCrateRecordId(parentRelease);
    currentPlayingReleaseId = recordId || currentPlayingReleaseId;
    const parentCoverUrl = resolveCatalogImageUrl(parentRelease.image);
    if (playerCover && parentCoverUrl) {
      playerCover.src = parentCoverUrl;
      playerCover.alt = `${parentRelease.title || 'Record'} Cover`;
      playerCover.classList.remove('hidden');
    }
    const releaseUrl = recordId ? `#record-${recordId}` : (parentRelease.page_url || '#');
    if (playerCoverLink) {
      playerCoverLink.href = releaseUrl;
      if (recordId) playerCoverLink.dataset.recordId = recordId;
      playerCoverLink.removeAttribute('target');
      playerCoverLink.removeAttribute('rel');
      playerCoverLink.setAttribute('aria-label', `Focus ${parentRelease.title || 'release'} in crate`);
      playerCoverLink.setAttribute('title', `Focus ${parentRelease.title || 'release'} in crate`);
    }
    if (playerReleaseLink) {
      playerReleaseLink.href = releaseUrl;
      if (recordId) playerReleaseLink.dataset.recordId = recordId;
      playerReleaseLink.removeAttribute('target');
      playerReleaseLink.removeAttribute('rel');
      playerReleaseLink.setAttribute('aria-label', `Focus ${parentRelease.title || 'release'} in crate`);
      playerReleaseLink.setAttribute('title', `Focus ${parentRelease.title || 'release'} in crate`);
    }
  }

  const previewUrl = String(track.preview_url || '').trim();
  if (!previewUrl) {
    playerError = { code: 'PREVIEW_UNAVAILABLE', message: 'The selected track has no preview URL.' };
    return Promise.resolve(playerErrorResult(playerError.code, playerError.message));
  }

  if (player) player.classList.remove('hidden');
  if (playerTitle) playerTitle.innerText = track.title || 'Untitled track';
  if (player) player.setAttribute('aria-label', `Preview ${track.title || 'track'}`);
  setPlayerUiPlaying(false);
  audio.src = previewUrl;
  audio.load();
  syncAgentOrbSurface();
  emitPlayerState('track_loaded');
  return startAudioPlayback();
}

function toggleAudioPlayback(source = 'player_control') {
  diagnostics.record('audio', 'preview_toggle', {
    source,
    action: audio.paused ? 'play' : 'pause',
    track_id: currentPlayingTrackId,
    release_record_id: currentPlayingReleaseId,
    pending_playback: Boolean(pendingPlayback)
  }, { snapshot: true });
  if (audio.paused) {
    return startAudioPlayback();
  } else {
    invalidatePlaybackRequests();
    audio.pause();
    setPlayerUiPlaying(false);
    updateTrackListIcons();
    return emitPlayerState('playback_paused');
  }
}

function pauseAudio({ source = 'agent' } = {}) {
  if (!currentPlayingTrackId || !(audio.currentSrc || audio.src)) {
    return playerErrorResult('NO_TRACK_LOADED', 'No track is loaded in the player.');
  }
  diagnostics.record('audio', 'preview_pause_requested', {
    source,
    track_id: currentPlayingTrackId,
    release_record_id: currentPlayingReleaseId
  });
  invalidatePlaybackRequests();
  clearPendingPlayback();
  audio.pause();
  setPlayerUiPlaying(false);
  updateTrackListIcons();
  return emitPlayerState('playback_paused');
}

function playAdjacentTrack(direction = 1, source = 'agent') {
  const target = getAdjacentTrack(direction);
  if (!target) {
    const label = Number(direction) < 0 ? 'previous' : 'next';
    return Promise.resolve(playerErrorResult(
      Number(direction) < 0 ? 'NO_PREVIOUS_TRACK' : 'NO_NEXT_TRACK',
      `There is no ${label} track in the current release.`
    ));
  }

  diagnostics.record('audio', 'preview_adjacent_requested', {
    direction: Number(direction) < 0 ? 'previous' : 'next',
    source,
    from_track_id: currentPlayingTrackId,
    to_track_id: target.track?.id || null,
    release_record_id: target.recordId
  });
  return playTrack(target.track, target.trackItemElement, {
    toggleIfCurrent: false,
    recordId: target.recordId
  });
}

function playNextTrack(source = 'autoplay') {
  return playAdjacentTrack(1, source);
}

function playPreviousTrack(source = 'agent') {
  return playAdjacentTrack(-1, source);
}

function playAdjacentPreview(direction = 1, source = 'orb') {
  const delta = Number(direction) < 0 ? -1 : 1;
  const adjacentTrack = getAdjacentTrack(delta);
  if (adjacentTrack) {
    return playTrack(adjacentTrack.track, adjacentTrack.trackItemElement, {
      toggleIfCurrent: false,
      recordId: adjacentTrack.recordId
    });
  }

  // Keep the orb transport continuous across album boundaries: when the
  // current release is at its first/last track, move to the neighbouring
  // release and preview its last/first track respectively.
  const anchor = getNavigationAnchorRecordId();
  if (isUserCrateViewActive || currentSearchQuery) {
    showMainCrateView({ preservePhysicalOrder: true });
  }
  const target = getAdjacentRelease(delta, { anchorRecordId: anchor });
  if (!target) {
    const label = delta < 0 ? 'previous' : 'next';
    return Promise.resolve(playerErrorResult(
      delta < 0 ? 'NO_PREVIOUS_RELEASE' : 'NO_NEXT_RELEASE',
      `There is no ${label} release in the visible Shop crate.`
    ));
  }

  const focused = focusRecordById(target.recordId);
  if (!focused.ok) return Promise.resolve(focused);
  const tracks = Array.isArray(target.release?.tracks) ? target.release.tracks : [];
  const track = delta < 0 ? tracks[tracks.length - 1] : tracks[0];
  if (!track) return Promise.resolve(focused);

  diagnostics.record('audio', 'preview_release_boundary_requested', {
    source,
    direction: delta < 0 ? 'previous' : 'next',
    from_release_record_id: anchor || null,
    to_release_record_id: target.recordId,
    track_id: track.id || null
  }, { snapshot: true });
  const trackItemElement = findTrackElement(target.recordId, track.id);
  return playTrack(track, trackItemElement, {
    toggleIfCurrent: false,
    recordId: target.recordId
  });
}

function formatTime(seconds) {
  if (isNaN(seconds)) return '0:00';
  const min = Math.floor(seconds / 60);
  const sec = String(Math.floor(seconds % 60)).padStart(2, '0');
  return `${min}:${sec}`;
}

// Main Physics & Animation Loop
function animate() {
  requestAnimationFrame(animate);

  const agentMotionActive = ['loading', 'active', 'busy', 'standby', 'returning'].includes(agentVisualState);
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const now = performance.now();
  const agentFloatOffset = agentMotionActive && !reducedMotion
    ? Math.sin(now * 0.00135) * 0.006
    : 0;

  // Agent Mode is deliberately felt before it becomes theatrical: a nearly
  // imperceptible lift and a little extra key light make the page feel awake.
  if (crateGroup) {
    const targetCrateY = -0.05 + agentFloatOffset;
    crateGroup.position.y += (targetCrateY - crateGroup.position.y) * 0.08;
  }

  if (spotLight) {
    const targetSpotIntensity = baseSpotLightIntensity + (agentMotionActive ? 0.55 : 0);
    spotLight.intensity += (targetSpotIntensity - spotLight.intensity) * 0.08;
  }

  // When details panel is open on desktop, shift camera slightly to the right (0.08) to push crate to the left, clearing space for the right sidebar
  const baseTargetCamX = isSelected && window.innerWidth >= 1024 ? 0.08 : 0;
  targetCamX = baseTargetCamX + globalCamXOffset;
  currentCamX += (targetCamX - currentCamX) * 0.08;

  // Move lights along with the camera focus to prevent washing out/exposure shifts
  if (dirLight) {
    dirLight.position.x = currentCamX;
    dirLight.target.position.x = currentCamX;
  }
  if (spotLight) {
    spotLight.position.x = currentCamX;
    spotLight.target.position.x = currentCamX;
  }

  // Dynamically update camera position and lookAt based on aspect ratio
  updateCameraPosition();
  syncAgentCrateFrame();
  syncAgentCrateAura(now, reducedMotion);

  // Update active flying vinyl animations
  if (activeAnimations.length > 0) {
    for (let i = activeAnimations.length - 1; i >= 0; i--) {
      const anim = activeAnimations[i];
      anim.progress += anim.speed;
      
      if (anim.progress >= 1.0) {
        anim.progress = 1.0;
        scene.remove(anim.mesh);
        activeAnimations.splice(i, 1);

        if (typeof anim.onComplete === 'function') {
          anim.onComplete();
        } else {
          rebuildUserCrateRecords();
        }
      } else {
        const t = anim.progress;
        const ease = t < 0.5
          ? 4 * t * t * t
          : 1 - Math.pow(-2 * t + 2, 3) / 2;
        const arc = Math.sin(Math.PI * ease) * anim.arcHeight;
        const settle = Math.max(0, (ease - 0.72) / 0.28);
        const settleEase = 1 - Math.pow(1 - settle, 3);

        anim.mesh.position.set(
          THREE.MathUtils.lerp(anim.start.x, anim.end.x, ease),
          THREE.MathUtils.lerp(anim.start.y, anim.end.y, ease) + arc,
          THREE.MathUtils.lerp(anim.start.z, anim.end.z, ease)
        );
        anim.mesh.rotation.set(
          THREE.MathUtils.lerp(anim.startRotX, anim.endRotX, settleEase),
          THREE.MathUtils.lerp(anim.startRotY, anim.endRotY, settleEase),
          THREE.MathUtils.lerp(anim.startRotZ, anim.endRotZ, settleEase)
        );
      }
    }
  }

  // 2. Crate group orientation is fixed
  if (crateGroup) {
    crateGroup.rotation.y = 0;
    crateGroup.rotation.x = 0;
  }

  // 3. Records Physics Simulation
  const H = 0.31; // height
  const yPivot = -0.15; // bottom support axis
  const agentDiggingPreviewActive = isAgentNavigationPreviewActive();
  const activeStackIndex = getActiveShopStackIndex();

  recordsData.forEach((rec, idx) => {
    const stackIndex = Number.isFinite(Number(rec.stackIndex)) ? Number(rec.stackIndex) : idx;
    if (stackIndex < activeStackIndex) {
      rec.targetRotX = 0.40; // leaning forward (naturally resting on the front wall)
    } else if (stackIndex > activeStackIndex) {
      rec.targetRotX = -0.20; // leaning backward inside the stack
    } else {
      if (agentDiggingPreviewActive && idx === agentDigPreviewIndex) {
        rec.targetRotX = 0;
      } else if (isSelected && !isUserCrateViewActive) {
        rec.targetRotX = 0; // perfectly upright when raised
      } else {
        rec.targetRotX = -0.10; // slightly leaning back
      }
    }

    rec.currentRotX += (rec.targetRotX - rec.currentRotX) * 0.12;
    rec.currentYOffset += (rec.targetYOffset - rec.currentYOffset) * 0.12;

    const effectiveRadius = (H / 2) + rec.currentYOffset;

    const localZOffset = effectiveRadius * Math.sin(rec.currentRotX);
    const localYOffset = effectiveRadius * Math.cos(rec.currentRotX);

    rec.mesh.rotation.x = rec.currentRotX;
    rec.mesh.position.z = rec.baseZ + localZOffset;
    rec.mesh.position.y = yPivot + localYOffset;
  });

  // User Crate Records Physics Simulation
  userRecordsData.forEach((rec, idx) => {
    if (idx < userActiveIndex) {
      rec.targetRotX = 0.40; // leaning forward
    } else if (idx > userActiveIndex) {
      rec.targetRotX = -0.20; // leaning backward
    } else {
      if (userIsSelected && isUserCrateViewActive) {
        rec.targetRotX = 0; // upright when raised
      } else {
        rec.targetRotX = -0.10;
      }
    }

    rec.currentRotX += (rec.targetRotX - rec.currentRotX) * 0.12;
    rec.currentYOffset += (rec.targetYOffset - rec.currentYOffset) * 0.12;

    const effectiveRadius = (H / 2) + rec.currentYOffset;

    const localZOffset = effectiveRadius * Math.sin(rec.currentRotX);
    const localYOffset = effectiveRadius * Math.cos(rec.currentRotX);

    rec.mesh.rotation.x = rec.currentRotX;
    rec.mesh.position.z = rec.baseZ + localZOffset;
    rec.mesh.position.y = yPivot + localYOffset;
  });

  // Render Scene
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

// Updates play/pause icons in the details panel tracklist
function updateTrackListIcons() {
  const trackItems = document.querySelectorAll('.track-item');
  trackItems.forEach(item => {
    const path = item.querySelector('.play-path');
    if (!path) return;

    const isCurrent = item.classList.contains('active');
    if (isCurrent && !audio.paused) {
      // Show PAUSE icon
      path.setAttribute('d', 'M6 19h4V5H6v14zm8-14v14h4V5h-4z');
    } else {
      // Show PLAY icon
      path.setAttribute('d', 'M8 5v14l11-7z');
    }
  });
}

function showStickyNoteModal() {
  const modal = document.getElementById('sticky-note-modal');
  if (modal) {
    modal.classList.remove('hidden');
    // Subtle organic zoom-in animation
    const paper = modal.querySelector('.postit-paper');
    if (paper) {
      paper.style.transform = 'scale(0.5) rotate(-10deg)';
      paper.style.opacity = '0';
      // Force repaint
      paper.offsetHeight;
      paper.style.transition = 'transform 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease';
      paper.style.transform = 'scale(1) rotate(-2deg)';
      paper.style.opacity = '1';
    }
  }
}

function hideStickyNoteModal() {
  const modal = document.getElementById('sticky-note-modal');
  if (modal) {
    const paper = modal.querySelector('.postit-paper');
    if (paper) {
      paper.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
      paper.style.transform = 'scale(0.8) rotate(5deg)';
      paper.style.opacity = '0';
      setTimeout(() => {
        modal.classList.add('hidden');
      }, 250);
    } else {
      modal.classList.add('hidden');
    }
  }
}

// Setup event listeners for sticky note modal
const closeStickyBtn = document.getElementById('close-sticky');
if (closeStickyBtn) {
  closeStickyBtn.addEventListener('click', hideStickyNoteModal);
}
const stickyModalEl = document.getElementById('sticky-note-modal');
if (stickyModalEl) {
  stickyModalEl.addEventListener('click', (e) => {
    if (e.target === stickyModalEl || e.target.classList.contains('sticky-note-container')) {
      hideStickyNoteModal();
    }
  });
}

const copyPromoBtn = document.getElementById('copy-promo-btn');
if (copyPromoBtn) {
  copyPromoBtn.addEventListener('click', () => {
    const codeText = document.getElementById('postit-code-text').innerText;
    navigator.clipboard.writeText(codeText).then(() => {
      copyPromoBtn.innerText = 'COPIED!';
      copyPromoBtn.classList.add('copied');
      setTimeout(() => {
        copyPromoBtn.innerText = 'COPY CODE';
        copyPromoBtn.classList.remove('copied');
      }, 2000);
    }).catch(err => {
      console.error('Failed to copy promo code:', err);
    });
  });
}

// Mobile Fullscreen Navigation Overlay Toggle Event Handlers
const menuToggleBtn = document.getElementById('menu-toggle-btn');
const mobileMenuOverlay = document.getElementById('mobile-menu-overlay');
const closeMenuBtn = document.getElementById('close-menu-btn');

if (menuToggleBtn && mobileMenuOverlay) {
  menuToggleBtn.addEventListener('click', () => {
    mobileMenuOverlay.classList.remove('hidden');
    // Animating layout in softly
    const logo = mobileMenuOverlay.querySelector('.mobile-menu-logo');
    const links = mobileMenuOverlay.querySelectorAll('.mobile-menu-link');
    if (logo) {
      logo.style.transform = 'translateY(-20px)';
      logo.style.opacity = '0';
      logo.offsetHeight; // force repaint
      logo.style.transition = 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease';
      logo.style.transform = 'translateY(0)';
      logo.style.opacity = '1';
    }
    links.forEach((link, idx) => {
      link.style.transform = 'translateY(20px)';
      link.style.opacity = '0';
      setTimeout(() => {
        link.style.transition = 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease';
        link.style.transform = 'translateY(0)';
        link.style.opacity = '1';
      }, 50 + idx * 50);
    });
  });
}

if (closeMenuBtn && mobileMenuOverlay) {
  closeMenuBtn.addEventListener('click', () => {
    mobileMenuOverlay.classList.add('hidden');
  });
}

// Close mobile overlay menu when clicking a link inside it
if (mobileMenuOverlay) {
  mobileMenuOverlay.addEventListener('click', (e) => {
    if (e.target.classList.contains('mobile-menu-link') || e.target === mobileMenuOverlay) {
      mobileMenuOverlay.classList.add('hidden');
    }
  });
}

// --- Auth and Crate Sync System ---
let currentUser = null;

function showLoginProcessingStatus(message, type = "info") {
  let statusBanner = document.getElementById('login-status-banner');
  if (!statusBanner) {
    statusBanner = document.createElement('div');
    statusBanner.id = 'login-status-banner';
    statusBanner.style.position = 'fixed';
    statusBanner.style.top = '24px';
    statusBanner.style.left = '50%';
    statusBanner.style.transform = 'translateX(-50%)';
    statusBanner.style.padding = '12px 24px';
    statusBanner.style.borderRadius = '8px';
    statusBanner.style.fontFamily = 'var(--font-mono)';
    statusBanner.style.fontSize = '0.8rem';
    statusBanner.style.letterSpacing = '0.08em';
    statusBanner.style.zIndex = '999999';
    statusBanner.style.boxShadow = '0 8px 32px rgba(0,0,0,0.5)';
    statusBanner.style.border = '1px solid var(--panel-border)';
    statusBanner.style.backdropFilter = 'blur(10px)';
    statusBanner.style.webkitBackdropFilter = 'blur(10px)';
    statusBanner.style.transition = 'all 0.3s ease';
    document.body.appendChild(statusBanner);
  }

  statusBanner.innerText = message;

  if (type === "error") {
    statusBanner.style.background = 'rgba(255, 0, 85, 0.85)';
    statusBanner.style.color = '#ffffff';
  } else if (type === "success") {
    statusBanner.style.background = 'rgba(3, 255, 0, 0.85)';
    statusBanner.style.color = '#000000';
  } else {
    statusBanner.style.background = 'rgba(20, 20, 25, 0.85)';
    statusBanner.style.color = 'var(--accent-color)';
  }

  statusBanner.style.opacity = '1';
  statusBanner.style.transform = 'translateX(-50%) translateY(0)';

  setTimeout(() => {
    statusBanner.style.opacity = '0';
    statusBanner.style.transform = 'translateX(-50%) translateY(-20px)';
  }, 4000);
}

function updateAuthUIState() {
  const accountBtn = document.getElementById('crate-account-btn');
  const unauthDiv = document.getElementById('auth-unauthenticated-state');
  const authDiv = document.getElementById('auth-authenticated-state');
  const emailSpan = document.getElementById('auth-user-email');

  if (!accountBtn) return;

  if (currentUser) {
    const emailStr = currentUser.email || "";
    accountBtn.innerText = emailStr.split('@')[0].toUpperCase();

    if (unauthDiv) unauthDiv.classList.add('hidden');
    if (authDiv) authDiv.classList.remove('hidden');
    if (emailSpan) emailSpan.innerText = emailStr;
  } else {
    accountBtn.innerText = "Save Crate";
    if (unauthDiv) unauthDiv.classList.remove('hidden');
    if (authDiv) authDiv.classList.add('hidden');
  }
}

function readLocalCrateItems() {
  const localCrateData = localStorage.getItem('seph_martin_crate');
  if (!localCrateData) return [];

  try {
    const parsed = JSON.parse(localCrateData);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("Invalid local crate JSON:", e);
    return [];
  }
}

function getOrderedUserCrateSlugs({ excludeAnimating = true } = {}) {
  let localItems = readLocalCrateItems();

  if (excludeAnimating && activeAnimations.length > 0) {
    const animatingSlugs = activeAnimations.map(anim => anim.slug).filter(Boolean);
    localItems = localItems.filter(slug => !animatingSlugs.includes(slug));
  }

  if (currentSearchQuery) {
    localItems = localItems.filter(slug => {
      const item = findMasterCatalogItem(slug);
      if (!item) return false;
      const titleMatch = item.title && item.title.toLowerCase().includes(currentSearchQuery);
      const artistMatch = item.artist && item.artist.toLowerCase().includes(currentSearchQuery);
      return titleMatch || artistMatch;
    });
  }

  if (currentFilter === 'latest') {
    localItems.reverse();
  } else if (currentFilter === 'popular') {
    localItems.sort((a, b) => {
      const itemA = findMasterCatalogItem(a);
      const itemB = findMasterCatalogItem(b);
      if (!itemA || !itemB) return 0;
      const popularityDifference = getCatalogPopularity(itemB) - getCatalogPopularity(itemA);
      if (popularityDifference !== 0) return popularityDifference;
      return compareCatalogItems(itemA, itemB);
    });
  } else if (currentFilter === 'oldest') {
    localItems.sort((a, b) => {
      const itemA = findMasterCatalogItem(a);
      const itemB = findMasterCatalogItem(b);
      if (!itemA || !itemB) return 0;
      return compareCatalogItems(itemA, itemB);
    });
  }

  return localItems;
}

async function checkUserSessionAndSync() {
  try {
    const sessionRes = await fetch('/api/auth/session');
    if (!sessionRes.ok) return;
    const sessionData = await sessionRes.json();

    if (sessionData.authenticated && sessionData.user) {
      currentUser = sessionData.user;
      console.log("Authenticated user session loaded:", currentUser);

      updateAuthUIState();

      const statusText = document.getElementById('sync-status-text');
      if (statusText) statusText.innerText = "Syncing...";

      const localItems = readLocalCrateItems();
      let serverItems = [];

      const getRes = await fetch('/api/crate/sync');
      if (getRes.ok) {
        const getData = await getRes.json();
        if (Array.isArray(getData.items)) {
          serverItems = getData.items;
        }
      }

      const mergedItems = [...new Set(
        [...serverItems, ...localItems]
          .map(item => String(item).trim())
          .filter(Boolean)
      )];

      let finalItems = mergedItems;
      if (mergedItems.length > 0) {
        const syncRes = await fetch('/api/crate/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: mergedItems })
        });

        if (syncRes.ok) {
          const syncData = await syncRes.json();
          if (Array.isArray(syncData.items)) {
            finalItems = syncData.items;
          }
        }
      }

      localStorage.setItem('seph_martin_crate', JSON.stringify(finalItems));
      if (typeof updateCrateUI === 'function') {
        updateCrateUI(finalItems);
      }

      if (statusText) statusText.innerText = "Crate Synced";
    } else {
      currentUser = null;
      updateAuthUIState();
    }
  } catch (error) {
    console.warn("Session check/sync failed:", error);
  }
}

async function handleUrlLoginVerification() {
  const urlParams = new URLSearchParams(window.location.search);
  const loginToken = urlParams.get('login_token');

  if (loginToken) {
    showLoginProcessingStatus("VERIFYING LOGIN LINK...");

    const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
    window.history.replaceState({ path: cleanUrl }, '', cleanUrl);

    try {
      const res = await fetch(`/api/auth/verify-magic-link?token=${encodeURIComponent(loginToken)}`);
      if (!res.ok) throw new Error("Link expired or invalid");
      const data = await res.json();

      if (data.ok) {
        showLoginProcessingStatus("LOGIN SUCCESSFUL!", "success");
        await checkUserSessionAndSync();
      } else {
        showLoginProcessingStatus("LOGIN FAILED. EXPIRED LINK.", "error");
        await checkUserSessionAndSync();
      }
    } catch (err) {
      console.error("Login verification failed:", err);
      showLoginProcessingStatus("LOGIN FAILED. LINK MAY BE EXPIRED.", "error");
      await checkUserSessionAndSync();
    }
  } else {
    await checkUserSessionAndSync();
  }
}

function initAuthUI() {
  const accountBtn = document.getElementById('crate-account-btn');
  const authModal = document.getElementById('crate-auth-modal');
  const closeAuthBtn = document.getElementById('close-auth-modal');
  const emailInput = document.getElementById('auth-email-input');
  const submitBtn = document.getElementById('auth-submit-btn');
  const logoutBtn = document.getElementById('auth-logout-btn');
  const errorMsg = document.getElementById('auth-error-msg');

  if (accountBtn && authModal) {
    accountBtn.addEventListener('click', () => {
      authModal.classList.remove('hidden');
      updateAuthUIState();
    });
  }

  if (closeAuthBtn && authModal) {
    closeAuthBtn.addEventListener('click', () => {
      authModal.classList.add('hidden');
    });

    // Close on overlay click
    authModal.addEventListener('click', (e) => {
      if (e.target === authModal) {
        authModal.classList.add('hidden');
      }
    });
  }

  if (submitBtn && emailInput) {
    submitBtn.addEventListener('click', async () => {
      const email = emailInput.value.trim();

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email || email.length > 254 || !emailRegex.test(email)) {
        if (errorMsg) {
          errorMsg.innerText = "PLEASE ENTER A VALID EMAIL.";
          errorMsg.classList.remove('hidden');
        }
        return;
      }

      if (errorMsg) errorMsg.classList.add('hidden');
      submitBtn.innerText = "SENDING...";
      submitBtn.disabled = true;

      try {
        const res = await fetch('/api/auth/magic-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });

        if (res.ok) {
          showLoginProcessingStatus("MAGIC LINK SENT TO YOUR INBOX!", "success");
          emailInput.value = "";
          authModal.classList.add('hidden');
        } else {
          if (errorMsg) {
            errorMsg.innerText = "FAILED TO SEND LINK. TRY AGAIN.";
            errorMsg.classList.remove('hidden');
          }
        }
      } catch (err) {
        console.error("Magic link request failed:", err);
        if (errorMsg) {
          errorMsg.innerText = "CONNECTION ERROR. TRY AGAIN.";
          errorMsg.classList.remove('hidden');
        }
      } finally {
        submitBtn.innerText = "SEND LINK";
        submitBtn.disabled = false;
      }
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      logoutBtn.innerText = "LOGGING OUT...";
      logoutBtn.disabled = true;
      try {
        const res = await fetch('/api/auth/logout', { method: 'POST' });
        if (res.ok) {
          currentUser = null;
          showLoginProcessingStatus("LOGGED OUT SECURELY.", "info");
          updateAuthUIState();
          authModal.classList.add('hidden');
        }
      } catch (err) {
        console.error("Logout request failed:", err);
      } finally {
        logoutBtn.innerText = "LOG OUT";
        logoutBtn.disabled = false;
      }
    });
  }

  const saveLink = document.getElementById('crate-save-link');
  if (saveLink && authModal) {
    saveLink.addEventListener('click', (e) => {
      e.preventDefault();
      authModal.classList.remove('hidden');
      updateAuthUIState();
    });
  }
}

function rebuildUserCrateRecords() {
  if (!userCrateGroup) return;

  // Clean out all current meshes in the user crate
  if (userRecordsData.length > 0) {
    userRecordsData.forEach(rec => userCrateGroup.remove(rec.mesh));
    userRecordsData = [];
  }

  const localItems = getOrderedUserCrateSlugs();

  const count = localItems.length;
  userActiveIndex = Math.max(0, Math.min(count - 1, userActiveIndex));
  if (count === 0) {
    deselectRecord();
    return;
  }
  
  const edgeTexture = createCardboardEdgeTexture();
  const H = 0.31;
  const W = 0.315;
  const T = 0.0022;
  
  const startZ = -0.125;
  const endZ = 0.08;
  const rangeZ = endZ - startZ;
  const spacing = count > 1 ? Math.min(0.015, rangeZ / (count - 1)) : 0;
  const actualZOffset = count > 1 ? Math.max(0, (rangeZ - (spacing * (count - 1))) / 2) : 0;
  
  const sleeveGeo = new THREE.BoxGeometry(W, H, T);
  const backSleeveMaterial = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.85,
    metalness: 0.05
  });
  
  localItems.forEach((slug, i) => {
    const item = findMasterCatalogItem(slug);
    if (!item) return;
    
    const frontMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.5,
      metalness: 0.05
    });
    
    const imageUrl = resolveCatalogImageUrl(item.image);
    if (imageUrl) {
      const isExternal = isCrossOriginCatalogImage(imageUrl);
      
      const cachedTexture = textureCache.get(imageUrl);
      if (cachedTexture) {
        frontMaterial.map = cachedTexture;
        frontMaterial.needsUpdate = true;
      } else {
        textureLoader.crossOrigin = isExternal ? 'anonymous' : '';
        textureLoader.load(imageUrl, (texture) => {
          textureCache.set(imageUrl, texture);
          texture.colorSpace = THREE.SRGBColorSpace;
          frontMaterial.map = texture;
          frontMaterial.needsUpdate = true;
        });
      }
    }
    
    const rightMat = new THREE.MeshStandardMaterial({ color: 0x333333, map: edgeTexture });
    const leftMat = new THREE.MeshStandardMaterial({ color: 0x333333, map: edgeTexture });
    const topMat = new THREE.MeshStandardMaterial({ color: 0x333333, map: edgeTexture });
    const bottomMat = new THREE.MeshStandardMaterial({ color: 0x333333, map: edgeTexture });
    
    const materials = [rightMat, leftMat, topMat, bottomMat, frontMaterial, backSleeveMaterial];
    const sleeveMesh = new THREE.Mesh(sleeveGeo, materials);
    sleeveMesh.castShadow = true;
    sleeveMesh.receiveShadow = true;
    sleeveMesh.userData = { index: i, slug: slug, isUserCrate: true };
    
    const baseZ = endZ - actualZOffset - (i * spacing);
    sleeveMesh.position.set(0, -0.15 + (H / 2), baseZ);
    sleeveMesh.rotation.x = -0.20; // resting posture
    
    userCrateGroup.add(sleeveMesh);
    userRecordsData.push({
      mesh: sleeveMesh,
      recordId: getCrateRecordId(item),
      slug: slug,
      baseZ: baseZ,
      currentYOffset: 0,
      targetYOffset: 0,
      currentRotX: -0.20,
      targetRotX: -0.20
    });
  });
}

function triggerVinylFlyAnimation(slug, onComplete) {
  // Find record in primary catalog listing
  const mainRecordIdx = catalog.findIndex(c => getCrateRecordId(c) === slug);
  if (mainRecordIdx === -1 || !userCrateGroup) return false;
  const activeRecord = recordsData[mainRecordIdx];
  if (!activeRecord) return false;
  
  // Clone selected sleeve mesh
  const cloneMesh = activeRecord.mesh.clone();
  scene.add(cloneMesh);
  
  // Match starting world coordinates
  const startPos = new THREE.Vector3();
  const startQuat = new THREE.Quaternion();
  activeRecord.mesh.getWorldPosition(startPos);
  activeRecord.mesh.getWorldQuaternion(startQuat);
  cloneMesh.position.copy(startPos);
  cloneMesh.quaternion.copy(startQuat);

  const orderedItems = getOrderedUserCrateSlugs({ excludeAnimating: false });
  const userIdx = orderedItems.indexOf(slug);
  const userCrateCount = orderedItems.length;
  
  const H = 0.31;
  const startZ = -0.125;
  const endZ = 0.08;
  const rangeZ = endZ - startZ;
  const spacing = userCrateCount > 1 ? Math.min(0.015, rangeZ / (userCrateCount - 1)) : 0;
  const actualZOffset = userCrateCount > 1 ? Math.max(0, (rangeZ - (spacing * (userCrateCount - 1))) / 2) : 0;
  const targetZ = endZ - actualZOffset - ((userIdx > -1 ? userIdx : userCrateCount - 1) * spacing);
  
  // End position is the exact local slot that rebuildUserCrateRecords will render.
  const endPos = new THREE.Vector3(0, -0.15 + (H / 2), targetZ);
  userCrateGroup.localToWorld(endPos);
  const startRot = cloneMesh.rotation.clone();
  const distance = startPos.distanceTo(endPos);
  
  activeAnimations.push({
    mesh: cloneMesh,
    slug: slug,
    start: startPos,
    end: endPos,
    startRotX: startRot.x,
    startRotY: startRot.y,
    startRotZ: startRot.z,
    endRotX: -0.20,
    endRotY: 0,
    endRotZ: 0,
    arcHeight: Math.max(0.24, Math.min(0.42, distance * 0.28)),
    onComplete,
    progress: 0,
    speed: 0.014
  });

  return true;
}

function updateMyCrateBadge() {
  const localItems = readLocalCrateItems();
  const counterPill = document.getElementById('mycrate-counter-pill');
  const switcher = document.querySelector('.view-switcher-pill');
  if (counterPill) {
    counterPill.innerText = localItems.length;
    if (localItems.length > 0) {
      counterPill.classList.remove('hidden');
      if (switcher) switcher.classList.remove('hidden');
    } else {
      counterPill.classList.add('hidden');
      if (switcher) switcher.classList.add('hidden');
      
      if (isUserCrateViewActive) {
        isUserCrateViewActive = false;
        globalCamXOffset = 0;
        const shopBtn = document.getElementById('view-shop-btn');
        const myCrateBtn = document.getElementById('view-mycrate-btn');
        if (shopBtn) shopBtn.classList.add('active');
        if (myCrateBtn) myCrateBtn.classList.remove('active');
      }
    }
  }
  updateUIControlsState();
}

function updateUIControlsState() {
  const checkoutSummary = getCheckoutSummary();
  const hasPersonal = checkoutSummary.checkout_available;
  
  const filterSwitcher = document.querySelector('.filter-switcher-pill');
  const filterCompactBtn = document.getElementById('filter-compact-btn');
  const searchPill = document.getElementById('search-pill-container');
  const checkoutBtn = document.getElementById('checkout-btn');
  const panelCheckoutBtn = document.getElementById('panel-checkout-btn');
  const viewSwitcher = document.querySelector('.view-switcher-pill');

  const isMobile = window.innerWidth <= 768;

  // Sync container classes to avoid WebKit :has() recalculation bugs on mobile devices
  if (viewSwitcher) {
    if (isUserCrateViewActive) {
      viewSwitcher.classList.add('active-mycrate');
    } else {
      viewSwitcher.classList.remove('active-mycrate');
    }
  }

  if (filterSwitcher) {
    if (currentFilter === 'popular') {
      filterSwitcher.classList.add('active-popular');
    } else {
      filterSwitcher.classList.remove('active-popular');
    }
  }

  if (isUserCrateViewActive) {
    // 1. Personal mode controls
    // Hide filter switcher completely
    if (filterSwitcher) filterSwitcher.classList.add('hidden');
    if (filterCompactBtn) filterCompactBtn.classList.add('hidden');
    
    // Hide search completely on mobile when in personal crate view
    if (searchPill) {
      if (isMobile) {
        searchPill.classList.add('hidden');
        searchPill.classList.remove('collapsed', 'search-active');
        const searchInput = document.getElementById('crate-search');
        if (searchInput && searchInput.value !== '') {
          searchInput.value = '';
          currentSearchQuery = '';
          filterRecords();
        }
      } else {
        searchPill.classList.remove('hidden');
        if (!searchPill.classList.contains('search-active')) {
          searchPill.classList.add('collapsed');
        } else {
          searchPill.classList.remove('collapsed');
        }
      }
    }
    
  } else {
    // 2. Public SHOP mode controls
    if (checkoutBtn) checkoutBtn.classList.add('hidden');
    
    // Ensure search pill is visible in Shop mode
    if (searchPill) {
      searchPill.classList.remove('hidden');
      const shouldCollapseSearch = isMobile;
      if (shouldCollapseSearch) {
        if (!searchPill.classList.contains('search-active')) {
          searchPill.classList.add('collapsed');
        } else {
          searchPill.classList.remove('collapsed');
        }
      } else {
        searchPill.classList.remove('collapsed', 'search-active');
      }
    }

    if (hasPersonal) {
      // If they have items in personal crate, compress filter switcher to a single icon by default!
      const isFilterExpanded = filterCompactBtn && filterCompactBtn.classList.contains('expanded');
      if (isFilterExpanded) {
        if (filterSwitcher) filterSwitcher.classList.remove('hidden');
        if (filterCompactBtn) filterCompactBtn.classList.remove('hidden');
      } else {
        if (filterSwitcher) filterSwitcher.classList.add('hidden');
        if (filterCompactBtn) {
          filterCompactBtn.classList.remove('hidden');
          if (currentFilter === 'popular') {
            filterCompactBtn.classList.add('active');
          } else {
            filterCompactBtn.classList.remove('active');
          }
        }
      }
    } else {
      // Classic view: show full filter switcher
      if (filterSwitcher) filterSwitcher.classList.remove('hidden');
      if (filterCompactBtn) filterCompactBtn.classList.add('hidden');
    }
  }

  if (checkoutBtn) {
    const checkoutEnabled = isUserCrateViewActive && hasPersonal;
    const activeDemoItem = getActiveUserCrateItem();
    const activeDemoPurchase = isDemoCheckoutSimulatorEnabled() && activeDemoItem
      ? getDemoPurchaseForRecord(activeDemoItem)
      : null;
    syncDemoCheckoutButton(checkoutBtn, activeDemoPurchase ? activeDemoItem : null);
    checkoutBtn.classList.toggle('hidden', !checkoutEnabled);
    checkoutBtn.disabled = !checkoutEnabled || checkoutInFlight;
    checkoutBtn.setAttribute('aria-disabled', String(!checkoutEnabled || checkoutInFlight));
    checkoutBtn.title = checkoutEnabled
      ? activeDemoPurchase
        ? demoCompletedRecordIds.has(getCrateRecordId(activeDemoItem))
          ? 'The demo preview has reached its end'
          : 'Reach the end of the demo preview'
        : 'Review checkout for the records in My Crate'
      : 'Add a record to My Crate before checkout';
  }

  if (panelCheckoutBtn) {
    const checkoutEnabled = isUserCrateViewActive && hasPersonal;
    const activeDemoItem = getActiveUserCrateItem();
    const activeDemoPurchase = isDemoCheckoutSimulatorEnabled() && activeDemoItem
      ? getDemoPurchaseForRecord(activeDemoItem)
      : null;
    syncDemoCheckoutButton(panelCheckoutBtn, activeDemoPurchase ? activeDemoItem : null);
    panelCheckoutBtn.classList.toggle('hidden', !checkoutEnabled);
    panelCheckoutBtn.disabled = !checkoutEnabled || checkoutInFlight;
    panelCheckoutBtn.setAttribute('aria-disabled', String(!checkoutEnabled || checkoutInFlight));
    panelCheckoutBtn.title = checkoutEnabled
      ? activeDemoPurchase
        ? demoCompletedRecordIds.has(getCrateRecordId(activeDemoItem))
          ? 'The demo preview has reached its end'
          : 'Reach the end of the demo preview'
        : 'Review checkout for the records in My Crate'
      : 'Add a record to My Crate before checkout';
  }

  // Update total price on Buy Crate button
  const totalSpan = document.getElementById('checkout-total');
  if (totalSpan) {
    totalSpan.innerText = `€${(checkoutSummary.total_cents / 100).toFixed(2)}`;
  }
  const panelTotalSpan = document.querySelector('.panel-checkout-total');
  if (panelTotalSpan) {
    panelTotalSpan.innerText = `€${(checkoutSummary.total_cents / 100).toFixed(2)}`;
  }

  // Release visibility and selection can change without an audio event
  // (for example after adding/removing a crate item). Keep the orb transport
  // buttons in sync with the currently navigable track/release surface.
  syncPlayerTransportControls();
}

function collapseFilterSwitcher() {
  const localItems = readLocalCrateItems();
  if (localItems.length > 0 && !isUserCrateViewActive) {
    const filterCompactBtn = document.getElementById('filter-compact-btn');
    const filterSwitcher = document.querySelector('.filter-switcher-pill');
    const viewSwitcher = document.querySelector('.view-switcher-pill');
    if (filterCompactBtn && filterSwitcher && viewSwitcher) {
      filterCompactBtn.classList.remove('hidden');
      filterSwitcher.classList.add('hidden');
      viewSwitcher.classList.remove('hidden-by-filter');
      
      if (currentFilter === 'popular') {
        filterCompactBtn.classList.add('active');
      } else {
        filterCompactBtn.classList.remove('active');
      }
    }
  }
}

// Global click listener to collapse filter switcher when clicking outside
window.addEventListener('click', (e) => {
  const filterSwitcher = document.querySelector('.filter-switcher-pill');
  if (filterSwitcher && !filterSwitcher.classList.contains('hidden')) {
    const localItems = readLocalCrateItems();
    if (localItems.length > 0 && !isUserCrateViewActive) {
      if (!filterSwitcher.contains(e.target) && e.target.id !== 'filter-compact-btn' && !e.target.closest('#filter-compact-btn')) {
        collapseFilterSwitcher();
      }
    }
  }
});
