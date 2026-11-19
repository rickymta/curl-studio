import { autocompletion, closeBrackets, type CompletionContext } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, type Extension, RangeSetBuilder, StateEffect } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  hoverTooltip,
  keymap,
  lineNumbers,
  placeholder as placeholderExt,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { useEffect, useRef } from 'react';

import { useVarCollection } from '@/features/request/varScope';

import { cn } from './ui';
import { varTooltipDom } from './varTooltip';

export type Lang = 'json' | 'xml' | 'html' | 'javascript' | 'text' | 'graphql';

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: 'var(--cm-keyword)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--cm-string)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--cm-number)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--cm-property)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--cm-comment)', fontStyle: 'italic' },
  { tag: [t.tagName, t.typeName, t.className], color: 'var(--cm-tag)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--cm-fn)' },
  { tag: [t.punctuation, t.bracket], color: 'var(--muted-foreground)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: 'var(--editor-font, 12.5px)', backgroundColor: 'transparent' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--foreground)' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--muted-foreground)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklch, var(--surface-hover) 45%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--foreground)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--selection) !important',
  },
  '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '.cm-tooltip': { backgroundColor: 'var(--surface)', border: '1px solid var(--border)' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' },
  '.cm-panels': { backgroundColor: 'var(--surface)', color: 'var(--foreground)' },
  '.cm-search input, .cm-search button': { fontSize: '12px' },
  '.cm-foldGutter span': { padding: '0 2px' },
  '.cm-var': { color: 'var(--accent)', fontWeight: '600' },
  // Syntax highlighting (e.g. a JSON string) renders inside the mark; let the variable colour win.
  '.cm-var *, .cm-var-unknown *': { color: 'inherit' },
  '.cm-var-unknown': { color: 'var(--danger)', fontWeight: '600', outline: '1px solid color-mix(in oklch, var(--danger) 60%, transparent)', borderRadius: '2px' },
  '.cm-tooltip.cm-var-tip': { border: 'none', background: 'transparent' },
});

/** Re-colour `{{vars}}` after the set of known variables changed (environment switch, edits). */
const refreshVars = StateEffect.define<null>();

/** Postman-style card when hovering a `{{variable}}` in the editor (value, scope, edit in place). */
function varHover(collectionId: () => string | null) {
  return hoverTooltip(
    (view, pos) => {
      const line = view.state.doc.lineAt(pos);
      for (const m of line.text.matchAll(VAR_RE)) {
        const from = line.from + m.index!;
        const to = from + m[0].length;
        if (pos < from || pos > to) continue;
        const name = m[0].slice(2, -2).trim();
        return {
          pos: from,
          end: to,
          above: false,
          create: () => ({ dom: varTooltipDom(name, collectionId(), () => view.dispatch({ effects: refreshVars.of(null) })) }),
        };
      }
      return null;
    },
    { hoverTime: 300 },
  );
}

const VAR_RE = /\{\{[^{}]+\}\}/g;

function varHighlighter(known: () => Set<string> | null) {
  const mark = Decoration.mark({ class: 'cm-var' });
  const bad = Decoration.mark({ class: 'cm-var-unknown' });
  const build = (view: EditorView): DecorationSet => {
    const b = new RangeSetBuilder<Decoration>();
    const k = known();
    for (const { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to);
      for (const m of text.matchAll(VAR_RE)) {
        const name = m[0].slice(2, -2).trim();
        const ok = !k || name.startsWith('$') || k.has(name);
        b.add(from + m.index!, from + m.index! + m[0].length, ok ? mark : bad);
      }
    }
    return b.finish();
  };
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(v: EditorView) {
        this.decorations = build(v);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshVars)))) this.decorations = build(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

function langExt(l: Lang): Extension {
  switch (l) {
    case 'json':
      return json();
    case 'xml':
      return xml();
    case 'html':
      return html();
    case 'javascript':
      return javascript();
    default:
      return [];
  }
}

const PM_COMPLETIONS = [
  'pm.test("", () => {\n  \n});',
  'pm.expect().to.equal()',
  'pm.response.to.have.status(200);',
  'pm.response.json()',
  'pm.response.text()',
  'pm.response.code',
  'pm.response.responseTime',
  'pm.response.headers.get("")',
  'pm.environment.set("", "")',
  'pm.environment.get("")',
  'pm.globals.set("", "")',
  'pm.globals.get("")',
  'pm.collectionVariables.set("", "")',
  'pm.collectionVariables.get("")',
  'pm.variables.get("")',
  'pm.variables.set("", "")',
  'pm.iterationData.get("")',
  'pm.request.headers.add({ key: "", value: "" });',
  'pm.request.url.toString()',
  'pm.sendRequest("", (err, res) => {\n  \n});',
  'pm.execution.setNextRequest("")',
  'pm.execution.skipRequest()',
  'pm.info.requestName',
  'pm.visualizer.set(template, data)',
  'console.log()',
];

function pmCompletions(ctx: CompletionContext) {
  const w = ctx.matchBefore(/[\w.]+/);
  if (!w || (w.from === w.to && !ctx.explicit)) return null;
  return {
    from: w.from,
    options: PM_COMPLETIONS.filter((c) => c.startsWith(w.text)).map((c) => ({ label: c, type: 'function' })),
  };
}

export interface CodeEditorProps {
  value: string;
  onChange?: (v: string) => void;
  language?: Lang;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
  lineNumbers?: boolean;
  wrap?: boolean;
  /** Known variable names; unknown `{{x}}` render red. */
  variables?: Set<string> | null;
  scripting?: boolean;
  onRun?: () => void;
  /** Extra CodeMirror extensions (e.g. GraphQL completion); reconfigured when it changes. */
  extensions?: Extension;
}

export function CodeEditor({
  value,
  onChange,
  language = 'text',
  readOnly = false,
  placeholder,
  className,
  lineNumbers: showLines = true,
  wrap = false,
  variables = null,
  scripting = false,
  onRun,
  extensions,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const lang = useRef(new Compartment());
  const ro = useRef(new Compartment());
  const wrapC = useRef(new Compartment());
  const extra = useRef(new Compartment());
  const collectionId = useVarCollection();
  const cb = useRef({ onChange, onRun, variables, collectionId });
  useEffect(() => {
    cb.current = { onChange, onRun, variables, collectionId };
  });
  useEffect(() => {
    view.current?.dispatch({ effects: refreshVars.of(null) });
  }, [variables]);

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          showLines ? [lineNumbers(), highlightActiveLineGutter(), foldGutter()] : [],
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          search({ top: true }),
          syntaxHighlighting(highlight),
          scripting ? autocompletion({ override: [pmCompletions] }) : [],
          keymap.of([
            { key: 'Mod-Enter', run: () => (cb.current.onRun?.(), true) },
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            ...foldKeymap,
            indentWithTab,
          ]),
          theme,
          varHighlighter(() => cb.current.variables ?? null),
          cb.current.variables !== null ? varHover(() => cb.current.collectionId) : [],
          placeholder ? placeholderExt(placeholder) : [],
          lang.current.of(langExt(language)),
          ro.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
          wrapC.current.of(wrap ? EditorView.lineWrapping : []),
          extra.current.of(extensions ?? []),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cb.current.onChange?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);
  useEffect(() => {
    view.current?.dispatch({ effects: lang.current.reconfigure(langExt(language)) });
  }, [language]);
  useEffect(() => {
    view.current?.dispatch({
      effects: ro.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
    });
  }, [readOnly]);
  useEffect(() => {
    view.current?.dispatch({ effects: wrapC.current.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }, [wrap]);
  useEffect(() => {
    view.current?.dispatch({ effects: extra.current.reconfigure(extensions ?? []) });
  }, [extensions]);

  return <div ref={host} className={cn('selectable min-h-0 overflow-hidden', className)} />;
}
