'use strict';

/* ============================================================
   NOVA OPTIMIZER — Lógica del frontend
   ============================================================ */

const $ = (id) => document.getElementById(id);

const els = {
  btnLogin: $('btnLogin'),
  btnLogout: $('btnLogout'),
  sideUser: $('sideUser'),
  sideProfile: $('sideProfile'),
  profCount: $('profCount'),
  profSaved: $('profSaved'),
  sideHistoryList: $('sideHistoryList'),
  dropzone: $('dropzone'),
  fileInput: $('fileInput'),
  filePreview: $('filePreview'),
  fileName: $('fileName'),
  fileSize: $('fileSize'),
  btnOptimize: $('btnOptimize'),
  phaseUpload: $('phase-upload'),
  phaseResult: $('phase-result'),
  btnBack: $('btnBack'),
  btnNew: $('btnNew'),
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
  sidebar: $('sidebar'),
  btnSidebarToggle: $('btnSidebarToggle'),
  progressPanel: $('progressPanel'),
  progressLabel: $('progressLabel'),
  progressPct: $('progressPct'),
  progressBar: $('progressBar'),
  progressSteps: $('progressSteps'),
};

let currentFile = null;
let currentBytes = null; // ArrayBuffer (para YTD)
let result = null;
let originalContent = '';
let isYtd = false;

/* ---------------- Utilidades ---------------- */

function formatBytes(bytes) {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes) || bytes < 0) return '—';
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

/* ---------------- Progreso de optimizacion (sidebar) ---------------- */

const PROGRESS_STEPS = {
  ytd: [
    { label: 'Archivo recibido', at: 0.05 },
    { label: 'Analizando estructura RSC7', at: 0.22 },
    { label: 'Optimizando texturas', at: 0.45 },
    { label: 'Generando archivo', at: 0.8 },
    { label: 'Completado', at: 1 },
  ],
  zip: [
    { label: 'Archivo recibido', at: 0.05 },
    { label: 'Descomprimiendo pack', at: 0.2 },
    { label: 'Optimizando texturas', at: 0.45 },
    { label: 'Re-encodificando ZIP', at: 0.75 },
    { label: 'Completado', at: 1 },
  ],
  xml: [
    { label: 'Archivo recibido', at: 0.1 },
    { label: 'Analizando documento', at: 0.3 },
    { label: 'Optimizando texto', at: 0.6 },
    { label: 'Completado', at: 1 },
  ],
  rsc7: [
    { label: 'Archivo recibido', at: 0.1 },
    { label: 'Descomprimiendo RSC7', at: 0.35 },
    { label: 'Analizando secciones', at: 0.7 },
    { label: 'Completado', at: 1 },
  ],
};

let _progressTimers = [];
let _progressRaf = null;

/** Estimación razonable del tiempo del servidor según tipo y calidad. */
function estimateProgress(type, quality) {
  const mb = currentFile ? currentFile.size / (1024 * 1024) : 0;
  if (type === 'ytd') return 600 + Math.max(0, 100 - (quality || 100)) * 40 + mb * 90;
  if (type === 'zip') return 1200 + Math.max(0, 100 - (quality || 100)) * 45 + mb * 120;
  if (type === 'rsc7') return 800 + mb * 60;
  return 500 + mb * 30;
}

function startProgress(type, opts) {
  const quality = opts && opts.quality !== undefined ? opts.quality : 100;
  const steps = PROGRESS_STEPS[type] || PROGRESS_STEPS.xml;
  const est = estimateProgress(type, quality);

  // limpiar estado previo
  _progressTimers.forEach(clearTimeout);
  _progressTimers = [];
  cancelAnimationFrame(_progressRaf);

  const panel = els.progressPanel;
  panel.classList.remove('done', 'err');
  els.sidebar.classList.add('open');

  els.progressSteps.innerHTML = steps.map((s, i) =>
    '<li data-step="' + i + '"><span class="p-dot"></span><span class="p-label">' + s.label + '</span></li>').join('');

  // activar pasos en el tiempo
  steps.forEach((s, i) => {
    if (s.at >= 1) return;
    _progressTimers.push(setTimeout(() => {
      // paso anterior -> done, este -> active
      if (i > 0) setStep(i - 1, 'done');
      setStep(i, 'active');
      els.progressLabel.textContent = s.label;
    }, est * s.at));
  });

  // barra + porcentaje animados
  const t0 = performance.now();
  const run = (now) => {
    const t = Math.min(1, (now - t0) / est);
    const v = Math.min(95, t * 95);
    els.progressBar.style.width = v + '%';
    els.progressPct.textContent = Math.round(v) + '%';
    if (t < 1) _progressRaf = requestAnimationFrame(run);
  };
  _progressRaf = requestAnimationFrame(run);

  // panel visible
  els.progressPanel.style.display = '';
  els.progressLabel.textContent = steps[0].label;
}

function setStep(i, state) {
  const li = els.progressSteps.querySelector('[data-step="' + i + '"]');
  if (!li) return;
  li.classList.remove('done', 'active', 'err');
  if (state) li.classList.add(state);
}

/* Anima el contador de % de ahorro (y el anillo conic-gradient). */
function animateCountUp(el, ringEl, target) {
  const t0 = performance.now();
  const dur = 900;
  const step = (now) => {
    const t = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    const v = target * eased;
    el.textContent = v.toFixed(1) + '%';
    if (ringEl) ringEl.style.setProperty('--pct', v.toFixed(1));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function finishProgress(ok) {
  _progressTimers.forEach(clearTimeout);
  _progressTimers = [];
  cancelAnimationFrame(_progressRaf);

  const panel = els.progressPanel;
  if (ok) {
    els.progressSteps.querySelectorAll('li').forEach((li) => li.classList.remove('active'));
    els.progressSteps.querySelectorAll('li').forEach((li) => li.classList.add('done'));
    els.progressBar.style.width = '100%';
    els.progressPct.textContent = '100%';
    els.progressLabel.textContent = 'Completado';
    panel.classList.add('done');
  } else {
    els.progressSteps.querySelector('li.active')?.classList.add('err');
    els.progressLabel.textContent = 'Error';
    panel.classList.add('err');
  }
}

// Toggle del sidebar (móvil / colapsable)
els.btnSidebarToggle.addEventListener('click', () => {
  els.sidebar.classList.toggle('open');
});
const sidebarOverlay = document.getElementById('sidebarOverlay');
if (sidebarOverlay) {
  sidebarOverlay.addEventListener('click', () => els.sidebar.classList.remove('open'));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') els.sidebar.classList.remove('open');
  });
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
  startProgress('xml');
  try {
    const res = await fetch('/api/optimize', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Error al optimizar');
    result = data;
    finishProgress(true);
    showResult();
    loadHistory();
    showToast('Optimización completada', 'ok');
  } catch (err) {
    finishProgress(false);
    showToast(err.message, 'err');
  } finally {
    setBtnLoading(els.btnOptimize, false);
  }
}

async function optimizeYtdNow() {
  if (!currentBytes) return;

  const quality = Number(els.qSlider.value) || 100;
  const form = new FormData();
  form.append('file', new File([currentBytes], currentFile.name));
  form.append('quality', String(quality));
  form.append('stripMips', 'true');

  setBtnLoading(els.btnOptimize, true, 'OPTIMIZANDO');
  startProgress('ytd', { quality });
  try {
    const res = await fetch('/api/optimize-ytd', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Error al optimizar YTD');
    result = data;
    finishProgress(true);
    showResult();
    loadHistory();
    showToast('Optimización completada (' + data.quality + '% calidad)', 'ok');
  } catch (err) {
    finishProgress(false);
    showToast(err.message, 'err');
  } finally {
    setBtnLoading(els.btnOptimize, false);
  }
}

async function optimizeZipNow() {
  if (!currentBytes) return;

  const quality = Number(els.qSlider.value) || 100;
  const form = new FormData();
  form.append('file', new File([currentBytes], currentFile.name));
  form.append('quality', String(quality));

  setBtnLoading(els.btnOptimize, true, 'OPTIMIZANDO');
  startProgress('zip', { quality });
  try {
    const res = await fetch('/api/optimize-zip', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Error al optimizar ZIP');
    result = data;
    finishProgress(true);
    showResult();
    loadHistory();
    showToast('Pack optimizado (' + data.quality + '% calidad)', 'ok');
  } catch (err) {
    finishProgress(false);
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
  startProgress('rsc7');
  try {
    const res = await fetch('/api/analyze', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Error al analizar');
    result = data;
    finishProgress(true);
    showResult();
    showToast('Análisis técnico completado', 'ok');
  } catch (err) {
    finishProgress(false);
    showToast(err.message, 'err');
  } finally {
    setBtnLoading(els.btnOptimize, false);
  }
}

/* ---------------- Mostrar resultado ---------------- */

function showResult() {
  const r = result;
  const oSize = r.originalSize != null ? r.originalSize : 0;
  const nSize = r.optimizedSize != null ? r.optimizedSize : null;
  const pct = r.savingsPct != null ? r.savingsPct : 0;

  els.phaseUpload.classList.remove('active');
  els.phaseResult.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  els.resultType.textContent = r.type;

  els.sizeOriginal.textContent = formatBytes(oSize);
  els.sizeOptimized.textContent = nSize != null ? formatBytes(nSize) : '—';

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
  const max = Math.max(oSize, nSize || 0, 1);
  els.barOriginal.style.width = (oSize / max) * 100 + '%';
  setTimeout(() => {
    els.barOptimized.style.width = (nSize != null ? (nSize / max) * 100 : 0) + '%';
  }, 150);

  // Anillo de ahorro (con count-up animado)
  const ringPct = Math.max(0, Math.min(pct, 100));
  if (nSize != null) {
    animateCountUp(els.savingsPct, els.savingsRing, ringPct);
    els.savingsBytes.textContent = formatBytes(Math.max(r.savingsBytes, 0));
    els.savingsBytes.classList.add('ok');
  } else {
    els.savingsPct.textContent = '—';
    els.savingsRing.style.setProperty('--pct', '0');
    els.savingsBytes.textContent = '—';
  }

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
    tile.style.animationDelay = (i * 45) + 'ms';

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
    .map((e, i) => {
      const saved = e.sizeAfter < e.sizeBefore;
      return '<div class="zip-row" style="animation-delay:' + (i * 45) + 'ms">' +
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

els.btnBack.addEventListener('click', resetUpload);
els.btnNew.addEventListener('click', resetUpload);

// Vuelve a la fase de subida con el estado limpio para optimizar otro archivo
// sin recargar la página.
function resetUpload() {
  currentFile = null;
  currentBytes = null;
  originalContent = null;
  result = null;
  isYtd = false;
  els.fileInput.value = '';
  els.filePreview.hidden = true;
  els.dropzone.querySelector('.dropzone-inner').style.display = '';
  els.statNodes.textContent = '—';
  els.statSize.textContent = '—';
  els.statType.textContent = '—';
  els.phaseResult.classList.remove('active');
  els.phaseUpload.classList.add('active');
  els.sidebar.classList.remove('open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

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

/* ---------------- Autenticación (Google OAuth) ---------------- */

async function initAuth() {
  try {
    const res = await fetch('/api/me');
    const data = await res.json();
    els.btnLogin.dataset.configured = data.configured ? '1' : '0';
    renderUser(data.user || null);
  } catch {
    els.btnLogin.dataset.configured = '0';
    renderUser(null);
  }
  loadHistory();
}

let loggedIn = false;

function renderUser(user) {
  loggedIn = !!(user && user.email);
  els.btnLogin.hidden = loggedIn;
  els.btnLogout.hidden = !loggedIn;
  els.sideProfile.hidden = !loggedIn;

  if (loggedIn) {
    els.sideUser.innerHTML =
      '<div class="side-user-name">' + escapeHtml(user.name || '') + '</div>' +
      '<div class="side-user-email">' + escapeHtml(user.email) + '</div>';
  } else {
    els.sideUser.innerHTML = '<span>Sin sesión iniciada</span>';
    els.sideHistoryList.innerHTML = '';
  }
}

els.btnLogin.addEventListener('click', () => {
  if (els.btnLogin.dataset.configured === '0') {
    showToast('Login no configurado', 'El administrador debe agregar GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el servidor.', true);
    return;
  }
  window.location.href = '/auth/google';
});

els.btnLogout.addEventListener('click', async () => {
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch { /* silencioso */ }
  window.location.reload();
});

async function loadHistory() {
  try {
    const res = await fetch('/api/history?limit=100');
    const data = await res.json();
    if (!data.ok) return;
    const items = data.items || [];

    // Perfil del usuario (sidebar): total + último registro
    if (loggedIn) {
      let totalSaved = 0;
      items.forEach((it) => { totalSaved += (it.savings_bytes || 0); });
      els.profCount.textContent = items.length;
      els.profSaved.textContent = formatBytes(totalSaved);

      if (!items.length) {
        els.sideHistoryList.innerHTML = '<div class="side-history-empty">Aún no optimizaste nada.</div>';
      } else {
        els.sideHistoryList.innerHTML = items.slice(0, 5).map((it) => {
          const date = new Date(it.created_at).toLocaleString('es');
          return '<div class="side-history-item">' +
            '<div class="sh-main">' +
              '<div class="sh-name" title="' + escapeHtml(it.original_name) + '">' + escapeHtml(it.original_name) + '</div>' +
              '<div class="sh-sub">' + it.file_type + ' · ' + date + '</div>' +
            '</div>' +
            '<div class="sh-save">−' + it.savings_pct.toFixed(1) + '%</div>' +
          '</div>';
        }).join('');
      }
    }

    // Historial principal
    if (!items.length) {
      els.historyList.innerHTML = loggedIn
        ? '<div class="history-empty">Aún no optimizaste ningún archivo. Todo lo que optimices se guarda en tu perfil.</div>'
        : '<div class="history-empty">Inicia sesión para guardar y ver tu historial de optimizaciones.</div>';
      return;
    }

    els.historyList.innerHTML = '';
    items.slice(0, 12).forEach((it) => {
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

initAuth();
