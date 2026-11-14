const http = require('http');
const https = require('https');
const { URL } = require('url');

function parseProxy(proxyUrl) {
  if (!proxyUrl) return null;
  const u = new URL(proxyUrl);
  return {
    host: u.hostname,
    port: parseInt(u.port || (u.protocol === 'https:' ? '443' : '80'), 10),
    auth: u.username ? `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}` : '',
    protocol: u.protocol,
  };
}

function tunnelThroughProxy(proxy, targetUrl, cb) {
  const target = new URL(targetUrl);
  const targetPort = target.port || (target.protocol === 'https:' ? 443 : 80);

  const connectReq = http.request({
    host: proxy.host,
    port: proxy.port,
    method: 'CONNECT',
    path: `${target.hostname}:${targetPort}`,
    headers: proxy.auth ? { 'Proxy-Authorization': 'Basic ' + Buffer.from(proxy.auth).toString('base64') } : {},
  });

  connectReq.on('connect', (res, socket) => {
    if (res.statusCode !== 200) {
      cb(new Error(`Proxy CONNECT failed: ${res.statusCode}`));
      socket.destroy();
      return;
    }
    cb(null, socket);
  });

  connectReq.on('error', (err) => cb(err));
  connectReq.end();
}

function makeRequest(targetUrl, options, cb) {
  const target = new URL(targetUrl);
  const isHttps = target.protocol === 'https:';
  const lib = isHttps ? https : http;
  const port = target.port || (isHttps ? 443 : 80);

  const reqOpts = {
    hostname: target.hostname,
    port,
    path: target.pathname + target.search,
    method: options.method,
    headers: options.headers,
    timeout: options.timeout,
  };

  if (options.socket) {
    reqOpts.socket = options.socket;
    reqOpts.agent = false;
  }

  const req = lib.request(reqOpts, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const setCookies = [];
      const respHeaders = {};
      for (const [k, v] of Object.entries(res.headers)) {
        if (k.toLowerCase() === 'set-cookie') {
          if (Array.isArray(v)) setCookies.push(...v);
          else setCookies.push(v);
        } else {
          respHeaders[k] = v;
        }
      }
      cb(null, { statusCode: res.statusCode, headers: respHeaders, body, setCookies });
    });
  });

  req.on('error', (err) => cb(err));
  req.on('timeout', () => { req.destroy(new Error('Request timeout')); });

  if (options.body) req.write(options.body);
  req.end();
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

    const proxy = parseProxy(proxyUrl);

    const execute = (socket) =>
      new Promise((resolve, reject) => {
        makeRequest(
          url,
          { method, headers: cleanedHeaders, body, timeout, socket },
          (err, result) => (err ? reject(err) : resolve(result))
        );
      });

    let result;
    if (proxy) {
      const socket = await new Promise((resolve, reject) => {
        tunnelThroughProxy(proxy, url, (err, sock) => (err ? reject(err) : resolve(sock)));
      });
      result = await execute(socket);
    } else {
      result = await execute(null);
    }

    res.status(200).json(result);
  } catch (err) {
    res.status(502).json({ error: 'RELAY_ERROR', message: err?.message || String(err) });
  }
};
