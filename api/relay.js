const { gotScraping } = require('got-scraping');

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

    const m = String(method).toLowerCase();
    const opts = {
      headers,
      body,
      proxyUrl,
      timeout: { request: timeout },
      followRedirect: true,
      throwHttpErrors: false,
      responseType: 'text',
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

    res.status(200).json({
      statusCode: response.statusCode,
      headers: response.headers,
      body: response.body,
      setCookies,
    });
  } catch (err) {
    res.status(502).json({
      error: 'RELAY_ERROR',
      message: err?.message || String(err),
    });
  }
};
