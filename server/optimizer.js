'use strict';

/**
 * NOVA OPTIMIZER - Motor de optimizacion XML de FiveM
 *
 * Optimiza archivos XML/META de addon props y clothing de FiveM:
 *  - .ytp.xml / .ytyp.xml  (arquetipos de props)
 *  - .ymt.xml / clothing meta (ShopPedApparel)
 *  - .meta generico (vehicles.meta, handling.meta, etc.)
 *
 * Estrategias aplicadas (todas seguras y reversibles):
 *  1. Eliminacion de comentarios XML
 *  2. Compactacion de espacios y lineas en blanco entre nodos
 *  3. Eliminacion de nodos vacios (sin contenido y sin hijos)
 *  4. Eliminacion de nodos <Item> vacios (tipicos de RAGE meta)
 *  5. Recorte de decimales en valores numericos de atributos y texto
 *  6. Normalizacion de fin de linea y codificacion
 */

// ---------------------------------------------------------------
// Utilidades de conteo
// ---------------------------------------------------------------

function countOccurrences(str, sub) {
  let n = 0;
  let idx = str.indexOf(sub);
  while (idx !== -1) {
    n++;
    idx = str.indexOf(sub, idx + sub.length);
  }
  return n;
}

// ---------------------------------------------------------------
// Paso 1: eliminar comentarios XML  <!-- ... -->
// ---------------------------------------------------------------

function stripComments(xml, stats) {
  let before = countOccurrences(xml, '<!--');
  // Eliminar comentarios, permitiendo que se eliminen de forma segura
  // sin tocar el contenido dentro de las etiquetas.
  let out = xml.replace(/<!--[\s\S]*?-->/g, function (m) {
    stats.comments_removed++;
    return '';
  });
  stats.comments_found = before;
  return out;
}

// ---------------------------------------------------------------
// Paso 2: detectar y eliminar nodos vacios
// Un nodo vacio puede ser:  <tag></tag>  o  <tag />
// ---------------------------------------------------------------

function stripEmptyNodes(xml, stats) {
  let result = xml;
  let changed = true;
  let passes = 0;

  // Solo eliminamos nodos SIN atributos y SIN contenido.
  // Los elementos con atributos (p.ej. <bbMin x=".." y=".." z=".."/>) contienen
  // datos y NUNCA deben eliminarse.

  // Iteramos hasta estabilizar porque eliminar un padre puede
  // volver vacio a su abuelo.
  while (changed && passes < 20) {
    changed = false;
    passes++;

    // <tag></tag>  -> eliminar (solo si no tiene atributos)
    const emptyPair = /<([a-zA-Z_][\w:.-]*)>(\s*)<\/\1>/g;
    result = result.replace(emptyPair, function (m, name) {
      changed = true;
      stats.empties_removed++;
      return '';
    });

    // <tag />  -> eliminar (solo si no tiene atributos)
    const selfClose = /<([a-zA-Z_][\w:.-]*)\s*\/>/g;
    result = result.replace(selfClose, function (m, name) {
      changed = true;
      stats.empties_removed++;
      return '';
    });
  }

  return result;
}

// ---------------------------------------------------------------
// Paso 3: recortar decimales en valores numericos
  // Convierte 1.123456789  ->  1.123457  (precision configurable)
// Aplica a atributos (value="..") y texto numerico directo.
// ---------------------------------------------------------------

function trimDecimals(xml, decimals, stats) {
  const factor = Math.pow(10, decimals);
  const fmt = function (n) {
    let r = Math.round(n * factor) / factor;
    // devolver sin ceros a la derecha
    return String(r);
  };

  // Atributos:  name="123.456789"  (solo floats)
  let out = xml.replace(/([A-Za-z_:][\w:.-]*=")(-?\d+\.\d+)(?=")/g, function (m, pre, num) {
    stats.decimals_trimmed++;
    return pre + fmt(parseFloat(num));
  });

  // Texto numerico dentro de etiquetas:  <value>1.23456789</value>
  out = out.replace(/>(-?\d+\.\d+)</g, function (m, num) {
    stats.decimals_trimmed++;
    return '>' + fmt(parseFloat(num)) + '<';
  });

  return out;
}

// ---------------------------------------------------------------
// Paso 5: compactar espacios entre etiquetas y normalizar lineas
// ---------------------------------------------------------------

function compactWhitespace(xml) {
  // Normalizar CRLF -> LF
  let out = xml.replace(/\r\n?/g, '\n');

  // Colapsar bloques de espacio/saltos entre '>' y '<'
  out = out.replace(/>(\s+)</g, function (m, ws) {
    // Solo colapsar si no hay texto significativo: entre tags es seguro
    return '><';
  });

  // Colapsar espacios multiples dentro del texto
  out = out.replace(/[ \t]{2,}/g, ' ');

  // Quitar lineas en blanco
  out = out.replace(/\n\s*\n/g, '\n');

  return out.trim();
}

// ---------------------------------------------------------------
// Clasificacion del tipo de archivo
// ---------------------------------------------------------------

function classifyType(name, content) {
  const ext = (name || '').toLowerCase();
  if (/\.ytyp\.xml$/.test(ext) || /\.ytp\.xml$/.test(ext)) return 'YTYP';
  if (/\.ymt\.xml$/.test(ext)) return 'YMT';
  if (/\.meta$/i.test(ext)) return 'META';
  if (/ShopPedApparel|pedOutfits|pedComponents/.test(content)) return 'CLOTHING';
  if (/CMapTypes|archetype|CBaseArchetypeDef|weaponArchetype/.test(content)) return 'YTYP';
  if (/handlingData|CLaunchData/.test(content)) return 'META';
  return 'XML';
}

// ---------------------------------------------------------------
// Optimizacion principal
// ---------------------------------------------------------------

/**
 * @param {Buffer} buffer
 * @param {object} options
 *   - keepDeclaration {boolean} mantener <?xml ...?>
 *   - trimDecimals {number}     digitos decimales (0 = desactivado)
 * @returns {{out:Buffer, stats:object, type:string}}
 */
function optimize(buffer, options = {}) {
  const t0 = Date.now();
  const keepDeclaration = options.keepDeclaration !== false;
  const decimals = typeof options.trimDecimals === 'number' ? options.trimDecimals : 6;

  let stats = {
    comments_removed: 0,
    comments_found: 0,
    empties_removed: 0,
    dups_removed: 0,
    decimals_trimmed: 0,
  };

  // Decodificar: preferir UTF-8; soporta BOM
  let text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  let hadBOM = /^\uFEFF/.test(buffer.toString('utf8'));
  const type = classifyType(options.filename || '', text);

  // Guardar declaracion XML para restaurarla al final
  let declaration = '';
  const declMatch = /^\s*<\?xml[\s\S]*?\?>/i.exec(text);
  if (declMatch) {
    declaration = declMatch[0];
    text = text.slice(declMatch.index + declMatch[0].length);
  }

  // --- Optimizaciones ---
  text = stripComments(text, stats);
  text = stripEmptyNodes(text, stats);
  if (decimals > 0) {
    text = trimDecimals(text, decimals, stats);
  }
  text = compactWhitespace(text);

  // Reensamblar
  let final = '';
  if (keepDeclaration && declaration) {
    final += declaration + '\n';
  }
  final += text;
  if (!final.endsWith('\n')) final += '\n';

  const optimized = Buffer.from(final, 'utf8');

  return {
    out: optimized,
    type,
    stats,
    hadBOM,
    elapsed_ms: Date.now() - t0,
  };
}

module.exports = { optimize, classifyType };
