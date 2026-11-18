import { Copy, FileUp, FolderOpen, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { CodeEditor } from '@/components/CodeEditor';
import { Button, Checkbox, cn, Field, IconButton, Input, Modal, Select } from '@/components/ui';
import { buildSpec } from '@/lib/build';
import { LANGUAGES } from '@/lib/codegen';
import { contextFor } from '@/lib/execute';
import { api } from '@/lib/ipc';
import { copyText, revealPath } from '@/lib/native';
import { clone, findItem, isFolder, uid } from '@/lib/postman';
import type { CookieInfo, PmItem, Settings } from '@/lib/types';
import { useTabs } from '@/stores/tabs';
import { errText, toast, useUi } from '@/stores/ui';
import { createCollection, useWorkspace } from '@/stores/workspace';

import { exportEverything, importFiles, importJsonText } from '../actions';

function ImportDialog({ initial }: { initial?: string }) {
  const [text, setText] = useState(initial ?? '');
  const close = () => useUi.getState().show(null);
  const doImport = () => {
    try {
      const done = importJsonText(text.trim());
      toast('success', `Imported ${done.join(', ')}`);
      close();
    } catch (e) {
      toast('error', errText(e));
    }
  };
  return (
    <Modal open onClose={close} title="Import" width={680} description="Postman collections (v1, v2.0, v2.1), environments, globals, full data dumps, or a cURL command.">
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
              toast('success', `Imported ${done.join(', ')}`);
              close();
            }
          }}
          className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border p-6 text-muted-foreground"
        >
          <FileUp className="size-6" />
          Drop files here or
          <Button
            onClick={async () => {
              close();
              await importFiles();
            }}
          >
            Choose files…
          </Button>
        </div>
        <Field label="…or paste raw text (JSON or cURL)">
          <CodeEditor value={text} onChange={setText} language={text.trim().startsWith('curl') ? 'text' : 'json'} className="h-56 rounded-md border border-border" placeholder="curl https://api.example.com -H 'Accept: application/json'" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!text.trim()} onClick={doImport}>
            Import
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
  return (
    <Modal open onClose={close} title="Code snippet" width={820}>
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
            <Checkbox checked={resolveVars} onChange={setResolveVars} label="Resolve variables" />
            <div className="flex-1" />
            <Button variant="primary" onClick={() => copyText(code).then(() => toast('success', 'Copied to clipboard'))}>
              <Copy className="size-3.5" /> Copy
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
    <Modal open onClose={close} title="Cookies" width={760} description="The workspace cookie jar: cookies set by responses are sent automatically on later requests.">
      <div className="max-h-[50vh] space-y-3 overflow-auto">
        {domains.length === 0 && <div className="text-muted-foreground">No cookies yet.</div>}
        {domains.map((d) => (
          <div key={d} className="rounded-md border border-border">
            <div className="flex items-center gap-2 bg-surface-muted px-2 py-1 font-medium">
              <span className="flex-1">{d}</span>
              <Button size="sm" variant="ghost" onClick={() => api.clearCookies(d).then(load)}>
                Clear domain
              </Button>
            </div>
            {list
              .filter((c) => c.domain === d)
              .map((c) => (
                <div key={`${c.path}-${c.name}`} className="flex items-center gap-2 border-t border-border px-2 py-1 font-mono text-[12px]">
                  <span className="text-accent">{c.name}</span>=<span className="min-w-0 flex-1 truncate">{c.value}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {c.path} {c.secure && 'Secure'} {c.httpOnly && 'HttpOnly'} {c.expires ? new Date(c.expires * 1000).toLocaleString() : 'Session'}
                  </span>
                  <IconButton label="Delete cookie" onClick={() => api.removeCookie(c.domain, c.path, c.name).then(load)}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
              ))}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-end gap-2 border-t border-border pt-3">
        <Field label="Domain" className="w-48">
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
          Add
        </Button>
        <Button variant="danger" onClick={() => api.clearCookies().then(load)}>
          Clear all
        </Button>
      </div>
    </Modal>
  );
}

function SettingsDialog() {
  const s = useWorkspace((x) => x.settings);
  const [v, setV] = useState<Settings>(s);
  const [dataDir, setDataDir] = useState('');
  useEffect(() => {
    api.info().then((i) => setDataDir(i.dataDir)).catch(() => undefined);
  }, []);
  const close = () => useUi.getState().show(null);
  const set = <K extends keyof Settings>(k: K, val: Settings[K]) => setV({ ...v, [k]: val });
  return (
    <Modal open onClose={close} title="Settings" width={620}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Theme">
          <Select value={v.theme} onChange={(x) => set('theme', x as Settings['theme'])} options={['dark', 'light', 'system']} />
        </Field>
        <Field label="Request timeout (ms)">
          <Input type="number" value={v.timeoutMs} onChange={(e) => set('timeoutMs', Number(e.target.value) || 30000)} />
        </Field>
        <Field label="Max redirects">
          <Input type="number" value={v.maxRedirects} onChange={(e) => set('maxRedirects', Number(e.target.value) || 10)} />
        </Field>
        <Field label="Max response size shown (MB)">
          <Input type="number" value={v.maxBodyMb} onChange={(e) => set('maxBodyMb', Number(e.target.value) || 50)} />
        </Field>
        <Field label="Proxy" hint="Empty = system proxy · none = direct · http://host:port · socks5://…" className="col-span-2">
          <Input value={v.proxy} onChange={(e) => set('proxy', e.target.value)} />
        </Field>
        <Field label="History entries kept">
          <Input type="number" value={v.historyLimit} onChange={(e) => set('historyLimit', Number(e.target.value) || 300)} />
        </Field>
        <div />
        <Checkbox checked={v.followRedirects} onChange={(x) => set('followRedirects', x)} label="Follow redirects" />
        <Checkbox checked={v.verifyTls} onChange={(x) => set('verifyTls', x)} label="SSL certificate verification" />
        <Checkbox checked={v.cookies} onChange={(x) => set('cookies', x)} label="Use the cookie jar" />
        <Checkbox checked={v.http1Only} onChange={(x) => set('http1Only', x)} label="Force HTTP/1.1" />
      </div>
      <div className="mt-4 flex items-center gap-2 border-t border-border pt-3 text-[12px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate" title={dataDir}>
          Workspace: <span className="font-mono">{dataDir}</span>
        </span>
        <Button size="sm" variant="ghost" onClick={() => revealPath(dataDir)}>
          <FolderOpen className="size-3.5" /> Open
        </Button>
        <Button size="sm" variant="ghost" onClick={exportEverything}>
          Export all (Postman dump)
        </Button>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={close}>Cancel</Button>
        <Button
          variant="primary"
          onClick={() => {
            useWorkspace.getState().saveSettings(v);
            close();
          }}
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}

function SaveAsDialog({ tabId }: { tabId: string }) {
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
    if (!target) target = createCollection('My Collection');
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
    toast('success', 'Saved');
    close();
  };
  return (
    <Modal open onClose={close} title="Save request">
      <div className="space-y-3">
        <Field label="Request name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Collection">
          <Select value={cid} onChange={(v) => (setCid(v), setFolder(''))} options={order.length ? order.map((id) => ({ value: id, label: collections[id]!.info.name })) : [{ value: '', label: 'Create “My Collection”' }]} />
        </Field>
        {folders.length > 0 && (
          <Field label="Folder">
            <Select value={folder} onChange={setFolder} options={[{ value: '', label: '(collection root)' }, ...folders.map((f) => ({ value: f.id, label: f.label }))]} />
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Save
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
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" type="submit">
            OK
          </Button>
        </div>
      </form>
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
      return <SettingsDialog />;
    case 'saveAs':
      return <SaveAsDialog tabId={d.tabId} />;
    case 'prompt':
      return <PromptDialog key={d.title + d.value} d={d} />;
    case 'confirm':
      return (
        <Modal open onClose={close} title={d.title} description={d.message}>
          <div className="flex justify-end gap-2">
            <Button onClick={close}>Cancel</Button>
            <Button
              variant={d.danger ? 'danger' : 'primary'}
              autoFocus
              onClick={() => {
                close();
                d.onConfirm();
              }}
            >
              {d.confirmLabel ?? 'OK'}
            </Button>
          </div>
        </Modal>
      );
    default:
      return null;
  }
}
