import { describe, expect, it, vi } from 'vitest'
import { OffError, cleanCode, offProduct, offSearch, productToFood } from './off.js'

globalThis.__APP_VERSION__ ??= 'test'

// A fetch that answers from a table of URL patterns, and records what was asked.
function fakeFetch(routes) {
  const calls = []
  const f = vi.fn(async (url, init) => {
    calls.push({ url, init })
    for (const [re, answer] of routes) {
      if (re.test(url)) {
        const a = typeof answer === 'function' ? answer(url) : answer
        if (a instanceof Error) throw a
        return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.body, text: async () => JSON.stringify(a.body) }
      }
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' }
  })
  f.calls = calls
  return f
}

const NUTELLA = {
  code: '3017620422003', product_name: 'Nutella', product_name_ro: 'Nutella cremă', brands: 'Ferrero, Nutella',
  quantity: '400 g', product_quantity: '400', serving_size: '15 g', serving_quantity: 15,
  nutriments: { 'energy-kcal_100g': 539, 'energy-kj_100g': 2252, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9, fiber_100g: 0 },
}

describe('reading a product', () => {
  it('takes the label per 100 g, the serving and the pack, named in the language asked for', () => {
    const f = productToFood(NUTELLA, 'ro')
    expect(f).toMatchObject({
      id: 'off:3017620422003', src: 'off', name: 'Nutella cremă', brand: 'Ferrero', code: '3017620422003', unit: 'g',
      per100: { kcal: 539, p: 6.3, c: 57.5, f: 30.9, fib: 0 }, serving: { label: '15 g', amount: 15 }, pack: 400,
    })
    expect(productToFood(NUTELLA, 'en').name).toBe('Nutella')
  })

  it('reads kilojoules when the label gives no kcal, and knows a drink by its pack', () => {
    const f = productToFood({ code: '5449000000996', product_name: 'Coca-Cola', quantity: '1,5 L', nutriments: { energy_100g: 180, carbohydrates_100g: 10.6 } })
    expect(f.unit).toBe('ml')
    expect(f.per100.kcal).toBe(43)
    expect(productToFood({ code: '12345678', product_name: 'Apă', product_quantity_unit: 'ml', nutriments: { 'energy-kcal_100g': 0 } }).unit).toBe('ml')
  })

  it('scales a label given per serving only', () => {
    const f = productToFood({ code: '12345678', product_name: 'Bar', serving_quantity: '40', nutriments: { 'energy-kcal_serving': 200, proteins_serving: 20 } })
    expect(f.per100).toMatchObject({ kcal: 500, p: 50 })
  })

  it('names a brand from a list of brand tags (the search) and leaves out a serving in the other unit', () => {
    const f = productToFood({ code: '4001724819806', product_name: { main: 'x' }, generic_name: 'Pudding', brands: ['dr-oetker'], quantity: '500 g', serving_quantity: 250, serving_quantity_unit: 'ml', nutriments: { 'energy-kcal_100g': 90 } })
    expect(f.brand).toBe('Dr Oetker')
    expect(f.name).toBe('Pudding')
    expect(f.serving).toBeUndefined()
  })

  it('has nothing to log without a label, unless asked to keep the name', () => {
    expect(productToFood({ code: '12345678', product_name: 'Mystery' })).toBeNull()
    expect(productToFood({ code: '12345678', product_name: 'Mystery' }, 'en', { keepEmpty: true })).toMatchObject({ name: 'Mystery', per100: null })
  })

  it('cleans barcodes', () => {
    expect(cleanCode(' 594 1021-001223 ')).toBe('5941021001223')
    expect(cleanCode('1234')).toBe('')
    expect(cleanCode(null)).toBe('')
  })
})

describe('a barcode lookup', () => {
  it('finds a product and names the app in its User-Agent', async () => {
    const fetchImpl = fakeFetch([[/api\/v2\/product\/3017620422003/, { status: 200, body: { status: 1, product: NUTELLA } }]])
    const r = await offProduct('3017620422003', { fetchImpl })
    expect(r.status).toBe('found')
    expect(r.food.per100.kcal).toBe(539)
    expect(fetchImpl.calls[0].url).toMatch(/^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/3017620422003\?fields=code,product_name,/)
    expect(fetchImpl.calls[0].init.headers['User-Agent']).toMatch(/^openGym\/[\w.-]+ \(https:/)
  })

  it('tries a 12-digit UPC as the 13-digit EAN too', async () => {
    const fetchImpl = fakeFetch([
      [/product\/012345678905\?/, { status: 404, body: { status: 0 } }],
      [/product\/0012345678905\?/, { status: 200, body: { status: 1, product: { ...NUTELLA, code: '0012345678905' } } }],
    ])
    const r = await offProduct('012345678905', { fetchImpl })
    expect(r.status).toBe('found')
    expect(r.food.code).toBe('0012345678905')
  })

  it('tells a product with no label from one that is not there', async () => {
    const nodata = fakeFetch([[/product\//, { status: 200, body: { status: 1, product: { code: '5941021001223', product_name: 'Telemea Hochland' } } }]])
    expect(await offProduct('5941021001223', { fetchImpl: nodata })).toMatchObject({ status: 'nodata', food: { name: 'Telemea Hochland', code: '5941021001223' } })
    const missing = fakeFetch([[/product\//, { status: 404, body: { status: 0, status_verbose: 'product not found' } }]])
    expect(await offProduct('5941021001223', { fetchImpl: missing })).toEqual({ status: 'notfound' })
    const old = fakeFetch([[/product\//, { status: 200, body: { status: 0 } }]])
    expect(await offProduct('5941021001223', { fetchImpl: old })).toEqual({ status: 'notfound' })
    expect(await offProduct('12', { fetchImpl: old })).toEqual({ status: 'notfound' })
  })

  it('reports no connection, and too many requests', async () => {
    const down = fakeFetch([[/product\//, new TypeError('Failed to fetch')]])
    await expect(offProduct('5941021001223', { fetchImpl: down })).rejects.toMatchObject({ code: 'offline' })
    const busy = fakeFetch([[/product\//, { status: 429, body: {} }]])
    await expect(offProduct('5941021001223', { fetchImpl: busy })).rejects.toBeInstanceOf(OffError)
    await expect(offProduct('5941021001223', { fetchImpl: busy })).rejects.toMatchObject({ code: 'rate' })
  })
})

describe('a search', () => {
  it('asks Search-a-licious in the diary\'s language and keeps only products with a label', async () => {
    const fetchImpl = fakeFetch([[/search\.openfoodfacts\.org\/search/, { status: 200, body: { hits: [
      NUTELLA, { ...NUTELLA }, { code: '1', product_name: 'No label' }, { code: '40084107', product_name_ro: 'Ciocolată', product_name: 'Chocolate', brands: ['milka'], nutriments: { 'energy-kcal_100g': 530 } },
    ] } }]])
    const foods = await offSearch('  nutella ', { fetchImpl, lang: 'ro' })
    expect(foods.map(f => f.name)).toEqual(['Nutella cremă', 'Ciocolată'])
    const url = new URL(fetchImpl.calls[0].url)
    expect(url.searchParams.get('q')).toBe('nutella')
    expect(url.searchParams.get('langs')).toBe('ro,en')
    expect(url.searchParams.get('fields')).toContain('product_name_ro')
    expect(fetchImpl.calls).toHaveLength(1)
  })

  it('falls back to the older search when Search-a-licious fails or finds nothing usable', async () => {
    const fetchImpl = fakeFetch([
      [/search\.openfoodfacts\.org/, { status: 503, body: {} }],
      [/cgi\/search\.pl/, { status: 200, body: { products: [NUTELLA] } }],
    ])
    expect((await offSearch('nutella', { fetchImpl })).map(f => f.code)).toEqual(['3017620422003'])
    expect(fetchImpl.calls[1].url).toMatch(/search_terms=nutella&search_simple=1&action=process&json=1/)
    const empty = fakeFetch([
      [/search\.openfoodfacts\.org/, { status: 200, body: { hits: [{ code: '1', product_name: 'No label' }] } }],
      [/cgi\/search\.pl/, { status: 200, body: { products: [] } }],
    ])
    expect(await offSearch('xyz', { fetchImpl: empty })).toEqual([])
    expect(empty.calls).toHaveLength(2)
  })

  it('does not search for one letter, and stops at a rate limit', async () => {
    const fetchImpl = fakeFetch([])
    expect(await offSearch('a', { fetchImpl })).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
    const busy = fakeFetch([[/search/, { status: 429, body: {} }]])
    await expect(offSearch('nutella', { fetchImpl: busy })).rejects.toMatchObject({ code: 'rate' })
    expect(busy.calls).toHaveLength(1)
  })

  it('says offline when neither search answers', async () => {
    const down = fakeFetch([[/./, new TypeError('Failed to fetch')]])
    await expect(offSearch('nutella', { fetchImpl: down })).rejects.toMatchObject({ code: 'offline' })
  })
})
