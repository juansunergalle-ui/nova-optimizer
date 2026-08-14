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
  toast: $('toast'),
};

let currentFile = null;
let result = null;
let originalContent = '';

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
  const okExt = /\.(xml|meta|ytyp|ymt|txt)$/i;
  if (!okExt.test(file.name)) {
    showToast('Formato no soportado. Usa .xml, .meta, .ytyp o .ymt', 'err');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    currentFile = file;
    originalContent = e.target.result;
    els.fileName.textContent = file.name;
    els.fileSize.textContent = formatBytes(file.size);
    els.filePreview.hidden = false;
    els.dropzone.querySelector('.dropzone-inner').style.display = 'none';

    els.statNodes.textContent = countXmlNodes(originalContent).toLocaleString('es');
    els.statSize.textContent = formatBytes(file.size);
    els.statType.textContent = detectType(file.name, originalContent);

    showToast('Archivo cargado correctamente', 'ok');
  };
  reader.readAsText(file);
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

els.btnOptimize.addEventListener('click', async () => {
  if (!currentFile) return;

  const form = new FormData();
  form.append('file', currentFile);
  form.append('keepDeclaration', 'true');
  form.append('trimDecimals', 'true');

  setBtnLoading(els.btnOptimize, true, 'OPTIMIZANDO');

  try {
    const res = await fetch('/api/optimize', { method: 'POST', body: form });
    const data = await res.json();

    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Error al optimizar');
    }

    result = data;
    showResult();
    loadHistory();
    showToast('Optimización completada', 'ok');
  } catch (err) {
    showToast(err.message, 'err');
  } finally {
    setBtnLoading(els.btnOptimize, false);
  }
});

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
  els.nodesOriginal.textContent = countXmlNodes(originalContent) + ' nodos';
  els.nodesOptimized.textContent = countXmlNodes(r.optimizedContent) + ' nodos';

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

  els.statComments.textContent = r.stats.comments_removed;
  els.statEmpties.textContent = r.stats.empties_removed;
  els.statDecimals.textContent = r.stats.decimals_trimmed;
  els.statElapsed.textContent = r.elapsedMs + ' ms';

  // Codigo
  $('tab-original').innerHTML = highlightXml(originalContent.slice(0, 200000));
  $('tab-optimized').innerHTML = highlightXml(r.optimizedContent.slice(0, 200000));
}

els.btnBack.addEventListener('click', () => {
  els.phaseResult.classList.remove('active');
  els.phaseUpload.classList.add('active');
});

els.btnDownload.addEventListener('click', () => {
  if (!result) return;
  const blob = new Blob([result.optimizedContent], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = result.optimizedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast('Descargando ' + result.optimizedName, 'ok');
});

els.btnCopy.addEventListener('click', async () => {
  if (!result) return;
  try {
    await navigator.clipboard.writeText(result.optimizedContent);
    showToast('XML copiado al portapapeles', 'ok');
  } catch {
    showToast('No se pudo copiar', 'err');
  }
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
