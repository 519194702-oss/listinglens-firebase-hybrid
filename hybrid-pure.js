/* ListingLens — pure helpers for the Firebase AI Logic hybrid path.
 *
 * No imports, no network, no Firebase: these functions are the part of
 * firebase-ai.js that can be unit-tested anywhere (Node or browser).
 * firebase-ai.js imports them; test/test-hybrid.mjs exercises them in the
 * browser and test/test-pure.mjs exercises them in Node.
 */

/** Build the optimization prompt sent to the model. */
export function buildHybridPrompt(input, keywords) {
  const lines = [
    'You are an expert Amazon listing copywriter, fluent in English and in Chinese e-commerce.',
    'Optimize the listing below. English title must be 200 characters or fewer and start with the primary keyword. Each bullet must be benefit-led ("HEADLINE: detail").',
    'The Chinese version must be localized for Chinese buyers (natural Taobao/JD-style copy), not a literal translation.',
    'Target keywords: ' + (keywords && keywords.length ? keywords.join(', ') : '(none)'),
    'Title: ' + (input.title || ''),
    'Bullets:',
    ...(input.bullets || []).map((b) => '- ' + b),
    'Description: ' + (input.description || ''),
    'Return ONLY the JSON object matching the schema.'
  ];
  return lines.join('\n');
}

/**
 * Normalize the SDK's inferenceSource to 'on-device' | 'cloud' | 'unknown'.
 * The docs say ON_DEVICE / IN_CLOUD; some SDK versions report the same
 * values in lower snake_case, so both are accepted.
 */
export function normalizeSource(raw) {
  const s = String(raw || '').toUpperCase();
  if (s === 'ON_DEVICE' || s === 'ON-DEVICE') return 'on-device';
  if (s === 'IN_CLOUD' || s === 'IN-CLOUD') return 'cloud';
  return 'unknown';
}

/**
 * Strictly validate model output. Returns a clean {en, cn} pair or null.
 * Missing/short bullet lists are topped up from the rules engine's output
 * (passed in as fallback) so the app never shows a half-finished listing;
 * a missing title or description is a hard failure and returns null.
 * When the model's Chinese side is missing or too short, the rules
 * engine's Chinese localization is used instead.
 */
export function parseListingJson(rawText, fallback) {
  if (typeof rawText !== 'string' || !rawText) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    // The model may wrap the JSON in prose; try the first {...} block.
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { parsed = JSON.parse(rawText.slice(start, end + 1)); } catch (e2) { return null; }
    } else {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const enTitle = str(parsed.title);
  const enDesc = str(parsed.description);
  if (!enTitle || !enDesc) return null;
  const cleanList = (arr) => (Array.isArray(arr) ? arr.map(str).filter(Boolean) : []);
  let enBullets = cleanList(parsed.bullets);
  let cnBullets = cleanList(parsed.bulletsCN);
  if (enBullets.length < 3) return null;
  // Top up short bullet lists from the rules engine so the output is whole.
  if (fallback && fallback.en) {
    while (enBullets.length < 5) enBullets.push(fallback.en.bullets[enBullets.length] || '');
    enBullets = enBullets.slice(0, 5);
  } else {
    enBullets = enBullets.slice(0, 5);
  }
  const cnTitle = str(parsed.titleCN);
  const cnDesc = str(parsed.descriptionCN);
  const cn =
    cnTitle && cnDesc && cnBullets.length >= 3
      ? {
          title: cnTitle,
          bullets: fallback && fallback.cn
            ? cnBullets.concat(fallback.cn.bullets.slice(cnBullets.length)).slice(0, 5)
            : cnBullets.slice(0, 5),
          description: cnDesc
        }
      : fallback && fallback.cn
        ? fallback.cn
        : null;
  if (!cn) return null;
  return { en: { title: enTitle, bullets: enBullets, description: enDesc }, cn };
}
