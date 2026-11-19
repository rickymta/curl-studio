// CodeMirror support for GraphQL queries once a schema is loaded: field completion for the type at
// the cursor and red underlines (with a tooltip) for unknown fields.

import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import { type Extension, RangeSetBuilder } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

import { checkQuery, type GqlSchema, typeAt, typeName } from '@/lib/graphqlAssist';

const errorMark = (message: string) => Decoration.mark({ class: 'cm-gql-error', attributes: { title: message } });

export function graphqlExtension(schema: GqlSchema, onProblems?: (n: number, first?: string) => void): Extension {
  const complete = (ctx: CompletionContext) => {
    const w = ctx.matchBefore(/\w*/);
    if (!w || (w.from === w.to && !ctx.explicit)) return null;
    const doc = ctx.state.doc.toString();
    const t = typeAt(doc, w.from, schema);
    if (t === 'top') {
      return { from: w.from, options: ['query', 'mutation', 'subscription', 'fragment'].map((k) => ({ label: k, type: 'keyword' })) };
    }
    if (!t?.fields) return null;
    return {
      from: w.from,
      options: [
        ...t.fields.map((f) => ({
          label: f.name,
          type: 'property',
          detail: `${f.args.length ? `(${f.args.map((a) => `${a.name}: ${typeName(a.type)}`).join(', ')}) ` : ''}${typeName(f.type)}`,
          info: f.description ?? undefined,
        })),
        { label: '__typename', type: 'property', detail: 'String!' },
      ],
    };
  };

  const build = (view: EditorView): DecorationSet => {
    const problems = checkQuery(view.state.doc.toString(), schema).sort((a, b) => a.from - b.from);
    onProblems?.(problems.length, problems[0]?.message);
    const b = new RangeSetBuilder<Decoration>();
    let last = -1;
    for (const p of problems) {
      if (p.from < last || p.to <= p.from) continue;
      b.add(p.from, p.to, errorMark(p.message));
      last = p.to;
    }
    return b.finish();
  };

  return [
    autocompletion({ override: [complete], activateOnTyping: true }),
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(v: EditorView) {
          this.decorations = build(v);
        }
        update(u: ViewUpdate) {
          if (u.docChanged) this.decorations = build(u.view);
        }
      },
      { decorations: (v) => v.decorations },
    ),
    EditorView.theme({
      '.cm-gql-error': { textDecoration: 'underline wavy var(--danger)', textUnderlineOffset: '3px' },
    }),
  ];
}
