// Shared dropzone + UI helpers used by every tool page.
(function (global) {
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function fmtBytes(n) {
    if (n == null || isNaN(n)) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(2) + ' MB';
    return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function bindDropzone(dropzoneEl, fileInputEl, onFiles, accept) {
    dropzoneEl.addEventListener('click', function (e) {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A') return;
      fileInputEl.click();
    });
    fileInputEl.addEventListener('change', function (e) {
      onFiles(Array.from(e.target.files));
      fileInputEl.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dropzoneEl.addEventListener(ev, function (e) {
        e.preventDefault(); e.stopPropagation();
        dropzoneEl.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dropzoneEl.addEventListener(ev, function (e) {
        e.preventDefault(); e.stopPropagation();
        dropzoneEl.classList.remove('dragover');
      });
    });
    dropzoneEl.addEventListener('drop', function (e) {
      var files = Array.from(e.dataTransfer.files);
      if (accept && accept.length) {
        files = files.filter(function (f) {
          return accept.some(function (ext) {
            return f.name.toLowerCase().endsWith(ext.toLowerCase());
          });
        });
      }
      onFiles(files);
    });
  }

  function setStatus(el, kind, msg) {
    el.className = 'status ' + kind;
    el.textContent = msg;
  }
  function clearStatus(el) {
    el.className = 'status hidden';
    el.textContent = '';
  }
  function setProgress(barEl, pct) {
    barEl.style.width = Math.max(0, Math.min(100, pct)) + '%';
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function renderFileList(listEl, files, onRemove) {
    listEl.innerHTML = '';
    files.forEach(function (f, idx) {
      var item = document.createElement('div');
      item.className = 'file-item';
      var span = document.createElement('span');
      var name = document.createElement('span');
      name.className = 'name'; name.textContent = f.name;
      var size = document.createElement('span');
      size.className = 'size'; size.textContent = fmtBytes(f.size);
      span.appendChild(name); span.appendChild(size);
      item.appendChild(span);
      if (onRemove) {
        var rm = document.createElement('button');
        rm.className = 'remove';
        rm.textContent = '\u00d7';
        rm.title = 'Remove';
        rm.onclick = function () { onRemove(idx); };
        item.appendChild(rm);
      }
      listEl.appendChild(item);
    });
  }

  // Natural ordering so "file2" sorts before "file10".
  function naturalCompare(a, b) {
    var ax = a.match(/(\d+|\D+)/g) || [];
    var bx = b.match(/(\d+|\D+)/g) || [];
    var len = Math.min(ax.length, bx.length);
    for (var i = 0; i < len; i++) {
      var na = parseInt(ax[i], 10), nb = parseInt(bx[i], 10);
      if (!isNaN(na) && !isNaN(nb)) { if (na !== nb) return na - nb; }
      else { var c = ax[i].localeCompare(bx[i]); if (c !== 0) return c; }
    }
    return ax.length - bx.length;
  }

  // Best-effort MIME guess for previews.
  var MIME_BY_EXT = {
    'jpg':'image/jpeg','jpeg':'image/jpeg','png':'image/png','gif':'image/gif',
    'webp':'image/webp','bmp':'image/bmp','svg':'image/svg+xml','ico':'image/x-icon',
    'mp3':'audio/mpeg','wav':'audio/wav','ogg':'audio/ogg','m4a':'audio/mp4','flac':'audio/flac',
    'mp4':'video/mp4','webm':'video/webm','mov':'video/quicktime','mkv':'video/x-matroska',
    'pdf':'application/pdf',
    'json':'application/json','xml':'application/xml','html':'text/html','htm':'text/html',
    'css':'text/css','js':'application/javascript','ts':'application/typescript',
    'md':'text/markdown','csv':'text/csv','tsv':'text/tab-separated-values',
    'txt':'text/plain','log':'text/plain','ini':'text/plain','conf':'text/plain','yml':'text/plain','yaml':'text/plain'
  };
  function guessMime(name) {
    var ext = (name.split('.').pop() || '').toLowerCase();
    return MIME_BY_EXT[ext] || 'application/octet-stream';
  }
  function isTextLike(name) {
    var m = guessMime(name);
    return m.indexOf('text/') === 0 || /(json|xml|javascript|typescript|markdown|csv)/.test(m);
  }
  function isImage(name)  { return guessMime(name).indexOf('image/') === 0; }
  function isAudio(name)  { return guessMime(name).indexOf('audio/') === 0; }
  function isVideo(name)  { return guessMime(name).indexOf('video/') === 0; }
  function isPdf(name)    { return guessMime(name) === 'application/pdf'; }

  global.CV = {
    $: $, $$: $$,
    fmtBytes: fmtBytes,
    bindDropzone: bindDropzone,
    setStatus: setStatus,
    clearStatus: clearStatus,
    setProgress: setProgress,
    downloadBlob: downloadBlob,
    renderFileList: renderFileList,
    naturalCompare: naturalCompare,
    guessMime: guessMime,
    isTextLike: isTextLike,
    isImage: isImage,
    isAudio: isAudio,
    isVideo: isVideo,
    isPdf: isPdf
  };
})(window);
