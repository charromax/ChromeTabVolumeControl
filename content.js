/**
 * content.js — Tab Volume Control
 *
 * Standalone reference copy of the volume-enforcement function.
 * The popup and background service worker inject this logic directly
 * via chrome.scripting.executeScript({ func }) rather than loading
 * this file, so changes here must be mirrored in popup.js and background.js.
 *
 * Known limitation: Web Audio API nodes (AudioContext) are not
 * affected — only <audio> and <video> HTML elements are controlled.
 */

"use strict";

/**
 * Sets volume on all current <audio>/<video> elements and installs a
 * MutationObserver to enforce the same volume on dynamically added elements.
 * Disconnects the observer when volume is restored to 1.0.
 *
 * @param {number} volume  0.0 (mute) – 1.0 (full)
 */
// eslint-disable-next-line no-unused-vars
function setAndWatchVolume(volume) {
  const KEY = "__tabVolumeObserver__";

  if (window[KEY]) {
    window[KEY].disconnect();
    window[KEY] = null;
  }

  function apply(el) { el.volume = Math.max(0, Math.min(1, volume)); }

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
