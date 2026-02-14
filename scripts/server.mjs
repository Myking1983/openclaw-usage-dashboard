import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect, getCachedResult } from './collector.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.DASHBOARD_PORT || '18790', 10);
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

let latestData = null;

async function refresh() {
  try {
    latestData = await collect();
    console.log(`[${new Date().toISOString()}] Data refreshed: ${latestData.summary?.totalCalls || 0} calls, $${(latestData.summary?.totalCost || 0).toFixed(4)}`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Refresh error:`, err.message);
  }
}

function getData() {
  return latestData || getCachedResult() || { summary: {}, daily: [], models: [], providers: [], tips: [], quotas: null };
}

function json(res, data) {
  const body = JSON.stringify(data);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

function parseQuery(url) {
  const u = new URL(url, 'http://localhost');
  const params = {};
  for (const [k, v] of u.searchParams) params[k] = v;
  return params;
}

function serveDashboard(res) {
  try {
    const html = readFileSync(join(__dirname, 'dashboard.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Dashboard file not found: ' + err.message);
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': '*' });
    res.end();
    return;
  }

  if (path === '/' || path === '/index.html') return serveDashboard(res);

  const data = getData();

  if (path === '/api/summary') return json(res, { summary: data.summary, updatedAt: data.updatedAt });

  if (path === '/api/daily') {
    const q = parseQuery(req.url);
    const days = parseInt(q.days || '30', 10);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const filtered = (data.daily || []).filter(d => d.date >= cutoffStr);
    return json(res, { daily: filtered, days });
  }

  if (path === '/api/models') return json(res, { models: data.models || [] });

  if (path === '/api/quotas') return json(res, { quotas: data.quotas, providers: data.providers || [] });

  if (path === '/api/tips') return json(res, { tips: data.tips || [] });

  if (path === '/api/all') return json(res, data);

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

// Startup: listen first, then collect in background
console.log(`[usage-dashboard] Starting on port ${PORT}...`);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[usage-dashboard] Listening on http://127.0.0.1:${PORT}`);
  // Collect data in background after server is up
  refresh().then(() => setInterval(refresh, REFRESH_INTERVAL));
});
