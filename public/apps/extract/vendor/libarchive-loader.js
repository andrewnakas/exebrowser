// Loads libarchive.js as a module and exposes window.libarchive = { Archive }.
// This lets non-module scripts access the API via the global.
import { Archive } from './libarchive.js';
window.libarchive = { Archive: Archive };
window.dispatchEvent(new Event('libarchive-ready'));
