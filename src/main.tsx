import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import './index.css';
import { t } from './lib/i18n';
import { isTauri } from './lib/ipc';
import { toast } from './stores/ui';

// The webview's built-in function-key actions (F3 find, F7 caret browsing, F12 devtools…) have no
// place in the desktop app. Only the default action is cancelled, so the app's own shortcuts
// (F1 = Help, F5 = reload the workspace) and the terminal still receive the key.
if (isTauri) {
  window.addEventListener(
    'keydown',
    (e) => {
      if (/^F([1-9]|1[0-2])$/.test(e.key)) e.preventDefault();
    },
    { capture: true },
  );
}

// Click handlers are often `async` with no catch: surface their failures instead of letting the
// button look dead (as in GitStudio).
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason as { message?: string } | undefined;
  toast('error', t('Something went wrong'), r?.message ?? String(e.reason));
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
