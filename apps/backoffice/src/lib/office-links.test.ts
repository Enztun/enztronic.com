import { describe, expect, it } from 'vitest';
import { officeHref, parseOfficeLink } from './office-links';

const workspace = '00000000-0000-4000-8000-000000000001';
const task = '6f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5';
const artifact = '7a1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5';

describe('Office deep links carry validated identifiers only', () => {
  it('treats no link parameters as no link and ignores unrelated query keys', () => {
    expect(parseOfficeLink({})).toEqual({ kind: 'none' });
    expect(parseOfficeLink({ utm_source: 'mail' })).toEqual({ kind: 'none' });
  });
  it('accepts an exact mode, workspace, task, artifact and view and normalizes identifier case', () => {
    expect(parseOfficeLink({ mode: 'demo', workspace, task: task.toUpperCase(), artifact, view: 'inbox' })).toEqual({ kind: 'link', mode: 'demo', workspaceId: workspace, taskId: task, artifactId: artifact, view: 'inbox' });
    expect(parseOfficeLink(new URLSearchParams(`mode=live&workspace=${workspace}`))).toMatchObject({ kind: 'link', mode: 'live', workspaceId: workspace, taskId: null });
    expect(parseOfficeLink({ view: 'status' })).toMatchObject({ kind: 'link', mode: 'demo', view: 'status' });
  });
  it('rejects malformed, ambiguous or incomplete links instead of guessing', () => {
    for (const params of [
      { mode: 'demo', workspace: 'not-a-uuid' },
      { mode: 'prod', workspace },
      { mode: 'demo', task },
      { workspace, task },
      { mode: 'demo', workspace, artifact },
      { mode: 'demo', workspace, task, view: 'admin' },
      { mode: ['demo', 'live'], workspace },
      { mode: 'demo', workspace: `${workspace}${'0'.repeat(40)}` },
    ]) expect(parseOfficeLink(params)).toEqual({ kind: 'invalid' });
    expect(parseOfficeLink(new URLSearchParams(`mode=demo&workspace=${workspace}&workspace=${workspace}`))).toEqual({ kind: 'invalid' });
  });
  it('builds canonical links that parse back to the same target and never include free text', () => {
    expect(officeHref({ mode: 'demo' })).toBe('/team');
    expect(officeHref({ mode: 'live' })).toBe('/team?mode=live');
    const href = officeHref({ mode: 'demo', workspaceId: workspace, taskId: task, artifactId: artifact, view: 'tasks' });
    expect(href).toBe(`/team?mode=demo&workspace=${workspace}&task=${task}&artifact=${artifact}&view=tasks`);
    const query = new URLSearchParams(href.split('?')[1]);
    expect([...query.keys()].every(key => ['mode', 'workspace', 'task', 'artifact', 'view'].includes(key))).toBe(true);
    expect(parseOfficeLink(query)).toEqual({ kind: 'link', mode: 'demo', workspaceId: workspace, taskId: task, artifactId: artifact, view: 'tasks' });
    // A task needs its workspace and an artifact needs its task; incomplete parts are dropped, not guessed.
    expect(officeHref({ mode: 'demo', taskId: task })).toBe('/team');
    expect(officeHref({ mode: 'demo', workspaceId: workspace, artifactId: artifact })).toBe(`/team?mode=demo&workspace=${workspace}`);
  });
});
