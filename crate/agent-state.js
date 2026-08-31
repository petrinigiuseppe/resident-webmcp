/*
 * Shared Agent Mode state semantics.
 *
 * Playback is deliberately the only source of truth for the passive
 * "listening" presence. An agent that is idle without an actively playing
 * preview is waiting for instructions instead.
 */

export const AGENT_OPERATION_LABELS = Object.freeze({
  human: 'Human control',
  loading: 'Connecting',
  waiting: 'Waiting for instructions',
  listening: 'Listening',
  thinking: 'Thinking',
  orienting: 'Orienting',
  browsing: 'Browsing',
  searching: 'Searching',
  digging: 'Digging',
  focusing: 'Moving picks',
  inspecting: 'Inspecting',
  curating: 'Curating',
  grabbing: 'Grabbing the crate',
  preparing: 'Preparing review',
  human_override: 'Human override',
  returning: 'Releasing'
});

const PASSIVE_AGENT_STATES = new Set(['active', 'standby']);

export function resolveAgentOperation(state, requestedOperation = '', isPlaying = false) {
  if (state === 'human') return 'human';
  if (state === 'override') return 'human_override';
  if (state === 'returning') return 'returning';
  if (state === 'loading') return 'loading';
  if (PASSIVE_AGENT_STATES.has(state)) return isPlaying ? 'listening' : 'waiting';

  const normalizedOperation = String(requestedOperation || '').trim();
  return AGENT_OPERATION_LABELS[normalizedOperation] ? normalizedOperation : 'thinking';
}

export function isPassiveAgentStatus(state, operation) {
  return PASSIVE_AGENT_STATES.has(state) && (operation === 'waiting' || operation === 'listening');
}

export function getAgentPresenceText(state, operation) {
  if (!isPassiveAgentStatus(state, operation)) return '';
  return operation === 'listening' ? 'Listening' : 'Waiting for instructions';
}

export function getAgentStatusText(state, operation) {
  if (state === 'human' || state === 'override') return 'HUMAN MODE';
  const label = AGENT_OPERATION_LABELS[operation] || AGENT_OPERATION_LABELS.thinking;
  return `AGENT MODE · ${label.toUpperCase()}`;
}
