// Lightweight GraphQL help driven by an introspected schema (no graphql-js dependency):
// - which type the cursor is in (for field completion),
// - unknown fields, sub-selections on scalars and unbalanced braces (for inline errors).
// It understands operations, aliases, arguments, fragments and inline fragments; it does not try
// to be a full validator.

export interface TypeRef {
  kind: string;
  name: string | null;
  ofType: TypeRef | null;
}
export interface GqlField {
  name: string;
  description?: string | null;
  args: { name: string; type: TypeRef }[];
  type: TypeRef;
}
export interface GqlType {
  kind: string;
  name: string;
  description?: string | null;
  fields: GqlField[] | null;
}
export interface GqlSchema {
  types: GqlType[];
  query?: string;
  mutation?: string;
  subscription?: string;
}

export const typeName = (t: TypeRef | null): string =>
  !t ? '' : t.kind === 'NON_NULL' ? `${typeName(t.ofType)}!` : t.kind === 'LIST' ? `[${typeName(t.ofType)}]` : (t.name ?? '');

export const leafName = (t: TypeRef | null): string => (t?.ofType ? leafName(t.ofType) : (t?.name ?? ''));

export interface GqlProblem {
  from: number;
  to: number;
  message: string;
}

interface Token {
  kind: 'name' | 'punct' | 'spread';
  text: string;
  from: number;
  to: number;
}

/** Names, punctuation and `...`; strings, comments and numbers are skipped. */
function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '"') {
      if (src.startsWith('"""', i)) {
        const end = src.indexOf('"""', i + 3);
        i = end < 0 ? src.length : end + 3;
      } else {
        i++;
        while (i < src.length && src[i] !== '"' && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1;
        i++;
      }
    } else if (src.startsWith('...', i)) {
      out.push({ kind: 'spread', text: '...', from: i, to: i + 3 });
      i += 3;
    } else if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < src.length && /\w/.test(src[i]!)) i++;
      out.push({ kind: 'name', text: src.slice(start, i), from: start, to: i });
    } else if ('{}():$@!=[],'.includes(c)) {
      out.push({ kind: 'punct', text: c, from: i, to: i + 1 });
      i++;
    } else i++;
  }
  return out;
}

const OPS = new Set(['query', 'mutation', 'subscription']);

/** Walk the document; `onField` sees each selected field with its parent type. */
function walk(
  src: string,
  schema: GqlSchema,
  onField?: (name: Token, parent: GqlType | null) => void,
  stopAt?: number,
): { stack: (GqlType | null)[]; problems: GqlProblem[] } {
  const byName = new Map(schema.types.map((t) => [t.name, t]));
  const problems: GqlProblem[] = [];
  const stack: (GqlType | null)[] = [];
  const opens: Token[] = [];
  let pending: GqlType | null | undefined; // type the next `{` opens
  let lastField: GqlField | null = null;
  let paren = 0;
  const toks = tokenize(src);
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i]!;
    if (stopAt !== undefined && tk.from >= stopAt) break;
    if (tk.text === '(' && tk.kind === 'punct') {
      paren++;
      continue;
    }
    if (tk.text === ')' && tk.kind === 'punct') {
      paren = Math.max(0, paren - 1);
      continue;
    }
    if (paren > 0) continue; // arguments / variable definitions
    const top = stack.length ? stack[stack.length - 1]! : undefined;
    if (tk.kind === 'name') {
      if (!stack.length) {
        // Top level: operation or fragment definition.
        if (OPS.has(tk.text)) pending = byName.get(schema[tk.text as 'query' | 'mutation' | 'subscription'] ?? '') ?? null;
        else if (tk.text === 'fragment') {
          const on = toks[i + 2];
          const tn = toks[i + 3];
          if (on?.text === 'on' && tn) {
            pending = byName.get(tn.text) ?? null;
            i += 3;
          }
        }
        continue;
      }
      if (toks[i - 1]?.kind === 'spread') continue; // ...FragmentName
      if (tk.text === 'on' && toks[i - 1]?.kind === 'spread') continue;
      if (toks[i + 1]?.text === ':') continue; // alias
      if (toks[i - 1]?.text === '@' || toks[i - 1]?.text === '$') continue; // directive / variable
      onField?.(tk, top ?? null);
      lastField = top?.fields?.find((f) => f.name === tk.text) ?? null;
      if (top?.fields && !lastField && tk.text !== '__typename') {
        problems.push({ from: tk.from, to: tk.to, message: `Field “${tk.text}” does not exist on type ${top.name}.` });
      }
      continue;
    }
    if (tk.kind === 'spread') {
      // Inline fragment: `... on Type {`
      if (toks[i + 1]?.text === 'on' && toks[i + 2]) {
        pending = byName.get(toks[i + 2]!.text) ?? null;
        i += 2;
      }
      continue;
    }
    if (tk.text === '{') {
      let next: GqlType | null;
      if (pending !== undefined) next = pending;
      else if (!stack.length) next = schema.query ? (byName.get(schema.query) ?? null) : null;
      else if (lastField) {
        const t = byName.get(leafName(lastField.type)) ?? null;
        if (t && !t.fields) problems.push({ from: tk.from, to: tk.to, message: `${lastField.name} is a ${typeName(lastField.type)} and has no sub-fields.` });
        next = t?.fields ? t : null;
      } else next = null;
      stack.push(next);
      opens.push(tk);
      pending = undefined;
      lastField = null;
    } else if (tk.text === '}') {
      if (!stack.length) problems.push({ from: tk.from, to: tk.to, message: 'Unexpected “}”.' });
      stack.pop();
      opens.pop();
      lastField = null;
    }
  }
  if (stopAt === undefined) for (const o of opens) problems.push({ from: o.from, to: o.to, message: 'This “{” is never closed.' });
  return { stack, problems };
}

/** Errors to underline in the query editor. */
export function checkQuery(src: string, schema: GqlSchema): GqlProblem[] {
  return walk(src, schema).problems;
}

/** Type whose fields can be typed at `pos` (null at the top level or inside a scalar). */
export function typeAt(src: string, pos: number, schema: GqlSchema): GqlType | null | 'top' {
  const { stack } = walk(src, schema, undefined, pos);
  if (!stack.length) return 'top';
  return stack[stack.length - 1] ?? null;
}
