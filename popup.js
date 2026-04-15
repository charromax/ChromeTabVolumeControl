/**
 * popup.js — Tab Volume Control
 *
 * Lists all audible tabs with per-tab volume sliders.
 * Click a tab row (outside the slider) to solo it — all others go to 0.
 * Click the soloed tab again to restore everyone to their pre-solo volumes.
 *
 * Known limitation: Web Audio API nodes (AudioContext) are not
 * affected — only <audio> and <video> HTML elements are controlled.
 */

"use strict";

const DEFAULT_VOLUME = 100; // 0–100

// All currently audible tabs — kept module-level for solo helpers.
let allTabs = [];

// --- Storage helpers ---

function getSession(keys) {
  return new Promise((resolve) => chrome.storage.session.get(keys, resolve));
}

function setSession(data) {
  return new Promise((resolve) => chrome.storage.session.set(data, resolve));
}

function removeSession(keys) {
  return new Promise((resolve) => chrome.storage.session.remove(keys, resolve));
}

function saveVolume(tabId, volume) {
  chrome.storage.session.set({ [String(tabId)]: volume });
}

// --- Volume injection ---

/**
 * Injected into the target tab. Must be self-contained (no closure refs).
 * @param {number} volume  0.0 – 1.0
 */
function setVolumeInTab(volume) {
  document.querySelectorAll("audio, video").forEach((el) => {
    el.volume = volume;
  });
}

async function applyVolumeToTab(tabId, volumePercent) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: setVolumeInTab,
      args: [volumePercent / 100],
    });
  } catch {
    // Tab may not be scriptable (e.g., chrome:// pages, extension pages).
  }
}

// --- DOM helpers ---

function getSliderVolume(tabId) {
  const row = document.querySelector(`.tab-row[data-tab-id="${tabId}"]`);
  return row ? Number(row.querySelector(".volume-slider").value) : DEFAULT_VOLUME;
}

function updateTabSlider(tabId, volume) {
  const row = document.querySelector(`.tab-row[data-tab-id="${tabId}"]`);
  if (!row) return;
  row.querySelector(".volume-slider").value = String(volume);
  row.querySelector(".volume-label").textContent = `${volume}%`;
}

function updateSoloHighlight(soloTabId) {
  document.querySelectorAll(".tab-row").forEach((row) => {
    const id = Number(row.dataset.tabId);
    row.classList.toggle("soloed", soloTabId !== null && id === soloTabId);
    row.classList.toggle("muted",  soloTabId !== null && id !== soloTabId);
  });
}

// --- Solo / Un-solo ---

async function handleRowClick(clickedTabId) {
  const data = await getSession(["solo_tabId", "solo_preVolumes"]);
  const soloTabId    = data.solo_tabId     ?? null;
  const preSoloVolumes = data.solo_preVolumes ?? {};

  if (soloTabId === String(clickedTabId)) {
    // ── Un-solo: restore all tabs to their pre-solo volumes ──
    await Promise.all(
      allTabs.map(async (tab) => {
        const vol = preSoloVolumes[String(tab.id)] ?? DEFAULT_VOLUME;
        updateTabSlider(tab.id, vol);
        saveVolume(tab.id, vol);
        await applyVolumeToTab(tab.id, vol);
      })
    );
    await removeSession(["solo_tabId", "solo_preVolumes"]);
    updateSoloHighlight(null);
  } else {
    // ── Solo: snapshot current volumes, then mute all other tabs ──
    const preVolumes = {};
    allTabs.forEach((tab) => {
      preVolumes[String(tab.id)] = getSliderVolume(tab.id);
    });

    await Promise.all(
      allTabs
        .filter((tab) => tab.id !== clickedTabId)
        .map(async (tab) => {
          updateTabSlider(tab.id, 0);
          saveVolume(tab.id, 0);
          await applyVolumeToTab(tab.id, 0);
        })
    );

    await setSession({ solo_tabId: String(clickedTabId), solo_preVolumes: preVolumes });
    updateSoloHighlight(clickedTabId);
  }
}

// --- Rendering ---

function buildFaviconFallback() {
  const div = document.createElement("div");
  div.className = "tab-favicon-fallback";
  div.textContent = "♪";
  return div;
}

function renderTabRow(tab, savedVolume, activeSoloTabId) {
  const volume   = savedVolume ?? DEFAULT_VOLUME;
  const isSoloed = activeSoloTabId !== null && String(tab.id) === activeSoloTabId;
  const isMuted  = activeSoloTabId !== null && String(tab.id) !== activeSoloTabId;

  const row = document.createElement("div");
  row.className = "tab-row";
  if (isSoloed) row.classList.add("soloed");
  if (isMuted)  row.classList.add("muted");
  row.dataset.tabId = tab.id;

  // Clicking the non-slider portion of the row triggers solo/unsolo.
  row.addEventListener("click", () => handleRowClick(tab.id));

  // Favicon
  if (tab.favIconUrl) {
    const img = document.createElement("img");
    img.className = "tab-favicon";
    img.src = tab.favIconUrl;
    img.alt = "";
    img.onerror = () => img.replaceWith(buildFaviconFallback());
    row.appendChild(img);
  } else {
    row.appendChild(buildFaviconFallback());
  }

  // Info column (title + controls)
  const info = document.createElement("div");
  info.className = "tab-info";

  const title = document.createElement("div");
  title.className = "tab-title";
  title.textContent = tab.title || tab.url || "Untitled Tab";
  title.title = tab.title || tab.url || "";
  info.appendChild(title);

  // Stop propagation on the controls area so dragging the slider
  // doesn't accidentally trigger the solo click on the row.
  const controls = document.createElement("div");
  controls.className = "tab-controls";
  controls.addEventListener("click", (e) => e.stopPropagation());

  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "volume-slider";
  slider.min = "0";
  slider.max = "100";
  slider.value = String(volume);
  slider.setAttribute("aria-label", `Volume for ${tab.title || "tab"}`);

  const label = document.createElement("span");
  label.className = "volume-label";
  label.textContent = `${volume}%`;

  slider.addEventListener("input", () => {
    const newVolume = Number(slider.value);
    label.textContent = `${newVolume}%`;
    saveVolume(tab.id, newVolume);
    applyVolumeToTab(tab.id, newVolume);
  });

  controls.appendChild(slider);
  controls.appendChild(label);
  info.appendChild(controls);
  row.appendChild(info);

  // SOLO badge — always in the DOM, shown via CSS only when soloed.
  const badge = document.createElement("span");
  badge.className = "solo-badge";
  badge.textContent = "SOLO";
  row.appendChild(badge);

  return row;
}

// --- Init ---

async function init() {
  const [tabs, sessionData] = await Promise.all([
    new Promise((resolve) => chrome.tabs.query({ audible: true }, resolve)),
    getSession(null),
  ]);

  allTabs = tabs ?? [];

  const list = document.getElementById("tab-list");
  const emptyState = document.getElementById("empty-state");

  if (allTabs.length === 0) {
    emptyState.hidden = false;
    return;
  }

  let soloTabId = sessionData.solo_tabId ?? null;

  // If the soloed tab is no longer audible, clear stale solo state.
  if (soloTabId && !allTabs.some((t) => String(t.id) === soloTabId)) {
    await removeSession(["solo_tabId", "solo_preVolumes"]);
    soloTabId = null;
  }

  allTabs.forEach((tab) => {
    const saved = sessionData[String(tab.id)];
    list.appendChild(renderTabRow(tab, saved, soloTabId));

    // Re-apply saved volume so the page matches the slider on open.
    const volumeToApply = saved ?? DEFAULT_VOLUME;
    if (volumeToApply !== DEFAULT_VOLUME) {
      applyVolumeToTab(tab.id, volumeToApply);
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
