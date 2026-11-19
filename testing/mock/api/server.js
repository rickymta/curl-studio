// CurlStudio test API: REST CRUD + token auth, GraphQL, WebSocket echo, SSE, misc edge cases.
// Run inside node:22-alpine (see ../docker-compose.yml); deps: ws, graphql.
const http = require('node:http');
const { URL } = require('node:url');
const { WebSocketServer } = require('ws');
const { graphql, buildSchema } = require('graphql');

const PORT = Number(process.env.PORT || 18090);
const USERS = { demo: { id: 1, username: 'demo', password: 'demo123', name: 'Demo User', role: 'admin' } };
const tokens = new Map();
let nextId = 4;
let products = [
  { id: 1, name: 'Keyboard', price: 49.9, stock: 12, tags: ['peripheral'] },
  { id: 2, name: 'Mouse', price: 19.5, stock: 40, tags: ['peripheral'] },
  { id: 3, name: 'Monitor 27"', price: 229, stock: 5, tags: ['display'] },
];

function send(res, status, body, headers = {}) {
  const isStr = typeof body === 'string';
  const data = body === undefined ? '' : isStr ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': '*',
    'x-mock': 'curlstudio',
    ...headers,
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function json(buf) {
  try {
    return buf.length ? JSON.parse(buf.toString('utf8')) : {};
  } catch {
    return undefined;
  }
}

function authUser(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? tokens.get(m[1]) : undefined;
}

const schema = buildSchema(`
  type Product { id: Int!, name: String!, price: Float!, stock: Int!, tags: [String!]! }
  type Query { products(limit: Int): [Product!]!, product(id: Int!): Product, hello(name: String): String! }
  type Mutation { addProduct(name: String!, price: Float!): Product! }
`);
const root = {
  products: ({ limit }) => (limit ? products.slice(0, limit) : products),
  product: ({ id }) => products.find((p) => p.id === id) ?? null,
  hello: ({ name }) => `Hello, ${name ?? 'world'}!`,
  addProduct: ({ name, price }) => {
    const p = { id: nextId++, name, price, stock: 0, tags: [] };
    products.push(p);
    return p;
  },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method.toUpperCase();
  const body = await readBody(req);

  if (method === 'OPTIONS') return send(res, 204, undefined, { allow: 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS' });
  if (path === '/' || path === '/health') return send(res, 200, { ok: true, service: 'curlstudio-mock', time: new Date().toISOString() });

  // --- auth
  if (path === '/auth/login' && method === 'POST') {
    const b = json(body);
    if (!b) return send(res, 400, { error: 'invalid JSON' });
    const u = USERS[b.username];
    if (!u || u.password !== b.password) return send(res, 401, { error: 'invalid credentials' });
    const token = `tok_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    tokens.set(token, u);
    return send(res, 200, { token, expiresIn: 3600, user: { id: u.id, name: u.name } }, { 'set-cookie': `session=${token}; Path=/; HttpOnly` });
  }
  if (path === '/me') {
    const u = authUser(req);
    if (!u) return send(res, 401, { error: 'missing or invalid bearer token' }, { 'www-authenticate': 'Bearer' });
    return send(res, 200, { id: u.id, username: u.username, name: u.name, role: u.role });
  }
  if (path === '/apikey') {
    const k = req.headers['x-api-key'] || url.searchParams.get('api_key');
    return k === 'secret-key' ? send(res, 200, { ok: true }) : send(res, 403, { error: 'bad api key' });
  }

  // --- products CRUD
  const pm = /^\/products(?:\/(\d+))?$/.exec(path);
  if (pm) {
    const id = pm[1] ? Number(pm[1]) : null;
    if (id === null) {
      if (method === 'GET' || method === 'HEAD') {
        const q = (url.searchParams.get('q') || '').toLowerCase();
        const limit = Number(url.searchParams.get('limit') || 0);
        let list = products.filter((p) => !q || p.name.toLowerCase().includes(q));
        if (limit) list = list.slice(0, limit);
        return send(res, 200, { total: list.length, items: list }, { 'x-total-count': String(list.length) });
      }
      if (method === 'POST') {
        if (!authUser(req)) return send(res, 401, { error: 'login required' });
        const b = json(body);
        if (!b) return send(res, 400, { error: 'invalid JSON' });
        const errors = [];
        if (!b.name || typeof b.name !== 'string') errors.push({ field: 'name', message: 'required' });
        if (typeof b.price !== 'number' || b.price < 0) errors.push({ field: 'price', message: 'must be a non-negative number' });
        if (errors.length) return send(res, 422, { errors });
        const p = { id: nextId++, name: b.name, price: b.price, stock: b.stock ?? 0, tags: b.tags ?? [] };
        products.push(p);
        return send(res, 201, p, { location: `/products/${p.id}` });
      }
      return send(res, 405, { error: 'method not allowed' });
    }
    const p = products.find((x) => x.id === id);
    if (!p) return send(res, 404, { error: `product ${id} not found` });
    if (method === 'GET' || method === 'HEAD') return send(res, 200, p, { etag: `"p${p.id}-${p.stock}"` });
    if (!authUser(req)) return send(res, 401, { error: 'login required' });
    if (method === 'PUT' || method === 'PATCH') {
      const b = json(body);
      if (!b) return send(res, 400, { error: 'invalid JSON' });
      Object.assign(p, method === 'PUT' ? { name: b.name ?? '', price: b.price ?? 0, stock: b.stock ?? 0, tags: b.tags ?? [] } : b, { id: p.id });
      return send(res, 200, p);
    }
    if (method === 'DELETE') {
      products = products.filter((x) => x.id !== id);
      return send(res, 204);
    }
    return send(res, 405, { error: 'method not allowed' });
  }

  // --- GraphQL
  if (path === '/graphql' && method === 'POST') {
    const b = json(body) || {};
    const r = await graphql({ schema, source: b.query || '', rootValue: root, variableValues: b.variables, operationName: b.operationName });
    return send(res, 200, r);
  }

  // --- echo + edge cases
  if (path === '/echo') {
    return send(res, 200, {
      method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: req.headers,
      bodyLength: body.length,
      body: body.toString('utf8').slice(0, 20000),
      json: json(body) ?? null,
    });
  }
  if (path === '/slow') {
    const ms = Math.min(30000, Number(url.searchParams.get('ms') || 1000));
    await new Promise((r) => setTimeout(r, ms));
    return send(res, 200, { waitedMs: ms });
  }
  const sm = /^\/status\/(\d{3})$/.exec(path);
  if (sm) return send(res, Number(sm[1]), { status: Number(sm[1]) });
  if (path === '/flaky') {
    const rate = Number(url.searchParams.get('rate') || 0.1);
    return Math.random() < rate ? send(res, 500, { error: 'random failure' }) : send(res, 200, { ok: true });
  }
  if (path === '/latency') {
    // Log-normal-ish latency for load-test charts.
    const base = Number(url.searchParams.get('base') || 40);
    const ms = Math.round(base * Math.exp(Math.random() * 1.2));
    await new Promise((r) => setTimeout(r, ms));
    return send(res, 200, { ms });
  }
  if (path === '/html') return send(res, 200, '<!doctype html><html><body><h1>Hello CurlStudio</h1><p>HTML preview test.</p></body></html>', { 'content-type': 'text/html; charset=utf-8' });
  if (path === '/xml') return send(res, 200, '<?xml version="1.0"?><catalog><item id="1">Keyboard</item><item id="2">Mouse</item></catalog>', { 'content-type': 'application/xml' });
  if (path === '/big') {
    const n = Math.min(200000, Number(url.searchParams.get('n') || 5000));
    return send(res, 200, Array.from({ length: n }, (_, i) => ({ i, name: `row ${i}`, value: Math.random() })));
  }
  if (path === '/redirect') return send(res, 302, '', { location: '/echo?redirected=1' });
  if (path === '/unicode') return send(res, 200, { vi: 'Xin chào thế giới — Tiếng Việt có dấu', emoji: '🚀✅', jp: 'こんにちは' });

  // --- SSE
  if (path === '/sse') {
    const count = Number(url.searchParams.get('count') || 5);
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    let i = 0;
    const t = setInterval(() => {
      i++;
      res.write(`id: ${i}\nevent: tick\ndata: ${JSON.stringify({ i, at: Date.now() })}\n\n`);
      if (i >= count) {
        clearInterval(t);
        res.end();
      }
    }, 500);
    req.on('close', () => clearInterval(t));
    return;
  }

  send(res, 404, { error: `no route ${method} ${path}` });
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  ws.send(JSON.stringify({ type: 'welcome', protocol: ws.protocol || null, ua: req.headers['user-agent'] || null }));
  ws.on('message', (data, isBinary) => {
    if (isBinary) return ws.send(data, { binary: true });
    const text = data.toString();
    ws.send(text === 'ping' ? 'pong' : `echo: ${text}`);
  });
});

server.listen(PORT, () => console.log(`mock api on :${PORT}`));
