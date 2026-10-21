// NFR-14: كل النصوص مترجمة في العربية والإنجليزية — فحص آلي في خط البناء.
// يفشل إن اختلفت المفاتيح بين اللغتين، أو كانت قيمة فارغة، أو كانت صيغة ICU غير صالحة.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { IntlMessageFormat } from 'intl-messageformat';

const dir = new URL('../messages/', import.meta.url);
const load = (l) => JSON.parse(readFileSync(fileURLToPath(new URL(`${l}.json`, dir)), 'utf8'));

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

const locales = ['ar', 'en'];
const flat = Object.fromEntries(locales.map((l) => [l, flatten(load(l))]));
const errors = [];
const allKeys = new Set(locales.flatMap((l) => Object.keys(flat[l])));

for (const key of allKeys) {
  for (const l of locales) {
    const value = flat[l][key];
    if (typeof value !== 'string' || value.trim() === '') {
      errors.push(`[${l}] مفتاح مفقود أو فارغ: ${key}`);
      continue;
    }
    try {
      new IntlMessageFormat(value, l);
    } catch (e) {
      errors.push(`[${l}] صيغة ICU غير صالحة في ${key}: ${e.message}`);
    }
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`✓ ${allKeys.size} مفتاحاً مترجماً بالكامل في: ${locales.join('، ')}`);
