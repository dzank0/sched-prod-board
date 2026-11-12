// Serves dist/ as static assets. Adds byte-range support for /proof/*.mp4 so video players can seek;
// Workers static assets answer Range requests with the whole file (HTTP 200).
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/proof/') || !url.pathname.endsWith('.mp4')) return env.ASSETS.fetch(request);
    const plain = new Request(url, { method: 'GET' });
    const asset = await env.ASSETS.fetch(plain);
    if (!asset.ok) return asset;
    const body = new Uint8Array(await asset.arrayBuffer());
    const headers = new Headers({ 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' });
    const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
    if (!m || (m[1] === '' && m[2] === '')) {
      headers.set('content-length', String(body.length));
      return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers });
    }
    let start = m[1] === '' ? Math.max(0, body.length - Number(m[2])) : Number(m[1]);
    let end = m[1] !== '' && m[2] !== '' ? Math.min(Number(m[2]), body.length - 1) : body.length - 1;
    if (start >= body.length || start > end) {
      headers.set('content-range', `bytes */${body.length}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set('content-range', `bytes ${start}-${end}/${body.length}`);
    headers.set('content-length', String(end - start + 1));
    return new Response(request.method === 'HEAD' ? null : body.subarray(start, end + 1), { status: 206, headers });
  },
};
