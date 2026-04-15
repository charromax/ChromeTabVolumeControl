/**
 * content.js — Tab Volume Control
 *
 * This file is included for completeness and can be used as a
 * persistent content script if needed in the future. The popup
 * currently injects setVolumeInTab directly via chrome.scripting
 * executeScript({ func }) without loading this file.
 *
 * Known limitation: Web Audio API nodes (AudioContext) are not
 * affected — only <audio> and <video> HTML elements are controlled.
 */

"use strict";

/**
 * Sets the volume on all <audio> and <video> elements in the page.
 *
 * @param {number} volume  A value between 0.0 (mute) and 1.0 (full).
 */
// eslint-disable-next-line no-unused-vars
function setVolumeInTab(volume) {
  document.querySelectorAll("audio, video").forEach((el) => {
    el.volume = Math.max(0, Math.min(1, volume));
  });
}
