const DEFAULT_SETTINGS = {
  enabled: true,
  mode: "hide",
  cacheTtlDays: 30,
  maxConcurrentChecks: 8
};

let settings = { ...DEFAULT_SETTINGS };
let scanTimer = null;
let scanRunning = false;
let scanRequested = false;

init();

async function init() {
  settings = await loadSettings();
  observePage();
  scheduleScan(0);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.settings) return;
    settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
    resetRenderedState();
    scheduleScan(0);
  });

  window.addEventListener("yt-navigate-finish", () => scheduleScan(0), true);
  window.addEventListener("yt-page-data-updated", () => scheduleScan(50), true);
  window.addEventListener("scroll", () => scheduleScan(80), { passive: true });
}

async function loadSettings() {
  const { settings: stored } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(stored || {}) };
}

function observePage() {
  const observer = new MutationObserver(() => scheduleScan(90));
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function scheduleScan(delay = 90) {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(scanPage, delay);
}

async function scanPage() {
  if (!settings.enabled) return;
  if (scanRunning) {
    scanRequested = true;
    return;
  }

  scanRunning = true;
  try {
    const items = collectItems()
      .filter(({ element, videoId }) => videoId && element.dataset.noAiVideoId !== videoId)
      .sort((a, b) => distanceFromViewport(a.element) - distanceFromViewport(b.element));

    if (!items.length) return;

    for (const { element, videoId } of items) {
      element.dataset.noAiVideoId = videoId;
      element.classList.add("no-ai-checking");
    }

    const batchSize = 24;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const videoIds = batch.map(item => item.videoId);
      const response = await chrome.runtime.sendMessage({ type: "CHECK_VIDEOS", videoIds });

      if (!response?.ok) {
        batch.forEach(({ element }) => element.classList.remove("no-ai-checking"));
        continue;
      }

      for (const { element, videoId } of batch) {
        element.classList.remove("no-ai-checking");
        const result = response.results?.[videoId];
        if (!result || result.error) {
          element.dataset.noAiResult = "error";
          continue;
        }

        element.dataset.noAiResult = result.ai ? "ai" : "ok";
        element.dataset.noAiReason = result.reason || "";
        if (result.ai) applyFilter(element, result.reason);
      }
    }
  } finally {
    scanRunning = false;
    if (scanRequested) {
      scanRequested = false;
      scheduleScan(40);
    }
  }
}

function collectItems() {
  const selectors = location.hostname === "music.youtube.com"
    ? ["ytmusic-responsive-list-item-renderer", "ytmusic-two-row-item-renderer"]
    : ["ytd-rich-item-renderer", "ytd-video-renderer", "ytd-grid-video-renderer", "ytd-compact-video-renderer", "#related yt-lockup-view-model"];

  const results = [];
  const seen = new Set();

  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      if (seen.has(element)) continue;
      seen.add(element);
      const videoId = extractVideoId(element);
      if (videoId) results.push({ element, videoId });
    }
  }

  return results;
}

function distanceFromViewport(element) {
  const rect = element.getBoundingClientRect();
  if (rect.bottom >= 0 && rect.top <= innerHeight) return 0;
  return rect.top > innerHeight ? rect.top - innerHeight : -rect.bottom;
}

function extractVideoId(element) {
  const anchors = element.querySelectorAll('a[href*="/watch?"]');
  for (const anchor of anchors) {
    try {
      const url = new URL(anchor.href, location.origin);
      const id = url.searchParams.get("v");
      if (id) return id;
    } catch (_) {}
  }
  return null;
}

function applyFilter(element, reason) {
  element.classList.remove("no-ai-hidden", "no-ai-blurred", "no-ai-labeled");

  if (settings.mode === "blur") {
    element.classList.add("no-ai-blurred");
    addOverlay(element, reason);
  } else if (settings.mode === "label") {
    element.classList.add("no-ai-labeled");
    addBadge(element);
  } else {
    element.classList.add("no-ai-hidden");
  }
}

function addOverlay(element, reason) {
  if (element.querySelector(":scope > .no-ai-overlay")) return;
  const overlay = document.createElement("div");
  overlay.className = "no-ai-overlay";
  overlay.innerHTML = `<div class="no-ai-overlay-card"><span class="no-ai-overlay-mark">AI</span><strong>AI content filtered</strong><span>${escapeHtml(reason || "YouTube AI disclosure")}</span><button type="button">Show anyway</button></div>`;
  overlay.querySelector("button").addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    element.classList.remove("no-ai-blurred");
    overlay.remove();
  });
  element.appendChild(overlay);
}

function addBadge(element) {
  if (element.querySelector(":scope > .no-ai-badge")) return;
  const badge = document.createElement("div");
  badge.className = "no-ai-badge";
  badge.textContent = "AI filtered";
  element.appendChild(badge);
}

function resetRenderedState() {
  document.querySelectorAll("[data-no-ai-video-id]").forEach(element => {
    element.classList.remove("no-ai-hidden", "no-ai-blurred", "no-ai-labeled", "no-ai-checking");
    element.querySelector(":scope > .no-ai-overlay")?.remove();
    element.querySelector(":scope > .no-ai-badge")?.remove();
    delete element.dataset.noAiVideoId;
    delete element.dataset.noAiResult;
    delete element.dataset.noAiReason;
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
