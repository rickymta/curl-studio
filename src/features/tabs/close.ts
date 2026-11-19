import { useTabs } from '@/stores/tabs';
import { useUi } from '@/stores/ui';
import { useWorkspace } from '@/stores/workspace';

/** True when closing this tab would lose edits. */
export function isDirty(id: string): boolean {
  const t = useTabs.getState().tabs.find((x) => x.id === id);
  return !!t && t.kind === 'request' && t.dirty;
}

/**
 * Close tabs the way Postman does: clean tabs close at once; each tab with unsaved changes
 * asks "Save changes?" (Don't save / Cancel / Save changes) unless the user ticked
 * "Always discard unsaved changes when closing a tab".
 */
export function requestClose(ids: string[]) {
  const { close } = useTabs.getState();
  const discard = useWorkspace.getState().settings.discardUnsavedOnClose;
  const dirty: string[] = [];
  for (const id of ids) {
    if (!discard && isDirty(id)) dirty.push(id);
    else close(id);
  }
  if (dirty.length) {
    useTabs.getState().setActive(dirty[0]!);
    useUi.getState().show({ kind: 'unsaved', tabIds: dirty });
  }
}

/** Continue with the rest of the queue after one tab was answered. */
export function nextUnsaved(rest: string[]) {
  const left = rest.filter((id) => useTabs.getState().tabs.some((t) => t.id === id));
  if (left.length) {
    useTabs.getState().setActive(left[0]!);
    useUi.getState().show({ kind: 'unsaved', tabIds: left });
  } else {
    useUi.getState().show(null);
  }
}

const unpinned = () => {
  const { tabs, pinned } = useTabs.getState();
  return tabs.filter((t) => !pinned.includes(t.id));
};

export const closeTab = (id: string) => requestClose([id]);
/** Pinned tabs stay open, as in Postman. */
export const closeOthers = (id: string) => requestClose(unpinned().filter((t) => t.id !== id).map((t) => t.id));
export const closeAll = () => requestClose(unpinned().map((t) => t.id));
/** Close every tab without unsaved changes (never asks). */
export const closeSaved = () => requestClose(unpinned().filter((t) => !isDirty(t.id)).map((t) => t.id));
