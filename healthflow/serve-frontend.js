#!/usr/bin/env node
/*
 * Zero-dependency static file server for the HealthFlow frontend.
 *
 *   node serve-frontend.js            -> http://localhost:5500
 *   PORT=6000 node serve-frontend.js  -> http://localhost:6000
 *
 * Serves the ./frontend folder with correct MIME types (required for ES modules).
 * Hash routing means only index.html is ever requested by the app shell.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'frontend');
const PORT = Number(process.env.PORT) || 5500;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

function send(res, status, headers, body) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, { 'Content-Type': 'text/plain' }, 'Bad request');
  }

  const target = path.join(ROOT, pathname);
  if (!target.startsWith(ROOT)) {
    return send(res, 403, { 'Content-Type': 'text/plain' }, 'Forbidden');
  }

  const file = fs.existsSync(target) && fs.statSync(target).isDirectory()
    ? path.join(target, 'index.html')
    : target;

  fs.readFile(file, (err, data) => {
    if (err) {
      // Unknown path: fall back to the app shell (hash routing takes over).
      return fs.readFile(path.join(ROOT, 'index.html'), (e2, shell) => {
        if (e2) return send(res, 404, { 'Content-Type': 'text/plain' }, 'Not found');
        send(res, 200, { 'Content-Type': TYPES['.html'] }, shell);
      });
    }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    send(res, 200, { 'Content-Type': type }, data);
  });
});

server.listen(PORT, () => {
  console.log(`HealthFlow frontend on http://localhost:${PORT}`);
});
