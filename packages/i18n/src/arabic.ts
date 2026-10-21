// FR/§10.2: تطبيع النص العربي قبل الفهرسة والبحث.
// إزالة التشكيل والتطويل، توحيد الهمزات (أ إ آ ← ا)، التاء المربوطة ← هاء، الألف المقصورة ← ياء.

const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭ]/g;
const TATWEEL = /ـ/g;

export function normalizeArabic(input: string): string {
  return input
    .normalize('NFC')
    .replace(DIACRITICS, '')
    .replace(TATWEEL, '')
    .replace(/[آأإٱ]/g, 'ا') // آ أ إ ٱ ← ا
    .replace(/ؤ/g, 'و') // ؤ ← و
    .replace(/ئ/g, 'ي') // ئ ← ي
    .replace(/ة/g, 'ه') // ة ← ه
    .replace(/ى/g, 'ي') // ى ← ي
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const ARABIC_INDIC = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

export type NumeralSystem = 'arab' | 'latn';

/** §10.2: إعداد لكل مستخدم بين الأرقام العربية (٠١٢) والغربية (012). */
export function toNumerals(value: string | number, system: NumeralSystem): string {
  const text = String(value);
  if (system === 'latn') {
    return text.replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)));
  }
  return text.replace(/[0-9]/g, (d) => ARABIC_INDIC[Number(d)]!);
}
