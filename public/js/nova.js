'use strict';

/* ============================================================
   NOVA OPTIMIZER — Lógica del frontend
   ============================================================ */

const $ = (id) => document.getElementById(id);

const els = {
  btnLogin: $('btnLogin'),
  profileMenu: $('profileMenu'),
  btnProfile: $('btnProfile'),
  profileInitial: $('profileInitial'),
  profileName: $('profileName'),
  profileDropdown: $('profileDropdown'),
  pdInitial: $('pdInitial'),
  pdName: $('pdName'),
  pdEmail: $('pdEmail'),
  pdLogout: $('pdLogout'),
  themeSeg: $('themeSeg'),
  langSeg: $('langSeg'),
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

/* ---------------- i18n (Español / English) ---------------- */

const I18N = {
  es: {
    login: 'Iniciar sesión',
    logout: 'Cerrar sesión',
    appearance: 'Apariencia',
    theme: 'Tema',
    themeDark: 'Oscuro',
    themeLight: 'Claro',
    language: 'Idioma',
    tagline: 'FiveM Asset Compression Engine',
    introTitle: 'Comprime tus assets de FiveM',
    introDesc: 'Sube <code>.ytd</code>, <code>.ydd</code>, <code>.yft</code>, <code>.ydr</code>, <code>.xml</code>, <code>.meta</code> o un <code>.zip</code> completo. Compara la calidad antes/después y descarga la versión optimizada lista para tu servidor.',
    dropTitle: 'Arrastra tu archivo aquí',
    dropSub: 'o haz clic para seleccionarlo',
    optimize: 'OPTIMIZAR',
    statNodes: 'Nodos XML',
    statWeight: 'Peso',
    statType: 'Tipo',
    myHistory: 'Tu historial',
    saved: 'Guardado',
    fmtYtd: 'Texturas',
    fmtYtdDesc: 'Optimización real · comparador de calidad',
    fmtYdd: 'Ropa / drawables',
    fmtYddDesc: 'Análisis técnico · texturas del pack',
    fmtYft: 'Fragmentos / vehículos',
    fmtYftDesc: 'Análisis técnico · texturas del pack',
    fmtYdr: 'Props estáticos',
    fmtYdrDesc: 'Análisis técnico · texturas del pack',
    fmtXml: 'Meta / ytyp / ymt',
    fmtXmlDesc: 'Optimización real de texto',
    fmtZip: 'Paquete completo',
    fmtZipDesc: 'Optimiza todas las texturas .ytd del pack',
    back: 'Volver',
    resultTitle: 'Optimización completada',
    original: 'ORIGINAL',
    optimized: 'OPTIMIZADO',
    originalShort: 'Original',
    optimizedShort: 'Optimizada',
    savedLabel: 'ahorrado',
    savTotal: 'Ahorro total',
    savComments: 'Comentarios eliminados',
    savEmpties: 'Nodos vacíos eliminados',
    savDecimals: 'Decimales recortados',
    savTime: 'Tiempo de proceso',
    download: 'DESCARGAR OPTIMIZADO',
    copy: 'Copiar XML',
    newFile: 'Optimizar otro archivo',
    qualityTitle: 'Comparador de calidad de texturas',
    qualityGlobal: 'Calidad global',
    process: 'PROCESO',
    profile: 'PERFIL',
    noSession: 'Sin sesión iniciada',
    optimizations: 'optimizaciones',
    savedShort: 'ahorrados',
    yourRecord: 'TU REGISTRO',
    footer: 'NOVA OPTIMIZER · Motor de compresión para assets de FiveM · Los archivos se procesan en tu servidor',
    waiting: 'En espera',
    done: 'Completado',
    error: 'Error',
    optimizing: 'OPTIMIZANDO',
    analyzing: 'ANALIZANDO',
    processing: 'PROCESANDO',
    loadedOk: 'Archivo cargado correctamente',
    badFormat: 'Formato no soportado. Usa .ytd, .xml, .meta, .zip, .ydd, .yft o .ydr',
    optDone: 'Optimización completada',
    optDoneYtd: 'Optimización completada ({q}% calidad)',
    packDone: 'Pack optimizado ({q}% calidad)',
    analyzeDone: 'Análisis técnico completado',
    copied: 'XML copiado al portapapeles',
    copyFail: 'No se pudo copiar',
    downloading: 'Descargando {name}',
    analyzeOnly: 'Este formato solo admite análisis técnico (sin descarga)',
    loginNotConfigured: 'Login no configurado',
    loginNotConfiguredSub: 'El administrador debe agregar GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el servidor.',
    texCount: '{n} texturas',
    ytdCount: '{n} .ytd',
    nodeCount: '{n} nodos',
    noPreview: 'Sin texturas con preview.',
    loadingTex: 'Cargando texturas…',
    previewErr: 'error preview',
    noPreviewShort: 'sin preview',
    undecodable: 'formato no decodificable',
    before: 'Antes',
    after: 'Después',
    texFound: 'Texturas encontradas',
    fileType: 'Tipo de archivo',
    rscVersion: 'Versión RSC7',
    compressed: 'Comprimido',
    yes: 'Sí',
    no: 'No',
    compRatio: 'Sí ({p}%)',
    sysSection: 'Sección system',
    gfxSection: 'Sección graphics',
    decompSize: 'Tamaño descomprimido',
    hasTexDict: 'TextureDictionary',
    analyzeNote: 'Este formato (.ydd/.yft/.ydr) no puede reescribirse sin un motor de mallas. La optimización real está disponible para .ytd (texturas) y .xml/.meta.',
    histEmptyLogged: 'Aún no optimizaste ningún archivo. Todo lo que optimices se guarda en tu perfil.',
    histEmptyAnon: 'Inicia sesión para guardar y ver tu historial de optimizaciones.',
    histSideEmpty: 'Aún no optimizaste nada.',
    prog: {
      fileReceived: 'Archivo recibido',
      analyzeRsc7: 'Analizando estructura RSC7',
      optTextures: 'Optimizando texturas',
      genFile: 'Generando archivo',
      done: 'Completado',
      unzip: 'Descomprimiendo pack',
      rezip: 'Re-encodificando ZIP',
      analyzeDoc: 'Analizando documento',
      optText: 'Optimizando texto',
      decompress: 'Descomprimiendo RSC7',
      analyzeSections: 'Analizando secciones',
    },
  },
  en: {
    login: 'Sign in',
    logout: 'Sign out',
    appearance: 'Appearance',
    theme: 'Theme',
    themeDark: 'Dark',
    themeLight: 'Light',
    language: 'Language',
    tagline: 'FiveM Asset Compression Engine',
    introTitle: 'Compress your FiveM assets',
    introDesc: 'Upload a <code>.ytd</code>, <code>.ydd</code>, <code>.yft</code>, <code>.ydr</code>, <code>.xml</code>, <code>.meta</code> or a full <code>.zip</code>. Compare before/after quality and download the optimized version ready for your server.',
    dropTitle: 'Drag your file here',
    dropSub: 'or click to select it',
    optimize: 'OPTIMIZE',
    statNodes: 'XML Nodes',
    statWeight: 'Weight',
    statType: 'Type',
    myHistory: 'Your history',
    saved: 'Saved',
    fmtYtd: 'Textures',
    fmtYtdDesc: 'Real optimization · quality comparator',
    fmtYdd: 'Clothing / drawables',
    fmtYddDesc: 'Technical analysis · pack textures',
    fmtYft: 'Fragments / vehicles',
    fmtYftDesc: 'Technical analysis · pack textures',
    fmtYdr: 'Static props',
    fmtYdrDesc: 'Technical analysis · pack textures',
    fmtXml: 'Meta / ytyp / ymt',
    fmtXmlDesc: 'Real text optimization',
    fmtZip: 'Full package',
    fmtZipDesc: 'Optimizes every .ytd texture in the pack',
    back: 'Back',
    resultTitle: 'Optimization complete',
    original: 'ORIGINAL',
    optimized: 'OPTIMIZED',
    originalShort: 'Original',
    optimizedShort: 'Optimized',
    savedLabel: 'saved',
    savTotal: 'Total savings',
    savComments: 'Comments removed',
    savEmpties: 'Empty nodes removed',
    savDecimals: 'Decimals trimmed',
    savTime: 'Process time',
    download: 'DOWNLOAD OPTIMIZED',
    copy: 'Copy XML',
    newFile: 'Optimize another file',
    qualityTitle: 'Texture quality comparator',
    qualityGlobal: 'Global quality',
    process: 'PROCESS',
    profile: 'PROFILE',
    noSession: 'No session started',
    optimizations: 'optimizations',
    savedShort: 'saved',
    yourRecord: 'YOUR RECORD',
    footer: 'NOVA OPTIMIZER · Compression engine for FiveM assets · Files are processed on your server',
    waiting: 'Idle',
    done: 'Complete',
    error: 'Error',
    optimizing: 'OPTIMIZING',
    analyzing: 'ANALYZING',
    processing: 'PROCESSING',
    loadedOk: 'File loaded successfully',
    badFormat: 'Unsupported format. Use .ytd, .xml, .meta, .zip, .ydd, .yft or .ydr',
    optDone: 'Optimization complete',
    optDoneYtd: 'Optimization complete ({q}% quality)',
    packDone: 'Pack optimized ({q}% quality)',
    analyzeDone: 'Technical analysis complete',
    copied: 'XML copied to clipboard',
    copyFail: 'Could not copy',
    downloading: 'Downloading {name}',
    analyzeOnly: 'This format only supports technical analysis (no download)',
    loginNotConfigured: 'Login not configured',
    loginNotConfiguredSub: 'The admin must add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server.',
    texCount: '{n} textures',
    ytdCount: '{n} .ytd',
    nodeCount: '{n} nodes',
    noPreview: 'No textures with preview.',
    loadingTex: 'Loading textures…',
    previewErr: 'preview error',
    noPreviewShort: 'no preview',
    undecodable: 'format not decodable',
    before: 'Before',
    after: 'After',
    texFound: 'Textures found',
    fileType: 'File type',
    rscVersion: 'RSC7 version',
    compressed: 'Compressed',
    yes: 'Yes',
    no: 'No',
    compRatio: 'Yes ({p}%)',
    sysSection: 'system section',
    gfxSection: 'graphics section',
    decompSize: 'Uncompressed size',
    hasTexDict: 'TextureDictionary',
    analyzeNote: 'This format (.ydd/.yft/.ydr) cannot be rewritten without a mesh engine. Real optimization is available for .ytd (textures) and .xml/.meta.',
    histEmptyLogged: "You haven't optimized any file yet. Everything you optimize is saved to your profile.",
    histEmptyAnon: 'Sign in to save and view your optimization history.',
    histSideEmpty: "You haven't optimized anything yet.",
    prog: {
      fileReceived: 'File received',
      analyzeRsc7: 'Analyzing RSC7 structure',
      optTextures: 'Optimizing textures',
      genFile: 'Generating file',
      done: 'Complete',
      unzip: 'Unpacking package',
      rezip: 'Re-encoding ZIP',
      analyzeDoc: 'Analyzing document',
      optText: 'Optimizing text',
      decompress: 'Decompressing RSC7',
      analyzeSections: 'Analyzing sections',
    },
  },
};

let lang = 'es';
let theme = 'dark';
let loggedIn = false;

function t(key, vars) {
  const dict = (I18N[lang] || I18N.es);
  let s = key.split('.').reduce((o, k) => (o ? o[k] : undefined), dict);
  if (s === undefined) s = key.split('.').reduce((o, k) => (o ? o[k] : undefined), I18N.es);
  if (s === undefined) s = key;
  if (vars) Object.keys(vars).forEach((k) => { s = s.split('{' + k + '}').join(vars[k]); });
  return s;
}

function applyI18n() {
  document.documentElement.lang = lang === 'en' ? 'en' : 'es';
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const k = el.dataset.i18n;
    const txt = t(k);
    if (txt !== k) el.innerHTML = txt;
  });
}

function initLang() {
  lang = localStorage.getItem('nova-lang') || (navigator.language || 'es').toLowerCase().indexOf('en') === 0 ? 'en' : 'es';
  if (lang !== 'es' && lang !== 'en') lang = 'es';
  syncLangSeg();
  applyI18n();
}

function setLang(l) {
  if (l !== 'es' && l !== 'en') return;
  lang = l;
  try { localStorage.setItem('nova-lang', l); } catch (e) { /* silencioso */ }
  syncLangSeg();
  applyI18n();
  if (loggedIn) loadHistory();
}

function syncLangSeg() {
  els.langSeg.querySelectorAll('.pd-seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.lang === lang);
  });
}

function applyTheme(th) {
  theme = th === 'light' ? 'light' : 'dark';
  document.documentElement.classList.toggle('theme-light', theme === 'light');
  try { localStorage.setItem('nova-theme', theme); } catch (e) { /* silencioso */ }
  els.themeSeg.querySelectorAll('.pd-seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.theme === theme);
  });
}

function initTheme() {
  theme = localStorage.getItem('nova-theme') === 'light' ? 'light' : 'dark';
  applyTheme(theme);
}

/* ---------------- Menú de perfil ---------------- */

function openDropdown() {
  els.profileDropdown.hidden = false;
  els.btnProfile.classList.add('open');
}
function closeDropdown() {
  els.profileDropdown.hidden = true;
  els.btnProfile.classList.remove('open');
}
function toggleDropdown() {
  els.profileDropdown.hidden ? openDropdown() : closeDropdown();
}
els.btnProfile.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleDropdown();
});
document.addEventListener('click', (e) => {
  if (!els.profileDropdown.hidden && !els.profileMenu.contains(e.target)) closeDropdown();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDropdown();
});
els.themeSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.pd-seg-btn');
  if (btn && btn.dataset.theme) applyTheme(btn.dataset.theme);
});
els.langSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('.pd-seg-btn');
  if (btn && btn.dataset.lang) setLang(btn.dataset.lang);
});

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
    btn.innerHTML = '<span class="spinner"></span> ' + (label || t('processing'));
  } else {
    btn.disabled = false;
    if (btn.dataset.html) btn.innerHTML = btn.dataset.html;
  }
}

/* ---------------- Progreso de optimizacion (sidebar) ---------------- */

const PROGRESS_STEPS = {
  ytd: [
    { k: 'prog.fileReceived', at: 0.05 },
    { k: 'prog.analyzeRsc7', at: 0.22 },
    { k: 'prog.optTextures', at: 0.45 },
    { k: 'prog.genFile', at: 0.8 },
    { k: 'prog.done', at: 1 },
  ],
  zip: [
    { k: 'prog.fileReceived', at: 0.05 },
    { k: 'prog.unzip', at: 0.2 },
    { k: 'prog.optTextures', at: 0.45 },
    { k: 'prog.rezip', at: 0.75 },
    { k: 'prog.done', at: 1 },
  ],
  xml: [
    { k: 'prog.fileReceived', at: 0.1 },
    { k: 'prog.analyzeDoc', at: 0.3 },
    { k: 'prog.optText', at: 0.6 },
    { k: 'prog.done', at: 1 },
  ],
  rsc7: [
    { k: 'prog.fileReceived', at: 0.1 },
    { k: 'prog.decompress', at: 0.35 },
    { k: 'prog.analyzeSections', at: 0.7 },
    { k: 'prog.done', at: 1 },
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
    '<li data-step="' + i + '"><span class="p-dot"></span><span class="p-label">' + t(s.k) + '</span></li>').join('');

  // activar pasos en el tiempo
  steps.forEach((s, i) => {
    if (s.at >= 1) return;
    _progressTimers.push(setTimeout(() => {
      // paso anterior -> done, este -> active
      if (i > 0) setStep(i - 1, 'done');
      setStep(i, 'active');
      els.progressLabel.textContent = t(s.k);
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
  els.progressLabel.textContent = t(steps[0].k);
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
    els.progressLabel.textContent = t('done');
    panel.classList.add('done');
  } else {
    els.progressSteps.querySelector('li.active')?.classList.add('err');
    els.progressLabel.textContent = t('error');
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
    showToast(t('badFormat'), 'err');
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
      els.statNodes.textContent = countXmlNodes(originalContent).toLocaleString(lang === 'en' ? 'en' : 'es');
      els.statSize.textContent = formatBytes(file.size);
      els.statType.textContent = detectType(file.name, originalContent);
      showToast(t('loadedOk'), 'ok');
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
    showToast(t('loadedOk'), 'ok');
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

  setBtnLoading(els.btnOptimize, true, t('optimizing'));
  startProgress('xml');
  try {
    const res = await fetch('/api/optimize', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Error al optimizar');
    result = data;
    finishProgress(true);
    showResult();
    loadHistory();
    showToast(t('optDone'), 'ok');
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

  setBtnLoading(els.btnOptimize, true, t('optimizing'));
  startProgress('ytd', { quality });
  try {
    const res = await fetch('/api/optimize-ytd', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Error al optimizar YTD');
    result = data;
    finishProgress(true);
    showResult();
    loadHistory();
    showToast(t('optDoneYtd', { q: data.quality }), 'ok');
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

  setBtnLoading(els.btnOptimize, true, t('optimizing'));
  startProgress('zip', { quality });
  try {
    const res = await fetch('/api/optimize-zip', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Error al optimizar ZIP');
    result = data;
    finishProgress(true);
    showResult();
    loadHistory();
    showToast(t('packDone', { q: data.quality }), 'ok');
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

  setBtnLoading(els.btnOptimize, true, t('analyzing'));
  startProgress('rsc7');
  try {
    const res = await fetch('/api/analyze', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Error al analizar');
    result = data;
    finishProgress(true);
    showResult();
    showToast(t('analyzeDone'), 'ok');
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
    els.nodesOriginal.textContent = t('texCount', { n: r.textures.length });
    els.nodesOptimized.textContent = t('texCount', { n: r.textures.length });
    els.preview.style.display = 'none';
    renderTextureGrid();
  } else if (r.type === 'zip') {
    els.nodesOriginal.textContent = t('ytdCount', { n: r.entries.length });
    els.nodesOptimized.textContent = t('ytdCount', { n: r.entries.length });
    els.preview.style.display = 'none';
    renderZipList();
  } else if (r.type === 'rsc7') {
    els.nodesOriginal.textContent = t('texCount', { n: r.textures ? r.textures.length : 0 });
    els.nodesOptimized.textContent = '—';
    els.preview.style.display = 'none';
    renderAnalyzeInfo();
  } else {
    els.nodesOriginal.textContent = t('nodeCount', { n: countXmlNodes(originalContent) });
    els.nodesOptimized.textContent = t('nodeCount', { n: countXmlNodes(r.optimizedContent) });
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
    grid.innerHTML = '<div class="tile-placeholder">' + t('noPreview') + '</div>';
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
    imgs.appendChild(buildPreview(t('before'), p.before));
    imgs.appendChild(buildPreview(t('after'), p.after));

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
    [t('fileType'), r.originalName],
    [t('rscVersion'), 'v' + r.version],
    [t('compressed'), r.isCompressed ? t('compRatio', { p: r.compressedRatio }) : t('no')],
    [t('sysSection'), formatBytes(r.sysSize)],
    [t('gfxSection'), formatBytes(r.gfxSize)],
    [t('decompSize'), formatBytes(r.originalSize)],
    [t('hasTexDict'), r.hasTextureDict ? t('yes') : t('no')],
  ];
  box.innerHTML = rows.map(([k, v]) =>
    '<div class="an-row"><span>' + k + '</span><strong>' + escapeHtml(String(v)) + '</strong></div>').join('');

  if (r.textures && r.textures.length) {
    const sub = document.createElement('div');
    sub.className = 'analyze-textures';
    sub.innerHTML = '<div class="an-title">' + t('texFound') + '</div>' +
      r.textures.map((tex) =>
        '<div class="an-tex">' + escapeHtml(tex.name) +
        ' <span>' + tex.width + 'x' + tex.height + ' · ' + escapeHtml(tex.formatName) +
        ' · ' + formatBytes(tex.pixelSize) + '</span></div>').join('');
    box.appendChild(sub);
  }

  box.innerHTML += '<div class="an-note">' + t('analyzeNote') + '</div>';
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
      cell.innerHTML += '<div class="tile-nopv">' + t('previewErr') + '</div>';
    }
    cell.appendChild(canvas);
  } else {
    cell.innerHTML += '<div class="tile-nopv">' + t('noPreviewShort') + '<br><small>' + t('undecodable') + '</small></div>';
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
    showToast(t('analyzeOnly'), 'err');
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
  showToast(t('downloading', { name: result.optimizedName }), 'ok');
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
    showToast(t('copied'), 'ok');
  } catch {
    showToast(t('copyFail'), 'err');
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

function renderUser(user) {
  loggedIn = !!(user && user.email);
  els.btnLogin.hidden = loggedIn;
  els.btnProfile.hidden = !loggedIn;
  els.sideProfile.hidden = !loggedIn;

  if (loggedIn) {
    const name = user.name || user.email || '';
    const initial = (name.trim()[0] || '?').toUpperCase();
    els.profileInitial.textContent = initial;
    els.profileName.textContent = name.split(/\s+/)[0] || name;
    els.pdInitial.textContent = initial;
    els.pdName.textContent = name;
    els.pdEmail.textContent = user.email || '';
    els.sideUser.innerHTML =
      '<div class="side-user-name">' + escapeHtml(name) + '</div>' +
      '<div class="side-user-email">' + escapeHtml(user.email || '') + '</div>';
  } else {
    closeDropdown();
    els.sideUser.innerHTML = '<span>' + t('noSession') + '</span>';
    els.sideHistoryList.innerHTML = '';
  }
}

els.btnLogin.addEventListener('click', () => {
  if (els.btnLogin.dataset.configured === '0') {
    showToast(t('loginNotConfigured'), t('loginNotConfiguredSub'), true);
    return;
  }
  window.location.href = '/auth/google';
});

els.pdLogout.addEventListener('click', async () => {
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
        els.sideHistoryList.innerHTML = '<div class="side-history-empty">' + t('histSideEmpty') + '</div>';
      } else {
        els.sideHistoryList.innerHTML = items.slice(0, 5).map((it) => {
          const date = new Date(it.created_at).toLocaleString(lang === 'en' ? 'en' : 'es');
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
        ? '<div class="history-empty">' + t('histEmptyLogged') + '</div>'
        : '<div class="history-empty">' + t('histEmptyAnon') + '</div>';
      return;
    }

    els.historyList.innerHTML = '';
    items.slice(0, 12).forEach((it) => {
      const div = document.createElement('div');
      div.className = 'history-item';
      const date = new Date(it.created_at).toLocaleString(lang === 'en' ? 'en' : 'es');
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

initLang();
initTheme();
initAuth();
