import { CircleAlert, FileUp, RefreshCw, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { CodeEditor, type Lang } from '@/components/CodeEditor';
import { KeyValueTable } from '@/components/KeyValueTable';
import { Button, cn, IconButton, Select, Spinner } from '@/components/ui';
import { graphqlExtension } from '@/components/graphqlExt';
import { prettyJson, prettyXml } from '@/lib/format';
import { type GqlField, type GqlSchema, type GqlType, type TypeRef, typeName } from '@/lib/graphqlAssist';
import { pickFiles } from '@/lib/native';
import type { PmBody, RequestSpec } from '@/lib/types';
import { api } from '@/lib/ipc';
import { errText, toast } from '@/stores/ui';

const MODES = [
  { id: 'none', label: 'none' },
  { id: 'formdata', label: 'form-data' },
  { id: 'urlencoded', label: 'x-www-form-urlencoded' },
  { id: 'raw', label: 'raw' },
  { id: 'file', label: 'binary' },
  { id: 'graphql', label: 'GraphQL' },
] as const;

const RAW_LANGS = [
  { value: 'text', label: 'Text' },
  { value: 'json', label: 'JSON' },
  { value: 'xml', label: 'XML' },
  { value: 'html', label: 'HTML' },
  { value: 'javascript', label: 'JavaScript' },
];

const INTROSPECTION = `query IntrospectionQuery { __schema { queryType { name } mutationType { name } subscriptionType { name } types { kind name description fields(includeDeprecated: true) { name description args { name type { ...TypeRef } } type { ...TypeRef } } inputFields { name type { ...TypeRef } } enumValues { name } } } }
fragment TypeRef on __Type { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }`;

/** Schemas fetched this session, by endpoint URL, so reopening a tab keeps completion. */
const schemaCache = new Map<string, GqlSchema>();

function GraphQLEditor({
  body,
  onChange,
  known,
  buildIntrospection,
}: {
  body: PmBody;
  onChange: (b: PmBody) => void;
  known?: Set<string> | null;
  buildIntrospection: () => RequestSpec | null;
}) {
  const g = body.graphql ?? { query: '', variables: '' };
  const urlKey = buildIntrospection()?.url ?? '';
  const [schema, setSchemaState] = useState<GqlSchema | null>(() => schemaCache.get(urlKey) ?? null);
  const setSchema = (s: GqlSchema) => {
    schemaCache.set(urlKey, s);
    setSchemaState(s);
  };
  const [problems, setProblems] = useState<{ n: number; first?: string }>({ n: 0 });
  const gqlExt = useMemo(() => (schema ? graphqlExtension(schema, (n, first) => setTimeout(() => setProblems({ n, first }), 0)) : []), [schema]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const fetchSchema = async () => {
    const spec = buildIntrospection();
    if (!spec) return;
    setBusy(true);
    try {
      spec.method = 'POST';
      spec.body = { mode: 'raw', raw: JSON.stringify({ query: INTROSPECTION }) };
      spec.headers = [...spec.headers.filter((h) => h.key.toLowerCase() !== 'content-type'), { key: 'Content-Type', value: 'application/json' }];
      const res = await api.send(spec);
      const json = JSON.parse(res.body) as { data?: { __schema: { types: GqlType[]; queryType?: { name: string }; mutationType?: { name: string }; subscriptionType?: { name: string } } }; errors?: unknown };
      if (!json.data) throw new Error(`Introspection failed: ${res.body.slice(0, 200)}`);
      const s = json.data.__schema;
      setSchema({ types: s.types, query: s.queryType?.name, mutation: s.mutationType?.name, subscription: s.subscriptionType?.name });
      toast('success', `Schema loaded: ${s.types.filter((t) => !t.name.startsWith('__')).length} types`);
    } catch (e) {
      toast('error', errText(e));
    } finally {
      setBusy(false);
    }
  };
  const roots = schema
    ? ([['query', schema.query], ['mutation', schema.mutation], ['subscription', schema.subscription]] as const)
        .filter(([, n]) => n)
        .map(([op, n]) => ({ op, type: schema.types.find((t) => t.name === n)! }))
    : [];
  const insertField = (op: string, f: GqlField) => {
    const args = f.args.length ? `(${f.args.map((a) => `${a.name}: $${a.name}`).join(', ')})` : '';
    const vars = f.args.length ? `(${f.args.map((a) => `$${a.name}: ${typeName(a.type)}`).join(', ')})` : '';
    const leaf = (t: TypeRef | null): string => (t?.ofType ? leaf(t.ofType) : (t?.name ?? ''));
    const target = schema?.types.find((t) => t.name === leaf(f.type));
    const sel = target?.fields?.length
      ? ` {\n    ${target.fields.filter((x) => !x.args.length && !schema!.types.find((t) => t.name === leaf(x.type))?.fields?.length).slice(0, 8).map((x) => x.name).join('\n    ') || '__typename'}\n  }`
      : '';
    onChange({ ...body, mode: 'graphql', graphql: { ...g, query: `${op} ${f.name[0]!.toUpperCase()}${f.name.slice(1)}${vars} {\n  ${f.name}${args}${sel}\n}\n` } });
  };
  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-[3] flex-col border-r border-border">
        <div className="flex h-8 items-center gap-2 px-2 text-[11px] font-semibold text-muted-foreground uppercase">
          Query
          <div className="flex-1" />
          <Button size="sm" variant="ghost" onClick={fetchSchema} disabled={busy}>
            {busy ? <Spinner className="size-3" /> : <RefreshCw className="size-3" />} Fetch schema
          </Button>
        </div>
        <CodeEditor value={g.query ?? ''} onChange={(v) => onChange({ ...body, mode: 'graphql', graphql: { ...g, query: v } })} variables={known} className="min-h-0 flex-1" language="text" placeholder="query { ... }" extensions={gqlExt} />
        <div className="flex h-6 shrink-0 items-center gap-1.5 border-t border-border px-2 text-[11.5px] text-muted-foreground">
          {!schema ? (
            'Fetch the schema for field completion (Ctrl+Space) and error checking.'
          ) : problems.n ? (
            <span className="flex min-w-0 items-center gap-1.5 text-danger" title={problems.first}>
              <CircleAlert className="size-3.5 shrink-0" />
              <span className="truncate">
                {problems.n} problem{problems.n > 1 ? 's' : ''}: {problems.first}
              </span>
            </span>
          ) : (
            <span className="text-success">✓ Query matches the schema</span>
          )}
        </div>
      </div>
      <div className="flex min-w-0 flex-[2] flex-col">
        <div className="flex h-8 items-center px-2 text-[11px] font-semibold text-muted-foreground uppercase">GraphQL Variables</div>
        <CodeEditor value={g.variables ?? ''} onChange={(v) => onChange({ ...body, mode: 'graphql', graphql: { ...g, variables: v } })} language="json" variables={known} className={cn('min-h-0', schema ? 'flex-1' : 'flex-1')} placeholder='{ "id": 1 }' />
        {schema && (
          <div className="h-1/2 overflow-auto border-t border-border p-1 text-[12px]">
            {roots.map(({ op, type }) => (
              <div key={op}>
                <button type="button" onClick={() => setOpen(open === op ? null : op)} className="w-full px-1 py-0.5 text-left font-semibold">
                  {open === op ? '▾' : '▸'} {op} ({type.fields?.length ?? 0})
                </button>
                {open === op &&
                  type.fields?.map((f) => (
                    <button key={f.name} type="button" title={f.description ?? ''} onClick={() => insertField(op, f)} className="block w-full truncate rounded px-3 py-0.5 text-left font-mono text-[11.5px] hover:bg-surface-hover">
                      <span className="text-accent">{f.name}</span>
                      {f.args.length > 0 && <span className="text-muted-foreground">({f.args.map((a) => `${a.name}: ${typeName(a.type)}`).join(', ')})</span>}
                      <span className="text-muted-foreground">: {typeName(f.type)}</span>
                    </button>
                  ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function BodyEditor({
  body,
  onChange,
  known,
  buildIntrospection,
}: {
  body: PmBody | undefined;
  onChange: (b: PmBody) => void;
  known?: Set<string> | null;
  buildIntrospection: () => RequestSpec | null;
}) {
  const b: PmBody = body ?? { mode: 'none' };
  const mode = b.mode ?? 'none';
  const lang = (b.options?.raw?.language ?? 'text') as Lang;
  const setMode = (m: string) => {
    const next: PmBody = { ...b, mode: m };
    if (m === 'raw' && next.raw === undefined) next.raw = '';
    if (m === 'graphql' && !next.graphql) next.graphql = { query: '', variables: '' };
    onChange(next);
  };
  const beautify = () => {
    const raw = b.raw ?? '';
    onChange({ ...b, raw: lang === 'json' ? prettyJson(raw) : lang === 'xml' || lang === 'html' ? prettyXml(raw) : raw });
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border px-3 text-[12.5px]">
        {MODES.map((m) => (
          <label key={m.id} className="flex cursor-pointer items-center gap-1.5">
            <input type="radio" checked={mode === m.id} onChange={() => setMode(m.id)} className="accent-[var(--accent)]" />
            {m.label}
          </label>
        ))}
        {mode === 'raw' && (
          <>
            <Select
              value={lang}
              onChange={(v) => onChange({ ...b, options: { ...b.options, raw: { language: v } } })}
              options={RAW_LANGS}
              className="h-6 text-[12px] text-accent"
            />
            <div className="flex-1" />
            <IconButton label="Beautify" onClick={beautify}>
              <Wand2 className="size-3.5" />
            </IconButton>
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {mode === 'none' && <div className="p-6 text-center text-muted-foreground">This request does not have a body</div>}
        {mode === 'raw' && <CodeEditor value={b.raw ?? ''} onChange={(v) => onChange({ ...b, raw: v })} language={lang} variables={known} className="h-full" />}
        {mode === 'urlencoded' && <KeyValueTable rows={b.urlencoded ?? []} onChange={(rows) => onChange({ ...b, urlencoded: rows })} known={known} />}
        {mode === 'formdata' && <KeyValueTable rows={b.formdata ?? []} onChange={(rows) => onChange({ ...b, formdata: rows })} known={known} files />}
        {mode === 'file' && (
          <div className="flex items-center gap-3 p-4">
            <Button
              onClick={async () => {
                const p = await pickFiles({ title: 'Select a file to send' });
                if (p[0]) onChange({ ...b, file: { src: p[0] } });
              }}
            >
              <FileUp className="size-4" /> Select file
            </Button>
            <span className="font-mono text-[12px] text-muted-foreground">{b.file?.src || 'No file selected'}</span>
          </div>
        )}
        {mode === 'graphql' && <GraphQLEditor body={b} onChange={onChange} known={known} buildIntrospection={buildIntrospection} />}
      </div>
    </div>
  );
}
