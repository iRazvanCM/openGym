// Everyday foods for the food diary, per 100 g (drinks per 100 ml), so the basics — chicken,
// rice, eggs, oats — are one tap away without a barcode or a connection. Packaged food comes from
// a barcode or an Open Food Facts search instead (lib/off.js), where the label's own numbers are
// better than any average.
//
// Values are the usual reference figures (USDA FoodData Central, rounded); a product on the shelf
// can differ by a few percent. "Raw" and "cooked" are separate rows because weighing raw and
// logging cooked (or the other way round) is the most common way a food diary goes wrong: 100 g of
// raw rice is about 280 g cooked. Each row: id, ro / en names, kcal, protein, carbs, fat, an optional
// fibre figure, `unit` ('ml' for drinks), and an optional typical serving.
const F = (id, ro, en, kcal, p, c, f, extra = {}) => ({ id: 'basic:' + id, ro, en, unit: 'g', per100: { kcal, p, c, f, ...(extra.fib != null ? { fib: extra.fib } : {}) }, ...(extra.unit ? { unit: extra.unit } : {}), ...(extra.serving ? { serving: extra.serving } : {}) })
const S = (en, ro, amount) => ({ en, ro, amount })

export const BASIC_FOODS = [
  // meat and fish
  F('chicken-breast-raw', 'Piept de pui, crud', 'Chicken breast, raw', 120, 22.5, 0, 2.6),
  F('chicken-breast-cooked', 'Piept de pui, gătit', 'Chicken breast, cooked', 165, 31, 0, 3.6),
  F('chicken-thigh-raw', 'Pulpă de pui fără piele, crudă', 'Chicken thigh, skinless, raw', 121, 19.7, 0, 4.1),
  F('turkey-breast-raw', 'Piept de curcan, crud', 'Turkey breast, raw', 114, 23.7, 0.1, 1.5),
  F('pork-tenderloin-raw', 'Mușchiuleț de porc, crud', 'Pork tenderloin, raw', 120, 21, 0, 3.4),
  F('beef-lean-raw', 'Vită slabă tocată (5%), crudă', 'Lean ground beef (5% fat), raw', 137, 21.4, 0, 5),
  F('beef-mince-10-raw', 'Vită tocată (10%), crudă', 'Ground beef (10% fat), raw', 176, 20, 0, 10),
  F('mince-20-raw', 'Carne tocată (20% grăsime), crudă', 'Mince (20% fat), raw', 254, 17.2, 0, 20),
  F('salmon-raw', 'Somon, crud', 'Salmon, raw', 208, 20.4, 0, 13.4),
  F('white-fish-raw', 'Pește alb (cod, merluciu), crud', 'White fish (cod, hake), raw', 82, 17.8, 0, 0.7),
  F('tuna-water', 'Ton în suc propriu, scurs', 'Tuna in water, drained', 116, 25.5, 0, 0.8),
  F('tuna-oil', 'Ton în ulei, scurs', 'Tuna in oil, drained', 198, 29.1, 0, 8.2),
  F('egg', 'Ou întreg', 'Egg, whole', 143, 12.6, 0.7, 9.5, { serving: S('1 egg', '1 ou', 50) }),
  F('egg-white', 'Albuș de ou', 'Egg white', 52, 10.9, 0.7, 0.2, { serving: S('1 egg white', '1 albuș', 33) }),
  // dairy
  F('cottage-cheese', 'Brânză de vaci slabă (~2%)', 'Cottage cheese (~2%)', 81, 10.5, 4.8, 2.3),
  F('skyr', 'Skyr natural', 'Skyr, plain', 63, 11, 4, 0.2),
  F('greek-yogurt-0', 'Iaurt grecesc 0%', 'Greek yogurt 0%', 59, 10.2, 3.6, 0.4),
  F('yogurt-3', 'Iaurt simplu 3,5%', 'Plain yogurt 3.5%', 61, 3.5, 4.7, 3.3),
  F('milk-1.5', 'Lapte 1,5%', 'Milk 1.5%', 46, 3.4, 4.9, 1.5, { unit: 'ml', serving: S('1 glass', '1 pahar', 250) }),
  F('milk-3.5', 'Lapte 3,5%', 'Milk 3.5%', 64, 3.3, 4.7, 3.5, { unit: 'ml', serving: S('1 glass', '1 pahar', 250) }),
  F('hard-cheese', 'Cașcaval (tip Edam)', 'Hard cheese (Edam type)', 357, 25, 1.4, 27.8, { serving: S('1 slice', '1 felie', 20) }),
  F('feta', 'Telemea / feta', 'Feta / telemea', 264, 14.2, 4.1, 21.3),
  F('whey', 'Proteină whey (pudră, tipic)', 'Whey protein powder (typical)', 400, 78, 8, 6, { serving: S('1 scoop', '1 măsură', 30) }),
  // grains and starches
  F('oats', 'Fulgi de ovăz', 'Rolled oats', 379, 13.2, 67.7, 6.5, { fib: 10.1 }),
  F('rice-raw', 'Orez alb, crud', 'White rice, raw', 365, 7.1, 80, 0.7),
  F('rice-cooked', 'Orez alb, fiert', 'White rice, cooked', 130, 2.7, 28.2, 0.3),
  F('pasta-raw', 'Paste, crude', 'Pasta, dry', 371, 13, 75, 1.5),
  F('pasta-cooked', 'Paste, fierte', 'Pasta, cooked', 158, 5.8, 30.9, 0.9),
  F('potato-raw', 'Cartofi, cruzi', 'Potatoes, raw', 77, 2, 17.5, 0.1),
  F('potato-boiled', 'Cartofi, fierți', 'Potatoes, boiled', 87, 1.9, 20.1, 0.1),
  F('sweet-potato-raw', 'Cartofi dulci, cruzi', 'Sweet potato, raw', 86, 1.6, 20.1, 0.1),
  F('bread-wholegrain', 'Pâine integrală', 'Wholegrain bread', 250, 12.5, 42, 3.5, { fib: 7, serving: S('1 slice', '1 felie', 30) }),
  F('bread-white', 'Pâine albă', 'White bread', 265, 9, 49, 3.2, { serving: S('1 slice', '1 felie', 30) }),
  F('cornmeal', 'Mălai, crud', 'Cornmeal, dry', 362, 8.1, 76.9, 3.6),
  F('polenta', 'Mămăligă (moale, aprox.)', 'Polenta, soft (approx.)', 72, 1.6, 15.4, 0.7),
  // legumes
  F('lentils-raw', 'Linte, crudă', 'Lentils, dry', 352, 24.6, 63.4, 1.1),
  F('lentils-cooked', 'Linte, fiartă', 'Lentils, cooked', 116, 9, 20.1, 0.4),
  F('chickpeas-cooked', 'Năut, fiert', 'Chickpeas, cooked', 164, 8.9, 27.4, 2.6),
  F('white-beans-cooked', 'Fasole albă, fiartă', 'White beans, cooked', 139, 9.7, 25.1, 0.4),
  // fruit
  F('apple', 'Măr', 'Apple', 52, 0.3, 13.8, 0.2, { fib: 2.4, serving: S('1 medium', '1 mediu', 180) }),
  F('banana', 'Banană', 'Banana', 89, 1.1, 22.8, 0.3, { serving: S('1 medium', '1 medie', 120) }),
  F('orange', 'Portocală', 'Orange', 47, 0.9, 11.8, 0.1, { serving: S('1 medium', '1 medie', 150) }),
  F('pear', 'Pară', 'Pear', 57, 0.4, 15.2, 0.1, { serving: S('1 medium', '1 medie', 170) }),
  F('kiwi', 'Kiwi', 'Kiwi', 61, 1.1, 14.7, 0.5, { serving: S('1 fruit', '1 fruct', 75) }),
  F('strawberries', 'Căpșuni', 'Strawberries', 32, 0.7, 7.7, 0.3),
  F('blueberries', 'Afine', 'Blueberries', 57, 0.7, 14.5, 0.3),
  F('grapes', 'Struguri', 'Grapes', 69, 0.7, 18.1, 0.2),
  F('watermelon', 'Pepene roșu', 'Watermelon', 30, 0.6, 7.6, 0.2),
  // vegetables
  F('tomato', 'Roșii', 'Tomatoes', 18, 0.9, 3.9, 0.2),
  F('cucumber', 'Castraveți', 'Cucumber', 15, 0.7, 3.6, 0.1),
  F('lettuce', 'Salată verde', 'Lettuce', 15, 1.4, 2.9, 0.2),
  F('bell-pepper', 'Ardei gras (roșu)', 'Bell pepper (red)', 31, 1, 6, 0.3),
  F('broccoli', 'Broccoli', 'Broccoli', 34, 2.8, 6.6, 0.4),
  F('cauliflower', 'Conopidă', 'Cauliflower', 25, 1.9, 5, 0.3),
  F('carrot', 'Morcovi', 'Carrots', 41, 0.9, 9.6, 0.2),
  F('onion', 'Ceapă', 'Onion', 40, 1.1, 9.3, 0.1),
  F('cabbage', 'Varză', 'Cabbage', 25, 1.3, 5.8, 0.1),
  F('zucchini', 'Dovlecel', 'Zucchini', 17, 1.2, 3.1, 0.3),
  F('spinach', 'Spanac', 'Spinach', 23, 2.9, 3.6, 0.4),
  F('green-beans', 'Fasole verde', 'Green beans', 31, 1.8, 7, 0.2),
  F('mushrooms', 'Ciuperci champignon', 'Mushrooms (white)', 22, 3.1, 3.3, 0.3),
  // fats and nuts
  F('olive-oil', 'Ulei de măsline', 'Olive oil', 884, 0, 0, 100, { serving: S('1 tbsp', '1 lingură', 13.5) }),
  F('sunflower-oil', 'Ulei de floarea-soarelui', 'Sunflower oil', 884, 0, 0, 100, { serving: S('1 tbsp', '1 lingură', 13.5) }),
  F('butter', 'Unt', 'Butter', 717, 0.9, 0.1, 81, { serving: S('1 tsp', '1 linguriță', 5) }),
  F('walnuts', 'Nuci', 'Walnuts', 654, 15.2, 13.7, 65.2),
  F('almonds', 'Migdale', 'Almonds', 579, 21.2, 21.6, 49.9),
  F('peanut-butter', 'Unt de arahide', 'Peanut butter', 588, 25.1, 19.6, 50.4, { serving: S('1 tbsp', '1 lingură', 16) }),
  F('avocado', 'Avocado', 'Avocado', 160, 2, 8.5, 14.7),
  // sweet things and the rest
  F('honey', 'Miere', 'Honey', 304, 0.3, 82.4, 0, { serving: S('1 tsp', '1 linguriță', 7) }),
  F('sugar', 'Zahăr', 'Sugar', 387, 0, 100, 0, { serving: S('1 tsp', '1 linguriță', 4) }),
  F('dark-chocolate', 'Ciocolată neagră 70%', 'Dark chocolate 70%', 598, 7.8, 45.9, 42.6),
  F('pizza', 'Pizza cu brânză (medie)', 'Cheese pizza (average)', 266, 11.4, 33.3, 9.7),
  // drinks, per 100 ml
  F('beer', 'Bere', 'Beer', 43, 0.5, 3.6, 0, { unit: 'ml', serving: S('1 bottle', '1 sticlă', 500) }),
  F('red-wine', 'Vin roșu', 'Red wine', 85, 0.1, 2.6, 0, { unit: 'ml', serving: S('1 glass', '1 pahar', 150) }),
  F('cola', 'Cola (cu zahăr)', 'Cola (sugared)', 42, 0, 10.6, 0, { unit: 'ml', serving: S('1 can', '1 doză', 330) }),
  F('orange-juice', 'Suc de portocale', 'Orange juice', 45, 0.7, 10.4, 0.2, { unit: 'ml', serving: S('1 glass', '1 pahar', 250) }),
]

export const BASIC_BY_ID = new Map(BASIC_FOODS.map(f => [f.id, f]))
