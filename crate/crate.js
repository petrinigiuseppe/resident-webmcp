/* --- 3D Vinyl Crate digging (Beta) crate.js --- */
import * as THREE from './vendor/three.module.js';

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

// Agent-native visual state. WebMCP owns the state transition; the renderer
// only responds to it so the normal human interaction path stays intact.
let agentVisualState = 'human';
let agentVisualOperation = 'human';
let agentFocusRecordIds = new Set();
let agentFocusRevision = 0;
let baseSpotLightIntensity = 2.5;
let agentDigPreviewTimer = null;
let agentDigPreviewToken = 0;
let agentDigPreviewIndex = -1;
let agentDigPreviewSnapshot = null;

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
let audio = new Audio();
let currentPlayingTrackId = null;
let currentPlayingTrackItem = null;
let siteAudioEnabled = true;

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
  if (agentVisualState === 'busy' && agentVisualOperation === 'digging') {
    startAgentDigPreview();
  } else {
    stopAgentDigPreview();
  }
});

window.addEventListener('seph-agent-sound', event => {
  const enabled = event.detail?.enabled;
  if (typeof enabled !== 'boolean') return;
  siteAudioEnabled = enabled;
  audio.muted = !siteAudioEnabled;
  document.documentElement.dataset.siteAudio = siteAudioEnabled ? 'on' : 'off';
});

window.addEventListener('seph-agent-focus', event => {
  agentFocusRecordIds = new Set(
    (event.detail?.record_ids || [])
      .map(value => String(value).trim())
      .filter(Boolean)
  );
  syncAgentFocusVisuals();
});

function filterAndSortCatalog(skipApply = false) {
  const localItems = readLocalCrateItems();
  let workingList = masterCatalog.filter(item => {
    const slug = item.page_url.split('/').pop();
    return !localItems.includes(slug);
  });

  // 1. Sort logic
  if (currentFilter === 'latest') {
    workingList.sort((a, b) => {
      const isOceanA = a.title && a.title.toLowerCase().includes("ocean");
      const isOceanB = b.title && b.title.toLowerCase().includes("ocean");
      if (isOceanA && !isOceanB) return -1;
      if (!isOceanA && isOceanB) return 1;

      const dateA = a.release_date ? new Date(a.release_date) : new Date(0);
      const dateB = b.release_date ? new Date(b.release_date) : new Date(0);
      return dateB - dateA;
    });
  } else if (currentFilter === 'popular') {
    workingList.sort((a, b) => {
      const getSlug = (item) => {
        if (item.slug) return item.slug;
        if (item.page_url) return item.page_url.replace(/^\//, '').replace(/\//g, '-');
        return '';
      };

      const slugA = getSlug(a);
      const slugB = getSlug(b);

      const aUnits = bestSellersMap.get(slugA) || 0;
      const bUnits = bestSellersMap.get(slugB) || 0;
      if (bUnits !== aUnits) return bUnits - aUnits;

      const aPrio = typeof a.sort_priority === 'number' ? a.sort_priority : 0;
      const bPrio = typeof b.sort_priority === 'number' ? b.sort_priority : 0;
      if (aPrio !== bPrio) return bPrio - aPrio;

      const dateA = a.release_date ? new Date(a.release_date) : new Date(0);
      const dateB = b.release_date ? new Date(b.release_date) : new Date(0);
      return dateB - dateA;
    });
  }

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

  if (!skipApply) {
    applyCatalogUpdates();
  }
  rebuildUserCrateRecords();
}

function getCrateRecordId(item) {
  const pageUrl = String(item?.page_url || '');
  const pageSlug = pageUrl.split('/').filter(Boolean).pop();
  return String(item?.record_id || pageSlug || item?.slug || '').trim();
}

function findMasterCatalogItem(recordId) {
  const normalized = String(recordId || '').trim();
  if (!normalized) return null;
  return masterCatalog.find(item => (
    getCrateRecordId(item) === normalized ||
    String(item?.slug || '') === normalized ||
    String(item?.page_url || '') === normalized
  )) || null;
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
    release_date: item.release_date || null,
    track_count: Array.isArray(item.tracks) ? item.tracks.length : 0
  };
}

function setSearchQuery(query) {
  const normalized = String(query || '').toLowerCase().trim().slice(0, 200);
  currentSearchQuery = normalized;

  const searchInput = document.getElementById('crate-search');
  const clearBtn = document.getElementById('search-clear');
  if (searchInput && searchInput.value !== normalized) searchInput.value = normalized;
  if (clearBtn) clearBtn.classList.toggle('hidden', !normalized);

  filterAndSortCatalog();
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

  isUserCrateViewActive = false;
  globalCamXOffset = 0;
  const shopBtn = document.getElementById('view-shop-btn');
  const myCrateBtn = document.getElementById('view-mycrate-btn');
  if (shopBtn) shopBtn.classList.add('active');
  if (myCrateBtn) myCrateBtn.classList.remove('active');
  selectRecord(visibleIndex);
  return { ok: true, record: summarizeCrateItem(item), view: 'shop', index: visibleIndex };
}

function showMyCrateView() {
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
    return {
      ok: false,
      error: { code: 'EMPTY_MY_CRATE', message: 'My Crate is empty. Add at least one record before checkout.' },
      view: 'shop',
      cart_count: 0,
      checkout_available: false
    };
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
  return { ok: true, view: 'my_crate', cart_count: checkoutSummary.cart_count };
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

function manageCrateRecord(recordId, action) {
  const item = findMasterCatalogItem(recordId);
  if (!item) {
    return { ok: false, error: { code: 'RECORD_NOT_FOUND', message: 'Record is not in the loaded catalog.' } };
  }

  const normalizedId = getCrateRecordId(item);
  const existingItems = readLocalCrateItems();
  const alreadyInCrate = existingItems.includes(normalizedId);
  if (action === 'add' && alreadyInCrate) {
    return { ok: true, changed: false, action, record: summarizeCrateItem(item), cart_count: existingItems.length };
  }
  if (action === 'remove' && !alreadyInCrate) {
    return { ok: true, changed: false, action, record: summarizeCrateItem(item), cart_count: existingItems.length };
  }

  const focused = focusRecordById(normalizedId);
  if (!focused.ok) return focused;

  const buyBtn = document.getElementById('buy-btn');
  if (!buyBtn) {
    return { ok: false, error: { code: 'CRATE_CONTROL_UNAVAILABLE', message: 'The existing Add to Crate control is unavailable.' } };
  }

  // Reuse the existing UI handler so local storage, animation, badge and
  // account-sync behavior remain one code path. This never reaches checkout.
  buyBtn.click();
  const updatedItems = readLocalCrateItems();
  return {
    ok: true,
    changed: true,
    action,
    record: summarizeCrateItem(item),
    cart_count: updatedItems.length,
    purchase_started: false
  };
}

function publishCrateApi() {
  const api = {
    status: () => ({
      ready: masterCatalog.length > 0,
      catalog_loaded: masterCatalog.length > 0,
      item_count: masterCatalog.length,
      visible_item_count: catalog.length,
      cart_count: readLocalCrateItems().length,
      site_audio_enabled: siteAudioEnabled,
      webgl: Boolean(renderer),
      webmcp_candidate: Boolean(document.modelContext),
      purchase_automation: false
    }),
    getMasterCatalog: () => masterCatalog.slice(),
    getVisibleCatalog: () => catalog.slice(),
    searchCatalog: (query, maxResults = 12) => {
      const normalized = String(query || '').toLowerCase().trim();
      return masterCatalog
        .filter(item => (
          String(item.title || '').toLowerCase().includes(normalized) ||
          String(item.artist || '').toLowerCase().includes(normalized)
        ))
        .slice(0, Math.max(1, Math.min(24, Number(maxResults) || 12)))
        .map(summarizeCrateItem);
    },
    setSearchQuery,
    focusRecord: focusRecordById,
    openRecordDetails: focusRecordById,
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

function applyCatalogUpdates() {
  const count = catalog.length;

  recordsData.forEach((rec, idx) => {
    if (idx < count) {
      const item = catalog[idx];

      // Make mesh visible and update its index pointer
      rec.mesh.visible = true;
      rec.recordId = getCrateRecordId(item);
      rec.mesh.userData = { index: idx, record_id: rec.recordId };
      syncAgentFocusVisuals();

      // Staggered ripple shuffle drop (idx * 25ms delay)
      const delay = idx * 25;
      setTimeout(() => {
        // Trigger a drop from above
        rec.currentYOffset = 0.25;
        rec.targetYOffset = 0;
        rec.targetRotX = -0.20;

        // Update texture map
        let imageUrl = item.image;
        const isExternal = imageUrl && imageUrl.startsWith('http') && !imageUrl.includes(window.location.hostname);
        if (isExternal) {
          imageUrl = '/api/proxy-image?url=' + encodeURIComponent(imageUrl);
        }

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
  deselectRecord();
}

// Load catalog from API or fallback
async function loadCatalogData() {
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
    catalog = await response.json();
    console.log('Catalog loaded from API:', catalog);
  } catch (error) {
    console.warn('API Catalog fetch failed. Using fallback catalog:', error);
    catalog = FALLBACK_CATALOG;
  }

  // Format/sanitize catalog data
  catalog = catalog.filter(item => item.tracks && item.tracks.length > 0);

  if (catalog.length === 0) {
    catalog = FALLBACK_CATALOG;
  }

  masterCatalog = [...catalog];
  filterAndSortCatalog(true); // Initial sort (latest order, Ocean's Groove first)
  publishCrateApi();



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
      userActiveIndex = newIndex;
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
      activeIndex = newIndex;
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
      latestBtn.classList.add('active');
      popularBtn.classList.remove('active');
      if (filterPill) filterPill.classList.remove('active-popular');
      currentFilter = 'latest';
      filterAndSortCatalog();
      collapseFilterSwitcher();
    });

    popularBtn.addEventListener('click', () => {
      if (currentFilter === 'popular') {
        collapseFilterSwitcher();
        return;
      }
      popularBtn.classList.add('active');
      latestBtn.classList.remove('active');
      if (filterPill) filterPill.classList.add('active-popular');
      currentFilter = 'popular';
      filterAndSortCatalog();
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

  // Keyboard navigation (ignore if typing in search input, except for Escape)
  window.addEventListener('keydown', (e) => {
    hideHelper();
    if (document.activeElement && document.activeElement.tagName === 'INPUT') {
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
    } else if (e.key === ' ') {
      const detailsOpen = !document.getElementById('details-panel').classList.contains('hidden');
      if (detailsOpen) {
        e.preventDefault();
        toggleAudioPlayback();
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
  playPauseBtn.addEventListener('click', toggleAudioPlayback);

  audio.addEventListener('timeupdate', () => {
    const fill = document.getElementById('player-progress-fill');
    const currentTimeEl = document.getElementById('player-current-time');

    if (audio.duration) {
      const pct = (audio.currentTime / audio.duration) * 100;
      fill.style.width = `${pct}%`;
      currentTimeEl.innerText = formatTime(audio.currentTime);
    }
  });

  audio.addEventListener('loadedmetadata', () => {
    const totalTimeEl = document.getElementById('player-total-time');
    totalTimeEl.innerText = formatTime(audio.duration);
  });

  audio.addEventListener('ended', () => {
    const playIcon = document.querySelector('.play-icon');
    const pauseIcon = document.querySelector('.pause-icon');
    playIcon.classList.remove('hidden');
    pauseIcon.classList.add('hidden');

    // Clear active track state in lists
    if (currentPlayingTrackItem) {
      currentPlayingTrackItem.classList.remove('active');
    }

    // Auto-play next track if available
    playNextTrack();
  });

  audio.addEventListener('play', updateTrackListIcons);
  audio.addEventListener('pause', updateTrackListIcons);

  // Progress bar scrub
  const progressBar = document.getElementById('player-progress-bar');
  progressBar.addEventListener('click', (e) => {
    const rect = progressBar.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const pct = clickX / width;

    if (audio.duration) {
      audio.currentTime = pct * audio.duration;
    }
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
      const span = buyBtn.querySelector('span');
      
      const promptEl = document.getElementById('crate-save-prompt');
      
      if (idx > -1) {
        localItems.splice(idx, 1);
        localStorage.setItem('seph_martin_crate', JSON.stringify(localItems));
        if (span) span.innerText = "Add to Crate";
        buyBtn.classList.remove('in-crate');
        
        rebuildUserCrateRecords();
        filterAndSortCatalog();
        updateMyCrateBadge();
        
        if (currentUser) {
          checkUserSessionAndSync();
        }
      } else {
        localItems.push(slug);
        localStorage.setItem('seph_martin_crate', JSON.stringify(localItems));
        if (span) span.innerText = "In Crate (Remove)";
        buyBtn.classList.add('in-crate');
        
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
          filterAndSortCatalog();
          deselectRecord();
        });
        updateMyCrateBadge();

        if (!animationStarted) {
          filterAndSortCatalog();
          deselectRecord();
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
      isUserCrateViewActive = false;
      globalCamXOffset = 0;
      shopBtn.classList.add('active');
      myCrateBtn.classList.remove('active');
      if (viewSwitcher) viewSwitcher.classList.remove('active-mycrate');
      deselectRecord();
      updateUIControlsState();
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

  // 3. Checkout Button Action (Cart checkout endpoint integration)
  const checkoutBtn = document.getElementById('checkout-btn');
  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', async () => {
      const localItems = readLocalCrateItems();
      const validItems = localItems.map(findMasterCatalogItem).filter(Boolean);
      if (validItems.length === 0) {
        updateUIControlsState();
        return;
      }

      checkoutBtn.disabled = true;
      const originalContent = checkoutBtn.innerHTML;
      checkoutBtn.innerText = "PREPARING...";

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
        const validSlugs = validItems.map(item => getCrateRecordId(item));
        const baseSlug = firstItem.slug || validSlugs[0];
        
        const params = new URLSearchParams();
        params.set('slug', baseSlug);
        params.set('cart_items', String(validItems.length));
        params.set('cart_total_cents', String(sumCents));
        params.set('cart_slugs', validSlugs.join(','));
        params.set('cart_lines', JSON.stringify(cartLines));
        params.set('return_to', '/');

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
          try {
            await fetch('/api/analytics-event', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                event: 'checkout_redirect',
                session_id: localStorage.getItem('seph_martin_session') || '',
                item_slug: baseSlug
              })
            });
          } catch(e){}
          
          window.location.href = data.url;
        } else {
          throw new Error("Invalid response payload");
        }
      } catch (err) {
        console.error("Checkout failed:", err);
        showTopErrorNotification(`CHECKOUT ERROR: ${err.message || 'Please try again.'}`);
        checkoutBtn.disabled = false;
        checkoutBtn.innerHTML = originalContent;
      }
    });
  }

  // Handle browser back-forward cache pageshow reload to restore checkout button state
  window.addEventListener('pageshow', (event) => {
    const checkoutBtn = document.getElementById('checkout-btn');
    if (checkoutBtn) {
      checkoutBtn.disabled = false;
      updateUIControlsState();
    }
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

  // Listen for prefers-color-scheme media changes
  try {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      syncThemeWithBrowser();
    });
  } catch (e) {
    try {
      window.matchMedia('(prefers-color-scheme: light)').addListener(() => {
        syncThemeWithBrowser();
      });
    } catch (err) {}
  }

  // Responsive resizing
  window.addEventListener('resize', onWindowResize);
}

function syncThemeWithBrowser() {
  if (!scene) return;
  const isLightMode = window.matchMedia('(prefers-color-scheme: light)').matches;
  const isMobile = window.innerWidth < 1024;

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

function onWindowResize() {
  const container = document.getElementById('canvas-container');
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
  updateCameraPosition();
  syncAgentCrateFrame();
  syncThemeWithBrowser();
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
        baseZ: baseZ,
        currentYOffset: 0,
        targetYOffset: 0,
        currentRotX: -0.20,
        targetRotX: -0.20
      });

      // Only load priority covers immediately
      if (i < priorityLimit) {
        let imageUrl = item.image;
        const isExternal = imageUrl && imageUrl.startsWith('http') && !imageUrl.includes(window.location.hostname);
        if (isExternal) {
          imageUrl = '/api/proxy-image?url=' + encodeURIComponent(imageUrl);
        }

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
      let imageUrl = item.image;
      const isExternal = imageUrl && imageUrl.startsWith('http') && !imageUrl.includes(window.location.hostname);
      if (isExternal) {
        imageUrl = '/api/proxy-image?url=' + encodeURIComponent(imageUrl);
      }

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
  const agentPreviewActive = agentVisualState === 'busy'
    && agentVisualOperation === 'digging'
    && !isUserCrateViewActive;
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

  // An agent dig is a shop-wide operation. If the user was looking at My
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
      || agentVisualState !== 'busy'
      || agentVisualOperation !== 'digging'
      || isUserCrateViewActive
    ) return;

    const availableIndexes = recordsData
      .map((record, index) => index < catalog.length && record.mesh.visible ? index : -1)
      .filter(index => index >= 0);
    if (availableIndexes.length === 0) {
      agentDigPreviewTimer = window.setTimeout(tick, 140);
      return;
    }

    agentDigPreviewIndex = availableIndexes[cursor % availableIndexes.length];
    activeIndex = agentDigPreviewIndex;
    isSelected = true;
    document.documentElement.dataset.agentDigPreviewIndex = String(agentDigPreviewIndex);
    showRecordDetails(agentDigPreviewIndex);
    updateRecordHeights();
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
function deselectRecord() {
  isSelected = false;
  userIsSelected = false;
  updateRecordHeights();

  const panel = document.getElementById('details-panel');
  panel.classList.add('hidden');
  panel.classList.remove('show-collapsed', 'show-expanded');
  pauseAudio();
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
    ? masterCatalog.find(c => c.page_url.split('/').pop() === userRecordsData[index].slug)
    : catalog[index];
  if (!item) return;

  // Set elements
  document.getElementById('detail-cover').src = item.image;
  const playerCoverImg = document.getElementById('player-play-cover');
  if (playerCoverImg && item.image) {
    playerCoverImg.src = item.image;
    playerCoverImg.classList.remove('hidden');
  }
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
    if (currentPlayingTrackId === track.id) {
      li.classList.add('active');
      currentPlayingTrackItem = li;
    }

    // Duration format
    const durMin = Math.floor(track.duration / 60);
    const durSec = String(Math.floor(track.duration % 60)).padStart(2, '0');
    const durStr = `${durMin}:${durSec}`;

    const isPlaying = (currentPlayingTrackId === track.id && !audio.paused);
    const pathD = isPlaying ? 'M6 19h4V5H6v14zm8-14v14h4V5h-4z' : 'M8 5v14l11-7z';

    li.innerHTML = `
      <div class="track-main">
        <span class="track-num">${track.number || tIdx + 1}</span>
        <span class="track-name">${track.title}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;">
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
  const slug = item.page_url.split('/').pop();
  buyBtn.setAttribute('data-slug', slug);
  
  const localCrateData = localStorage.getItem('seph_martin_crate');
  let localItems = [];
  try {
    if (localCrateData) {
      localItems = JSON.parse(localCrateData);
    }
  } catch (e) {}
  
  const span = buyBtn.querySelector('span');
  const promptEl = document.getElementById('crate-save-prompt');
  
  if (localItems.includes(slug)) {
    if (span) span.innerText = "In Crate (Remove)";
    buyBtn.classList.add('in-crate');
    if (!currentUser && promptEl) {
      promptEl.classList.remove('hidden');
    } else if (promptEl) {
      promptEl.classList.add('hidden');
    }
  } else {
    if (span) span.innerText = "Add to Crate";
    buyBtn.classList.remove('in-crate');
    if (promptEl) {
      promptEl.classList.add('hidden');
    }
  }

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

// Audio Player Functionality
function playTrack(track, trackItemElement) {
  const player = document.getElementById('custom-player');
  const playerTitle = document.getElementById('player-track-title');
  const playIcon = document.querySelector('.play-icon');
  const pauseIcon = document.querySelector('.pause-icon');

  if (currentPlayingTrackId === track.id) {
    toggleAudioPlayback();
    return;
  }

  if (currentPlayingTrackItem) {
    currentPlayingTrackItem.classList.remove('active');
  }

  currentPlayingTrackItem = trackItemElement;
  currentPlayingTrackItem.classList.add('active');
  currentPlayingTrackId = track.id;

  audio.src = track.preview_url;
  audio.play()
    .then(() => {
      player.classList.remove('hidden');
      playerTitle.innerText = track.title;
      if (playIcon) playIcon.classList.add('hidden');
      if (pauseIcon) pauseIcon.classList.remove('hidden');
      const playPauseBtn = document.getElementById('player-play-btn');
      if (playPauseBtn) playPauseBtn.classList.add('is-playing');
    })
    .catch(err => {
      console.error('Audio playback failed:', err);
    });
}

function toggleAudioPlayback() {
  const playIcon = document.querySelector('.play-icon');
  const pauseIcon = document.querySelector('.pause-icon');
  const playPauseBtn = document.getElementById('player-play-btn');

  if (audio.paused) {
    audio.play()
      .then(() => {
        if (playIcon) playIcon.classList.add('hidden');
        if (pauseIcon) pauseIcon.classList.remove('hidden');
        if (playPauseBtn) playPauseBtn.classList.add('is-playing');
      })
      .catch(err => console.error(err));
  } else {
    audio.pause();
    if (playIcon) playIcon.classList.remove('hidden');
    if (pauseIcon) pauseIcon.classList.add('hidden');
    if (playPauseBtn) playPauseBtn.classList.remove('is-playing');
  }
}

function pauseAudio() {
  audio.pause();
  const playIcon = document.querySelector('.play-icon');
  const pauseIcon = document.querySelector('.pause-icon');
  const playPauseBtn = document.getElementById('player-play-btn');
  if (playIcon) playIcon.classList.remove('hidden');
  if (pauseIcon) pauseIcon.classList.add('hidden');
  if (playPauseBtn) playPauseBtn.classList.remove('is-playing');
}

function playNextTrack() {
  const currentItem = catalog[activeIndex];
  if (!currentItem || !currentItem.tracks) return;

  const nextTrackIndex = currentItem.tracks.findIndex(t => t.id === currentPlayingTrackId) + 1;

  if (nextTrackIndex < currentItem.tracks.length) {
    const trackItems = document.querySelectorAll('.track-item');
    if (trackItems[nextTrackIndex]) {
      trackItems[nextTrackIndex].click();
    }
  }
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
  const agentDiggingPreviewActive = agentVisualState === 'busy'
    && agentVisualOperation === 'digging'
    && !isUserCrateViewActive;

  recordsData.forEach((rec, idx) => {
    if (idx < activeIndex) {
      rec.targetRotX = 0.40; // leaning forward (naturally resting on the front wall)
    } else if (idx > activeIndex) {
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
      const item = masterCatalog.find(c => c.page_url.split('/').pop() === slug);
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
      const itemA = masterCatalog.find(c => c.page_url.split('/').pop() === a);
      const itemB = masterCatalog.find(c => c.page_url.split('/').pop() === b);
      if (!itemA || !itemB) return 0;

      const getSlug = (item) => {
        if (item.slug) return item.slug;
        if (item.page_url) return item.page_url.replace(/^\//, '').replace(/\//g, '-');
        return '';
      };

      const aUnits = bestSellersMap.get(getSlug(itemA)) || 0;
      const bUnits = bestSellersMap.get(getSlug(itemB)) || 0;
      return bUnits - aUnits;
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
    const item = masterCatalog.find(c => c.page_url.split('/').pop() === slug);
    if (!item) return;
    
    const frontMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.5,
      metalness: 0.05
    });
    
    let imageUrl = item.image;
    if (imageUrl) {
      const isExternal = imageUrl.startsWith('http') && !imageUrl.includes(window.location.hostname);
      if (isExternal) {
        imageUrl = '/api/proxy-image?url=' + encodeURIComponent(imageUrl);
      }
      
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
  const mainRecordIdx = catalog.findIndex(c => c.page_url.split('/').pop() === slug);
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
    
    // Show Buy Crate only when the visible personal crate has valid catalog lines.
    if (checkoutBtn) {
      if (hasPersonal) {
        checkoutBtn.classList.remove('hidden');
      } else {
        checkoutBtn.classList.add('hidden');
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
    checkoutBtn.disabled = !checkoutEnabled;
    checkoutBtn.setAttribute('aria-disabled', String(!checkoutEnabled));
    checkoutBtn.title = checkoutEnabled
      ? 'Review checkout for the records in My Crate'
      : 'Add a record to My Crate before checkout';
  }

  // Update total price on Buy Crate button
  const totalSpan = document.getElementById('checkout-total');
  if (totalSpan) {
    totalSpan.innerText = `€${(checkoutSummary.total_cents / 100).toFixed(2)}`;
  }
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
