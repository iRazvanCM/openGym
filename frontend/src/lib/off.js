// Open Food Facts (openfoodfacts.org, data under the ODbL): the open food database behind the
// food diary's barcode scan and its search for packaged food.
//
// Two read-only, anonymous calls:
//   - a product by barcode: GET world.openfoodfacts.org/api/v2/product/{code}?fields=…
//   - a search by name: Search-a-licious (search.openfoodfacts.org/search), the search the
//     project points apps to, with the older /cgi/search.pl as the fallback when it fails.
// OFF asks every app to name itself in a User-Agent ("AppName/Version (contact)") and allows
// about 15 product reads and 10 searches a minute per IP. So the diary searches when asked (the
// Search key), never on every keystroke, and a product once logged is kept in S.foods
// (lib/food.js): the next scan of it is answered on the phone, with no request at all.
//
// In the app the call goes out through CapacitorHttp (lib/capacitor-fetch.js): no CORS to ask
// for, and the User-Agent header is ours to set. In a browser it is a plain fetch (OFF allows
// CORS) and the browser sends its own User-Agent.
//
// Whatever comes back is turned into the diary's food shape (lib/food.js): name, brand, barcode,
// measured in g or ml, its numbers per 100 g (or 100 ml), a serving and the pack size when the
// label gives them.
import { MOBILE } from './mobile.js'
import { cleanPer100 } from './food.js'

export const OFF_BASE = 'https://world.openfoodfacts.org'
export const OFF_SEARCH = 'https://search.openfoodfacts.org/search'
const TIMEOUT_MS = 12000
const PRODUCT_FIELDS = [
  'code', 'product_name', 'product_name_ro', 'product_name_en', 'generic_name', 'generic_name_ro', 'generic_name_en',
  'brands', 'quantity', 'product_quantity', 'product_quantity_unit', 'serving_size', 'serving_quantity',
  'serving_quantity_unit', 'nutriments', 'nutrition_data_per', 'lang',
]
// Search-a-licious stores the per-language names as one field and hands them back flattened
// (product_name, product_name_ro, …): only the ones listed come back. `brands` is a list of
// brand tags there ('dr-oetker'), a comma-separated string from the product API.
const SEARCH_FIELDS = PRODUCT_FIELDS.filter(f => f !== 'nutrition_data_per' && f !== 'serving_quantity_unit')

const userAgent = () => {
  const v = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
  return `openGym/${v} (https://github.com/DuarteSantos8/openGym)`
}

/** Why a lookup failed: 'offline' (no answer), 'rate' (too many requests), 'failed'. */
export class OffError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status || 0 }
}

async function defaultFetch() {
  if (!MOBILE) return (url, init) => fetch(url, init)
  const { nativeFetch } = await import('./capacitor-fetch.js')
  return nativeFetch
}

// One GET with a time limit. A network failure or the time running out is 'offline'.
async function get(url, { fetchImpl, timeoutMs = TIMEOUT_MS } = {}) {
  const f = fetchImpl || await defaultFetch()
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null
  try {
    const headers = { Accept: 'application/json' }
    if (MOBILE || fetchImpl) headers['User-Agent'] = userAgent()
    const res = await f(url, { method: 'GET', headers, ...(ctl ? { signal: ctl.signal } : {}) })
    if (res.status === 429) throw new OffError('rate', 429)
    return res
  } catch (e) {
    if (e instanceof OffError) throw e
    throw new OffError('offline')
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Digits only; a barcode is 8 to 14 of them (EAN-8, UPC-A, EAN-13, GTIN-14). */
export function cleanCode(code) {
  const c = String(code ?? '').replace(/\D/g, '')
  return c.length >= 8 && c.length <= 14 ? c : ''
}

/* --------------------------------------------------------------------- the product -- */

const text = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')
const numOf = v => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

// A brand for display: the first of a comma-separated list, or of a list of brand tags
// ('dr-oetker' → 'Dr Oetker').
function brandOf(v) {
  if (Array.isArray(v)) {
    const tag = text(v.find(x => typeof x === 'string' && x.trim()) || '')
    return tag.replace(/^xx:/, '').split('-').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
  }
  return text(String(v || '').split(',')[0])
}

// Liquids are labelled per 100 ml, and OFF keeps those numbers in the same `_100g` fields; the
// pack size tells which it is ('500 ml', '1,5 L', '33 cl').
function isLiquid(p) {
  const unit = text(p.product_quantity_unit).toLowerCase()
  if (unit === 'ml' || unit === 'l' || unit === 'cl') return true
  if (unit === 'g' || unit === 'kg') return false
  const q = text(p.quantity).toLowerCase()
  if (/\d\s*(ml|cl|dl|l|ltr|litre|liter|litri)\b/.test(q)) return true
  return false
}

// The numbers per 100 g/ml. Energy from kcal when the label gives it, else from kJ (OFF's
// `energy_100g` is always kJ). A product labelled per serving only is scaled up from it.
function per100Of(p) {
  const n = p.nutriments && typeof p.nutriments === 'object' ? p.nutriments : {}
  const pick = (k, suffix) => numOf(n[`${k}${suffix}`])
  const read = suffix => {
    let kcal = pick('energy-kcal', suffix)
    if (kcal == null) {
      const kj = pick('energy-kj', suffix) ?? pick('energy', suffix)
      if (kj != null) kcal = kj / 4.184
    }
    return { kcal, p: pick('proteins', suffix), c: pick('carbohydrates', suffix), f: pick('fat', suffix), fib: pick('fiber', suffix) }
  }
  const a = read('_100g')
  if (a.kcal != null || a.p != null || a.c != null || a.f != null) return cleanPer100(a)
  const serving = numOf(p.serving_quantity)
  const s = read('_serving')
  if (serving > 0 && (s.kcal != null || s.p != null)) {
    const k = 100 / serving
    const scale = v => (v == null ? null : v * k)
    return cleanPer100({ kcal: scale(s.kcal), p: scale(s.p), c: scale(s.c), f: scale(s.f), fib: scale(s.fib) })
  }
  return null
}

// The best name for `lang`: the product name in that language, then the main one, then English,
// then the generic name ('Iaurt grecesc') — some products have only that.
function nameOf(p, lang) {
  return text(p[`product_name_${lang}`]) || text(p.product_name) || text(p.product_name_en) ||
    text(p[`generic_name_${lang}`]) || text(p.generic_name) || text(p.generic_name_en)
}

/**
 * An OFF product as a diary food, or null when it has no usable nutrition facts. Pass `keepEmpty`
 * to get the name and barcode of one without them (the diary then offers to fill them in).
 */
export function productToFood(p, lang = 'en', { keepEmpty = false } = {}) {
  if (!p || typeof p !== 'object') return null
  const code = cleanCode(p.code)
  const per100 = per100Of(p)
  if (!per100 && !keepEmpty) return null
  const unit = isLiquid(p) ? 'ml' : 'g'
  const food = {
    id: code ? 'off:' + code : null, src: 'off', ref: code ? 'off:' + code : '',
    name: nameOf(p, lang).slice(0, 120), brand: brandOf(p.brands).slice(0, 80), code, unit, per100,
  }
  const serving = numOf(p.serving_quantity)
  const servingUnit = text(p.serving_quantity_unit).toLowerCase()
  // A serving in the other unit than the pack (a 250 ml glass of a powder) is left out: its
  // amount could not be read against numbers per 100 g.
  if (serving > 0 && serving <= 5000 && (!servingUnit || servingUnit === unit)) {
    food.serving = { label: text(p.serving_size).slice(0, 40), amount: Math.round(serving * 10) / 10 }
  }
  const pack = numOf(p.product_quantity)
  if (pack > 0 && pack <= 5000) food.pack = Math.round(pack * 10) / 10
  return food
}

/**
 * A product by barcode: { status: 'found', food } | { status: 'nodata', food } (the product is
 * there but its label is not, so `food` has a name and code and no numbers) | { status: 'notfound' }.
 * Throws an OffError when OFF cannot be reached or refuses.
 */
export async function offProduct(code, { fetchImpl, lang = 'en', timeoutMs } = {}) {
  const c = cleanCode(code)
  if (!c) return { status: 'notfound' }
  // A 12-digit UPC-A is the same code as the 13-digit EAN with a leading 0, which is how many
  // products are filed.
  const tries = c.length === 12 ? [c, '0' + c] : [c]
  for (const tryCode of tries) {
    const res = await get(`${OFF_BASE}/api/v2/product/${tryCode}?fields=${PRODUCT_FIELDS.join(',')}`, { fetchImpl, timeoutMs })
    if (res.status === 404) continue
    if (!res.ok) throw new OffError('failed', res.status)
    let j
    try { j = await res.json() } catch { throw new OffError('failed', res.status) }
    if (j?.status !== 1 || !j.product) continue
    const product = { ...j.product, code: j.product.code || tryCode }
    const food = productToFood(product, lang, { keepEmpty: true })
    if (!food) continue
    return food.per100 ? { status: 'found', food } : { status: 'nodata', food }
  }
  return { status: 'notfound' }
}

/**
 * Packaged foods by name: [food], best match first, only those with nutrition facts. Search-a-
 * licious first; the older search when that one fails or has nothing usable. Throws an
 * OffError when neither answers.
 */
export async function offSearch(query, { fetchImpl, lang = 'en', pageSize = 24, timeoutMs } = {}) {
  const q = String(query || '').trim().slice(0, 100)
  if (q.length < 2) return []
  const langs = lang === 'en' ? 'en' : `${lang},en`
  const opts = { fetchImpl, timeoutMs }
  let first = null
  try {
    const url = `${OFF_SEARCH}?q=${encodeURIComponent(q)}&langs=${langs}&page_size=${pageSize}&fields=${SEARCH_FIELDS.join(',')}`
    const res = await get(url, opts)
    if (res.ok) {
      const j = await res.json()
      const foods = uniqueFoods((Array.isArray(j?.hits) ? j.hits : []).map(p => productToFood(p, lang)))
      if (foods.length) return foods
    }
  } catch (e) {
    first = e
    if (e instanceof OffError && e.code === 'rate') throw e
  }
  try {
    const url = `${OFF_BASE}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=${pageSize}&fields=${PRODUCT_FIELDS.join(',')}`
    const res = await get(url, opts)
    if (!res.ok) throw new OffError('failed', res.status)
    const j = await res.json()
    return uniqueFoods((Array.isArray(j?.products) ? j.products : []).map(p => productToFood(p, lang)))
  } catch (e) {
    throw e instanceof OffError ? e : first instanceof OffError ? first : new OffError('failed')
  }
}

// Usable results only, one per barcode.
function uniqueFoods(list) {
  const seen = new Set()
  return list.filter(f => {
    if (!f || !f.name || !f.per100) return false
    const key = f.code || f.name.toLowerCase() + '|' + f.brand.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
