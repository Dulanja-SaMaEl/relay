const { gotScraping } = require('got-scraping');
const zlib = require('zlib');

function maybeDecompress(buf, encoding) {
  try {
    const enc = (encoding || '').toLowerCase();
    const isGzip = buf && buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
    if (enc === 'gzip' || isGzip) return zlib.gunzipSync(buf).toString('utf8');
    if (enc === 'deflate') return zlib.inflateSync(buf).toString('utf8');
    if (enc === 'br') return zlib.brotliDecompressSync(buf).toString('utf8');
  } catch (e) {}
  return buf ? buf.toString('utf8') : '';
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'GET') {
    res.status(200).json({ ok: true, service: 'nexus-vercel-relay' });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    return;
  }

  try {
    const { url, method = 'GET', headers = {}, body, timeout = 25000, proxyUrl } = req.body || {};
    if (!url) {
      res.status(400).json({ error: 'Missing url' });
      return;
    }

    const cleanedHeaders = { ...headers };
    delete cleanedHeaders['host'];
    delete cleanedHeaders['content-length'];

    const m = String(method).toLowerCase();
    // got-scraping spoofs a real browser TLS/JA3 fingerprint, which is required
    // to pass Garena's DataDome bot protection. responseType: 'buffer' +
    // decompress: false ensure we receive raw (possibly gzipped) bytes that
    // we decompress ourselves — never auto-decoded to UTF-8 which corrupts
    // high bytes (0x80+) like the gzip magic 0x1f 0x8b.
    const opts = {
      headers: cleanedHeaders,
      body,
      proxyUrl,
      timeout: { request: timeout },
      followRedirect: true,
      throwHttpErrors: false,
      responseType: 'buffer',
      decompress: false,
    };

    const response =
      m === 'get'
        ? await gotScraping.get(url, opts)
        : m === 'post'
        ? await gotScraping.post(url, opts)
        : m === 'put'
        ? await gotScraping.put(url, opts)
        : await gotScraping.delete(url, opts);

    const rawSetCookie = response.headers['set-cookie'];
    const setCookies = Array.isArray(rawSetCookie)
      ? rawSetCookie
      : rawSetCookie
      ? [rawSetCookie]
      : [];

    const contentEncoding = response.headers['content-encoding'];
    const encodingStr = Array.isArray(contentEncoding) ? contentEncoding[0] : contentEncoding;
    const respBody = response.body;
    const bodyBuffer = Buffer.isBuffer(respBody)
      ? respBody
      : response.rawBody || Buffer.from(String(respBody), 'binary');
    const bodyStr = maybeDecompress(bodyBuffer, encodingStr);

    res.status(200).json({
      statusCode: response.statusCode,
      headers: response.headers,
      body: bodyStr,
      setCookies,
    });
  } catch (err) {
    res.status(502).json({
      error: 'RELAY_ERROR',
      message: err?.message || String(err),
    });
  }
};
