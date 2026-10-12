export const PROVIDERS = {
  gemini: {
    label: 'Gemini',
    by: 'Google',
    keyUrl: 'https://aistudio.google.com/apikey',
    models: ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'],
  },
  groq: {
    label: 'Groq',
    by: 'Groq',
    keyUrl: 'https://console.groq.com/keys',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    models: ['qwen/qwen3.8-27b'],
  },
  openrouter: {
    label: 'OpenRouter',
    by: 'OpenRouter',
    keyUrl: 'https://openrouter.ai/keys',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    models: ['openrouter/free', 'google/gemma-4-31b-it:free', 'google/gemma-4-26b-a4b-it:free'],
    headers: { 'X-Title': 'Annamaya' },
  },
  mistral: {
    label: 'Mistral',
    by: 'Mistral',
    keyUrl: 'https://console.mistral.ai/api-keys',
    url: 'https://api.mistral.ai/v1/chat/completions',
    models: ['mistral-small-latest', 'mistral-medium-latest'],
    imageAsString: true,
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);
const TIMEOUT_MS = 60000;

export function emptyConfig() {
  return { first: 'gemini', keys: Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])), models: Object.fromEntries(PROVIDER_IDS.map((id) => [id, ''])) };
}

export function normaliseConfig(saved) {
  const cfg = emptyConfig();
  if (!saved) return cfg;
  if (saved.key && !saved.keys) cfg.keys.gemini = saved.key;
  if (saved.model && !saved.models) cfg.models.gemini = saved.model;
  Object.assign(cfg.keys, saved.keys || {});
  Object.assign(cfg.models, saved.models || {});
  if (PROVIDERS[saved.first]) cfg.first = saved.first;
  return cfg;
}

export const hasKey = (ai) => PROVIDER_IDS.some((id) => (ai?.keys?.[id] || '').trim());

export function activeProviders(ai) {
  const order = [ai.first, ...PROVIDER_IDS.filter((id) => id !== ai.first)];
  return order.filter((id) => PROVIDERS[id] && (ai.keys[id] || '').trim());
}

const PLATE_SCHEMA = {
  type: 'object',
  properties: {
    is_food: { type: 'boolean', description: 'False when the photo does not show food or drink.' },
    summary: { type: 'string', description: 'One short line naming the plate, e.g. "Rice, dal, chicken curry and curd".' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          portion: { type: 'string', description: 'Visible portion in household units, e.g. "1.5 cups", "2 rotis".' },
          grams: { type: 'number' },
          kcal: { type: 'number' },
          protein_g: { type: 'number' },
          carbs_g: { type: 'number' },
          fat_g: { type: 'number' },
          menu_match: { type: 'string', description: 'Exact menu line this corresponds to, or empty string.' },
        },
        required: ['name', 'portion', 'grams', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'menu_match'],
        additionalProperties: false,
      },
    },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    notes: { type: 'string', description: 'One sentence on the main source of uncertainty.' },
  },
  required: ['is_food', 'summary', 'items', 'confidence', 'notes'],
  additionalProperties: false,
};

const PLATE_SYSTEM = `You estimate nutrition from a photo of a meal served in an Indian university hostel mess (VIT-AP, Andhra Pradesh).

Work from what is actually visible. Identify each distinct food on the plate, judge its portion from visual cues (plate and katori size, spoon, how far the rice spreads, number of rotis), convert to grams, then to calories and macros using typical values for home-style South and North Indian cooking. Mess food is cooked in moderate oil; gravies are roughly three-quarters vegetable to one-quarter gravy.

You are given the menu the mess served for this meal. Use it to name dishes correctly — a brown gravy is far more likely to be the listed curry than something else — but only report foods you can see. The person may have skipped items or taken extra helpings, and may have added something not on the menu.

List every item separately, including small ones such as pickle, papad and curd. Give honest single-number estimates rather than ranges. Set confidence to "low" when the photo is dark, blurry, partly eaten or mostly hidden.`;

class AiError extends Error {
  constructor(message, { retryable = false, final = false } = {}) {
    super(message);
    this.retryable = retryable;
    this.final = final;
  }
}

function explainHttp(provider, status, bodyText) {
  let detail = '';
  try {
    const j = JSON.parse(bodyText);
    detail = j.error?.message || j.message || (typeof j.error === 'string' ? j.error : '') || '';
  } catch {
    detail = bodyText.slice(0, 200);
  }
  detail = String(detail).slice(0, 220);
  if (status === 401 || status === 403) return new AiError(`${provider} rejected the API key. ${detail}`);
  if (status === 404) return new AiError(`${provider} does not recognise that model name. ${detail}`);
  if (status === 429) return new AiError(`${provider} rate limit or quota reached. ${detail}`, { retryable: true });
  if (status >= 500) return new AiError(`${provider} is having trouble right now (${status}).`, { retryable: true });
  return new AiError(`${provider} error ${status}: ${detail}`);
}

async function post(url, headers, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new AiError('The request timed out.', { retryable: true });
    throw new AiError('Could not reach the service. Check your internet connection.', { retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

function geminiText(data) {
  if (typeof data.output_text === 'string' && data.output_text) return data.output_text;
  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.type === 'thought' || node.thought === true) return;
    if (typeof node.text === 'string' && (node.type === undefined || node.type === 'text')) out.push(node.text);
    for (const key of ['outputs', 'output', 'steps', 'model_output', 'content', 'candidates', 'parts']) walk(node[key]);
  };
  walk(data);
  return out.join('');
}

async function geminiInteractions({ key, model, system, content, schema }) {
  const body = {
    model,
    system_instruction: system,
    input: content.map((c) => (c.type === 'image' ? { type: 'image', data: c.source.data, mime_type: c.source.media_type } : { type: 'text', text: c.text })),
    store: false,
  };
  if (schema) body.response_format = { type: 'text', mime_type: 'application/json', schema };
  return post('https://generativelanguage.googleapis.com/v1beta/interactions', { 'content-type': 'application/json', 'x-goog-api-key': key }, body);
}

async function geminiGenerateContent({ key, model, system, content, schema }) {
  const parts = content.map((c) => (c.type === 'image' ? { inlineData: { mimeType: c.source.media_type, data: c.source.data } } : { text: c.text }));
  if (schema) parts.push({ text: `Reply with JSON only, matching this JSON Schema exactly:\n${JSON.stringify(schema)}` });
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: schema ? { responseMimeType: 'application/json' } : {},
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  return post(url, { 'content-type': 'application/json', 'x-goog-api-key': key }, body);
}

async function geminiOnce(request) {
  let res = await geminiInteractions(request);
  let text = await res.text();
  if (res.status === 400 || res.status === 404) {
    const retry = await geminiGenerateContent(request);
    const retryText = await retry.text();
    if (retry.ok || (retry.status !== 400 && retry.status !== 404)) {
      res = retry;
      text = retryText;
    }
  }
  if (!res.ok) {
    const err = explainHttp('Gemini', res.status, text);
    err.status = res.status;
    throw err;
  }
  const data = JSON.parse(text);
  const answer = geminiText(data);
  if (!answer) throw new AiError(`Gemini returned no answer (${data.status || data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason || 'empty'}).`);
  return answer;
}

async function callGemini(request) {
  const models = [request.model, ...PROVIDERS.gemini.models.filter((m) => m !== request.model)];
  let last;
  for (const model of models) {
    try {
      return await geminiOnce({ ...request, model });
    } catch (err) {
      last = err;
      if (![404, 429, 500, 502, 503, 504].includes(err.status)) throw err;
    }
  }
  throw last;
}

async function callChat(id, { key, model, system, content, schema }) {
  const p = PROVIDERS[id];
  const instructions = schema ? `${system}\n\nReply with a single JSON object only, with no markdown, matching this JSON Schema:\n${JSON.stringify(schema)}` : system;
  const parts = [{ type: 'text', text: instructions }];
  for (const c of content) {
    if (c.type === 'image') {
      const url = `data:${c.source.media_type};base64,${c.source.data}`;
      parts.push({ type: 'image_url', image_url: p.imageAsString ? url : { url } });
    } else parts.push({ type: 'text', text: c.text });
  }
  const body = { model, messages: [{ role: 'user', content: parts }] };
  if (schema) body.response_format = { type: 'json_object' };
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${key}`, ...(p.headers || {}) };
  let res = await post(p.url, headers, body);
  let text = await res.text();
  if (res.status === 400 && body.response_format) {
    delete body.response_format;
    res = await post(p.url, headers, body);
    text = await res.text();
  }
  if (!res.ok) throw explainHttp(p.label, res.status, text);
  const message = JSON.parse(text).choices?.[0]?.message?.content;
  const answer = Array.isArray(message) ? message.map((m) => m.text || '').join('') : String(message || '');
  if (!answer.trim()) throw new AiError(`${p.label} returned no answer.`, { retryable: true });
  return answer;
}

function callOne(ai, id, request) {
  const key = (ai.keys[id] || '').trim();
  const model = (ai.models[id] || '').trim() || PROVIDERS[id].models[0];
  return id === 'gemini' ? callGemini({ ...request, key, model }) : callChat(id, { ...request, key, model });
}

async function call(ai, request, handle = (text) => text) {
  const ids = activeProviders(ai);
  if (!ids.length) throw new AiError('Add an AI key in Settings first.', { final: true });
  const failures = [];
  for (const id of ids) {
    try {
      const value = await handle(await callOne(ai, id, request));
      return { value, via: PROVIDERS[id].label };
    } catch (err) {
      if (err.final) throw err;
      failures.push({ id, err });
    }
  }
  if (failures.length === 1) throw failures[0].err;
  const message = `All ${failures.length} AI services failed. ${failures.map((f) => f.err.message).join(' ')}`;
  throw new AiError(message, { retryable: failures.some((f) => f.err.retryable) });
}

function parseJson(text) {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const m = /\{[\s\S]*\}/.exec(trimmed);
    if (m) return JSON.parse(m[0]);
    throw new AiError('The AI reply could not be read. Please try again.', { retryable: true });
  }
}

const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);

export async function analysePlate(ai, { imageBase64, meal, dateLabel, menuLines = [], hint = '' }) {
  const menuText = menuLines.length ? menuLines.map((l) => `- ${l}`).join('\n') : '(menu not available for this date)';
  const prompt = [
    `Meal: ${meal} on ${dateLabel}.`,
    `Menu served for this meal:\n${menuText}`,
    hint ? `Note from the person eating: ${hint}` : '',
    'Estimate the calories and macros of what is on this plate.',
  ].filter(Boolean).join('\n\n');
  const request = {
    system: PLATE_SYSTEM,
    schema: PLATE_SCHEMA,
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
      { type: 'text', text: prompt },
    ],
  };
  const { value, via } = await call(ai, request, (raw) => {
    const out = parseJson(raw);
    if (out.is_food === false) throw new AiError("That photo doesn't look like food. Try another shot of the plate.", { final: true });
    const items = (out.items || []).map((i) => ({
      name: String(i.name || 'Item'),
      portion: String(i.portion || ''),
      grams: Math.round(num(i.grams)),
      kcal: Math.round(num(i.kcal)),
      protein: Math.round(num(i.protein_g) * 10) / 10,
      carbs: Math.round(num(i.carbs_g) * 10) / 10,
      fat: Math.round(num(i.fat_g) * 10) / 10,
      menuMatch: String(i.menu_match || ''),
      qty: 1,
    }));
    if (!items.length) throw new AiError('No food could be identified in that photo.');
    return {
      summary: String(out.summary || ''),
      items,
      confidence: ['low', 'medium', 'high'].includes(out.confidence) ? out.confidence : 'medium',
      notes: String(out.notes || ''),
    };
  });
  return { ...value, via };
}

const COACH_SYSTEM = `You are a practical nutrition coach reading one student's food log from a university hostel mess in Andhra Pradesh. The numbers are estimates from photos and menu lookups, so treat them as approximate.

Write a short personal review in plain text: four short paragraphs, no headings, no bullet lists, no markdown. Cover what the pattern shows, what is going well, the one or two changes that would matter most, and concrete picks from this mess's own menu that would help (name actual dishes from the data). Be specific to these numbers, direct, and encouraging without flattery. Do not give medical advice or diagnose anything.`;

export async function coachReport(ai, stats) {
  const { value } = await call(ai, {
    system: COACH_SYSTEM,
    content: [{ type: 'text', text: `Here is the log summary as JSON:\n${JSON.stringify(stats)}` }],
  });
  return value.trim();
}

export async function prepareImage(file, maxSide = 1280, quality = 0.85) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
  const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * ratio);
  const h = Math.round(bitmap.height * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  return blob;
}

export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function ping(ai, id) {
  const text = await callOne(ai, id, { system: 'Reply with the single word OK.', content: [{ type: 'text', text: 'ping' }] });
  return text.trim().length > 0;
}

const DAY_SYSTEM = `You are a practical nutrition coach reviewing one day of eating for a student at a university hostel mess in Andhra Pradesh. The numbers are estimates from photos and menu lookups, so treat them as approximate.

Write a short personal review of this one day in plain text: four short paragraphs, no headings, no bullet lists, no markdown. Cover how the day went against the targets, which specific meals and dishes drove the calories and the protein, what one or two swaps from this mess's own food would have improved it (name the dishes, including any high-protein dishes served but not taken), and what to do at tomorrow's meals. If the day is not complete, say what the remaining meals should look like instead. Be specific to these numbers, direct, and encouraging without flattery. Do not give medical advice or diagnose anything.`;

export async function dayReview(ai, payload) {
  const { value } = await call(ai, { system: DAY_SYSTEM, content: [{ type: 'text', text: `Here is the day as JSON:\n${JSON.stringify(payload)}` }] });
  return value.trim();
}
