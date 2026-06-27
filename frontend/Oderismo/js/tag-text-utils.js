/**
 * Utilidades de texto para etiquetas: normalización y detección de similitud.
 * Evita duplicados por mayúsculas, acentos o variantes singular/plural.
 */

/** Paleta para nuevas etiquetas (color aleatorio legible en chips). */
const LABEL_COLOR_PALETTE = [
  '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e',
  '#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e',
  '#14b8a6', '#06b6d4', '#3b82f6', '#64748b', '#71492c',
];

/**
 * Color hex aleatorio para una etiqueta nueva.
 * @returns {string}
 */
export function randomLabelColor() {
  return LABEL_COLOR_PALETTE[Math.floor(Math.random() * LABEL_COLOR_PALETTE.length)];
}

/**
 * 1) LIMPIEZA Y NORMALIZACIÓN
 * Minúsculas, trim y sin diacríticos ("Rójo " → "rojo").
 * @param {string} raw
 * @returns {string}
 */
export function normalizeTagText(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Distancia de Levenshtein (ediciones mínimas entre dos cadenas).
 * @param {string} a — ya normalizada
 * @param {string} b — ya normalizada
 * @returns {number}
 */
export function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let i = 0; i < rows; i++) matrix[i][0] = i;
  for (let j = 0; j < cols; j++) matrix[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[rows - 1][cols - 1];
}

/**
 * Heurística singular/plural en español (coche ↔ coches).
 * @param {string} a — normalizado
 * @param {string} b — normalizado
 */
function isPluralVariant(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;

  const pairs = [
    [a + 's', b],
    [b + 's', a],
    [a + 'es', b],
    [b + 'es', a],
  ];
  if (pairs.some(([x, y]) => x === y)) return true;

  if (a.endsWith('s') && a.slice(0, -1) === b) return true;
  if (b.endsWith('s') && b.slice(0, -1) === a) return true;
  if (a.endsWith('es') && a.slice(0, -2) === b) return true;
  if (b.endsWith('es') && b.slice(0, -2) === a) return true;

  return false;
}

/**
 * ¿Son la misma etiqueta semántica (normalización + plural + cercanía)?
 * @param {string} textA
 * @param {string} textB
 * @returns {boolean}
 */
export function areSimilarTagTexts(textA, textB) {
  const a = normalizeTagText(textA);
  const b = normalizeTagText(textB);
  if (!a || !b) return false;
  if (a === b) return true;
  if (isPluralVariant(a, b)) return true;

  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  if (short.length >= 3 && long.includes(short)) return true;

  const maxLen = Math.max(a.length, b.length);
  const threshold = maxLen <= 4 ? 1 : maxLen <= 7 ? 2 : 3;
  return levenshteinDistance(a, b) <= threshold;
}

/**
 * @typedef {{ id: number, name: string, color?: string }} TagItem
 */

/**
 * Busca en el catálogo una etiqueta ya existente equivalente al texto escrito.
 * @param {string} input
 * @param {TagItem[]} catalog
 * @returns {TagItem|null}
 */
export function findMatchingCatalogTag(input, catalog) {
  const norm = normalizeTagText(input);
  if (!norm || !catalog?.length) return null;

  const exact = catalog.find((t) => normalizeTagText(t.name) === norm);
  if (exact) return exact;

  return catalog.find((t) => areSimilarTagTexts(norm, t.name)) || null;
}

/**
 * Coincidencias por prefijo (autocompletado agresivo): "coc" → "coche".
 * @param {string} input
 * @param {TagItem[]} catalog
 * @param {Set<number>} takenIds
 * @returns {TagItem[]}
 */
export function findPrefixMatches(input, catalog, takenIds = new Set()) {
  const norm = normalizeTagText(input);
  if (!norm || !catalog?.length) return [];

  return catalog.filter((t) => {
    if (takenIds.has(t.id)) return false;
    const name = normalizeTagText(t.name);
    return name.startsWith(norm) && name !== norm;
  });
}

/**
 * Mejor sugerencia por prefijo (la más corta que encaje = completado más natural).
 * @param {string} input
 * @param {TagItem[]} catalog
 * @param {Set<number>} takenIds
 * @returns {TagItem|null}
 */
export function findBestPrefixCompletion(input, catalog, takenIds = new Set()) {
  const matches = findPrefixMatches(input, catalog, takenIds);
  if (!matches.length) return null;
  return matches.sort(
    (a, b) => normalizeTagText(a.name).length - normalizeTagText(b.name).length,
  )[0];
}

/**
 * ¿Debe mostrarse «¿Quisiste decir…?»? (similar pero no es el mismo texto ni prefijo exacto).
 */
export function shouldShowDidYouMean(input, tag) {
  if (!tag) return false;
  const norm = normalizeTagText(input);
  const name = normalizeTagText(tag.name);
  if (!norm || !name || norm === name) return false;
  if (name.startsWith(norm)) return false;
  return areSimilarTagTexts(norm, tag.name);
}

/**
 * 2) SUGERENCIA «¿Quisiste decir…?» — plural, typo o variante (p. ej. «coches» → «coche»).
 * @param {string} input
 * @param {TagItem[]} catalog
 * @param {Set<number>} takenIds
 * @returns {TagItem|null}
 */
export function findDidYouMeanTag(input, catalog, takenIds = new Set()) {
  const norm = normalizeTagText(input);
  if (norm.length < 2 || !catalog?.length) return null;

  let best = null;
  let bestScore = Infinity;

  for (const tag of catalog) {
    if (takenIds.has(tag.id)) continue;
    const name = normalizeTagText(tag.name);
    if (name === norm) continue;
    if (!shouldShowDidYouMean(input, tag)) continue;

    const dist = levenshteinDistance(norm, name);
    if (dist < bestScore) {
      bestScore = dist;
      best = tag;
    }
  }

  return best;
}

/**
 * Ordena el desplegable: prefijos primero, luego el resto por nombre.
 * @param {string} input
 * @param {TagItem[]} catalog
 * @param {Set<number>} takenIds
 * @returns {TagItem[]}
 */
export function rankSuggestList(input, catalog, takenIds = new Set()) {
  const norm = normalizeTagText(input);
  const available = (catalog || []).filter((t) => !takenIds.has(t.id));

  if (!norm) return available.slice(0, 12);

  const prefix = [];
  const fuzzy = [];
  const rest = [];

  for (const tag of available) {
    const name = normalizeTagText(tag.name);
    if (name.startsWith(norm)) prefix.push(tag);
    else if (areSimilarTagTexts(norm, tag.name)) fuzzy.push(tag);
    else if (norm.length >= 2 && name.includes(norm)) rest.push(tag);
  }

  const byName = (a, b) => a.name.localeCompare(b.name, 'es');
  prefix.sort(byName);
  fuzzy.sort(byName);
  rest.sort(byName);

  const seen = new Set();
  const out = [];
  for (const list of [prefix, fuzzy, rest]) {
    for (const t of list) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
      if (out.length >= 12) return out;
    }
  }
  return out;
}

/**
 * Sufijo visual para autocompletar en el input (ej. input "coc" → ghost "he").
 * @param {string} input
 * @param {TagItem|null} completionTag
 * @returns {string}
 */
export function completionSuffix(input, completionTag) {
  if (!completionTag) return '';
  const norm = normalizeTagText(input);
  const full = normalizeTagText(completionTag.name);
  if (!norm || !full.startsWith(norm) || full === norm) return '';
  return completionTag.name.slice(input.length);
}
