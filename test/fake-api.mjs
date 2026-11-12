// A stand-in for the course incident API, from README "The incident API". Records every call.
import { createServer } from 'node:http';

export async function startFakeApi({ initial = 3, addEveryMs = 1500, firstDelayMs = 600, empty = false } = {}) {
  const t0 = Date.now();
  let seq = 0, cursorN = 0, inFlight = 0;
  const calls = [], acks = [];
  const fixed = { id: 'INC-6567', service: 'sessions', region: 'ap-southeast', summary: 'fixed time row', severity: 'sev3', openedAt: '2026-11-11T03:11:00.000Z' };
  const made = [];
  const add = () => { seq++; made.unshift({ id: `INC-${1000 + seq}`, service: 'booking-api', region: 'eu-west', summary: seq === 2 ? '<img src=x onerror="window.__xss=1">' : `incident ${seq}`, severity: seq % 3 === 0 ? 'sev1' : 'sev2', openedAt: new Date().toISOString() }); };
  if (!empty) for (let i = 0; i < initial; i++) add();
  const timer = empty ? null : setInterval(add, addEveryMs);
  const server = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*' };
    inFlight++;
    const call = { path: u.pathname, since: u.searchParams.get('since'), at: Date.now() - t0, maxInFlight: inFlight };
    calls.push(call);
    if (u.pathname.endsWith('/incidents')) {
      if (calls.filter((c) => c.path.endsWith('/incidents')).length === 1) await new Promise((r) => setTimeout(r, firstDelayMs));
      const cursor = `c${++cursorN}`;
      res.writeHead(200, headers).end(JSON.stringify({ updatedAt: new Date().toISOString(), incidents: empty ? [] : [...made, fixed], cursor }));
    } else if (u.pathname.endsWith('/ack')) {
      const a = { id: u.searchParams.get('id'), cursor: u.searchParams.get('cursor'), latest: `c${cursorN}` };
      acks.push(a);
      res.writeHead(200, headers).end(JSON.stringify({ id: a.id, ackedAt: new Date().toISOString(), receipt: `rcpt-${a.id}` }));
    } else res.writeHead(404, headers).end('{}');
    inFlight--;
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}/api`, calls, acks, close: () => { clearInterval(timer); server.closeAllConnections(); server.close(); } };
}
