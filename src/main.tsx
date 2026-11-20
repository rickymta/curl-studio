import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import './index.css';
import { isTauri } from './lib/ipc';

// The webview's built-in function-key actions (F5 reload, F3 find, F7 caret browsing, F12 devtools…)
// have no place in the desktop app: F5 would throw away unsaved tabs. Only the default action is
// cancelled, so the app's own shortcuts (F1 = Help) and the terminal still receive the key.
if (isTauri) {
  window.addEventListener(
    'keydown',
    (e) => {
      if (/^F([1-9]|1[0-2])$/.test(e.key)) e.preventDefault();
    },
    { capture: true },
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
