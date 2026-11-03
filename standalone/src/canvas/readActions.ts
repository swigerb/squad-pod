import { relative } from 'node:path';
import { readMemberCharter } from '../../../src/memberCharter.js';
import { parseCharterModel, readModelConfig } from '../../../src/declaredModels.js';
import type { OutboundMessage } from '../../../src/types.js';

const text = (value: string | null, limit = 512) => value === null ? null
  : value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, limit);
const members = (messages: OutboundMessage[]) =>
  messages.find(message => message.type === 'existingAgents')?.agents.slice(0, 128) ?? [];

/** Bounded projections only: never return credentials, absolute paths or raw diagnostics. */
export function officeState(messages: OutboundMessage[]) {
  const layout = messages.find(message => message.type === 'layoutLoaded')?.layout;
  const source = messages.find(message => message.type === 'sourceStatus')?.status;
  return {
    members: members(messages).map(member => ({
      slug: text(member.id, 128), name: text(member.name, 256), role: text(member.role, 256),
      status: member.status, statusSource: source?.liveActivity?.state === 'following'
        ? 'joined-session-observation' : 'local-file-observation',
    })),
    layout: layout ? { cols: layout.cols, rows: layout.rows, furnitureCount: layout.furniture.length } : null,
    source: source ? { teamFound: source.teamFound, observer: source.observer,
      liveActivity: source.liveActivity?.state === 'following' ? 'following' : 'unavailable',
      diagnostics: source.error === null ? 'none' : 'unavailable' } : null,
  };
}

/** Reuse guarded exact-member charter/model services; declarations are not runtime selection. */
export function memberDetails(root: string, slug: string, messages: OutboundMessage[]) {
  const roster = members(messages);
  const member = roster.find(candidate => candidate.id === slug);
  if (!member) return { status: 'unavailable' };
  const charter = readMemberCharter({ workspaceRoot: root,
    isCurrentMember: id => roster.some(candidate => candidate.id === id) }, slug);
  const sources = readModelConfig(root, member.name);
  if (charter.charterContent !== null) {
    sources.unshift(parseCharterModel(charter.charterContent, 'charter.md'));
  }
  return { status: 'available', slug, charterStatus: charter.charterStatus,
    charterSummary: text(charter.charterSummary, 2048), expertise: text(charter.expertise, 2048),
    model: { provenance: 'declared-only', runtime: null, sources: sources.slice(0, 4).map(source => ({
      source: text(source.sourcePath === 'charter.md' ? source.sourcePath : relative(root, source.sourcePath), 256),
      state: source.state, diagnostic: text(source.diagnostic),
      values: source.values.slice(0, 3).map(value => ({ key: text(value.key, 256), value: text(value.value) })),
    })) },
  };
}
