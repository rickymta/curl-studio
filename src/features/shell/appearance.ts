// Zoom and brightness of the whole UI (Settings → Appearance, status bar, Ctrl +/-/0).

import { useWorkspace } from '@/stores/workspace';

export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2;
export const BRIGHTNESS_MIN = 70;
export const BRIGHTNESS_MAX = 130;

export const clampZoom = (z: number) => Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number.isFinite(z) ? z : 1)) * 10) / 10;

export function clampBrightness(v: number): number {
  if (!Number.isFinite(v)) return 100;
  return Math.min(BRIGHTNESS_MAX, Math.max(BRIGHTNESS_MIN, Math.round(v / 5) * 5));
}

export function applyZoom(z: number) {
  (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = String(clampZoom(z));
}

/** Dim or brighten everything on screen (text, charts, terminal) by `percent`. */
export function applyBrightness(percent: number) {
  const style = document.documentElement.style;
  if (percent === 100) style.removeProperty('filter');
  else style.setProperty('filter', `brightness(${percent / 100})`);
}

export function setZoom(z: number) {
  const ws = useWorkspace.getState();
  const v = clampZoom(z);
  if (v !== ws.settings.zoom) ws.saveSettings({ ...ws.settings, zoom: v });
}

export const zoomBy = (d: number) => setZoom(useWorkspace.getState().settings.zoom + d);
