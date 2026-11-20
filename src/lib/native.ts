import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { openPath as openPathNative, openUrl as openUrlNative } from '@tauri-apps/plugin-opener';

import { download } from './format';
import { askText } from '@/stores/ui';

import { t } from './i18n';
import { api, isTauri } from './ipc';

export interface Filter {
  name: string;
  extensions: string[];
}

/** File picker returning absolute paths (browser dev mode falls back to a prompt). */
export async function pickFiles(opts: { title: string; filters?: Filter[]; multiple?: boolean; directory?: boolean }): Promise<string[]> {
  if (isTauri) {
    const r = await openDialog({ title: opts.title, multiple: !!opts.multiple, directory: !!opts.directory, filters: opts.filters });
    if (!r) return [];
    return Array.isArray(r) ? r : [r];
  }
  // Browser dev mode has no native file dialog: ask for the path(s) in the app's own dialog.
  const p = await askText(opts.title, opts.multiple ? t('Absolute paths') : t('Absolute path'), '', {
    hint: opts.multiple ? t('Separate several paths with ;') : t('Browser dev mode: type the full path on this computer.'),
    placeholder: opts.directory ? 'C:\\data\\folder' : 'C:\\data\\file.json',
  });
  return p ? p.split(';').map((x) => x.trim()).filter(Boolean) : [];
}

/** Read text files chosen by the user (browser dev mode reads through an <input type=file>). */
export async function pickTextFiles(opts: { title: string; filters?: Filter[]; multiple?: boolean }): Promise<{ name: string; text: string }[]> {
  if (isTauri) {
    const paths = await pickFiles(opts);
    return Promise.all(paths.map(async (p) => ({ name: p.split(/[\\/]/).pop() ?? p, text: await api.readText(p) })));
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = !!opts.multiple;
    const exts = opts.filters?.flatMap((f) => f.extensions.map((e) => `.${e}`)) ?? [];
    if (exts.length && !exts.includes('.*')) input.accept = exts.join(',');
    input.onchange = async () => {
      const files = [...(input.files ?? [])];
      resolve(await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() }))));
    };
    input.click();
  });
}

/** Save text through a native "Save as" dialog (browser: download). Returns false if cancelled. */
export async function saveText(defaultName: string, text: string, filters?: Filter[]): Promise<boolean> {
  if (isTauri) {
    const path = await saveDialog({ defaultPath: defaultName, filters });
    if (!path) return false;
    await api.writeText(path, text);
    return true;
  }
  const ext = defaultName.split('.').pop() ?? '';
  const type =
    ext === 'json' ? 'application/json' : ext === 'html' ? 'text/html' : ext === 'csv' ? 'text/csv' : ext === 'xml' ? 'application/xml' : 'text/plain';
  download(defaultName, text, type);
  return true;
}

export async function savePath(defaultName: string, filters?: Filter[]): Promise<string | null> {
  if (isTauri) {
    return (await saveDialog({ defaultPath: defaultName, filters })) ?? null;
  }
  return askText(t('Save to'), t('Absolute path'), defaultName, { hint: t('Browser dev mode: type the full path on this computer.') });
}

export async function openUrl(url: string): Promise<void> {
  if (isTauri) {
    await openUrlNative(url);
    return;
  }
  window.open(url, '_blank', 'noopener');
}

export async function revealPath(path: string): Promise<void> {
  if (isTauri) {
    await openPathNative(path);
  }
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export const JSON_FILTER: Filter[] = [{ name: 'JSON', extensions: ['json'] }];
