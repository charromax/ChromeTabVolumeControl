/**
 * background.js — Tab Volume Control service worker
 *
 * Listens for tab navigation completions and re-applies any stored
 * volume from chrome.storage.session. This covers the case where a tab
 * navigates to a new page (e.g. clicking a YouTube video), which destroys
 * the previously injected MutationObserver and resets media element volumes
 * to the browser default of 1.0.
 */

"use strict";

const DEFAULT_VOLUME = 100;

/**
 * Same MutationObserver-based function used by popup.js.
 * Must be self-contained — no closure references.
 */
function setAndWatchVolume(volume) {
  const KEY = "__tabVolumeObserver__";

  if (window[KEY]) {
    window[KEY].disconnect();
    window[KEY] = null;
  }

  function apply(el) { el.volume = volume; }

  document.querySelectorAll("audio, video").forEach(apply);

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

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  // Only act when the page has fully loaded.
  if (changeInfo.status !== "complete") return;

  const data = await chrome.storage.session.get(String(tabId));
  const volume = data[String(tabId)];

  // Nothing stored or already at full volume — nothing to enforce.
  if (volume === undefined || volume === DEFAULT_VOLUME) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: setAndWatchVolume,
      args: [volume / 100],
    });
  } catch {
    // Tab is not scriptable (chrome://, extensions pages, etc.).
  }
});
