import { Copy, FileUp, SquareTerminal, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { CodeEditor } from '@/components/CodeEditor';
import { Button, Checkbox, cn, Field, IconButton, Input, Modal, Select } from '@/components/ui';
import { buildSpec } from '@/lib/build';
import { LANGUAGES } from '@/lib/codegen';
import { contextFor } from '@/lib/execute';
import { plural, t } from '@/lib/i18n';
import { api } from '@/lib/ipc';
import { copyText } from '@/lib/native';
import { clone, findItem, isFolder, uid } from '@/lib/postman';
import type { CookieInfo, PmItem } from '@/lib/types';
import { useTabs } from '@/stores/tabs';
import { errText, toast, useUi } from '@/stores/ui';
import { createCollection, useWorkspace } from '@/stores/workspace';

import { importFiles, importJsonText } from '../actions';
import { saveTab } from '../request/common';
import { HelpDialog } from '../shell/HelpDialog';
import { shellFamily, typeInTerminal } from '../terminal/runtime';
import { SettingsDialog } from '../shell/SettingsDialog';
import { ActivityWindow, ShortcutsWindow } from '../shell/Windows';
import { nextUnsaved } from '../tabs/close';

function ImportDialog({ initial }: { initial?: string }) {
  const [text, setText] = useState(initial ?? '');
  const close = () => useUi.getState().show(null);
  const doImport = () => {
    try {
      const done = importJsonText(text.trim());
      toast('success', t('Imported {list}', { list: done.join(', ') }));
      close();
    } catch (e) {
      toast('error', errText(e));
    }
  };
  return (
    <Modal open onClose={close} title={t('Import')} width={680} description={t('Postman collections (v1, v2.0, v2.1), environments, globals, full data dumps, or a cURL command.')}>
      <div className="space-y-3">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={async (e) => {
            e.preventDefault();
            const done: string[] = [];
            for (const f of Array.from(e.dataTransfer.files)) {
              try {
                done.push(...importJsonText(await f.text()));
              } catch (err) {
                toast('error', `${f.name}: ${errText(err)}`);
              }
            }
            if (done.length) {
              toast('success', t('Imported {list}', { list: done.join(', ') }));
              close();
            }
          }}
          className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border p-6 text-muted-foreground"
        >
          <FileUp className="size-6" />
          {t('Drop files here or')}
          <Button
            onClick={async () => {
              close();
              await importFiles();
            }}
          >
            {t('Choose files…')}
          </Button>
        </div>
        <Field label={t('…or paste raw text (JSON or cURL)')}>
          <CodeEditor value={text} onChange={setText} language={text.trim().startsWith('curl') ? 'text' : 'json'} className="h-56 rounded-md border border-border" placeholder="curl https://api.example.com -H 'Accept: application/json'" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={close}>{t('Cancel')}</Button>
          <Button variant="primary" disabled={!text.trim()} onClick={doImport}>
            {t('Import')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CodeDialog({ tabId }: { tabId: string }) {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === tabId));
  const [lang, setLang] = useState(() => localStorage.getItem('curlstudio.codeLang') ?? 'curl');
  const [resolveVars, setResolveVars] = useState(true);
  const close = () => useUi.getState().show(null);
  const code = useMemo(() => {
    if (!tab || tab.kind !== 'request') return '';
    const ctx = contextFor(tab.collectionId, tab.itemId);
    const scopes = resolveVars ? ctx.scopes : { globals: {}, collection: {}, environment: {}, data: {}, local: {} };
    const { spec } = buildSpec(tab.draft.request ?? {}, { collection: ctx.collection, parents: ctx.parents, scopes, settings: ctx.settings, behavior: tab.draft.protocolProfileBehavior });
    return (LANGUAGES.find((l) => l.id === lang) ?? LANGUAGES[0]!).gen(spec);
  }, [tab, lang, resolveVars]);
  /** cURL quoted for the in-app terminal's shell, joined onto one line (typed, not run). */
  const runInTerminal = () => {
    if (!tab || tab.kind !== 'request') return;
    const ctx = contextFor(tab.collectionId, tab.itemId);
    const { spec } = buildSpec(tab.draft.request ?? {}, { collection: ctx.collection, parents: ctx.parents, scopes: ctx.scopes, settings: ctx.settings, behavior: tab.draft.protocolProfileBehavior });
    // A shell would take newlines inside the body as Enter; a JSON body goes on one line instead
    // (same data, whitespace is not significant in JSON).
    if (spec.body.mode === 'raw') {
      try {
        spec.body = { ...spec.body, raw: JSON.stringify(JSON.parse(spec.body.raw)) };
      } catch {
        /* not JSON: keep as is */
      }
    }
    const fam = shellFamily();
    const id = fam === 'powershell' ? 'curl-ps' : fam === 'cmd' ? 'curl-cmd' : 'curl';
    // Line continuations (\ in bash, ` in PowerShell, ^ in cmd) become spaces: one line to edit.
    const cmd = (LANGUAGES.find((l) => l.id === id) ?? LANGUAGES[0]!)
      .gen(spec)
      .replace(/\s*[\\`^]\r?\n\s*/g, ' ')
      .trim();
    close();
    void typeInTerminal(cmd);
  };
  return (
    <Modal open onClose={close} title={t('Code snippet')} width={820}>
      <div className="flex gap-3">
        <div className="w-52 shrink-0 space-y-0.5">
          {LANGUAGES.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => {
                setLang(l.id);
                localStorage.setItem('curlstudio.codeLang', l.id);
              }}
              className={cn('block w-full rounded px-2 py-1 text-left text-[12.5px]', lang === l.id ? 'bg-accent text-accent-foreground' : 'hover:bg-surface-hover')}
            >
              {l.label}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <CodeEditor value={code} readOnly language={lang === 'fetch' || lang === 'axios' ? 'javascript' : 'text'} className="h-[420px] rounded-md border border-border" wrap />
          <div className="flex items-center gap-2">
            <Checkbox checked={resolveVars} onChange={setResolveVars} label={t('Resolve variables')} />
            <div className="flex-1" />
            <Button onClick={runInTerminal} title={t('Type the cURL command into the in-app terminal (press Enter there to run it)')}>
              <SquareTerminal className="size-3.5" /> {t('Run in terminal')}
            </Button>
            <Button variant="primary" onClick={() => copyText(code).then(() => toast('success', t('Copied to clipboard')))}>
              <Copy className="size-3.5" /> {t('Copy')}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function CookiesDialog() {
  const [list, setList] = useState<CookieInfo[]>([]);
  const [domain, setDomain] = useState('');
  const [raw, setRaw] = useState('');
  const close = () => useUi.getState().show(null);
  const load = () => api.cookies().then(setList).catch((e) => toast('error', errText(e)));
  useEffect(() => {
    load();
  }, []);
  const domains = [...new Set(list.map((c) => c.domain))];
  return (
    <Modal open onClose={close} title={t('Cookies')} width={760} description={t('The workspace cookie jar: cookies set by responses are sent automatically on later requests.')}>
      <div className="max-h-[50vh] space-y-3 overflow-auto">
        {domains.length === 0 && <div className="text-muted-foreground">{t('No cookies yet.')}</div>}
        {domains.map((d) => (
          <div key={d} className="rounded-md border border-border">
            <div className="flex items-center gap-2 bg-surface-muted px-2 py-1 font-medium">
              <span className="flex-1">{d}</span>
              <Button size="sm" variant="ghost" onClick={() => api.clearCookies(d).then(load)}>
                {t('Clear domain')}
              </Button>
            </div>
            {list
              .filter((c) => c.domain === d)
              .map((c) => (
                <div key={`${c.path}-${c.name}`} className="flex items-center gap-2 border-t border-border px-2 py-1 font-mono text-[12px]">
                  <span className="text-accent">{c.name}</span>=<span className="min-w-0 flex-1 truncate">{c.value}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {c.path} {c.secure && 'Secure'} {c.httpOnly && 'HttpOnly'} {c.expires ? new Date(c.expires * 1000).toLocaleString() : t('Session')}
                  </span>
                  <IconButton label={t('Delete cookie')} onClick={() => api.removeCookie(c.domain, c.path, c.name).then(load)}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
              ))}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-end gap-2 border-t border-border pt-3">
        <Field label={t('Domain')} className="w-48">
          <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" />
        </Field>
        <Field label="Cookie" className="flex-1">
          <Input value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="session=abc; Path=/; HttpOnly" className="font-mono" />
        </Field>
        <Button
          disabled={!domain || !raw}
          onClick={() =>
            api
              .setCookie(domain, raw)
              .then(() => {
                setRaw('');
                load();
              })
              .catch((e) => toast('error', errText(e)))
          }
        >
          {t('Add')}
        </Button>
        <Button variant="danger" onClick={() => api.clearCookies().then(load)}>
          {t('Clear all')}
        </Button>
      </div>
    </Modal>
  );
}

function SaveAsDialog({ tabId, then }: { tabId: string; then?: () => void }) {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === tabId));
  const collections = useWorkspace((s) => s.collections);
  const order = useWorkspace((s) => s.order);
  const [name, setName] = useState(tab?.kind === 'request' ? tab.draft.name : '');
  const [cid, setCid] = useState(order[0] ?? '');
  const [folder, setFolder] = useState('');
  const close = () => useUi.getState().show(null);
  if (!tab || tab.kind !== 'request') return null;
  const folders: { id: string; label: string }[] = [];
  const walk = (items: PmItem[], prefix: string) => {
    for (const it of items) {
      if (isFolder(it)) {
        folders.push({ id: it.id!, label: `${prefix}${it.name}` });
        walk(it.item!, `${prefix}${it.name} / `);
      }
    }
  };
  if (collections[cid]) walk(collections[cid]!.item, '');
  const save = () => {
    let target = cid;
    if (!target) target = createCollection(t('My Collection'));
    const item: PmItem = { ...clone(tab.draft), id: uid(), name: name || tab.draft.name };
    useWorkspace.getState().updateCollection(target, (c) => {
      if (folder) {
        const f = findItem(c.item, folder);
        if (f?.item.item) {
          f.item.item.push(item);
          return;
        }
      }
      c.item.push(item);
    });
    useTabs.getState().updateDraft(tab.id, (d) => Object.assign(d, { id: item.id, name: item.name }));
    useTabs.getState().markSaved(tab.id, target, item.id!);
    toast('success', t('Saved'));
    close();
    then?.();
  };
  return (
    <Modal open onClose={close} title={t('Save request')}>
      <div className="space-y-3">
        <Field label={t('Request name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label={t('Collection')}>
          <Select value={cid} onChange={(v) => (setCid(v), setFolder(''))} options={order.length ? order.map((id) => ({ value: id, label: collections[id]!.info.name })) : [{ value: '', label: t('Create “My Collection”') }]} />
        </Field>
        {folders.length > 0 && (
          <Field label={t('Folder')}>
            <Select value={folder} onChange={setFolder} options={[{ value: '', label: t('(collection root)') }, ...folders.map((f) => ({ value: f.id, label: f.label }))]} />
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={close}>{t('Cancel')}</Button>
          <Button variant="primary" onClick={save}>
            {t('Save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function PromptDialog({ d }: { d: Extract<NonNullable<ReturnType<typeof useUi.getState>['dialog']>, { kind: 'prompt' }> }) {
  const [value, setValue] = useState(d.value);
  const close = () => useUi.getState().show(null);
  return (
    <Modal open onClose={close} title={d.title}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!value.trim()) return;
          close();
          d.onSubmit(value.trim());
        }}
        className="space-y-3"
      >
        <Field label={d.label}>
          <Input value={value} onChange={(e) => setValue(e.target.value)} autoFocus onFocus={(e) => e.target.select()} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={close}>{t('Cancel')}</Button>
          <Button variant="primary" type="submit">
            {t('OK')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function UnsavedDialog({ tabIds }: { tabIds: string[] }) {
  const [id, ...rest] = tabIds;
  const tab = useTabs((s) => s.tabs.find((t) => t.id === id));
  const settings = useWorkspace((s) => s.settings);
  const [always, setAlways] = useState(false);
  if (!tab || tab.kind !== 'request') return null;
  const cancel = () => useUi.getState().show(null);
  const remember = () => {
    if (always) useWorkspace.getState().saveSettings({ ...settings, discardUnsavedOnClose: true });
  };
  const dontSave = () => {
    remember();
    useTabs.getState().close(tab.id);
    // With "always discard" ticked, the rest of the queue closes without asking.
    if (always) {
      for (const r of rest) useTabs.getState().close(r);
      useUi.getState().show(null);
    } else nextUnsaved(rest);
  };
  const save = () => {
    remember();
    const after = () => {
      useTabs.getState().close(tab.id);
      nextUnsaved(rest);
    };
    if (tab.collectionId && tab.itemId && useWorkspace.getState().collections[tab.collectionId]) {
      saveTab(tab);
      after();
    } else {
      useUi.getState().show({ kind: 'saveAs', tabId: tab.id, then: after });
    }
  };
  return (
    <Modal open onClose={cancel} title={t('Save changes?')}>
      <div className="space-y-4">
        <p className="text-[13px]">
          <span className="font-semibold break-all">{tab.draft.name}</span> {t('has unsaved changes. Save these changes to avoid losing your work.')}
          {rest.length > 0 && <span className="text-muted-foreground"> {t(plural(rest.length, '({n} more tab after this one.)', '({n} more tabs after this one.)'), { n: rest.length })}</span>}
        </p>
        <Checkbox checked={always} onChange={setAlways} label={t('Always discard unsaved changes when closing a tab')} title={t('You can turn this back off in Settings')} />
        <div className="flex items-center gap-2">
          <Button onClick={dontSave}>{t("Don't save")}</Button>
          <div className="flex-1" />
          <Button onClick={cancel}>{t('Cancel')}</Button>
          <Button variant="primary" data-autofocus onClick={save}>
            {t('Save changes')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function Dialogs() {
  const d = useUi((s) => s.dialog);
  const close = () => useUi.getState().show(null);
  if (!d) return null;
  switch (d.kind) {
    case 'import':
      return <ImportDialog initial={d.initialText} />;
    case 'code':
      return <CodeDialog tabId={d.tabId} />;
    case 'cookies':
      return <CookiesDialog />;
    case 'settings':
      return <SettingsDialog section={d.section} />;
    case 'shortcuts':
      return <ShortcutsWindow open onClose={close} />;
    case 'activity':
      return <ActivityWindow open onClose={close} />;
    case 'help':
      return <HelpDialog onClose={close} initialTab={d.tab} />;
    case 'saveAs':
      return <SaveAsDialog tabId={d.tabId} then={d.then} />;
    case 'unsaved':
      return <UnsavedDialog key={d.tabIds[0]} tabIds={d.tabIds} />;
    case 'prompt':
      return <PromptDialog key={d.title + d.value} d={d} />;
    case 'confirm': {
      const back = () => useUi.getState().show(d.returnTo ?? null);
      return (
        <Modal open onClose={back} title={d.title} description={d.message}>
          <div className="flex justify-end gap-2">
            <Button onClick={back}>{t('Cancel')}</Button>
            <Button
              variant={d.danger ? 'danger' : 'primary'}
              autoFocus
              onClick={() => {
                back();
                d.onConfirm();
              }}
            >
              {d.confirmLabel ?? t('OK')}
            </Button>
          </div>
        </Modal>
      );
    }
    default:
      return null;
  }
}
