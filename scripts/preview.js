'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const web = path.join(root, 'plugins/org.example.dbeaver.echarts/web');
const port = Number(process.env.ECHARTS_PREVIEW_PORT || 8765);
const clients = new Set();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/__preview/events') {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    response.write(': connected\n\n');
    clients.add(response);
    request.on('close', () => clients.delete(response));
    return;
  }
  const file = url.pathname === '/__preview/bridge.js'
    ? path.join(root, 'dev/preview-bridge.js')
    : path.resolve(web, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (file !== path.join(root, 'dev/preview-bridge.js') && !file.startsWith(web + path.sep)) {
    response.writeHead(403).end();
    return;
  }
  fs.readFile(file, (error, bytes) => {
    if (error) { response.writeHead(404).end('Not found'); return; }
    let body = bytes;
    if (file === path.join(web, 'index.html')) {
      body = bytes.toString('utf8').replace('<script src="js/chart.js">', '<script src="/__preview/bridge.js"></script>\n  <script src="js/chart.js">');
    }
    response.writeHead(200, { 'Content-Type': (types[path.extname(file)] || 'application/octet-stream') + (['.html', '.js', '.css', '.json'].includes(path.extname(file)) ? '; charset=utf-8' : ''), 'Cache-Control': 'no-store' });
    response.end(body);
  });
});
let changeTimer;
const notify = () => {
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => { for (const client of clients) client.write('data: reload\n\n'); }, 150);
};
const watchers = [web, path.join(web, 'js'), path.join(web, 'css'), path.join(root, 'dev')].map(directory => fs.watch(directory, notify));
const heartbeat = setInterval(() => { for (const client of clients) client.write(': keepalive\n\n'); }, 15000);
server.on('error', error => { console.error(error.message); process.exitCode = 1; shutdown(); });
function shutdown() {
  clearInterval(heartbeat);
  clearTimeout(changeTimer);
  for (const watcher of watchers) watcher.close();
  for (const client of clients) client.end();
  server.close();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
server.listen(port, '127.0.0.1', () => console.log(`ECharts preview: http://127.0.0.1:${port}\nSample data only. Save web files to reload the page. Ctrl+C stops the server.`));
