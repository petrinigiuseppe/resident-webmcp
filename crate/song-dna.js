/*
 * Song DNA Lite
 *
 * A deliberately conservative metadata index for the WebMCP demo.  The live
 * catalog currently contains titles, descriptions, source tags and track
 * metadata, but not authoritative BPM, key or audio features.  This module
 * never fabricates those fields: missing dimensions are returned explicitly
 * so the agent can describe the limits of the current crate honestly.
 */

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'at', 'be', 'but', 'by', 'for', 'from', 'give',
  'i', 'in', 'into', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'something',
  'that', 'the', 'this', 'to', 'with', 'you', 'your'
]);

const SIGNAL_GROUPS = [
  {
    id: 'warmth',
    label: 'warm / analog warmth',
    terms: ['warm', 'warmth', 'analog', 'analogue', 'tape', 'soulful', 'dusty']
  },
  {
    id: 'dreamy',
    label: 'dreamy / atmospheric',
    terms: ['dreamy', 'dream', 'dreamlike', 'atmospheric', 'ethereal', 'ambient', 'sunrise']
  },
  {
    id: 'dark',
    label: 'dark / late-night',
    terms: ['dark', 'deep', 'late night', 'late-night', '3am', '4am', 'basement', 'afterhours', 'afters']
  },
  {
    id: 'punch',
    label: 'punchy / percussive',
    terms: ['punchy', 'punch', 'driving', 'percussive', 'raw', 'banger', '909', '808', 'kick']
  },
  {
    id: 'groove',
    label: 'groove / swing',
    terms: ['groove', 'groovy', 'swing', 'swinging', 'syncopated', 'rolling', 'funky', 'shuffle']
  },
  {
    id: 'broken',
    label: 'broken / breakbeat',
    terms: ['broken', 'breakbeat', 'breaks', 'half-time', 'half time', 'polyrhythmic']
  },
  {
    id: 'club',
    label: 'club / dancefloor',
    terms: ['club', 'club-ready', 'club ready', 'dancefloor', 'dance floor', 'warehouse', 'peak-time', 'peak time', 'tool']
  },
  {
    id: 'chicago',
    label: 'Chicago reference',
    terms: ['chicago']
  },
  {
    id: 'detroit',
    label: 'Detroit reference',
    terms: ['detroit']
  },
  {
    id: 'london',
    label: 'London reference',
    terms: ['london']
  },
  {
    id: 'berlin',
    label: 'Berlin reference',
    terms: ['berlin']
  }
];

const MISSING_FIELDS = [
  'bpm',
  'bpm_feel',
  'groove_type',
  'swing_ratio',
  'key',
  'mode',
  'tonality_feel',
  'saturation_level',
  'analog_warmth',
  'spatial_width',
  'energy_arc',
  'time_of_night',
  'dancefloor_function',
  'has_live_drums',
  'has_808',
  'has_909',
  'bassline_type',
  'vocal_presence',
  'mix_friendliness'
];

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

function getRecordId(item) {
  const pageUrl = String(item?.page_url || '');
  const pageSlug = pageUrl.split('/').filter(Boolean).pop();
  return String(item?.record_id || pageSlug || item?.slug || '').trim();
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

function getTrackDurations(item) {
  return (Array.isArray(item?.tracks) ? item.tracks : [])
    .map(track => Number(track?.duration))
    .filter(duration => Number.isFinite(duration) && duration > 0);
}

function getSourceText(item, declaredTags = getDeclaredTags(item)) {
  const trackTitles = (Array.isArray(item?.tracks) ? item.tracks : [])
    .map(track => track?.title)
    .filter(Boolean);

  return asText([
    item?.title,
    item?.artist,
    item?.site_name,
    item?.description,
    ...declaredTags,
    ...trackTitles
  ].join(' '));
}

function getMatchedSignals(sourceText) {
  return SIGNAL_GROUPS
    .map(group => {
      const matches = group.terms.filter(term => sourceText.includes(asText(term)));
      if (matches.length === 0) return null;
      return {
        id: group.id,
        label: group.label,
        matched_terms: unique(matches)
      };
    })
    .filter(Boolean);
}

function buildMusicDNA(item) {
  const declaredTags = getDeclaredTags(item);
  const sourceText = getSourceText(item, declaredTags);
  const durations = getTrackDurations(item);
  const matchedSignals = getMatchedSignals(sourceText);

  return {
    schema_version: 'music-dna-lite.v1',
    status: 'partial',
    record_id: getRecordId(item),
    source: 'catalog-metadata',
    declared: {
      tags: declaredTags
    },
    inferred_from_metadata: {
      signals: matchedSignals,
      track_count: Array.isArray(item?.tracks) ? item.tracks.length : 0,
      total_duration_seconds: durations.length > 0
        ? durations.reduce((sum, duration) => sum + duration, 0)
        : null,
      has_preview: (Array.isArray(item?.tracks) ? item.tracks : [])
        .some(track => Boolean(track?.preview_url))
    },
    missing_fields: [...MISSING_FIELDS],
    provenance: {
      declared_tags: 'catalog_metadata',
      inferred_signals: 'deterministic_metadata_match',
      audio_analysis: 'not_available_in_current_catalog'
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

function getDescriptorSignals(descriptor) {
  const normalized = asText(descriptor);
  const groups = SIGNAL_GROUPS
    .filter(group => group.terms.some(term => normalized.includes(asText(term))))
    .map(group => ({
      id: group.id,
      label: group.label,
      requested_terms: group.terms.filter(term => normalized.includes(asText(term)))
    }));

  const freeTerms = unique(normalized
    .split(' ')
    .filter(token => token.length > 2 && !STOP_WORDS.has(token)))
    .filter(token => !groups.some(group => group.requested_terms.some(term => asText(term).includes(token))));

  return { normalized, groups, freeTerms };
}

function scoreItem(item, descriptor) {
  const dna = buildMusicDNA(item);
  const searchText = getSearchText(item, dna);
  const declaredTags = getDeclaredTags(item).map(asText);
  const parsed = getDescriptorSignals(descriptor);
  const reasons = [];
  let points = 0;
  let possible = 0;

  parsed.groups.forEach(group => {
    possible += 2;
    const matchedTerm = group.requested_terms.find(term => searchText.includes(asText(term)));
    if (matchedTerm) {
      points += declaredTags.some(tag => tag.includes(asText(matchedTerm))) ? 2 : 1;
      reasons.push(`DNA signal: ${group.label}`);
    }
  });

  parsed.freeTerms.forEach(term => {
    possible += 1;
    if (searchText.includes(term)) {
      points += declaredTags.some(tag => tag.includes(term)) ? 1.25 : 0.75;
      reasons.push(`metadata match: ${term}`);
    }
  });

  const descriptorWords = parsed.normalized.split(' ').filter(Boolean);
  if (descriptorWords.length === 0) {
    return { item, dna, score: 0, reasons: [] };
  }

  // A short descriptor with no controlled signal still gets a deterministic
  // title/description match, while never pretending this is an audio score.
  if (possible === 0) {
    descriptorWords.forEach(term => {
      if (term.length > 2 && searchText.includes(term)) {
        points += 1;
        possible += 1;
        reasons.push(`metadata match: ${term}`);
      }
    });
  }

  const normalizedScore = possible > 0 ? Math.min(1, points / possible) : 0;
  return {
    item,
    dna,
    score: Number(normalizedScore.toFixed(3)),
    reasons: unique(reasons).slice(0, 5)
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
      dna_status: result.dna.status
    })),
    descriptor_parse: {
      normalized: parsed.normalized,
      controlled_signals: parsed.groups.map(group => group.id),
      free_terms: parsed.freeTerms,
      scoring: 'deterministic catalog metadata; not audio analysis',
      unavailable_dimensions: [...MISSING_FIELDS]
    }
  };
}

function buildCollectionStats(items) {
  const records = Array.isArray(items) ? items : [];
  const tagFrequency = {};
  const signalFrequency = {};

  records.forEach(item => {
    getDeclaredTags(item).forEach(tag => {
      const key = String(tag).trim();
      if (key) tagFrequency[key] = (tagFrequency[key] || 0) + 1;
    });

    buildMusicDNA(item).inferred_from_metadata.signals.forEach(signal => {
      signalFrequency[signal.id] = (signalFrequency[signal.id] || 0) + 1;
    });
  });

  const knownFields = ['title', 'artist', 'description', 'tags', 'tracks', 'preview_url'];
  const missingFields = [...MISSING_FIELDS];

  return {
    total_records: records.length,
    dna_schema_version: 'music-dna-lite.v1',
    dna_status: 'partial_metadata_only',
    known_fields: knownFields,
    missing_fields: missingFields,
    tag_frequency: Object.fromEntries(
      Object.entries(tagFrequency).sort(([, a], [, b]) => b - a).slice(0, 30)
    ),
    inferred_signal_frequency: Object.fromEntries(
      Object.entries(signalFrequency).sort(([, a], [, b]) => b - a)
    ),
    provenance: 'catalog metadata and deterministic text matches; no BPM/key/audio claims'
  };
}

export {
  buildCollectionStats,
  buildMusicDNA,
  getRecordId,
  scoreCatalog
};
