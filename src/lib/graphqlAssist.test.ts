import { describe, expect, it } from 'vitest';

import { checkQuery, type GqlSchema, typeAt } from './graphqlAssist';

const named = (name: string) => ({ kind: 'OBJECT', name, ofType: null });
const scalar = (name: string) => ({ kind: 'SCALAR', name, ofType: null });
const list = (t: ReturnType<typeof named>) => ({ kind: 'LIST', name: null, ofType: t });

const schema: GqlSchema = {
  query: 'Query',
  mutation: 'Mutation',
  types: [
    { kind: 'OBJECT', name: 'Query', fields: [
      { name: 'products', args: [{ name: 'limit', type: scalar('Int') }], type: list(named('Product')) },
      { name: 'hello', args: [], type: scalar('String') },
    ] },
    { kind: 'OBJECT', name: 'Mutation', fields: [{ name: 'addProduct', args: [], type: named('Product') }] },
    { kind: 'OBJECT', name: 'Product', fields: [
      { name: 'id', args: [], type: scalar('Int') },
      { name: 'name', args: [], type: scalar('String') },
    ] },
    { kind: 'SCALAR', name: 'Int', fields: null },
    { kind: 'SCALAR', name: 'String', fields: null },
  ],
};

describe('graphql assist', () => {
  it('accepts a valid query with variables, aliases and arguments', () => {
    const q = 'query ($n: Int) {\n  items: products(limit: $n) { id name __typename }\n  hello(name: "x")\n}';
    expect(checkQuery(q, schema)).toEqual([]);
  });

  it('flags unknown fields, sub-selections on scalars and open braces', () => {
    const msgs = checkQuery('{ products { id price } hello { x }', schema).map((p) => p.message);
    expect(msgs).toContain('Field “price” does not exist on type Product.');
    expect(msgs.some((m) => m.includes('hello is a String'))).toBe(true);
    expect(msgs.some((m) => m.includes('never closed'))).toBe(true);
  });

  it('knows the type at the cursor', () => {
    const q = 'mutation { addProduct { ';
    const t = typeAt(q, q.length, schema);
    expect(t !== 'top' && t?.name).toBe('Product');
    expect(typeAt('', 0, schema)).toBe('top');
    const q2 = '{ products(limit: 2) { id } ';
    const t2 = typeAt(q2, q2.length, schema);
    expect(t2 !== 'top' && t2?.name).toBe('Query');
  });
});
