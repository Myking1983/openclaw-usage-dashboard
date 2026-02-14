import { createReadStream, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = join(process.env.HOME, '.openclaw/agents/main/sessions');
const CONFIG_PATH = join(process.env.HOME, '.openclaw/openclaw.json');
const CACHE_PATH = join(__dirname, '..', 'data', 'cache.json');

// --- JSONL Parser ---

async function parseSessionFile(filePath, startByte = 0) {
  const records = [];
  const stat = statSync(filePath);
  if (stat.size <= startByte) return { records, bytesRead: stat.size };

  const stream = createReadStream(filePath, { start: startByte, encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type !== 'message') continue;
      const msg = entry.message;
      if (!msg || msg.role !== 'assistant' || !msg.usage) continue;
      if (msg.usage.totalTokens === 0 && (!msg.usage.cost || msg.usage.cost.total === 0)) continue;

      records.push({
        timestamp: entry.timestamp,
        provider: msg.provider || 'unknown',
        model: msg.model || 'unknown',
        input: msg.usage.input || 0,
        output: msg.usage.output || 0,
        cacheRead: msg.usage.cacheRead || 0,
        cacheWrite: msg.usage.cacheWrite || 0,
        totalTokens: msg.usage.totalTokens || 0,
        cost: msg.usage.cost?.total || 0,
        costInput: msg.usage.cost?.input || 0,
        costOutput: msg.usage.cost?.output || 0,
      });
    } catch { /* skip malformed lines */ }
  }

  return { records, bytesRead: stat.size };
}

// --- Scan all sessions with incremental caching ---

export async function scanAllSessions(cache = {}) {
  const fileOffsets = cache.fileOffsets || {};
  const allRecords = cache.records || [];
  let files;

  try {
    files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.jsonl'));
  } catch {
    return { records: allRecords, fileOffsets };
  }

  for (const file of files) {
    const filePath = join(SESSIONS_DIR, file);
    const stat = statSync(filePath);
    const prevSize = fileOffsets[file] || 0;

    if (stat.size <= prevSize) continue; // no new data

    const { records, bytesRead } = await parseSessionFile(filePath, prevSize);
    allRecords.push(...records);
    fileOffsets[file] = bytesRead;
  }

  return { records: allRecords, fileOffsets };
}

// --- Aggregation ---

function toDateStr(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toWeekStart(ts) {
  const d = new Date(ts);
  d.setDate(d.getDate() - d.getDay());
  return toDateStr(d.toISOString());
}

export function aggregateUsage(records) {
  const daily = {};
  const byModel = {};
  const byProvider = {};
  let totalCost = 0, totalTokens = 0, totalCalls = 0;
  let todayCost = 0, weekCost = 0, monthCost = 0;

  const now = new Date();
  const todayStr = toDateStr(now.toISOString());
  const weekStartStr = toWeekStart(now.toISOString());
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  for (const r of records) {
    const day = toDateStr(r.timestamp);

    // daily
    if (!daily[day]) daily[day] = { date: day, cost: 0, tokens: 0, calls: 0, input: 0, output: 0 };
    daily[day].cost += r.cost;
    daily[day].tokens += r.totalTokens;
    daily[day].calls += 1;
    daily[day].input += r.input;
    daily[day].output += r.output;

    // by model
    const modelKey = `${r.provider}/${r.model}`;
    if (!byModel[modelKey]) byModel[modelKey] = { model: r.model, provider: r.provider, key: modelKey, cost: 0, tokens: 0, calls: 0, input: 0, output: 0, cacheRead: 0 };
    byModel[modelKey].cost += r.cost;
    byModel[modelKey].tokens += r.totalTokens;
    byModel[modelKey].calls += 1;
    byModel[modelKey].input += r.input;
    byModel[modelKey].output += r.output;
    byModel[modelKey].cacheRead += r.cacheRead;

    // by provider
    if (!byProvider[r.provider]) byProvider[r.provider] = { provider: r.provider, cost: 0, tokens: 0, calls: 0 };
    byProvider[r.provider].cost += r.cost;
    byProvider[r.provider].tokens += r.totalTokens;
    byProvider[r.provider].calls += 1;

    // totals
    totalCost += r.cost;
    totalTokens += r.totalTokens;
    totalCalls += 1;

    if (day === todayStr) todayCost += r.cost;
    if (day >= weekStartStr) weekCost += r.cost;
    if (day.startsWith(monthStr)) monthCost += r.cost;
  }

  const dailyArr = Object.values(daily).sort((a, b) => a.date.localeCompare(b.date));
  const modelArr = Object.values(byModel).sort((a, b) => b.cost - a.cost);
  const providerArr = Object.values(byProvider).sort((a, b) => b.cost - a.cost);

  return {
    summary: { totalCost, totalTokens, totalCalls, todayCost, weekCost, monthCost },
    daily: dailyArr,
    models: modelArr,
    providers: providerArr,
  };
}

// --- Provider quotas via CLI ---

export async function getProviderQuotas() {
  try {
    const raw = execSync('openclaw status --usage --json 2>/dev/null', {
      timeout: 15000,
      encoding: 'utf8',
      env: { ...process.env, PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin' },
    });
    return JSON.parse(raw);
  } catch {
    // fallback: try without --json
    try {
      const raw = execSync('openclaw status --usage 2>/dev/null', {
        timeout: 15000,
        encoding: 'utf8',
        env: { ...process.env, PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin' },
      });
      return { raw, parsed: false };
    } catch {
      return { error: 'Could not fetch provider quotas', parsed: false };
    }
  }
}

// --- Model pricing from config ---

export function loadModelPricing() {
  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    const pricing = {};
    const providers = config.models?.providers || {};
    for (const [provName, prov] of Object.entries(providers)) {
      for (const m of (prov.models || [])) {
        pricing[`${provName}/${m.id}`] = {
          input: m.cost?.input || 0,
          output: m.cost?.output || 0,
          cacheRead: m.cost?.cacheRead || 0,
          cacheWrite: m.cost?.cacheWrite || 0,
        };
      }
    }
    return pricing;
  } catch {
    return {};
  }
}

// --- Savings tips generator ---

export function generateTips(aggregated, pricing) {
  const tips = [];
  const { models, summary } = aggregated;

  if (models.length === 0) return [{ text: '暂无用量数据', type: 'info' }];

  // Tip: Most expensive model
  const topModel = models[0];
  if (topModel && topModel.cost > 0) {
    const pct = ((topModel.cost / summary.totalCost) * 100).toFixed(1);
    tips.push({
      text: `${topModel.key} 占总花费 ${pct}%（$${topModel.cost.toFixed(4)}）`,
      type: 'info',
    });
  }

  // Tip: Free model utilization
  const freeModels = models.filter(m => {
    const p = pricing[m.key];
    return p && p.input === 0 && p.output === 0;
  });
  if (freeModels.length > 0) {
    const freeCalls = freeModels.reduce((s, m) => s + m.calls, 0);
    const totalCalls = summary.totalCalls;
    const pct = ((freeCalls / totalCalls) * 100).toFixed(1);
    tips.push({
      text: `免费模型使用率 ${pct}%（${freeCalls}/${totalCalls} 次调用）。简单任务可多用免费模型节省开支`,
      type: freeCalls / totalCalls < 0.3 ? 'warning' : 'success',
    });
  }

  // Tip: Cache utilization
  const totalInput = models.reduce((s, m) => s + m.input, 0);
  const totalCache = models.reduce((s, m) => s + m.cacheRead, 0);
  if (totalInput > 0) {
    const cacheRate = ((totalCache / (totalInput + totalCache)) * 100).toFixed(1);
    tips.push({
      text: `缓存命中率 ${cacheRate}%。保持同一会话连续对话可提高缓存命中`,
      type: parseFloat(cacheRate) > 30 ? 'success' : 'warning',
    });
  }

  // Tip: Cost comparison
  const paidModels = models.filter(m => m.cost > 0);
  if (paidModels.length >= 2) {
    const expensive = paidModels[0];
    const cheap = paidModels[paidModels.length - 1];
    if (expensive.calls > 0 && cheap.calls > 0) {
      const expAvg = expensive.cost / expensive.calls;
      const cheapAvg = cheap.cost / cheap.calls;
      if (expAvg > cheapAvg * 5) {
        const ratio = (expAvg / cheapAvg).toFixed(0);
        tips.push({
          text: `${expensive.key} 平均每次调用比 ${cheap.key} 贵 ${ratio}x。简单任务考虑用便宜模型`,
          type: 'warning',
        });
      }
    }
  }

  // Tip: Daily spend alert
  if (summary.todayCost > 1) {
    tips.push({
      text: `今日花费已达 $${summary.todayCost.toFixed(2)}，注意控制用量`,
      type: 'danger',
    });
  }

  return tips;
}

// --- Cache management ---

function loadCache() {
  try {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveCache(data) {
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(data), 'utf8');
}

// --- Main collect function ---

export async function collect() {
  const cache = loadCache();
  const { records, fileOffsets } = await scanAllSessions(cache);
  const aggregated = aggregateUsage(records);
  const pricing = loadModelPricing();
  const tips = generateTips(aggregated, pricing);

  let quotas = null;
  try {
    quotas = await getProviderQuotas();
  } catch { /* ignore */ }

  const result = {
    ...aggregated,
    pricing,
    tips,
    quotas,
    updatedAt: new Date().toISOString(),
  };

  saveCache({ fileOffsets, records, result });
  return result;
}

// --- Export cached result ---

export function getCachedResult() {
  const cache = loadCache();
  return cache.result || null;
}
