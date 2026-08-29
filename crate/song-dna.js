/*
 * Song DNA Lite
 * SPDX-License-Identifier: MPL-2.0
 * Copyright (c) 2026 Giuseppe Petrini / Seph Martin
 *
 * A deliberately conservative metadata index for the WebMCP demo. The live
 * catalog currently contains titles, descriptions, source tags and track
 * metadata, but not authoritative BPM, key or audio features. This module
 * never fabricates those fields: metadata-derived dimensions carry source
 * evidence, while audio fields remain explicitly unavailable.
 */

const DNA_SCHEMA_VERSION = 'music-dna-lite.v1';
const DNA_SCHEMA_REVISION = 3;

const TECHNICAL_AUDIO_FIELDS = ['bpm', 'key', 'mode'];

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'at', 'be', 'but', 'by', 'for', 'from', 'give',
  'i', 'in', 'into', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'something',
  'that', 'the', 'this', 'to', 'with', 'you', 'your'
]);

const NEGATION_WORDS = new Set([
  'avoid', 'excluding', 'exclude', 'less', 'no', 'not', 'without'
]);

const SOURCE_WEIGHTS = Object.freeze({
  catalog_tags: 1,
  release_identity: 0.76,
  release_description: 0.72,
  track_titles: 0.68
});

const SOURCE_LABELS = Object.freeze({
  catalog_tags: 'declared catalog tag',
  release_identity: 'release or artist metadata',
  release_description: 'release description',
  track_titles: 'track title'
});

const PROFILE_DIMENSIONS = [
  'genre',
  'mood',
  'groove',
  'energy',
  'scene',
  'culture',
  'era',
  'instrumentation',
  'vocals',
  'structure'
];

/*
 * These are vocabulary bridges, not audio labels. A match means that the
 * word/phrase exists in a catalog tag, description, release identity or
 * track title. Keep ids stable because descriptor_parse exposes them to the
 * host agent.
 */
const SIGNAL_GROUPS = [
  // Genre / format
  { id: 'house', dimension: 'genre', label: 'house', terms: ['house'] },
  { id: 'tech_house', dimension: 'genre', label: 'tech house', terms: ['tech house', 'tech-house'] },
  { id: 'disco_house', dimension: 'genre', label: 'disco house', terms: ['disco house'] },
  { id: 'funky_house', dimension: 'genre', label: 'funky house', terms: ['funky house'] },
  { id: 'deep_house', dimension: 'genre', label: 'deep house', terms: ['deep house'] },
  { id: 'disco', dimension: 'genre', label: 'disco', terms: ['disco'] },
  { id: 'nu_disco', dimension: 'genre', label: 'nu disco', terms: ['nu disco', 'nu-disco'] },
  { id: '90s_house', dimension: 'genre', label: '90s house', terms: ['90s house', '90s-house'] },
  { id: 'french_house', dimension: 'genre', label: 'French house', terms: ['french house'] },
  { id: 'soulful_house', dimension: 'genre', label: 'soulful house', terms: ['soulful house'] },
  { id: 'minimal_tech', dimension: 'genre', label: 'minimal tech', terms: ['minimal tech', 'minimal techno'] },
  { id: 'techno', dimension: 'genre', label: 'techno', terms: ['techno'] },
  { id: 'vocal_house', dimension: 'genre', label: 'vocal house', terms: ['vocal house'] },
  { id: 'electronic', dimension: 'genre', label: 'electronic', terms: ['electronic'] },
  { id: 'trap', dimension: 'genre', label: 'trap', terms: ['trap'] },
  { id: 'rap', dimension: 'genre', label: 'rap', terms: ['rap'] },
  { id: 'hip_hop', dimension: 'genre', label: 'hip hop', terms: ['hip hop', 'hip-hop'] },

  // Mood / affect
  { id: 'warmth', dimension: 'mood', label: 'warm / analog warmth', terms: ['warm', 'warmth', 'analog', 'analogue', 'tape', 'dusty'] },
  { id: 'dreamy', dimension: 'mood', label: 'dreamy / atmospheric', terms: ['dreamy', 'dream', 'dreamlike', 'atmospheric', 'ethereal', 'ambient', 'sunrise'] },
  { id: 'dark', dimension: 'mood', label: 'dark / late-night', terms: ['dark', 'deep', 'late night', 'late-night', '3am', '3 am', '4am', '4 am', 'basement', 'afterhours', 'after-hours', 'afters'] },
  { id: 'hopeful', dimension: 'mood', label: 'hopeful / uplifting', terms: ['hope', 'hopeful', 'uplifting', 'bright', 'optimistic'] },
  { id: 'euphoric', dimension: 'mood', label: 'euphoric', terms: ['euphoria', 'euphoric'] },
  { id: 'emotive', dimension: 'mood', label: 'emotive / emotional', terms: ['emotive', 'emotional', 'emotion'] },
  { id: 'nostalgic', dimension: 'mood', label: 'nostalgic', terms: ['nostalgia', 'nostalgic'] },
  { id: 'soulful', dimension: 'mood', label: 'soulful', terms: ['soulful', 'soul'] },
  { id: 'playful', dimension: 'mood', label: 'playful / vibrant', terms: ['playful', 'vibrant', 'fun'] },
  { id: 'introspective', dimension: 'mood', label: 'introspective', terms: ['introspective', 'introspection'] },

  // Groove / rhythm language available in copy
  { id: 'groove', dimension: 'groove', label: 'groove / swing', terms: ['groove', 'groovy', 'swing', 'swinging', 'syncopated', 'rolling', 'funky', 'shuffle'] },
  { id: 'punch', dimension: 'energy', label: 'punchy / percussive', terms: ['punchy', 'punch', 'driving', 'percussive', 'raw', 'banger', '909', '808', 'kick'] },
  { id: 'broken', dimension: 'groove', label: 'broken / breakbeat', terms: ['broken', 'breakbeat', 'breaks', 'half-time', 'half time', 'polyrhythmic'] },
  { id: 'bassline', dimension: 'groove', label: 'bassline-led', terms: ['bassline', 'basslines', 'bass'] },

  // Energy / context
  { id: 'club', dimension: 'scene', label: 'club / dancefloor', terms: ['club', 'club-ready', 'club ready', 'dancefloor', 'dance floor', 'tool'] },
  { id: 'peak_time', dimension: 'energy', label: 'peak-time / high energy', terms: ['peak-time', 'peak time', 'peak', 'high-energy', 'high energy', 'relentless', 'high impact'] },
  { id: 'driving', dimension: 'energy', label: 'driving', terms: ['driving', 'drive'] },
  { id: 'warehouse', dimension: 'scene', label: 'warehouse / underground', terms: ['warehouse', 'underground'] },
  { id: 'radio', dimension: 'scene', label: 'radio', terms: ['radio'] },
  { id: 'festival', dimension: 'scene', label: 'festival', terms: ['festival'] },
  { id: 'headphones', dimension: 'scene', label: 'headphones', terms: ['headphones'] },

  // Cultural / geographic references
  { id: 'chicago', dimension: 'culture', label: 'Chicago reference', terms: ['chicago'] },
  { id: 'detroit', dimension: 'culture', label: 'Detroit reference', terms: ['detroit'] },
  { id: 'new_york', dimension: 'culture', label: 'New York reference', terms: ['new york', 'new-york', 'ny mix'] },
  { id: 'london', dimension: 'culture', label: 'London reference', terms: ['london'] },
  { id: 'berlin', dimension: 'culture', label: 'Berlin reference', terms: ['berlin'] },
  { id: 'naples', dimension: 'culture', label: 'Naples reference', terms: ['naples', 'napoli'] },

  // Era references in copy/tags, not measured production era
  { id: 'era_70s', dimension: 'era', label: '70s reference', terms: ['70s', '70s dance', 'seventies'] },
  { id: 'era_80s', dimension: 'era', label: '80s reference', terms: ['80s', '80s dance', 'eighties'] },
  { id: 'era_90s', dimension: 'era', label: '90s reference', terms: ['90s', '90s trance', 'nineties'] },
  { id: 'era_00s', dimension: 'era', label: '00s reference', terms: ['00s', '2000s', 'early 2000s'] },
  { id: 'era_10s', dimension: 'era', label: '10s reference', terms: ['10s', '2010s'] },
  { id: 'era_20s', dimension: 'era', label: '20s reference', terms: ['20s', '2020s'] },

  // Instrument / vocal mentions in text
  { id: 'piano', dimension: 'instrumentation', label: 'piano / keys', terms: ['piano', 'keys', 'key melody'] },
  { id: 'synth', dimension: 'instrumentation', label: 'synth / synthesizer', terms: ['synth', 'synths', 'synth-pop', 'synthesizer'] },
  { id: 'strings', dimension: 'instrumentation', label: 'strings', terms: ['strings', 'string'] },
  { id: 'guitar', dimension: 'instrumentation', label: 'guitar', terms: ['guitar'] },
  { id: 'sample', dimension: 'instrumentation', label: 'sample-led', terms: ['sample', 'samples', 'sampling'] },
  { id: 'drums', dimension: 'instrumentation', label: 'drums / percussion', terms: ['drums', 'drum', 'percussion', 'percussions'] },
  { id: 'vocals', dimension: 'vocals', label: 'vocal presence mention', terms: ['vocal', 'vocals', 'voice', 'voices', 'singer', 'singing', 'lyrics'] },

  // Arrangement / release-format language
  { id: 'extended', dimension: 'structure', label: 'extended mix', terms: ['extended', 'long mix'] },
  { id: 'radio_edit', dimension: 'structure', label: 'radio edit', terms: ['radio edit', 'radio mix'] },
  { id: 'dub', dimension: 'structure', label: 'dub mix', terms: ['dub', 'dub mix'] },
  { id: 'remix', dimension: 'structure', label: 'remix', terms: ['remix', 'remixes', 'rework', 'reworks'] },
  { id: 'breakdown', dimension: 'structure', label: 'breakdown', terms: ['breakdown'] },
  { id: 'drop', dimension: 'structure', label: 'drop reference', terms: ['drop', 'drops'] },
  { id: 'intro_outro', dimension: 'structure', label: 'intro / outro reference', terms: ['intro', 'intros', 'outro', 'outros'] }
];

/* These are the original MusicDNA fields for which the current catalog does
 * not provide authoritative structured or measured values. */
const MISSING_FIELDS = [
  'bpm',
  'bpm_feel',
  'groove_type',
  'swing_ratio',
  'key',
  'mode',
  'tonality_feel',
  'texture_tags',
  'saturation_level',
  'production_era_feel',
  'analog_warmth',
  'lo_fi',
  'spatial_width',
  'energy_arc',
  'time_of_night',
  'dancefloor_function',
  'city_vibe',
  'has_live_drums',
  'has_808',
  'has_909',
  'bassline_type',
  'vocal_presence',
  'featured_instruments',
  'intro_bars',
  'outro_bars',
  'has_breakdown',
  'mix_friendliness'
];

const AVAILABLE_METADATA_DIMENSIONS = [
  'genre',
  'mood',
  'groove',
  'energy',
  'scene',
  'culture',
  'era_reference',
  'instrumentation_mentions',
  'vocal_mentions',
  'structure_mentions',
  'track_count',
  'duration_seconds',
  'preview_availability'
];

const SPECIAL_REGEX_CHARS = '\\^$.*+?()[]{}|';

function asText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/[^a-z0-9#+\-./ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function escapeRegExp(value) {
  return String(value)
    .split('')
    .map(char => SPECIAL_REGEX_CHARS.includes(char) ? '\\' + char : char)
    .join('');
}

function matchesTerm(sourceText, term) {
  const source = asText(sourceText);
  const normalizedTerm = asText(term);
  if (!source || !normalizedTerm) return false;
  const pattern = normalizedTerm
    .split(' ')
    .filter(Boolean)
    .map(escapeRegExp)
    .join('\\s+');
  return new RegExp('(^|[^a-z0-9])' + pattern + '(?=$|[^a-z0-9])').test(source);
}

function getLegacyPageSlug(item) {
  const pageUrl = String(item?.page_url || '');
  const pageSlug = pageUrl.split('/').filter(Boolean).pop();
  return String(pageSlug || item?.slug || '').trim();
}

function getRecordId(item) {
  const explicitId = String(item?.record_id || '').trim();
  if (explicitId) return explicitId;

  const pageSlug = getLegacyPageSlug(item);
  if (!pageSlug) return String(item?.slug || '').trim();

  // Album and vinyl merch can intentionally share a Bandcamp page URL. Keep
  // the legacy album ID stable, while giving the merch listing its own local
  // identity so crate state and WebMCP focus never collapse the two records.
  return String(item?.type || '').toLowerCase() === 'merch'
    ? `${pageSlug}--merch`
    : pageSlug;
}

function getDeclaredTagSource(item) {
  if (Array.isArray(item?.bandcamp_tags)) return 'bandcamp_tags';
  if (Array.isArray(item?.tags)) return 'tags';
  if (Array.isArray(item?.genre_tags)) return 'genre_tags';
  return null;
}

function getDeclaredTags(item) {
  const source = Array.isArray(item?.bandcamp_tags)
    ? item.bandcamp_tags
    : Array.isArray(item?.tags)
      ? item.tags
      : Array.isArray(item?.genre_tags)
        ? item.genre_tags
        : [];

  return unique(source.map(tag => String(tag).trim()).filter(Boolean));
}

function parseDurationSeconds(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const numeric = Number(text);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  }
  const match = text.match(/^(\d+):([0-5]\d)(?::([0-5]\d))?$/);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const third = match[3] ? Number(match[3]) : null;
  const total = third === null ? first * 60 + second : first * 3600 + second * 60 + third;
  return Number.isFinite(total) && total > 0 ? total : null;
}

function cleanAnalysisText(value, max = 160) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

function parseBpm(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 20 && value <= 300
      ? Math.round(value * 10) / 10
      : null;
  }
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{2,3}(?:\.\d+)?)\s*(?:bpm)?$/i);
  if (!match) return null;
  return parseBpm(Number(match[1]));
}

function parseMusicalKey(value) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return null;
  // Accept conventional pitch-class names and Camelot/Open Key labels, but do
  // not turn arbitrary descriptive text into a key claim.
  const camelot = text.match(/^(1[0-2]|[1-9])([AB])$/i);
  if (camelot) return `${Number(camelot[1])}${camelot[2].toUpperCase()}`;

  const pitchClass = text.match(/^([A-Ga-g])([#b]?)(?:\s*(maj(?:or)?|min(?:or)?))?$/i);
  if (!pitchClass) return null;
  const note = pitchClass[1].toUpperCase();
  const accidental = pitchClass[2] || '';
  const quality = pitchClass[3]
    ? /^(?:maj|major)$/i.test(pitchClass[3]) ? ' major' : ' minor'
    : '';
  return `${note}${accidental}${quality}`;
}

function parseMode(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (['major', 'maj'].includes(text)) return 'major';
  if (['minor', 'min'].includes(text)) return 'minor';
  return null;
}

function getTrackAnalysisInput(item, track, index) {
  const releaseAnalysis = item?.audio_analysis || item?.audioAnalysis || null;
  const releaseTracks = releaseAnalysis?.tracks;
  const releaseTrackAnalysis = Array.isArray(releaseTracks)
    ? releaseTracks.find(candidate => String(candidate?.track_id || candidate?.id || '') === String(track?.id || ''))
      || releaseTracks[index]
    : releaseTracks && typeof releaseTracks === 'object'
      ? releaseTracks[String(track?.id || '')]
      : null;
  return track?.audio_analysis
    || track?.audioAnalysis
    || track?.technical_metadata
    || releaseTrackAnalysis
    || null;
}

function buildTrackAudioAnalysis(item, track, index) {
  const raw = getTrackAnalysisInput(item, track, index);
  const provenance = raw?.provenance && typeof raw.provenance === 'object'
    ? raw.provenance
    : {};
  const source = cleanAnalysisText(raw?.source || provenance.source);
  const method = cleanAnalysisText(raw?.method || provenance.method);
  const confidence = typeof raw?.confidence === 'number'
    ? Math.max(0, Math.min(1, raw.confidence))
    : typeof provenance.confidence === 'number'
      ? Math.max(0, Math.min(1, provenance.confidence))
      : null;
  const candidates = {
    bpm: parseBpm(raw?.bpm ?? raw?.tempo),
    key: parseMusicalKey(raw?.key ?? raw?.musical_key),
    mode: parseMode(raw?.mode)
  };
  const candidateFields = TECHNICAL_AUDIO_FIELDS.filter(field => candidates[field] !== null);
  const verified = Boolean(source && method);
  const availableFields = verified ? candidateFields : [];
  const unverifiedFields = verified ? [] : candidateFields;

  return {
    track_id: String(track?.id || ''),
    title: String(track?.title || ''),
    status: availableFields.length > 0
      ? 'available'
      : unverifiedFields.length > 0 ? 'unverified' : 'not_available',
    bpm: availableFields.includes('bpm') ? candidates.bpm : null,
    key: availableFields.includes('key') ? candidates.key : null,
    mode: availableFields.includes('mode') ? candidates.mode : null,
    available_fields: availableFields,
    unverified_fields: unverifiedFields,
    source: verified ? source : null,
    method: verified ? method : null,
    confidence: verified ? confidence : null
  };
}

function buildAudioAnalysis(item) {
  const tracks = Array.isArray(item?.tracks) ? item.tracks : [];
  const trackAnalyses = tracks.map((track, index) => buildTrackAudioAnalysis(item, track, index));
  const availableFields = unique(trackAnalyses.flatMap(analysis => analysis.available_fields));
  const unverifiedFields = unique(trackAnalyses.flatMap(analysis => analysis.unverified_fields));
  const coverage = Object.fromEntries(
    TECHNICAL_AUDIO_FIELDS.map(field => [
      `tracks_with_${field}`,
      trackAnalyses.filter(analysis => analysis.available_fields.includes(field)).length
    ])
  );
  let status = 'not_available';
  if (availableFields.length > 0 && availableFields.length === TECHNICAL_AUDIO_FIELDS.length) status = 'available';
  else if (availableFields.length > 0) status = 'partial';
  else if (unverifiedFields.length > 0) status = 'unverified';

  return {
    status,
    scope: 'per_track',
    tracks: trackAnalyses,
    available_fields: availableFields,
    missing_fields: TECHNICAL_AUDIO_FIELDS.filter(field => !availableFields.includes(field)),
    coverage,
    provenance: status === 'not_available'
      ? 'No authoritative per-track audio analysis is present in the current catalog.'
      : status === 'unverified'
        ? 'Candidate BPM/key values were found without both source and method, so they remain withheld.'
        : 'Values are exposed only when each field carries explicit source and method provenance.'
  };
}

function getTrackDurations(item) {
  return (Array.isArray(item?.tracks) ? item.tracks : [])
    .map(track => parseDurationSeconds(track?.duration))
    .filter(duration => Number.isFinite(duration) && duration > 0);
}

function getMetadataSources(item, declaredTags = getDeclaredTags(item)) {
  const trackTitles = (Array.isArray(item?.tracks) ? item.tracks : [])
    .map(track => track?.title)
    .filter(Boolean);

  return [
    {
      source: 'catalog_tags',
      text: asText(declaredTags.join(' '))
    },
    {
      source: 'release_identity',
      text: asText([item?.title, item?.artist, item?.site_name].filter(Boolean).join(' '))
    },
    {
      source: 'release_description',
      text: asText(item?.description)
    },
    {
      source: 'track_titles',
      text: asText(trackTitles.join(' '))
    }
  ].filter(entry => entry.text);
}

function getMatchedSignals(item, declaredTags = getDeclaredTags(item)) {
  const sources = getMetadataSources(item, declaredTags);

  return SIGNAL_GROUPS
    .map(group => {
      const evidence = sources
        .map(source => ({
          source: source.source,
          matched_terms: unique(group.terms.filter(term => matchesTerm(source.text, term)))
        }))
        .filter(entry => entry.matched_terms.length > 0);
      if (evidence.length === 0) return null;

      const strongest = evidence
        .slice()
        .sort((a, b) => (SOURCE_WEIGHTS[b.source] || 0) - (SOURCE_WEIGHTS[a.source] || 0))[0];

      return {
        id: group.id,
        dimension: group.dimension,
        label: group.label,
        matched_terms: unique(evidence.flatMap(entry => entry.matched_terms)),
        evidence,
        evidence_strength: SOURCE_LABELS[strongest.source] || strongest.source
      };
    })
    .filter(Boolean);
}

function emptyProfile() {
  return Object.fromEntries(PROFILE_DIMENSIONS.map(dimension => [dimension, []]));
}

function buildMetadataProfile(signals) {
  const profile = emptyProfile();
  (signals || []).forEach(signal => {
    if (!profile[signal.dimension]) profile[signal.dimension] = [];
    profile[signal.dimension].push(signal.id);
  });
  Object.keys(profile).forEach(dimension => {
    profile[dimension] = unique(profile[dimension]);
  });
  return profile;
}

function buildMusicDNA(item) {
  const declaredTags = getDeclaredTags(item);
  const sources = getMetadataSources(item, declaredTags);
  const durations = getTrackDurations(item);
  const signals = getMatchedSignals(item, declaredTags);
  const tracks = Array.isArray(item?.tracks) ? item.tracks : [];
  const audioAnalysis = buildAudioAnalysis(item);
  const missingFields = MISSING_FIELDS.filter(field => !audioAnalysis.available_fields.includes(field));

  return {
    schema_version: DNA_SCHEMA_VERSION,
    schema_revision: DNA_SCHEMA_REVISION,
    status: 'partial',
    record_id: getRecordId(item),
    source: audioAnalysis.available_fields.length > 0
      ? 'catalog-metadata-plus-authoritative-audio-analysis'
      : 'catalog-metadata',
    declared: {
      tags: declaredTags,
      tag_source: getDeclaredTagSource(item),
      description_present: Boolean(String(item?.description || '').trim())
    },
    metadata_profile: buildMetadataProfile(signals),
    inferred_from_metadata: {
      signals,
      track_count: tracks.length,
      total_duration_seconds: durations.length > 0
        ? Math.round(durations.reduce((sum, duration) => sum + duration, 0))
        : null,
      has_preview: tracks.some(track => Boolean(track?.preview_url)),
      source_fields_available: sources.map(source => source.source),
      audio_analysis: audioAnalysis
    },
    audio_analysis: audioAnalysis,
    missing_fields: missingFields,
    provenance: {
      declared_tags: 'catalog_metadata',
      inferred_signals: 'deterministic_metadata_match',
      audio_analysis: audioAnalysis.provenance,
      note: 'Evidence strength is source priority, not a measured audio confidence.'
    }
  };
}

function getSearchText(item, dna = buildMusicDNA(item)) {
  const signalText = (dna.inferred_from_metadata?.signals || [])
    .flatMap(signal => [signal.id, signal.label, ...(signal.matched_terms || [])]);
  return asText([
    item?.title,
    item?.artist,
    item?.site_name,
    item?.description,
    ...getDeclaredTags(item),
    ...signalText,
    ...(Array.isArray(item?.tracks) ? item.tracks.map(track => track?.title) : [])
  ].join(' '));
}

function getRequestedTerms(normalized, group) {
  const found = group.terms.filter(term => matchesTerm(normalized, term));
  return found.filter(term => !found.some(other => (
    other !== term && asText(other).includes(asText(term))
  )));
}

function isNegatedTerm(normalized, term) {
  const tokens = asText(normalized).split(' ').filter(Boolean);
  const termTokens = asText(term).split(' ').filter(Boolean);
  if (termTokens.length === 0) return false;

  for (let index = 0; index <= tokens.length - termTokens.length; index += 1) {
    const candidate = tokens.slice(index, index + termTokens.length);
    if (candidate.join(' ') !== termTokens.join(' ')) continue;
    const before = tokens.slice(Math.max(0, index - 3), index);
    if (before.some(token => NEGATION_WORDS.has(token))) return true;
    if (before.slice(-2).join(' ') === 'less of') return true;
  }
  return false;
}

function getDescriptorSignals(descriptor) {
  const normalized = asText(descriptor);
  const groups = [];
  const excludedGroups = [];
  const reservedTerms = [];

  SIGNAL_GROUPS.forEach(group => {
    const requestedTerms = getRequestedTerms(normalized, group);
    if (requestedTerms.length === 0) return;

    const includedTerms = requestedTerms.filter(term => !isNegatedTerm(normalized, term));
    const excludedTerms = requestedTerms.filter(term => isNegatedTerm(normalized, term));
    reservedTerms.push(...requestedTerms.flatMap(term => asText(term).split(' ')));

    if (includedTerms.length > 0) {
      groups.push({
        id: group.id,
        dimension: group.dimension,
        label: group.label,
        requested_terms: includedTerms
      });
    }
    if (excludedTerms.length > 0) {
      excludedGroups.push({
        id: group.id,
        dimension: group.dimension,
        label: group.label,
        requested_terms: excludedTerms
      });
    }
  });

  const reserved = new Set(reservedTerms);
  const freeTerms = unique(normalized
    .split(' ')
    .filter(token => token.length > 2 && !STOP_WORDS.has(token) && !NEGATION_WORDS.has(token))
    .filter(token => !reserved.has(token)));

  return { normalized, groups, excludedGroups, freeTerms };
}

function getSignalStrength(signal) {
  return Math.max(
    0.45,
    ...(signal?.evidence || []).map(entry => SOURCE_WEIGHTS[entry.source] || 0.45)
  );
}

function getFreeTermEvidence(item, term) {
  return getMetadataSources(item)
    .filter(source => matchesTerm(source.text, term))
    .sort((a, b) => (SOURCE_WEIGHTS[b.source] || 0) - (SOURCE_WEIGHTS[a.source] || 0))
    .map(source => ({
      source: source.source,
      strength: SOURCE_LABELS[source.source] || source.source
    }));
}

function scoreItem(item, descriptor) {
  const dna = buildMusicDNA(item);
  const searchText = getSearchText(item, dna);
  const signalMap = new Map((dna.inferred_from_metadata?.signals || []).map(signal => [signal.id, signal]));
  const parsed = getDescriptorSignals(descriptor);
  const reasons = [];
  const evidence = [];
  let points = 0;
  let possible = 0;
  let conflictPenalty = 0;

  parsed.groups.forEach(group => {
    const groupWeight = group.dimension === 'genre' ? 1.15 : 1;
    possible += groupWeight;
    const signal = signalMap.get(group.id);
    if (!signal) return;
    const strength = getSignalStrength(signal);
    points += groupWeight * strength;
    reasons.push('DNA signal: ' + group.label);
    evidence.push({
      type: 'controlled_signal',
      id: group.id,
      source: signal.evidence_strength,
      strength: Number(strength.toFixed(2))
    });
  });

  parsed.excludedGroups.forEach(group => {
    const signal = signalMap.get(group.id);
    if (!signal) return;
    conflictPenalty += group.dimension === 'genre' ? 0.35 : 0.25;
    reasons.push('excluded signal present: ' + group.label);
    evidence.push({
      type: 'excluded_signal',
      id: group.id,
      source: signal.evidence_strength
    });
  });

  parsed.freeTerms.forEach(term => {
    possible += 1;
    const termEvidence = getFreeTermEvidence(item, term);
    if (termEvidence.length === 0) return;
    const strongest = termEvidence[0];
    points += SOURCE_WEIGHTS[strongest.source] || 0.45;
    reasons.push('metadata match: ' + term);
    evidence.push({
      type: 'free_term',
      term,
      source: strongest.strength,
      strength: Number((SOURCE_WEIGHTS[strongest.source] || 0.45).toFixed(2))
    });
  });

  if (possible === 0) {
    return { item, dna, score: 0, reasons: [], evidence: [] };
  }

  // searchText remains a deliberate compatibility fallback for a descriptor
  // that contains one useful free word but has no controlled signal. It never
  // changes the provenance claim: this is still text metadata, not audio.
  if (points === 0 && parsed.freeTerms.length > 0) {
    const fallbackMatches = parsed.freeTerms.filter(term => matchesTerm(searchText, term));
    points += fallbackMatches.length * 0.35;
  }

  const normalizedScore = Math.max(0, Math.min(1, (points / possible) - conflictPenalty));
  return {
    item,
    dna,
    score: Number(normalizedScore.toFixed(3)),
    reasons: unique(reasons).slice(0, 5),
    evidence: evidence.slice(0, 8)
  };
}

function scoreCatalog(items, descriptor, { maxResults = 12, excludeIds = [] } = {}) {
  const excluded = new Set((excludeIds || []).map(value => String(value).trim()).filter(Boolean));
  const ranked = (Array.isArray(items) ? items : [])
    .filter(item => !excluded.has(getRecordId(item)) && !excluded.has(String(item?.slug || '')))
    .map(item => scoreItem(item, descriptor))
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score || String(a.item?.title || '').localeCompare(String(b.item?.title || '')))
    .slice(0, Math.max(1, Math.min(24, Number(maxResults) || 12)));

  const parsed = getDescriptorSignals(descriptor);
  return {
    matches: ranked.map(result => ({
      record_id: getRecordId(result.item),
      catalog_slug: String(result.item?.slug || getRecordId(result.item)),
      title: result.item?.title || '',
      artist: result.item?.artist || '',
      label: result.item?.site_name || '',
      score: result.score,
      match_reason: result.reasons,
      match_evidence: result.evidence,
      dna_status: result.dna.status
    })),
    descriptor_parse: {
      normalized: parsed.normalized,
      controlled_signals: parsed.groups.map(group => group.id),
      excluded_signals: parsed.excludedGroups.map(group => group.id),
      free_terms: parsed.freeTerms,
      scoring: 'weighted deterministic catalog metadata; not audio analysis',
      available_dimensions: [...AVAILABLE_METADATA_DIMENSIONS],
      unavailable_dimensions: [...MISSING_FIELDS]
    }
  };
}

function buildCollectionStats(items) {
  const records = Array.isArray(items) ? items : [];
  const tagFrequency = {};
  const signalFrequency = {};
  const dimensionFrequency = {};
  let recordsWithTags = 0;
  let recordsWithDescriptions = 0;
  let recordsWithPreviews = 0;
  let trackCount = 0;
  const audioAnalysisCoverage = Object.fromEntries(
    TECHNICAL_AUDIO_FIELDS.map(field => [`tracks_with_${field}`, 0])
  );

  records.forEach(item => {
    const tags = getDeclaredTags(item);
    if (tags.length > 0) recordsWithTags += 1;
    tags.forEach(tag => {
      const key = String(tag).trim();
      if (key) tagFrequency[key] = (tagFrequency[key] || 0) + 1;
    });

    if (String(item?.description || '').trim()) recordsWithDescriptions += 1;
    const tracks = Array.isArray(item?.tracks) ? item.tracks : [];
    trackCount += tracks.length;
    if (tracks.some(track => Boolean(track?.preview_url))) recordsWithPreviews += 1;

    const dna = buildMusicDNA(item);
    Object.keys(audioAnalysisCoverage).forEach(field => {
      audioAnalysisCoverage[field] += dna.audio_analysis.coverage[field] || 0;
    });
    dna.inferred_from_metadata.signals.forEach(signal => {
      signalFrequency[signal.id] = (signalFrequency[signal.id] || 0) + 1;
      dimensionFrequency[signal.dimension] = (dimensionFrequency[signal.dimension] || 0) + 1;
    });
  });

  return {
    total_records: records.length,
    total_tracks: trackCount,
    dna_schema_version: DNA_SCHEMA_VERSION,
    dna_schema_revision: DNA_SCHEMA_REVISION,
    dna_status: 'partial_metadata_only',
    known_fields: [
      'title',
      'artist',
      'description',
      'tags',
      'metadata_profile',
      'tracks',
      'duration_seconds',
      'preview_url',
      'audio_analysis'
    ],
    available_dimensions: [...AVAILABLE_METADATA_DIMENSIONS],
    missing_fields: [...MISSING_FIELDS],
    metadata_coverage: {
      records_with_tags: recordsWithTags,
      records_with_descriptions: recordsWithDescriptions,
      records_with_previews: recordsWithPreviews,
      audio_analysis: {
        status: Object.values(audioAnalysisCoverage).some(value => value > 0) ? 'partial' : 'not_available',
        ...audioAnalysisCoverage
      }
    },
    tag_frequency: Object.fromEntries(
      Object.entries(tagFrequency).sort(([, a], [, b]) => b - a).slice(0, 30)
    ),
    inferred_signal_frequency: Object.fromEntries(
      Object.entries(signalFrequency).sort(([, a], [, b]) => b - a)
    ),
    inferred_dimension_frequency: Object.fromEntries(
      Object.entries(dimensionFrequency).sort(([, a], [, b]) => b - a)
    ),
    provenance: 'Catalog metadata and deterministic text matches; BPM/key appear only with explicit audio-analysis provenance.'
  };
}

export {
  buildCollectionStats,
  buildAudioAnalysis,
  buildMusicDNA,
  getRecordId,
  scoreCatalog
};
