/** An immutable selection object also identifies this particular visit/revision choice. */
export type TaskSelection = Readonly<{
  taskId: string;
  workspaceId: string;
  artifactId: string | null;
  artifactNotFound: boolean;
}>;

type UpdateSelection = (update: (current: TaskSelection | null) => TaskSelection | null) => void;

/**
 * Capture the originating selection before an asynchronous save. Polling can update task
 * records without changing it; any later navigation or revision choice creates a new object.
 * A completed save must never change that newer choice, even when its task ID is identical.
 */
export function createRevisionSavedHandler(origin: TaskSelection | null, updateSelection: UpdateSelection): () => void {
  return () => updateSelection((current) => {
    if (!origin || current !== origin) return current;
    return { ...current, artifactId: null, artifactNotFound: false };
  });
}
