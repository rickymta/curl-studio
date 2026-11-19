// DOM version of the variable card for CodeMirror tooltips (body and script editors), matching
// VarPopover: value + scope, edit in place (Enter saves, Esc reverts), secrets masked.

import { lookupVar, SCOPE_LABEL, SCOPE_LETTER, setVar, type VarScopeName } from '@/features/request/varScope';
import { DYNAMIC } from '@/lib/vars';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function varTooltipDom(name: string, collectionId: string | null, onSaved: () => void): HTMLElement {
  const info = lookupVar(collectionId, name);
  const box = el('div', 'w-80 rounded-lg border border-border bg-surface p-2.5 text-[12.5px] text-foreground shadow-2xl');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', `Variable ${name}`);
  box.dataset.varPopover = '';

  if (info.dynamic) {
    const gen = DYNAMIC[name.slice(1)];
    box.append(el('div', 'font-medium', 'Dynamic variable'), el('div', 'mt-1 text-muted-foreground', gen ? `A new value is generated for each request, e.g. ${gen()}` : 'Not a known dynamic variable.'));
    return box;
  }

  let target: VarScopeName = info.scope ?? info.writable[0] ?? 'globals';
  let committed = info.value;
  const input = el('input', 'h-8 w-full rounded-md border border-border bg-background px-2 font-mono text-[12.5px] outline-none focus:border-accent');
  input.type = info.secret ? 'password' : 'text';
  input.value = info.value;
  input.placeholder = 'Enter value';
  input.spellcheck = false;
  const commit = () => {
    if (input.value === committed && info.scope) return;
    if (!info.scope && input.value === '') return;
    setVar(collectionId, info.scope ?? target, name, input.value);
    committed = input.value;
    onSaved();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      input.blur();
    } else if (e.key === 'Escape') {
      input.value = committed;
      input.blur();
    }
  });
  input.addEventListener('blur', commit);
  if (info.scope === 'environment' || info.scope === 'globals') box.append(el('div', 'mb-1 text-[11px] text-muted-foreground', 'Current value'));
  box.append(input);

  if (info.initial !== undefined) {
    box.append(el('div', 'mt-1.5 truncate text-[11.5px] text-muted-foreground', `Initial value: ${info.secret ? '••••••' : info.initial || '(empty)'}`));
  }
  if (!info.scope) box.append(el('div', 'mt-2 text-danger', '⚠ Unresolved variable — type a value to add it to:'));

  const row = el('div', 'mt-2 flex items-center gap-2');
  const badge = el('span', `flex size-5 items-center justify-center rounded text-[10.5px] font-bold ${info.scope ? 'bg-success-soft text-success' : 'bg-surface-muted text-muted-foreground'}`, SCOPE_LETTER[target]);
  row.append(badge);
  if (info.scope || info.writable.length < 2) {
    row.append(el('span', '', SCOPE_LABEL[target]));
  } else {
    const sel = el('select', 'rounded border border-border bg-background px-1 py-0.5 text-[12px] outline-none');
    sel.setAttribute('aria-label', 'Scope for the new variable');
    for (const s of info.writable) {
      const o = el('option', '', SCOPE_LABEL[s]);
      o.value = s;
      sel.append(o);
    }
    sel.addEventListener('change', () => {
      target = sel.value as VarScopeName;
      badge.textContent = SCOPE_LETTER[target];
    });
    row.append(sel);
  }
  box.append(row);
  return box;
}
