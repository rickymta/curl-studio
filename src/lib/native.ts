import { download } from './format';
import { api, isTauri } from './ipc';

export interface Filter {
  name: string;
  extensions: string[];
}

/** File picker returning absolute paths (browser dev mode falls back to a prompt). */
export async function pickFiles(opts: { title: string; filters?: Filter[]; multiple?: boolean; directory?: boolean }): Promise<string[]> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const r = await open({ title: opts.title, multiple: !!opts.multiple, directory: !!opts.directory, filters: opts.filters });
    if (!r) return [];
    return Array.isArray(r) ? r : [r];
  }
  const p = window.prompt(`${opts.title} (absolute path${opts.multiple ? 's, separated by ;' : ''})`);
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
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ defaultPath: defaultName, filters });
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
    const { save } = await import('@tauri-apps/plugin-dialog');
    return (await save({ defaultPath: defaultName, filters })) ?? null;
  }
  return window.prompt('Save to (absolute path)', defaultName);
}

export async function openUrl(url: string): Promise<void> {
  if (isTauri) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
    return;
  }
  window.open(url, '_blank', 'noopener');
}

export async function revealPath(path: string): Promise<void> {
  if (isTauri) {
    const { openPath } = await import('@tauri-apps/plugin-opener');
    await openPath(path);
  }
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export const JSON_FILTER: Filter[] = [{ name: 'JSON', extensions: ['json'] }];
