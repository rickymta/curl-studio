// Keyboard shortcuts shown in the Keyboard Shortcuts window (Ctrl+/). Keep in sync with the
// handlers in App.tsx (global), HttpEditor (send/save) and the terminal runtime.

export interface Shortcut {
  label: string;
  /** Alternatives, each a list of keys pressed together. */
  keys: string[][];
}

export interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Requests',
    items: [
      { label: 'Send request', keys: [['Ctrl', 'Enter'], ['Enter (in the URL bar)']] },
      { label: 'Save request', keys: [['Ctrl', 'S']] },
      { label: 'New HTTP request tab', keys: [['Ctrl', 'T']] },
      { label: 'Import (Postman, cURL)', keys: [['Ctrl', 'O']] },
      { label: 'Import a cURL command', keys: [['Ctrl', 'V (in the URL bar)']] },
      { label: 'Variable card: save / cancel', keys: [['Enter'], ['Esc']] },
    ],
  },
  {
    title: 'Tabs and Navigation',
    items: [
      { label: 'Close tab', keys: [['Ctrl', 'W'], ['Middle click']] },
      { label: 'Next tab', keys: [['Ctrl', 'Tab']] },
      { label: 'Previous tab', keys: [['Ctrl', 'Shift', 'Tab']] },
      { label: 'Search the sidebar', keys: [['Ctrl', 'K']] },
      { label: 'Show / hide the sidebar', keys: [['Ctrl', '\\']] },
      { label: 'Find in editor / response', keys: [['Ctrl', 'F']] },
      { label: 'Close dialog or menu', keys: [['Esc']] },
    ],
  },
  {
    title: 'Panels and Windows',
    items: [
      { label: 'Toggle in-app terminal', keys: [['Ctrl', '`']] },
      { label: 'Toggle console', keys: [['Ctrl', 'Alt', 'C']] },
      { label: 'Activity Logs', keys: [['Ctrl', 'Shift', 'L']] },
      { label: 'Keyboard Shortcuts', keys: [['Ctrl', '/']] },
      { label: 'Settings', keys: [['Ctrl', ',']] },
      { label: 'Help & Support', keys: [['F1']] },
    ],
  },
  {
    title: 'View',
    items: [
      { label: 'Zoom in', keys: [['Ctrl', '+'], ['Ctrl', '=']] },
      { label: 'Zoom out', keys: [['Ctrl', '-']] },
      { label: 'Reset zoom', keys: [['Ctrl', '0']] },
    ],
  },
  {
    title: 'Terminal',
    items: [
      { label: 'Copy selection', keys: [['Ctrl', 'Shift', 'C'], ['Ctrl', 'C (with a selection)']] },
      { label: 'Paste', keys: [['Ctrl', 'V']] },
      { label: 'Interrupt the running command', keys: [['Ctrl', 'C']] },
    ],
  },
];
