const DEFAULT_SETTINGS = {
  enabled: true,
  mode: "hide",
  cacheTtlDays: 30,
  maxConcurrentChecks: 8
};

const CACHE_PREFIX = "nai:v2:";
const inFlight = new Map();
const hotCache = new Map();
let activeRequests = 0;
const queue = [];

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({
    settings: { ...DEFAULT_SETTINGS, ...(current.settings || {}) }
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CHECK_VIDEOS" && Array.isArray(message.videoIds)) {
    checkVideos(message.videoIds)
      .then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "CHECK_VIDEO" && message.videoId) {
    checkVideos([message.videoId])
      .then(result => sendResponse(result.ok ? { ok: true, ...(result.results[message.videoId] || {}) } : result))
      .catch(error => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "CLEAR_CACHE") {
    clearCache()
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "CACHE_STATS") {
    getCacheStats()
      .then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
});

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

async function checkVideos(videoIds) {
  const ids = [...new Set(videoIds)]
    .filter(id => /^[A-Za-z0-9_-]{6,20}$/.test(id))
    .slice(0, 50);

  if (!ids.length) return { ok: true, results: {} };

  const settings = await getSettings();
  const ttlMs = settings.cacheTtlDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const results = {};
  const unresolved = [];

  for (const id of ids) {
    const cached = hotCache.get(id);
    if (cached && now - cached.checkedAt < ttlMs) {
      results[id] = { ...cached, source: "memory" };
    } else {
      unresolved.push(id);
    }
  }

  if (unresolved.length) {
    const keys = unresolved.map(id => CACHE_PREFIX + id);
    const stored = await chrome.storage.local.get(keys);
    const needsNetwork = [];

    for (const id of unresolved) {
      const value = stored[CACHE_PREFIX + id];
      if (value && now - value.checkedAt < ttlMs) {
        hotCache.set(id, value);
        results[id] = { ...value, source: "cache" };
      } else {
        needsNetwork.push(id);
      }
    }

    const networkResults = await Promise.all(needsNetwork.map(id => checkNetwork(id, settings.maxConcurrentChecks)));
    for (let i = 0; i < needsNetwork.length; i++) {
      results[needsNetwork[i]] = networkResults[i];
    }
  }

  return { ok: true, results };
}

function checkNetwork(videoId, maxConcurrentChecks) {
  if (inFlight.has(videoId)) return inFlight.get(videoId);

  const promise = enqueue(async () => {
    try {
      const result = await fetchAndDetect(videoId);
      const value = {
        ai: result.ai,
        reason: result.reason,
        checkedAt: Date.now()
      };
      hotCache.set(videoId, value);
      await chrome.storage.local.set({ [CACHE_PREFIX + videoId]: value });
      return { ...value, source: "network" };
    } catch (error) {
      return { ai: false, reason: String(error), checkedAt: Date.now(), source: "error", error: true };
    }
  }, maxConcurrentChecks).finally(() => inFlight.delete(videoId));

  inFlight.set(videoId, promise);
  return promise;
}

function enqueue(task, maxConcurrent) {
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject, maxConcurrent });
    pumpQueue();
  });
}

function pumpQueue() {
  while (queue.length > 0) {
    const next = queue[0];
    const limit = Math.max(1, Math.min(12, Number(next.maxConcurrent) || 8));
    if (activeRequests >= limit) return;

    queue.shift();
    activeRequests++;
    Promise.resolve()
      .then(next.task)
      .then(next.resolve, next.reject)
      .finally(() => {
        activeRequests--;
        pumpQueue();
      });
  }
}

async function fetchAndDetect(videoId) {
  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`;
  const response = await fetch(url, {
    method: "GET",
    credentials: "include",
    cache: "default",
    redirect: "follow"
  });

  if (!response.ok) throw new Error(`YouTube returned ${response.status}`);
  return detectAiDisclosure(await response.text());
}

function detectAiDisclosure(html) {
  const key = "howThisWasMadeSectionViewModel";
  let from = 0;

  while (true) {
    const index = html.indexOf(key, from);
    if (index === -1) break;

    const start = Math.max(0, index - 1200);
    const end = Math.min(html.length, index + 7500);
    const nearby = decodeEscapedText(html.slice(start, end)).toLowerCase();
    const aiSignals = [
      "made with ai", "generated with ai", "ai-generated", "ai generated",
      "generative ai", "synthetic content", "altered or synthetic",
      "fully ai generated", "partially ai generated", "utworzone przy pomocy ai",
      "wygenerowane przez ai", "wygenerowany przez ai", "generatywnej ai",
      "treści syntetyczne", "tresci syntetyczne", "zmienione lub syntetyczne"
    ];

    const matched = aiSignals.find(signal => nearby.includes(signal));
    if (matched) return { ai: true, reason: `YouTube disclosure: ${matched}` };
    from = index + key.length;
  }

  if (/"containsSyntheticMedia"\s*:\s*true/i.test(html) || /"contains_synthetic_media"\s*:\s*true/i.test(html)) {
    return { ai: true, reason: "YouTube synthetic-media flag" };
  }

  return { ai: false, reason: "No AI disclosure found" };
}

function decodeEscapedText(value) {
  return value
    .replace(/\\u0026/g, "&")
    .replace(/\\u003d/g, "=")
    .replace(/\\u003c/g, "<")
    .replace(/\\u003e/g, ">")
    .replace(/\\u0027/g, "'")
    .replace(/\\\"/g, '"')
    .replace(/\\n/g, " ");
}

async function clearCache() {
  hotCache.clear();
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(key => key.startsWith("nai:v"));
  if (keys.length) await chrome.storage.local.remove(keys);
}

async function getCacheStats() {
  const all = await chrome.storage.local.get(null);
  const entries = Object.entries(all).filter(([key]) => key.startsWith(CACHE_PREFIX));
  return {
    ok: true,
    checked: entries.length,
    ai: entries.filter(([, value]) => value?.ai === true).length
  };
}
