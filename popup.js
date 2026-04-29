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
 *
 * Sets volume on all current <audio>/<video> elements and installs a
 * MutationObserver that enforces the same volume on any elements added
 * dynamically later (e.g. YouTube loading the next video segment).
 * When volume is restored to 1.0 the observer is disconnected.
 *
 * @param {number} volume  0.0 – 1.0
 */
function setAndWatchVolume(volume) {
  const KEY = "__tabVolumeObserver__";

  // Disconnect any previously installed observer.
  if (window[KEY]) {
    window[KEY].disconnect();
    window[KEY] = null;
  }

  function apply(el) { el.volume = volume; }

  document.querySelectorAll("audio, video").forEach(apply);

  // At full volume there's nothing to enforce — skip the observer.
  if (volume >= 1.0) return;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches?.("audio, video")) apply(node);
        node.querySelectorAll?.("audio, video").forEach(apply);
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  window[KEY] = observer;
}

async function applyVolumeToTab(tabId, volumePercent) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: setAndWatchVolume,
      args: [volumePercent / 100],
    });
  } catch {
    // Tab may not be scriptable (e.g., chrome:// pages, extension pages).
  }
}

// --- DOM helpers ---

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
  const data = await getSession(["solo_tabId", "solo_mutedTabIds"]);
  const soloTabId      = data.solo_tabId       ?? null;
  const mutedTabIds    = data.solo_mutedTabIds  ?? [];

  if (soloTabId === String(clickedTabId)) {
    // ── Un-solo: restore all muted tabs to 100% ──
    await Promise.all(
      mutedTabIds.map(async (tabId) => {
        updateTabSlider(tabId, DEFAULT_VOLUME);
        saveVolume(tabId, DEFAULT_VOLUME);
        await applyVolumeToTab(tabId, DEFAULT_VOLUME);
      })
    );
    await removeSession(["solo_tabId", "solo_mutedTabIds"]);
    updateSoloHighlight(null);
  } else {
    // ── Solo: boost this tab to 100%, mute all others ──
    updateTabSlider(clickedTabId, DEFAULT_VOLUME);
    saveVolume(clickedTabId, DEFAULT_VOLUME);
    await applyVolumeToTab(clickedTabId, DEFAULT_VOLUME);

    const tabsToMute = allTabs.filter((tab) => tab.id !== clickedTabId);
    await Promise.all(
      tabsToMute.map(async (tab) => {
        updateTabSlider(tab.id, 0);
        saveVolume(tab.id, 0);
        await applyVolumeToTab(tab.id, 0);
      })
    );

    await setSession({
      solo_tabId: String(clickedTabId),
      solo_mutedTabIds: tabsToMute.map((tab) => tab.id),
    });
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

  // When solo is active, muted tabs are no longer audible so the query above
  // misses them. Fetch them explicitly so they remain visible in the popup.
  const soloTabId = sessionData.solo_tabId ?? null;
  if (soloTabId) {
    const storedMutedIds = (sessionData.solo_mutedTabIds ?? []).filter(
      (id) => !allTabs.some((t) => t.id === id)
    );

    const mutedTabs = (
      await Promise.all(
        storedMutedIds.map((id) => chrome.tabs.get(id).catch(() => null))
      )
    ).filter(Boolean);

    allTabs = allTabs.concat(mutedTabs);
  }

  const list = document.getElementById("tab-list");
  const emptyState = document.getElementById("empty-state");

  if (allTabs.length === 0) {
    emptyState.hidden = false;
    return;
  }

  let soloId = sessionData.solo_tabId ?? null;

  // If the soloed tab is no longer present at all, clear stale solo state.
  if (soloId && !allTabs.some((t) => String(t.id) === soloId)) {
    await removeSession(["solo_tabId", "solo_mutedTabIds"]);
    soloId = null;
  }

  allTabs.forEach((tab) => {
    const saved = sessionData[String(tab.id)];
    list.appendChild(renderTabRow(tab, saved, soloId));

    // Re-apply saved volume so the page matches the slider on open.
    const volumeToApply = saved ?? DEFAULT_VOLUME;
    if (volumeToApply !== DEFAULT_VOLUME) {
      applyVolumeToTab(tab.id, volumeToApply);
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
