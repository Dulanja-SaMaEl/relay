import http from 'http';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFile);
const PORT = 4040;

const BROWSER_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const BROWSER_CH_UA = '"Not-A.Brand";v="99", "Google Chrome";v="157", "Chromium";v="157"';

const CURL_BIN = process.platform === 'win32' ? 'curl.exe' : 'curl';

async function runCurlRequest({ url, method = 'GET', headers = {}, body, timeout = 25000, proxyUrl }) {
  const tmpId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const headerFile = path.join(os.tmpdir(), `curl_hdr_${tmpId}.txt`);
  const bodyFile = path.join(os.tmpdir(), `curl_body_${tmpId}.json`);

  try {
    const args = [
      '-s',
      '-S',
      '-D', headerFile,
      '-X', method.toUpperCase(),
      '--max-time', String(Math.ceil(timeout / 1000)),
      url,
      '-H', 'Accept: application/json, text/plain, */*',
      '-H', 'Accept-Language: en-US,en;q=0.9,id;q=0.8',
      '-H', 'Cache-Control: no-cache',
      '-H', 'Pragma: no-cache',
      '-H', 'DNT: 1',
      '-H', `Referer: ${headers['Referer'] || headers['referer'] || 'https://shop.garena.my/'}`,
      '-H', 'Sec-Fetch-Dest: empty',
      '-H', 'Sec-Fetch-Mode: cors',
      '-H', 'Sec-Fetch-Site: same-origin',
      '-H', `User-Agent: ${BROWSER_UA}`,
      '-H', `sec-ch-ua: ${BROWSER_CH_UA}`,
      '-H', 'sec-ch-ua-mobile: ?1',
      '-H', 'sec-ch-ua-platform: "iOS"',
    ];

    // Forward the request through the configured residential/rotating proxy
    if (proxyUrl) {
      args.push('--proxy', proxyUrl);
    }

    const cookieVal = headers['Cookie'] || headers['cookie'];
    if (cookieVal) {
      args.push('-b', cookieVal);
    }

    const csrfVal = headers['x-csrf-token'] || headers['X-Csrf-Token'];
    if (csrfVal) {
      args.push('-H', `x-csrf-token: ${csrfVal}`);
    }

    if (headers['Origin'] || headers['origin']) {
      args.push('-H', `Origin: ${headers['Origin'] || headers['origin']}`);
    }

    if (body !== undefined && body !== null && method.toUpperCase() !== 'GET') {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      fs.writeFileSync(bodyFile, bodyStr, 'utf8');
      args.push('-H', 'Content-Type: application/json');
      args.push('--data-binary', `@${bodyFile}`);
    }

    const { stdout } = await execFileAsync(CURL_BIN, args, { maxBuffer: 10 * 1024 * 1024 });
    const rawHeaders = fs.existsSync(headerFile) ? fs.readFileSync(headerFile, 'utf8') : '';

    const lines = rawHeaders.split(/\r?\n/);
    let statusCode = 200;
    const setCookies = [];
    const respHeaders = {};

    for (const line of lines) {
      if (line.startsWith('HTTP/')) {
        const parts = line.split(/\s+/);
        if (parts[1]) statusCode = parseInt(parts[1], 10);
      } else {
        const idx = line.indexOf(':');
        if (idx > 0) {
          const k = line.slice(0, idx).trim().toLowerCase();
          const v = line.slice(idx + 1).trim();
          if (k === 'set-cookie') {
            setCookies.push(v);
          } else {
            respHeaders[k] = v;
          }
        }
      }
    }

    return {
      statusCode,
      headers: respHeaders,
      body: stdout,
      setCookies,
    };
  } finally {
    try { if (fs.existsSync(headerFile)) fs.unlinkSync(headerFile); } catch {}
    try { if (fs.existsSync(bodyFile)) fs.unlinkSync(bodyFile); } catch {}
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, service: 'nexus-https-curl-relay', port: PORT }));
  }

  let rawBody = '';
  req.on('data', (chunk) => {
    rawBody += chunk;
  });

  req.on('end', async () => {
    try {
      const payload = JSON.parse(rawBody || '{}');
      const { url, method = 'GET', headers = {}, body, timeout = 25000, proxyUrl } = payload;
      if (!url) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Missing url' }));
      }

      const result = await runCurlRequest({ url, method, headers, body, timeout });
      console.log(`[CURL-RELAY] ${method} ${url} -> ${result.statusCode} | body: ${result.body.slice(0, 140)}`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    } catch (err) {
      console.error('[RELAY ERROR]', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      return res.end(
        JSON.stringify({
          error: 'RELAY_ERROR',
          message: err?.message || String(err),
        })
      );
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Nexus HTTPS cURL Relay listening on http://127.0.0.1:${PORT}`);
});
