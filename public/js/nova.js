'use strict';

/* ============================================================
   NOVA OPTIMIZER — Lógica del frontend
   ============================================================ */

const $ = (id) => document.getElementById(id);

const els = {
  dbStatus: $('dbStatus'),
  dropzone: $('dropzone'),
  fileInput: $('fileInput'),
  filePreview: $('filePreview'),
  fileName: $('fileName'),
  fileSize: $('fileSize'),
  btnOptimize: $('btnOptimize'),
  phaseUpload: $('phase-upload'),
  phaseResult: $('phase-result'),
  btnBack: $('btnBack'),
  btnDownload: $('btnDownload'),
  btnCopy: $('btnCopy'),
  statNodes: $('statNodes'),
  statSize: $('statSize'),
  statType: $('statType'),
  historyList: $('historyList'),
  resultType: $('resultType'),
  barOriginal: $('barOriginal'),
  barOptimized: $('barOptimized'),
  sizeOriginal: $('sizeOriginal'),
  sizeOptimized: $('sizeOptimized'),
  nodesOriginal: $('nodesOriginal'),
  nodesOptimized: $('nodesOptimized'),
  savingsPct: $('savingsPct'),
  savingsRing: $('savingsRing'),
  savingsBytes: $('savingsBytes'),
  statComments: $('statComments'),
  statEmpties: $('statEmpties'),
  statDecimals: $('statDecimals'),
  statElapsed: $('statElapsed'),
  qualityPanel: $('qualityPanel'),
  qSlider: $('qSlider'),
  qSliderVal: $('qSliderVal'),
  textureGrid: $('textureGrid'),
  preview: document.querySelector('.preview'),
  toast: $('toast'),
};

let currentFile = null;
let currentBytes = null; // ArrayBuffer (para YTD)
let result = null;
let originalContent = '';
let isYtd = false;

/* ---------------- Utilidades ---------------- */

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function countXmlNodes(xml) {
  const tags = xml.match(/<\/[a-zA-Z_][\w:.-]*>/g);
  return tags ? tags.length : 0;
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlightXml(xml) {
  const esc = escapeHtml(xml);
  return esc
    .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span style="color:#64748b">$1</span>')
    .replace(/(&lt;\/?)([a-zA-Z_][\w:.-]*)/g, '$1<span style="color:#22d3ee">$2</span>')
    .replace(/([a-zA-Z_:][\w:.-]*)=(&quot;.*?&quot;)/g, '<span style="color:#e879f9">$1</span>=<span style="color:#a3e635">$2</span>');
}

function showToast(msg, type) {
  els.toast.textContent = msg;
  els.toast.className = 'toast ' + (type || '');
  els.toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { els.toast.hidden = true; }, 3200);
}

function setBtnLoading(btn, loading, label) {
  if (loading) {
    btn.dataset.html = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> ' + (label || 'PROCESANDO');
  } else {
    btn.disabled = false;
    if (btn.dataset.html) btn.innerHTML = btn.dataset.html;
  }
}

/* ---------------- Drag & drop / subida ---------------- */

els.dropzone.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', () => {
  if (els.fileInput.files[0]) handleFile(els.fileInput.files[0]);
});

['dragenter', 'dragover'].forEach((ev) => {
  els.dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    els.dropzone.classList.add('dragover');
  });
});
['dragleave', 'drop'].forEach((ev) => {
  els.dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    els.dropzone.classList.remove('dragover');
  });
});
els.dropzone.addEventListener('drop', (e) => {
  const f = e.dataTransfer.files[0];
  if (f) handleFile(f);
});

function handleFile(file) {
  const ext = file.name.toLowerCase();
  isYtd = /\.ytd$/.test(ext);
  const okExt = /\.(xml|meta|ytyp|ymt|txt|ytd|zip|ydd|yft|ydr|ybn|ymap)$/i;

  if (!okExt.test(file.name)) {
    showToast('Formato no soportado. Usa .ytd, .xml, .meta, .zip, .ydd, .yft o .ydr', 'err');
    return;
  }

  currentFile = file;
  els.fileName.textContent = file.name;
  els.fileSize.textContent = formatBytes(file.size);
  els.filePreview.hidden = false;
  els.dropzone.querySelector('.dropzone-inner').style.display = 'none';

  if (/\.(xml|meta|ytyp|ymt|txt)$/i.test(file.name)) {
    // Texto: leer como texto para previsualizar
    const reader = new FileReader();
    reader.onload = (e) => {
      originalContent = e.target.result;
      els.statNodes.textContent = countXmlNodes(originalContent).toLocaleString('es');
      els.statSize.textContent = formatBytes(file.size);
      els.statType.textContent = detectType(file.name, originalContent);
      showToast('Archivo cargado correctamente', 'ok');
    };
    reader.readAsText(file);
    return;
  }

  // Binario: .ytd .zip .ydd .yft .ydr .ybn .ymap
  const reader = new FileReader();
  reader.onload = (e) => {
    currentBytes = e.target.result;
    els.statNodes.textContent = '—';
    els.statSize.textContent = formatBytes(file.size);
    els.statType.textContent = detectExt(file.name);
    showToast('Archivo cargado correctamente', 'ok');
  };
  reader.readAsArrayBuffer(file);
}

function detectExt(name) {
  const ext = name.toLowerCase();
  if (/\.ytd$/i.test(ext)) return 'YTD';
  if (/\.ydd$/i.test(ext)) return 'YDD';
  if (/\.yft$/i.test(ext)) return 'YFT';
  if (/\.ydr$/i.test(ext)) return 'YDR';
  if (/\.ybn$/i.test(ext)) return 'YBN';
  if (/\.ymap$/i.test(ext)) return 'YMAP';
  if (/\.zip$/i.test(ext)) return 'ZIP';
  return detectType(name, originalContent);
}

function detectType(name, content) {
  const ext = name.toLowerCase();
  if (/\.ytyp\.xml$/.test(ext) || /\.ytp\.xml$/.test(ext)) return 'YTYP';
  if (/\.ymt\.xml$/.test(ext)) return 'YMT';
  if (/\.meta$/i.test(ext)) return 'META';
  if (/ShopPedApparel|pedOutfits|pedComponents/.test(content)) return 'CLOTHING';
  if (/CMapTypes|archetype|CBaseArchetypeDef/.test(content)) return 'YTYP';
  return 'XML';
}

/* ---------------- Optimizar ---------------- */

els.btnOptimize.addEventListener('click', () => {
  if (!currentFile) return;
  const ext = currentFile.name.toLowerCase();
  if (isYtd) optimizeYtdNow();
  else if (/\.zip$/.test(ext)) optimizeZipNow();
  else if (/\.(ydd|yft|ydr|ybn|ymap)$/.test(ext)) analyzeNow();
  else optimizeXmlNow();
});

async function optimizeXmlNow() {
  const form = new FormData();
  form.append('file', currentFile);
  form.append('keepDeclaration', 'true');
  form.append('trimDecimals', 'true');

  setBtnLoading(els.btnOptimize, true, 'OPTIMIZANDO');
  try {
    const res = await fetch('/api/optimize', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Error al optimizar');
    result = data;
    showResult();
    loadHistory();
    showToast('Optimización completada', 'ok');
  } catch (err) {
    showToast(err.message, 'err');
  } finally {
    setBtnLoading(els.btnOptimize, false);
  }
}

async function optimizeYtdNow() {
  if (!currentBytes) return;

  const form = new FormData();
  form.append('file', new File([currentBytes], currentFile.name));
  form.append('quality', String(Number(els.qSlider.value) || 100));
  form.append('stripMips', 'true');

  setBtnLoading(els.btnOptimize, true, 'OPTIMIZANDO');

  try {
    const res = await fetch('/api/optimize-ytd', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Error al optimizar YTD');
    result = data;
    showResult();
    loadHistory();
    showToast('Optimización completada (' + data.quality + '% calidad)', 'ok');
  } catch (err) {
    showToast(err.message, 'err');
  } finally {
    setBtnLoading(els.btnOptimize, false);
  }
}

async function optimizeZipNow() {
  if (!currentBytes) return;

  const form = new FormData();
  form.append('file', new File([currentBytes], currentFile.name));
  form.append('quality', String(Number(els.qSlider.value) || 100));

  setBtnLoading(els.btnOptimize, true, 'OPTIMIZANDO');
  try {
    const res = await fetch('/api/optimize-zip', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Error al optimizar ZIP');
    result = data;
    showResult();
    loadHistory();
    showToast('Pack optimizado (' + data.quality + '% calidad)', 'ok');
  } catch (err) {
    showToast(err.message, 'err');
  } finally {
    setBtnLoading(els.btnOptimize, false);
  }
}

async function analyzeNow() {
  if (!currentBytes) return;

  const form = new FormData();
  form.append('file', new File([currentBytes], currentFile.name));

  setBtnLoading(els.btnOptimize, true, 'ANALIZANDO');
  try {
    const res = await fetch('/api/analyze', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Error al analizar');
    result = data;
    showResult();
    showToast('Análisis técnico completado', 'ok');
  } catch (err) {
    showToast(err.message, 'err');
  } finally {
    setBtnLoading(els.btnOptimize, false);
  }
}

/* ---------------- Mostrar resultado ---------------- */

function showResult() {
  const r = result;
  const oSize = r.originalSize;
  const nSize = r.optimizedSize;
  const pct = r.savingsPct;

  els.phaseUpload.classList.remove('active');
  els.phaseResult.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  els.resultType.textContent = r.type;

  els.sizeOriginal.textContent = formatBytes(oSize);
  els.sizeOptimized.textContent = formatBytes(nSize);

  if (r.type === 'ytd') {
    els.nodesOriginal.textContent = r.textures.length + ' texturas';
    els.nodesOptimized.textContent = r.textures.length + ' texturas';
    els.preview.style.display = 'none';
    renderTextureGrid();
  } else if (r.type === 'zip') {
    els.nodesOriginal.textContent = r.entries.length + ' .ytd';
    els.nodesOptimized.textContent = r.entries.length + ' .ytd';
    els.preview.style.display = 'none';
    renderZipList();
  } else if (r.type === 'rsc7') {
    els.nodesOriginal.textContent = (r.textures ? r.textures.length : 0) + ' texturas';
    els.nodesOptimized.textContent = '—';
    els.preview.style.display = 'none';
    renderAnalyzeInfo();
  } else {
    els.nodesOriginal.textContent = countXmlNodes(originalContent) + ' nodos';
    els.nodesOptimized.textContent = countXmlNodes(r.optimizedContent) + ' nodos';
    els.preview.style.display = '';
    els.qualityPanel.hidden = true;
    $('tab-original').innerHTML = highlightXml(originalContent.slice(0, 200000));
    $('tab-optimized').innerHTML = highlightXml(r.optimizedContent.slice(0, 200000));
  }

  // Barras proporcionales al mayor
  const max = Math.max(oSize, nSize, 1);
  els.barOriginal.style.width = (oSize / max) * 100 + '%';
  setTimeout(() => { els.barOptimized.style.width = (nSize / max) * 100 + '%'; }, 150);

  // Anillo de ahorro
  const ringPct = Math.max(0, Math.min(pct, 100));
  els.savingsPct.textContent = ringPct.toFixed(1) + '%';
  els.savingsRing.style.setProperty('--pct', ringPct.toFixed(1));
  els.savingsBytes.textContent = formatBytes(Math.max(r.savingsBytes, 0));
  els.savingsBytes.classList.add('ok');

  els.statComments.textContent = (r.stats && r.stats.comments_removed) || 0;
  els.statEmpties.textContent = (r.stats && r.stats.empties_removed) || 0;
  els.statDecimals.textContent = (r.stats && r.stats.decimals_trimmed) || 0;
  els.statElapsed.textContent = (r.elapsedMs != null ? r.elapsedMs : 0) + ' ms';
}

function renderTextureGrid() {
  const r = result;
  const grid = els.textureGrid;
  grid.innerHTML = '';

  // El slider se usa para re-optimizar al soltarlo
  els.qualityPanel.hidden = false;
  els.qSlider.value = String(r.quality || 70);
  els.qSliderVal.textContent = els.qSlider.value + '%';

  if (!r.previews || !r.previews.length) {
    grid.innerHTML = '<div class="tile-placeholder">Sin texturas con preview.</div>';
    return;
  }

  r.previews.forEach((p, i) => {
    const tex = r.textures[i];
    const tile = document.createElement('div');
    tile.className = 'tile';

    const head = document.createElement('div');
    head.className = 'tile-head';
    head.innerHTML =
      '<span class="tile-name" title="' + escapeHtml(p.name) + '">' + escapeHtml(p.name) + '</span>' +
      '<span class="tile-fmt">' + escapeHtml(tex.formatName) + '</span>';

    const imgs = document.createElement('div');
    imgs.className = 'tile-imgs';
    imgs.appendChild(buildPreview('Antes', p.before));
    imgs.appendChild(buildPreview('Después', p.after));

    const foot = document.createElement('div');
    foot.className = 'tile-foot';
    const saved = tex.saved > 0;
    foot.innerHTML =
      '<span>' + tex.widthBefore + 'x' + tex.heightBefore +
        (tex.widthAfter !== tex.widthBefore ? ' → ' + tex.widthAfter + 'x' + tex.heightAfter : '') +
        '</span>' +
      '<span class="' + (saved ? 'save' : 'none') + '">' +
        (saved ? '−' + tex.pct + '%' : '—') + '</span>';

    tile.appendChild(head);
    tile.appendChild(imgs);
    tile.appendChild(foot);
    grid.appendChild(tile);
  });
}

function renderZipList() {
  const r = result;
  const grid = els.textureGrid;
  grid.innerHTML = '';

  els.qualityPanel.hidden = false;
  els.qSlider.value = String(r.quality || 100);
  els.qSliderVal.textContent = els.qSlider.value + '%';

  const table = document.createElement('div');
  table.className = 'zip-list';
  table.innerHTML = r.entries
    .map((e) => {
      const saved = e.sizeAfter < e.sizeBefore;
      return '<div class="zip-row">' +
        '<span class="zip-name" title="' + escapeHtml(e.name) + '">' + escapeHtml(e.name) + '</span>' +
        '<span class="zip-sizes">' + formatBytes(e.sizeBefore) + ' → ' + formatBytes(e.sizeAfter) + '</span>' +
        '<span class="' + (saved ? 'save' : 'none') + '">' + (saved ? '−' + e.pct + '%' : '—') + '</span>' +
      '</div>';
    })
    .join('');
  grid.appendChild(table);
}

function renderAnalyzeInfo() {
  const r = result;
  const grid = els.textureGrid;
  grid.innerHTML = '';
  els.qualityPanel.hidden = true;

  const box = document.createElement('div');
  box.className = 'analyze-box';
  const rows = [
    ['Tipo de archivo', r.originalName],
    ['Versión RSC7', 'v' + r.version],
    ['Comprimido', r.isCompressed ? 'Sí (' + r.compressedRatio + '%)' : 'No'],
    ['Sección system', formatBytes(r.sysSize)],
    ['Sección graphics', formatBytes(r.gfxSize)],
    ['Tamaño descomprimido', formatBytes(r.originalSize)],
    ['TextureDictionary', r.hasTextureDict ? 'Sí' : 'No'],
  ];
  box.innerHTML = rows.map(([k, v]) =>
    '<div class="an-row"><span>' + k + '</span><strong>' + escapeHtml(String(v)) + '</strong></div>').join('');

  if (r.textures && r.textures.length) {
    const sub = document.createElement('div');
    sub.className = 'analyze-textures';
    sub.innerHTML = '<div class="an-title">Texturas encontradas</div>' +
      r.textures.map((t) =>
        '<div class="an-tex">' + escapeHtml(t.name) +
        ' <span>' + t.width + 'x' + t.height + ' · ' + escapeHtml(t.formatName) +
        ' · ' + formatBytes(t.pixelSize) + '</span></div>').join('');
    box.appendChild(sub);
  }

  box.innerHTML += '<div class="an-note">Este formato (.ydd/.yft/.ydr) no puede reescribirse sin un motor de mallas. La optimización real está disponible para .ytd (texturas) y .xml/.meta.</div>';
  grid.appendChild(box);
}

function buildPreview(label, pv) {
  const cell = document.createElement('div');
  cell.className = 'tile-cell';
  cell.innerHTML = '<div class="tile-cell-label">' + label + '</div>';

  if (pv && pv.rgba) {
    const canvas = document.createElement('canvas');
    canvas.width = pv.w;
    canvas.height = pv.h;
    const ctx = canvas.getContext('2d');
    try {
      const bytes = atob(pv.rgba);
      const arr = new Uint8ClampedArray(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      ctx.putImageData(new ImageData(arr, pv.w, pv.h), 0, 0);
    } catch (e) {
      cell.innerHTML += '<div class="tile-nopv">error preview</div>';
    }
    cell.appendChild(canvas);
  } else {
    cell.innerHTML += '<div class="tile-nopv">sin preview<br><small>formato no decodificable</small></div>';
  }
  return cell;
}

els.btnBack.addEventListener('click', () => {
  els.phaseResult.classList.remove('active');
  els.phaseUpload.classList.add('active');
});

els.btnDownload.addEventListener('click', () => {
  if (!result) return;

  if (result.type === 'rsc7') {
    showToast('Este formato solo admite análisis técnico (sin descarga)', 'err');
    return;
  }

  if (result.type === 'ytd' || result.type === 'zip') {
    const bytes = base64ToArrayBuffer(result.optimizedFile);
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    downloadBlob(blob, result.optimizedName);
  } else {
    const blob = new Blob([result.optimizedContent], { type: 'application/xml' });
    downloadBlob(blob, result.optimizedName);
  }
  showToast('Descargando ' + result.optimizedName, 'ok');
});

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

els.btnCopy.addEventListener('click', async () => {
  if (!result) return;
  try {
    await navigator.clipboard.writeText(result.optimizedContent);
    showToast('XML copiado al portapapeles', 'ok');
  } catch {
    showToast('No se pudo copiar', 'err');
  }
});

// Slider de calidad: actualiza etiqueta en vivo, re-optimiza al soltar
els.qSlider.addEventListener('input', () => {
  els.qSliderVal.textContent = els.qSlider.value + '%';
});
els.qSlider.addEventListener('change', () => {
  if (result && result.type === 'ytd') optimizeYtdNow();
});

// Tabs del preview
document.querySelectorAll('.preview-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.preview-tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.code').forEach((c) => c.classList.remove('active'));
    tab.classList.add('active');
    $(tab.dataset.target).classList.add('active');
  });
});

/* ---------------- MySQL health + historial ---------------- */

async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    els.dbStatus.className = 'status-chip ' + (data.db ? 'online' : 'offline');
    els.dbStatus.querySelector('.status-label').textContent = data.db
      ? 'MySQL: conectado'
      : 'MySQL: sin conexión';
    if (data.db) loadHistory();
  } catch {
    els.dbStatus.className = 'status-chip offline';
    els.dbStatus.querySelector('.status-label').textContent = 'Servidor no disponible';
  }
}

async function loadHistory() {
  try {
    const res = await fetch('/api/history?limit=12');
    const data = await res.json();
    if (!data.ok) return;

    if (!data.items.length) {
      els.historyList.innerHTML = '<div class="history-empty">Aún no hay optimizaciones guardadas.</div>';
      return;
    }

    els.historyList.innerHTML = '';
    data.items.forEach((it) => {
      const div = document.createElement('div');
      div.className = 'history-item';
      const date = new Date(it.created_at).toLocaleString('es');
      div.innerHTML =
        '<div>' +
          '<div class="hi-name">' + escapeHtml(it.original_name) + '</div>' +
          '<div class="hi-sub">' + it.file_type + ' · ' + formatBytes(it.original_size) + ' → ' + formatBytes(it.optimized_size) + ' · ' + date + '</div>' +
        '</div>' +
        '<div class="hi-save">−' + it.savings_pct.toFixed(1) + '%</div>';
      els.historyList.appendChild(div);
    });
  } catch {
    /* silencioso */
  }
}

/* ---------------- Init ---------------- */

checkHealth();
