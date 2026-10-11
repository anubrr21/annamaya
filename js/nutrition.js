const R = (re, kcal, p, c, f, o = {}) => ({ re, kcal, p, c, f, ...o });

const RULES = [
  R(/uggani.*bajji/i, 380, 8, 52, 15, { serving: '1 plate + 2 bajji' }),
  R(/ghee.*podi.*idl/i, 270, 7, 42, 8, { serving: '3 idli with ghee podi' }),
  R(/fried rice.*manchuria/i, 480, 10, 72, 16, { serving: '1 plate' }),
  R(/manchuria.*noodles|noodles.*manchuria/i, 450, 10, 64, 17, { serving: '1 plate' }),
  R(/bread.*peanut butter/i, 290, 9, 34, 13, { serving: '2 slices' }),
  R(/bread.*butter/i, 230, 5, 36, 8, { serving: '2 slices' }),
  R(/soup.*bread/i, 150, 4, 22, 5, { serving: '1 bowl' }),
  R(/thick curd.*pickle/i, 115, 5, 8, 7, { serving: '1 cup' }),
  R(/ghee\s*\+\s*podi/i, 90, 1, 3, 8, { serving: '1 tsp ghee + podi' }),
  R(/milk\s*\+\s*cof+ee/i, 110, 5, 9, 6, { serving: '1 glass' }),

  R(/egg bhurji|scrambled egg/i, 120, 8, 2, 9, { serving: '60 g' }),
  R(/om(e)?let/i, 150, 10, 2, 11, { serving: '1 omelette' }),
  R(/boiled egg/i, 78, 6, 1, 5, { each: 1, serving: '1 egg' }),

  R(/chicken.*biryani/i, 560, 30, 62, 20, { serving: '1 plate' }),
  R(/paneer.*biryani/i, 520, 17, 64, 21, { serving: '1 plate' }),
  R(/mushroom biryani/i, 400, 9, 62, 12, { serving: '1 plate' }),
  R(/biryani/i, 430, 10, 64, 14, { serving: '1 plate' }),
  R(/bisi?bele/i, 330, 9, 52, 9, { serving: '1 bowl' }),
  R(/pula[vo]/i, 350, 7, 58, 9, { serving: '1 cup' }),
  R(/ghee rice/i, 360, 6, 56, 12, { serving: '1 cup' }),
  R(/(pudina|jeera|tomato|bhagara|lemon|coconut) rice|pulihora/i, 320, 6, 55, 8, { serving: '1 cup' }),
  R(/fried rice/i, 340, 7, 56, 10, { serving: '1 cup' }),
  R(/white rice|plain rice/i, 260, 5, 57, 1, { serving: '1 cup cooked' }),
  R(/noodles|maggi/i, 310, 7, 44, 12, { serving: '1 plate' }),

  R(/masala dosa/i, 210, 5, 32, 7, { each: 2, serving: 'per dosa' }),
  R(/pesarattu/i, 140, 7, 20, 4, { each: 2, serving: 'per piece' }),
  R(/utt?appam/i, 180, 5, 28, 5, { each: 2, serving: 'per piece' }),
  R(/\bdosa\b/i, 155, 4, 24, 5, { each: 2, serving: 'per dosa' }),
  R(/idl[iy] upma/i, 250, 7, 40, 7, { serving: '1 plate' }),
  R(/idl[iy]/i, 60, 2, 12, 0.4, { each: 3, serving: 'per idli' }),
  R(/dahi vada/i, 110, 4, 13, 5, { each: 2, serving: 'per piece' }),
  R(/sambar vada/i, 150, 5, 18, 6, { each: 2, serving: 'per piece with sambar' }),
  R(/vada pav/i, 290, 7, 42, 10, { each: 1, serving: 'per piece' }),
  R(/pav bhaji/i, 400, 10, 56, 15, { serving: '2 pav + bhaji' }),
  R(/vada/i, 130, 4, 14, 7, { each: 3, serving: 'per vada' }),
  R(/\bpoori|\bpuri\b/i, 110, 2, 14, 5, { each: 3, serving: 'per poori' }),
  R(/bhatur/i, 220, 5, 30, 9, { each: 2, serving: 'per bhatura' }),
  R(/naan/i, 260, 7, 40, 8, { each: 1, serving: 'per naan' }),
  R(/paratha/i, 180, 5, 24, 7, { each: 2, serving: 'per paratha' }),
  R(/t(h)?epla/i, 120, 4, 17, 4, { each: 2, serving: 'per piece' }),
  R(/pulka|phulka/i, 70, 3, 15, 0.4, { each: 2, serving: 'per pulka' }),
  R(/roti|chapath?i/i, 100, 3, 18, 2.5, { each: 2, serving: 'per roti' }),
  R(/pongal/i, 320, 8, 45, 12, { serving: '1 bowl' }),
  R(/kitchidi|khichdi|daliya/i, 260, 7, 42, 7, { serving: '1 bowl' }),
  R(/upma/i, 250, 6, 40, 8, { serving: '1 bowl' }),
  R(/poha/i, 250, 5, 45, 6, { serving: '1 plate' }),
  R(/sevai|shavige|semiya/i, 230, 4, 42, 5, { serving: '1 plate' }),
  R(/uggani/i, 250, 5, 44, 6, { serving: '1 plate' }),
  R(/cornflakes|chocos|mu(e)?s(e)?li/i, 200, 6, 36, 4, { serving: '1 bowl with milk' }),
  R(/sprouts/i, 90, 7, 14, 1, { serving: '1 small cup' }),
  R(/ra+gi malt/i, 130, 3, 26, 1.5, { serving: '1 glass' }),

  R(/samosa/i, 260, 5, 30, 14, { each: 1, serving: 'per samosa' }),
  R(/puff/i, 250, 5, 28, 13, { each: 1, serving: 'per puff' }),
  R(/punugulu curry/i, 190, 7, 22, 8, { serving: '1 cup' }),
  R(/punugulu/i, 40, 1, 5, 2, { each: 8, serving: 'per piece' }),
  R(/mysore bonda/i, 110, 2, 14, 5, { each: 2, serving: 'per bonda' }),
  R(/mirchi bajji/i, 110, 2, 12, 6, { each: 2, serving: 'per bajji' }),
  R(/bhajji|bajji/i, 80, 1, 10, 4, { each: 2, serving: 'per piece' }),
  R(/pakoda|pakora/i, 220, 5, 22, 13, { serving: '1 plate' }),
  R(/plum cake|chocolate cake|cake/i, 310, 4, 44, 13, { each: 1, serving: 'per piece' }),
  R(/\bchaa?t\b/i, 260, 8, 38, 9, { serving: '1 plate' }),
  R(/soup/i, 90, 3, 12, 3, { serving: '1 bowl' }),
  R(/(?<!baby\s?)corn/i, 150, 4, 26, 4, { serving: '1 cup' }),
  R(/boiled peanuts|peanut sundal/i, 220, 10, 10, 16, { serving: '1 cup' }),

  R(/paneer salad/i, 220, 14, 6, 16, { serving: '1 cup' }),
  R(/soya (chunk|bean) salad/i, 160, 18, 12, 3, { serving: '1 cup' }),
  R(/yogurt salad/i, 120, 7, 10, 5, { serving: '1 cup' }),
  R(/sweet potato salad/i, 130, 2, 30, 0.3, { serving: '1 cup' }),
  R(/(chana|chick\s?peas?|beans) salad/i, 150, 8, 22, 3, { serving: '1 cup' }),
  R(/fruit salad/i, 90, 1, 22, 0.3, { serving: '1 cup' }),
  R(/salad/i, 35, 1, 7, 0.2, { serving: '1 small plate' }),

  R(/chicken 65|chilli chicken|chicken fry/i, 340, 30, 10, 20, { serving: '150 g' }),
  R(/fish fry/i, 260, 24, 6, 15, { serving: '120 g' }),
  R(/chicken/i, 300, 30, 6, 17, { serving: '150 g with gravy' }),
  R(/paneer 65|chilli paneer|baby\s?corn/i, 290, 12, 14, 21, { serving: '1 cup' }),
  R(/paneer/i, 320, 14, 10, 25, { serving: '75 g paneer with gravy' }),
  R(/mirchi ka salan/i, 180, 4, 10, 14, { serving: '1 cup' }),
  R(/soya chunks/i, 200, 18, 14, 8, { serving: '1 cup' }),
  R(/dragon potato/i, 260, 3, 34, 13, { serving: '1 cup' }),
  R(/manchuri/i, 220, 5, 22, 12, { serving: '1 cup' }),

  R(/gulab jamun/i, 150, 2, 22, 6, { each: 1, serving: 'per piece' }),
  R(/jilebi|jalebi/i, 180, 1, 32, 6, { serving: '2 pieces' }),
  R(/mysore pak/i, 200, 3, 20, 12, { serving: '1 piece' }),
  R(/badusha/i, 250, 3, 34, 12, { serving: '1 piece' }),
  R(/halwa/i, 220, 3, 30, 10, { serving: '1 small cup' }),
  R(/payasam|kheer/i, 200, 5, 30, 7, { serving: '1 small cup' }),
  R(/basundh?i|rabdi/i, 130, 4, 14, 6, { serving: '60 ml' }),
  R(/ice cream/i, 140, 2, 16, 7, { serving: '1 scoop' }),
  R(/kalakand|peda/i, 150, 4, 18, 7, { serving: '1 piece' }),
  R(/laddu|ladoo/i, 190, 3, 26, 9, { serving: '1 piece' }),
  R(/tukda/i, 300, 6, 38, 14, { serving: '1 piece' }),
  R(/custard/i, 170, 4, 28, 5, { serving: '1 cup' }),

  R(/dal makhani|dal maharani/i, 220, 9, 22, 10, { serving: '1 cup' }),
  R(/sambar/i, 110, 5, 16, 3, { serving: '1 cup' }),
  R(/ma+j+iga pulusu/i, 90, 3, 8, 5, { serving: '1 cup' }),
  R(/rasam|pulusu/i, 60, 2, 9, 2, { serving: '1 cup' }),
  R(/dal chutney/i, 70, 3, 6, 4, { serving: '2 tbsp' }),
  R(/dal|pappu/i, 160, 9, 22, 4, { serving: '1 cup' }),
  R(/chole|rajma|kala chana|chickpea|red beans|chana masala/i, 210, 10, 28, 6, { serving: '1 cup' }),

  R(/raitha|raita/i, 80, 3, 6, 4, { serving: '1 small cup' }),
  R(/perugu chutney/i, 60, 2, 5, 3, { serving: '2 tbsp' }),
  R(/butter\s?milk/i, 40, 2, 3, 1.5, { serving: '1 glass' }),
  R(/lassi/i, 180, 6, 26, 5, { serving: '1 glass' }),
  R(/curd/i, 100, 5, 7, 6, { serving: '1 cup' }),
  R(/milk shake/i, 220, 7, 34, 6, { serving: '1 glass' }),
  R(/badam milk/i, 190, 6, 26, 7, { serving: '1 glass' }),
  R(/juice/i, 120, 1, 29, 0.3, { serving: '250 ml' }),
  R(/sharbath|sherbet/i, 90, 0, 23, 0, { serving: '1 glass' }),
  R(/lemon water/i, 20, 0, 4, 0.5, { serving: '1 glass' }),
  R(/\b(tea|coffee|milk)\b/i, 90, 3, 11, 3.5, { serving: '1 cup' }),
  R(/soup/i, 90, 3, 12, 3, { serving: '1 bowl' }),

  R(/raw banana fry/i, 140, 2, 22, 6, { serving: '1 cup' }),
  R(/banana/i, 105, 1, 27, 0.4, { serving: '1 banana' }),
  R(/guava/i, 70, 3, 14, 1, { serving: '1 fruit' }),
  R(/sweet lime|mosambi|orange/i, 60, 1, 14, 0.2, { serving: '1 fruit' }),
  R(/grapes/i, 70, 1, 18, 0.2, { serving: '1 cup' }),
  R(/cut fruit|papaya|melon|fruit/i, 60, 1, 14, 0.2, { serving: '1 cup' }),

  R(/papad/i, 45, 2, 6, 1.5, { serving: '1 papad' }),
  R(/fryums/i, 80, 1, 10, 4, { serving: '1 handful' }),
  R(/chips/i, 150, 2, 15, 10, { serving: '1 handful' }),
  R(/pickle|avakaya/i, 25, 0, 1, 2, { serving: '1 tsp' }),
  R(/sauce|salt mirchi/i, 20, 0, 5, 0, { serving: '1 tbsp' }),
  R(/chutney/i, 70, 2, 4, 5, { serving: '2 tbsp' }),
  R(/^onions?\b|onion small/i, 15, 0, 3, 0, { serving: 'few slices' }),

  R(/aloo|potato/i, 170, 3, 24, 7, { serving: '1 cup' }),
  R(/kurma|kolhapuri|jalfrezi|masala|gravy/i, 160, 4, 14, 10, { serving: '1 cup' }),
  R(/fry|poriyal|stir/i, 130, 3, 12, 8, { serving: '1 cup' }),
  R(/curry/i, 140, 3, 14, 8, { serving: '1 cup' }),
];

const FALLBACK = { kcal: 120, p: 3, c: 15, f: 5, serving: '1 serving' };
const round1 = (n) => Math.round(n * 10) / 10;

function estimatePart(text) {
  const rule = RULES.find((r) => r.re.test(text));
  if (!rule) return { ...FALLBACK, known: false, each: null };
  let count = 1;
  if (rule.each) {
    const pcs = /(\d+)\s*(?:big\s*)?pcs?\b/i.exec(text);
    count = pcs ? Number(pcs[1]) : rule.each;
  }
  return {
    kcal: rule.kcal * count,
    p: rule.p * count,
    c: rule.c * count,
    f: rule.f * count,
    serving: rule.each ? `${count} ${count === 1 ? 'piece' : 'pieces'}` : rule.serving,
    known: true,
    each: rule.each ? count : null,
  };
}

export function estimateItem(text) {
  const whole = RULES.find((r) => r.re.test(text));
  const comboFirst = whole && RULES.indexOf(whole) < 8;
  const parts = comboFirst ? [text] : text.split(/\s*,\s*(?![^()]*\))/).filter(Boolean);
  const est = parts.map(estimatePart);
  const sum = (k) => est.reduce((a, e) => a + e[k], 0);
  return {
    name: text,
    kcal: Math.round(sum('kcal')),
    protein: round1(sum('p')),
    carbs: round1(sum('c')),
    fat: round1(sum('f')),
    serving: est.map((e) => e.serving).join(' + '),
    known: est.every((e) => e.known),
  };
}

export function scale(item, qty) {
  return {
    ...item,
    qty,
    kcal: Math.round(item.kcal * qty),
    protein: round1(item.protein * qty),
    carbs: round1(item.carbs * qty),
    fat: round1(item.fat * qty),
  };
}

export function totals(items) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const i of items) {
    t.kcal += Number(i.kcal) || 0;
    t.protein += Number(i.protein) || 0;
    t.carbs += Number(i.carbs) || 0;
    t.fat += Number(i.fat) || 0;
  }
  return { kcal: Math.round(t.kcal), protein: round1(t.protein), carbs: round1(t.carbs), fat: round1(t.fat) };
}

const ACTIVITY = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 };
const GOAL_SHIFT = { lose: -400, maintain: 0, gain: 300 };

export function computeTargets(profile) {
  const { sex = 'male', age, heightCm, weightKg, activity = 'light', goal = 'maintain' } = profile || {};
  if (!age || !heightCm || !weightKg) return null;
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'female' ? -161 : 5);
  const tdee = bmr * (ACTIVITY[activity] || ACTIVITY.light);
  const kcal = Math.max(1200, Math.round((tdee + (GOAL_SHIFT[goal] || 0)) / 10) * 10);
  const protein = Math.round(weightKg * (goal === 'maintain' ? 1.2 : 1.6));
  const fat = Math.round((kcal * 0.27) / 9);
  const carbs = Math.round((kcal - protein * 4 - fat * 9) / 4);
  return { kcal, protein, carbs, fat, bmr: Math.round(bmr), tdee: Math.round(tdee) };
}

export const DEFAULT_TARGETS = { kcal: 2200, protein: 70, carbs: 300, fat: 65 };

const GROUPS = [
  ['Sweets', /cake|jamun|jilebi|jalebi|mysore pak|badusha|halwa|payasam|kheer|basundh|ice cream|laddu|ladoo|peda|kalakand|tukda|custard/i],
  ['Drinks', /\b(tea|coffee)\b|juice|sharbath|lemon water|shake|malt|badam milk|^milk\b/i],
  ['Meat, fish & egg', /chicken|mutton|fish|prawn|\begg|om(e)?let/i],
  ['Fried snacks', /samosa|puff|pakoda|pakora|bajji|bhajji|bonda|punugulu(?! curry)|vada|chips|fryums|papad|poori|puri\b|bhatur|\bchaa?t\b|manchuri|\b65\b/i],
  ['Paneer & dairy', /paneer|curd|raitha|raita|lassi|butter\s?milk|yogurt|\bmilk\b/i],
  ['Dal & legumes', /\bdal\b|pappu|sambar|rasam|pulusu|chole|rajma|chana|chick\s?pea|beans|sprouts|sundal|soya|soup/i],
  ['Condiments', /pickle|avakaya|chutney|sauce|podi|\bghee\b|^onions?\b|salt mirchi/i],
  ['Rice & grains', /rice|biryani|pula[vo]|bath\b|pulihora|pongal|upma|poha|kitchidi|khichdi|idl[iy]|\bdosa\b|utt?appam|pesarattu|roti|pulka|phulka|chapath?i|paratha|naan|t(h)?epla|bread|noodles|maggi|sevai|shavige|cornflakes|chocos|mu(e)?s(e)?li|uggani|\bpav\b/i],
  ['Fruit', /banana|grapes|fruit|papaya|melon|guava|sweet lime|mosambi|apple|orange|pomegranate/i],
  ['Vegetables', /salad|fry|curry|masala|poriyal|kurma|kolhapuri|jalfrezi|gravy|aloo|potato|bhindi|gourd|vegetable|veg\b/i],
];
export function groupFor(text) {
  return (GROUPS.find(([, re]) => re.test(text)) || ['Other'])[0];
}
