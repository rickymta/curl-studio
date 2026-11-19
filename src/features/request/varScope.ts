import { createContext, useContext } from 'react';

import type { PmEnvironment } from '@/lib/types';
import { envToMap, kvToMap } from '@/lib/vars';
import { useWorkspace } from '@/stores/workspace';

export type VarScopeName = 'environment' | 'collection' | 'globals';

export const SCOPE_LETTER: Record<VarScopeName, string> = { environment: 'E', collection: 'C', globals: 'G' };
export const SCOPE_LABEL: Record<VarScopeName, string> = { environment: 'Environment', collection: 'Collection', globals: 'Globals' };

/** Collection the variable inputs below belong to (null = a request outside any collection). */
export const VarCollection = createContext<string | null>(null);
export const useVarCollection = () => useContext(VarCollection);

export interface VarInfo {
  name: string;
  /** Scope the value comes from (the winning one), or null when unresolved. */
  scope: VarScopeName | null;
  value: string;
  dynamic: boolean;
  /** Scopes the user can write a value into. */
  writable: VarScopeName[];
  /** Environment/globals only: Postman's initial value (shared) next to the current value. */
  initial?: string;
  /** `type: secret` in the environment: shown masked. */
  secret?: boolean;
}

function envDetail(e: PmEnvironment | null | undefined, name: string): { initial?: string; secret?: boolean } {
  const v = e?.values.find((x) => x.key === name && x.enabled !== false);
  if (!v) return {};
  return { initial: v.value, secret: v.type === 'secret' };
}

/** Resolve a variable the way requests do: environment > collection > globals. */
export function lookupVar(collectionId: string | null, name: string): VarInfo {
  const ws = useWorkspace.getState();
  const env = ws.activeEnv ? ws.environments[ws.activeEnv] : null;
  const col = collectionId ? ws.collections[collectionId] : null;
  const writable: VarScopeName[] = [...(env ? (['environment'] as const) : []), ...(col ? (['collection'] as const) : []), 'globals'];
  if (name.startsWith('$')) return { name, scope: null, value: '', dynamic: true, writable: [] };
  const maps: [VarScopeName, Record<string, string>][] = [
    ['environment', envToMap(env)],
    ['collection', kvToMap(col?.variable)],
    ['globals', envToMap(ws.globals)],
  ];
  for (const [scope, map] of maps) {
    if (name in map) {
      const extra = scope === 'environment' ? envDetail(env, name) : scope === 'globals' ? envDetail(ws.globals, name) : {};
      return { name, scope, value: map[name] ?? '', dynamic: false, writable, ...extra };
    }
  }
  return { name, scope: null, value: '', dynamic: false, writable };
}

function writeEnv(e: PmEnvironment, name: string, value: string) {
  const v = e.values.find((x) => x.key === name && x.enabled !== false) ?? e.values.find((x) => x.key === name);
  if (!v) e.values.push({ key: name, value, type: 'default', enabled: true });
  else {
    v.enabled = true;
    // Postman's hover card edits the *current* value; keep the initial value when there is one.
    if (v.currentValue !== undefined) v.currentValue = value;
    else v.value = value;
  }
}

/** Set (or create) a variable in one scope. */
export function setVar(collectionId: string | null, scope: VarScopeName, name: string, value: string) {
  const ws = useWorkspace.getState();
  if (scope === 'environment' && ws.activeEnv) {
    ws.updateEnvironment(ws.activeEnv, (e) => writeEnv(e, name, value));
  } else if (scope === 'collection' && collectionId) {
    ws.updateCollection(collectionId, (c) => {
      c.variable ??= [];
      const v = c.variable.find((x) => x.key === name);
      if (v) {
        v.value = value;
        v.disabled = false;
      } else c.variable.push({ key: name, value });
    });
  } else {
    ws.updateGlobals((g) => writeEnv(g, name, value));
  }
}
