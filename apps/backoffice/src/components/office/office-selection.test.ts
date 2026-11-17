import { describe, expect, it, vi } from 'vitest';

import { officeHref } from '@/lib/office-links';

import { createRevisionSavedHandler, type TaskSelection } from './office-selection';

const workspaceA = '00000000-0000-4000-8000-000000000001';
const workspaceB = '00000000-0000-4000-8000-000000000002';
const taskA = '10000000-0000-4000-8000-000000000001';
const taskB = '10000000-0000-4000-8000-000000000002';
const revisionA1 = '20000000-0000-4000-8000-000000000001';
const revisionA2 = '20000000-0000-4000-8000-000000000002';
const revisionB1 = '30000000-0000-4000-8000-000000000001';
const revisionB2 = '30000000-0000-4000-8000-000000000002';

function selection(overrides: Partial<TaskSelection> = {}): TaskSelection {
  return Object.freeze({ taskId: taskA, workspaceId: workspaceA, artifactId: revisionA1, artifactNotFound: false, ...overrides });
}

// Exercise the actual callback factory across an asynchronous save completion.
// Navigation changes the selection while the save's original callback waits.
function delayedSave(origin: TaskSelection | null, initial = origin) {
  let current: TaskSelection | null = initial;
  let changes = 0;
  const setSelection = vi.fn((updater: (value: TaskSelection | null) => TaskSelection | null) => {
    const next = updater(current);
    if (next !== current) changes++;
    current = next;
  });
  const onSaved = createRevisionSavedHandler(origin, setSelection);
  let resolveSave!: () => void;
  const response = new Promise<void>((resolve) => { resolveSave = resolve; });
  const completion = response.then(onSaved);

  return {
    get current() { return current; },
    get changes() { return changes; },
    setSelection,
    navigate(next: TaskSelection | null) { current = next; },
    async finish() {
      expect(setSelection).not.toHaveBeenCalled();
      resolveSave();
      await completion;
    },
  };
}

describe('revision-save completion preserves newer selection intent', () => {
  it('follows the newly current revision when the originating selection is unchanged', async () => {
    const origin = selection({ artifactNotFound: true });
    const save = delayedSave(origin);

    await save.finish();

    expect(save.current).toEqual({ ...origin, artifactId: null, artifactNotFound: false });
    expect(save.current).not.toBe(origin);
    expect(save.setSelection).toHaveBeenCalledTimes(1);
    expect(save.changes).toBe(1);
    expect(origin).toEqual({ taskId: taskA, workspaceId: workspaceA, artifactId: revisionA1, artifactNotFound: true });
    expect(officeHref({ mode: 'demo', ...save.current! })).toBe(`/team?mode=demo&workspace=${workspaceA}&task=${taskA}`);
  });

  it('still follows current after a record poll that leaves the selection untouched', async () => {
    const origin = selection();
    const save = delayedSave(origin);
    let taskRecord = { id: taskA, currentArtifactId: revisionA1, version: 1 };

    taskRecord = { ...taskRecord, currentArtifactId: revisionA2, version: 2 };
    expect(save.current).toBe(origin);
    await save.finish();

    expect(save.current).toEqual({ ...origin, artifactId: null });
    expect(save.current?.artifactId ?? taskRecord.currentArtifactId).toBe(revisionA2);
    expect(save.setSelection).toHaveBeenCalledTimes(1);
    expect(save.changes).toBe(1);
    expect(origin.artifactId).toBe(revisionA1);
  });

  it('preserves B/R1, its URL and displayed revision when A finishes saving', async () => {
    const origin = selection();
    const save = delayedSave(origin);
    const next = selection({ taskId: taskB, artifactId: revisionB1 });
    const revisions = [
      { id: revisionB1, content: 'Task B historical revision' },
      { id: revisionB2, content: 'Task B current revision' },
    ];
    const href = officeHref({ mode: 'demo', ...next, view: 'tasks' });
    save.navigate(next);

    await save.finish();

    expect(save.current).toBe(next);
    expect(officeHref({ mode: 'demo', ...save.current!, view: 'tasks' })).toBe(href);
    expect(new URL(href, 'https://office.example').searchParams.get('artifact')).toBe(revisionB1);
    expect(revisions.find((revision) => revision.id === save.current?.artifactId)?.content).toBe('Task B historical revision');
    expect(save.setSelection).toHaveBeenCalledTimes(1);
    expect(save.changes).toBe(0);
    expect(origin.artifactId).toBe(revisionA1);
  });

  it('keeps the detail closed if it was closed during the save', async () => {
    const origin = selection();
    const save = delayedSave(origin);
    save.navigate(null);

    await save.finish();

    expect(save.current).toBeNull();
    expect(save.setSelection).toHaveBeenCalledTimes(1);
    expect(save.changes).toBe(0);
  });

  it('preserves a reopened A selection even when all its identifiers match the origin', async () => {
    const origin = selection();
    const save = delayedSave(origin);
    save.navigate(null);
    const reopened = selection();
    expect(reopened).toEqual(origin);
    expect(reopened).not.toBe(origin);
    save.navigate(reopened);

    await save.finish();

    expect(save.current).toBe(reopened);
    expect(save.current?.artifactId).toBe(revisionA1);
    expect(save.setSelection).toHaveBeenCalledTimes(1);
    expect(save.changes).toBe(0);
  });

  it('preserves a new A selection after navigating A to B to A with the same identifiers', async () => {
    const origin = selection();
    const save = delayedSave(origin);
    save.navigate(selection({ taskId: taskB, artifactId: revisionB1 }));
    const returned = selection();
    expect(returned).toEqual(origin);
    save.navigate(returned);

    await save.finish();

    expect(save.current).toBe(returned);
    expect(save.current?.artifactId).toBe(revisionA1);
    expect(save.setSelection).toHaveBeenCalledTimes(1);
    expect(save.changes).toBe(0);
  });

  it('preserves a different explicitly selected revision of A', async () => {
    const origin = selection();
    const save = delayedSave(origin);
    const next = selection({ artifactId: revisionA2 });
    save.navigate(next);

    await save.finish();

    expect(save.current).toBe(next);
    expect(save.current?.artifactId).toBe(revisionA2);
    expect(save.setSelection).toHaveBeenCalledTimes(1);
    expect(save.changes).toBe(0);
  });

  it('preserves the newer workspace scope', async () => {
    const origin = selection();
    const save = delayedSave(origin);
    const next = selection({ workspaceId: workspaceB, taskId: taskB, artifactId: revisionB1 });
    save.navigate(next);

    await save.finish();

    expect(save.current).toBe(next);
    expect(save.current?.workspaceId).toBe(workspaceB);
    expect(save.setSelection).toHaveBeenCalledTimes(1);
    expect(save.changes).toBe(0);
  });

  it('does not alter a later selection when no origin was captured', async () => {
    const save = delayedSave(null);
    const next = selection({ taskId: taskB, artifactId: revisionB1 });
    save.navigate(next);

    await save.finish();

    expect(save.current).toBe(next);
    expect(save.setSelection.mock.calls.length).toBeLessThanOrEqual(1);
    expect(save.changes).toBe(0);
  });
});
