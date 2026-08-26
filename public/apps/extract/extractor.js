// Universal archive extractor.
// Uses libarchive.js (libarchive compiled to WASM) for reading.
// Supports: zip, rar (v4 & v5), 7z, tar, gz, bz2, xz, lzma, cab, iso, ar, etc.
// For creating output zips of selected files we use zip.js.
(function () {
  var Archive = null;
  var zip = window.zip;
  if (!zip) { console.error('zip.js not loaded'); return; }
  zip.configure({ useWebWorkers: false });

  function ensureArchive() {
    if (Archive) return Archive;
    if (window.libarchive && window.libarchive.Archive) {
      Archive = window.libarchive.Archive;
      return Archive;
    }
    return null;
  }

  var state = {
    file: null,
    archive: null,
    entries: [],   // [{path, size, isDir, compressedFile}]
    filter: '',
    selected: new Set()
  };

  var els = {};

  function init() {
    els.dropzone   = CV.$('#dropzone');
    els.fileInput  = CV.$('#fileInput');
    els.fileList   = CV.$('#fileList');
    els.password   = CV.$('#archivePassword');
    els.openBtn    = CV.$('#openBtn');
    els.resetBtn   = CV.$('#resetBtn');
    els.tree       = CV.$('#tree');
    els.toolbar    = CV.$('#treeToolbar');
    els.search     = CV.$('#searchInput');
    els.meta       = CV.$('#archiveMeta');
    els.selectAll  = CV.$('#selectAll');
    els.extractAll = CV.$('#extractAllBtn');
    els.extractSel = CV.$('#extractSelBtn');
    els.status     = CV.$('#status');
    els.progress   = CV.$('#progressWrap');
    els.progressBar = CV.$('#progressBar');
    els.preview    = CV.$('#previewModal');
    els.previewTitle = CV.$('#previewTitle');
    els.previewBody = CV.$('#previewBody');
    els.previewClose = CV.$('#previewClose');
    els.adPost     = CV.$('#adSlotPost');

    CV.bindDropzone(els.dropzone, els.fileInput, function (files) {
      if (!files.length) return;
      state.file = files[0];
      CV.renderFileList(els.fileList, [state.file], function () { reset(); });
      CV.clearStatus(els.status);
      els.openBtn.disabled = false;
      els.resetBtn.disabled = false;
    });

    els.openBtn.addEventListener('click', openArchive);
    els.resetBtn.addEventListener('click', reset);
    els.search.addEventListener('input', function () {
      state.filter = this.value.trim().toLowerCase();
      renderTree();
    });
    els.selectAll.addEventListener('change', function () {
      var checked = this.checked;
      visibleFileEntries().forEach(function (e) {
        if (checked) state.selected.add(e.path);
        else state.selected.delete(e.path);
      });
      renderTree();
      updateSelExtractBtn();
    });
    els.extractAll.addEventListener('click', function () {
      extractMany(state.entries.filter(function (e) { return !e.isDir; }), 'extracted');
    });
    els.extractSel.addEventListener('click', function () {
      var sel = state.entries.filter(function (e) { return !e.isDir && state.selected.has(e.path); });
      if (!sel.length) return;
      extractMany(sel, 'extracted');
    });
    els.previewClose.addEventListener('click', closePreview);
    els.preview.addEventListener('click', function (e) {
      if (e.target === els.preview) closePreview();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closePreview();
    });
  }

  function reset() {
    state.file = null;
    state.archive = null;
    state.entries = [];
    state.filter = '';
    state.selected.clear();
    els.fileList.innerHTML = '';
    els.tree.innerHTML = '';
    els.toolbar.style.display = 'none';
    els.openBtn.disabled = true;
    els.resetBtn.disabled = true;
    els.extractAll.disabled = true;
    els.extractSel.disabled = true;
    els.search.value = '';
    els.password.value = '';
    els.selectAll.checked = false;
    els.meta.textContent = '';
    CV.clearStatus(els.status);
    els.progress.style.display = 'none';
    CV.setProgress(els.progressBar, 0);
    if (els.adPost) els.adPost.classList.remove('visible');
  }

  async function openArchive() {
    if (!state.file) return;
    var A = ensureArchive();
    if (!A) {
      CV.setStatus(els.status, 'error', 'Archive engine still loading. Try again in a moment.');
      return;
    }
    els.openBtn.disabled = true;
    CV.setStatus(els.status, 'info', 'Reading archive\u2026');
    els.progress.style.display = 'block';
    CV.setProgress(els.progressBar, 5);

    try {
      state.archive = await A.open(state.file);
      var pw = els.password.value;
      if (pw) await state.archive.usePassword(pw);

      CV.setProgress(els.progressBar, 25);
      var arr = await state.archive.getFilesArray();

      state.entries = arr.map(function (item) {
        var fullPath = item.path ? (item.path + (item.path.endsWith('/') ? '' : '/') + item.file.name) : item.file.name;
        // libarchive.js reports files only; directories are inferred from paths.
        return {
          path: fullPath,
          name: item.file.name,
          dir: item.path || '',
          size: item.file.size != null ? item.file.size : (item.file._size || 0),
          isDir: false,
          compressedFile: item.file
        };
      });

      state.entries.sort(function (a, b) { return CV.naturalCompare(a.path, b.path); });

      CV.setProgress(els.progressBar, 100);
      els.progress.style.display = 'none';
      els.toolbar.style.display = 'flex';
      els.extractAll.disabled = state.entries.length === 0;
      updateMeta();
      renderTree();
      CV.setStatus(els.status, 'success', 'Loaded ' + state.entries.length + ' file' + (state.entries.length === 1 ? '' : 's') + '. Browse, preview, or extract.');
      if (els.adPost) els.adPost.classList.add('visible');
    } catch (e) {
      console.error(e);
      var msg = (e && e.message) || String(e);
      if (/password|encrypted|crypt/i.test(msg)) {
        CV.setStatus(els.status, 'error', 'This archive is password-protected. Enter the password and try again.');
      } else if (/format|signature|magic/i.test(msg)) {
        CV.setStatus(els.status, 'error', 'Could not detect the archive format. The file may be corrupt or unsupported.');
      } else {
        CV.setStatus(els.status, 'error', 'Failed to open archive: ' + msg);
      }
      els.progress.style.display = 'none';
    } finally {
      els.openBtn.disabled = false;
    }
  }

  function updateMeta() {
    var n = state.entries.length;
    var totalSize = state.entries.reduce(function (a, e) { return a + (e.size || 0); }, 0);
    els.meta.textContent = n + ' file' + (n === 1 ? '' : 's') + ' \u00b7 ' + CV.fmtBytes(totalSize) + ' uncompressed';
  }

  function visibleFileEntries() {
    if (!state.filter) return state.entries;
    return state.entries.filter(function (e) {
      return e.path.toLowerCase().indexOf(state.filter) !== -1;
    });
  }

  function renderTree() {
    var visible = visibleFileEntries();
    els.tree.innerHTML = '';
    if (!visible.length) {
      var empty = document.createElement('div');
      empty.className = 'tree-row';
      empty.innerHTML = '<span style="color:var(--muted);padding:14px">No matches.</span>';
      els.tree.appendChild(empty);
      updateSelExtractBtn();
      return;
    }
    visible.forEach(function (entry) {
      var row = document.createElement('div');
      row.className = 'tree-row';

      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = state.selected.has(entry.path);
      cb.addEventListener('change', function () {
        if (cb.checked) state.selected.add(entry.path);
        else state.selected.delete(entry.path);
        updateSelExtractBtn();
      });

      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = entry.path;
      name.title = 'Click to preview';
      name.addEventListener('click', function () { previewEntry(entry); });

      var size = document.createElement('span');
      size.className = 'size';
      size.textContent = CV.fmtBytes(entry.size);

      var actions = document.createElement('span');
      actions.className = 'row-actions';
      var dl = document.createElement('button');
      dl.className = 'row-btn';
      dl.textContent = 'Save';
      dl.title = 'Download this file';
      dl.addEventListener('click', function (e) {
        e.stopPropagation();
        extractOne(entry);
      });
      actions.appendChild(dl);

      row.appendChild(cb);
      row.appendChild(name);
      row.appendChild(size);
      row.appendChild(actions);
      els.tree.appendChild(row);
    });
    updateSelExtractBtn();
  }

  function updateSelExtractBtn() {
    var n = 0;
    state.entries.forEach(function (e) { if (state.selected.has(e.path)) n++; });
    els.extractSel.disabled = n === 0;
    els.extractSel.textContent = n > 0 ? ('Extract Selected (' + n + ')') : 'Extract Selected';
  }

  async function extractOne(entry) {
    try {
      CV.setStatus(els.status, 'info', 'Extracting ' + entry.path + '\u2026');
      var extracted = await entry.compressedFile.extract();
      var blob = extracted instanceof Blob ? extracted : new Blob([extracted]);
      CV.downloadBlob(blob, entry.name);
      CV.setStatus(els.status, 'success', 'Saved ' + entry.name + '.');
    } catch (e) {
      console.error(e);
      CV.setStatus(els.status, 'error', 'Failed to extract: ' + (e.message || e));
    }
  }

  async function extractMany(entries, baseName) {
    if (!entries.length) return;
    if (entries.length === 1) return extractOne(entries[0]);

    els.extractAll.disabled = true;
    els.extractSel.disabled = true;
    els.progress.style.display = 'block';
    CV.setProgress(els.progressBar, 1);
    CV.setStatus(els.status, 'info', 'Extracting ' + entries.length + ' files\u2026');

    try {
      var blobWriter = new zip.BlobWriter('application/zip');
      var writer = new zip.ZipWriter(blobWriter, { bufferedWrite: true });

      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        var pct = 5 + Math.floor(90 * (i / entries.length));
        CV.setProgress(els.progressBar, pct);
        CV.setStatus(els.status, 'info', 'Packing ' + (i + 1) + '/' + entries.length + ': ' + entry.path);
        try {
          var data = await entry.compressedFile.extract();
          var blob = data instanceof Blob ? data : new Blob([data]);
          await writer.add(entry.path, new zip.BlobReader(blob));
        } catch (err) {
          console.warn('Skip', entry.path, err);
        }
        await new Promise(function (r) { setTimeout(r, 0); });
      }

      CV.setProgress(els.progressBar, 98);
      CV.setStatus(els.status, 'info', 'Finalizing zip\u2026');
      var outBlob = await writer.close();
      var srcName = state.file.name.replace(/\.[^.]+$/, '');
      CV.downloadBlob(outBlob, srcName + '-' + baseName + '.zip');
      CV.setProgress(els.progressBar, 100);
      CV.setStatus(els.status, 'success', 'Done. Downloaded ' + entries.length + ' files as a zip.');
      if (els.adPost) els.adPost.classList.add('visible');
    } catch (e) {
      console.error(e);
      CV.setStatus(els.status, 'error', 'Extract failed: ' + (e.message || e));
    } finally {
      els.extractAll.disabled = false;
      updateSelExtractBtn();
      setTimeout(function () { els.progress.style.display = 'none'; }, 800);
    }
  }

  async function previewEntry(entry) {
    if (entry.size > 25 * 1024 * 1024) {
      CV.setStatus(els.status, 'warn', 'File is too large to preview (' + CV.fmtBytes(entry.size) + '). Use Save to download it.');
      return;
    }
    els.previewTitle.textContent = entry.path;
    els.previewBody.innerHTML = '<p style="color:var(--muted);text-align:center;padding:30px">Loading preview\u2026</p>';
    els.preview.classList.add('open');

    try {
      var data = await entry.compressedFile.extract();
      var mime = CV.guessMime(entry.name);
      var blob = data instanceof Blob ? data : new Blob([data], { type: mime });
      els.previewBody.innerHTML = '';

      if (CV.isImage(entry.name)) {
        var img = document.createElement('img');
        img.src = URL.createObjectURL(blob);
        img.onload = function () { setTimeout(function () { URL.revokeObjectURL(img.src); }, 60000); };
        els.previewBody.appendChild(img);
      } else if (CV.isAudio(entry.name)) {
        var au = document.createElement('audio');
        au.controls = true; au.src = URL.createObjectURL(blob);
        els.previewBody.appendChild(au);
      } else if (CV.isVideo(entry.name)) {
        var vd = document.createElement('video');
        vd.controls = true; vd.src = URL.createObjectURL(blob);
        els.previewBody.appendChild(vd);
      } else if (CV.isPdf(entry.name)) {
        var ifr = document.createElement('iframe');
        ifr.style.width = '100%'; ifr.style.height = '70vh'; ifr.style.border = '0';
        ifr.src = URL.createObjectURL(blob);
        els.previewBody.appendChild(ifr);
      } else if (CV.isTextLike(entry.name) || entry.size < 256 * 1024) {
        var text = await blob.text();
        // Crude binary check: if many NULs / control bytes, fall back.
        var bin = 0;
        for (var i = 0; i < Math.min(text.length, 4000); i++) {
          var c = text.charCodeAt(i);
          if (c === 0 || (c < 9 && c !== 7) || (c > 13 && c < 32)) bin++;
        }
        if (bin > 40 && !CV.isTextLike(entry.name)) {
          els.previewBody.innerHTML = '<p style="color:var(--muted);text-align:center;padding:30px">No preview available for this file type. Use Save to download.</p>';
        } else {
          var pre = document.createElement('pre');
          pre.textContent = text.length > 500000 ? text.slice(0, 500000) + '\n\n\u2026 (truncated)' : text;
          els.previewBody.appendChild(pre);
        }
      } else {
        els.previewBody.innerHTML = '<p style="color:var(--muted);text-align:center;padding:30px">No preview available for this file type. Use Save to download.</p>';
      }
    } catch (e) {
      console.error(e);
      els.previewBody.innerHTML = '<p style="color:var(--error);text-align:center;padding:30px">Could not load preview: ' + (e.message || e) + '</p>';
    }
  }

  function closePreview() {
    els.preview.classList.remove('open');
    els.previewBody.innerHTML = '';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
