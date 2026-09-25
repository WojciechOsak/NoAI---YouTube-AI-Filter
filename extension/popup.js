const DEFAULT_SETTINGS = {
  enabled: true,
  mode: "hide",
  cacheTtlDays: 30,
  maxConcurrentChecks: 8
};

const enabled = document.querySelector("#enabled");
const modeButtons = [...document.querySelectorAll("#mode [data-mode]")];
const clear = document.querySelector("#clear");
const status = document.querySelector("#status");
const checked = document.querySelector("#checked");
const ai = document.querySelector("#ai");
const filterState = document.querySelector("#filterState");
let currentMode = "hide";

init();

async function init() {
  const { settings } = await chrome.storage.local.get("settings");
  const value = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  enabled.checked = value.enabled;
  currentMode = value.mode;
  updateUi();
  await refreshStats();
}

enabled.addEventListener("change", save);
modeButtons.forEach(button => button.addEventListener("click", () => {
  currentMode = button.dataset.mode;
  updateUi();
  save();
}));

clear.addEventListener("click", async () => {
  clear.disabled = true;
  status.textContent = "Clearing cache…";
  const response = await chrome.runtime.sendMessage({ type: "CLEAR_CACHE" });
  status.textContent = response?.ok ? "Detection cache cleared." : "Could not clear cache.";
  clear.disabled = false;
  await refreshStats();
  setTimeout(() => { status.textContent = ""; }, 1600);
});

function updateUi() {
  filterState.textContent = enabled.checked ? "Active" : "Paused";
  document.body.classList.toggle("is-paused", !enabled.checked);
  modeButtons.forEach(button => {
    const active = button.dataset.mode === currentMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
}

async function save() {
  const { settings: old } = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({
    settings: {
      ...DEFAULT_SETTINGS,
      ...(old || {}),
      enabled: enabled.checked,
      mode: currentMode
    }
  });
  updateUi();
  status.textContent = "Saved";
  setTimeout(() => { status.textContent = ""; }, 700);
}

async function refreshStats() {
  const response = await chrome.runtime.sendMessage({ type: "CACHE_STATS" });
  if (!response?.ok) return;
  checked.textContent = response.checked.toLocaleString();
  ai.textContent = response.ai.toLocaleString();
}
