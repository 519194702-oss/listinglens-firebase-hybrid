#!/usr/bin/env node
/* Node unit tests for hybrid-pure.js (no Firebase, no browser).
 * Usage: node test/test-pure.mjs — exit 0 = all checks passed.
 */
import { buildHybridPrompt, normalizeSource, parseListingJson } from '../hybrid-pure.js';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' — ' + detail : ''));
}

check('normalizeSource ON_DEVICE', normalizeSource('ON_DEVICE') === 'on-device');
check('normalizeSource on_device (lowercase)', normalizeSource('on_device') === 'on-device');
check('normalizeSource IN_CLOUD', normalizeSource('IN_CLOUD') === 'cloud');
check('normalizeSource in_cloud (lowercase)', normalizeSource('in_cloud') === 'cloud');
check('normalizeSource unknown stays unknown', normalizeSource('SOMETHING_ELSE') === 'unknown' && normalizeSource(null) === 'unknown');

const good = parseListingJson(JSON.stringify({
  title: 'Test Title Here',
  bullets: ['A: one', 'B: two', 'C: three', 'D: four', 'E: five'],
  description: 'Desc here.',
  titleCN: '测试标题',
  bulletsCN: ['一', '二', '三', '四', '五'],
  descriptionCN: '中文描述。'
}), null);
check('parseListingJson accepts valid JSON', good && good.en.title === 'Test Title Here' && good.en.bullets.length === 5 && good.cn.title === '测试标题');

check('parseListingJson rejects garbage', parseListingJson('not json at all', null) === null);
check('parseListingJson rejects missing title', parseListingJson(JSON.stringify({ bullets: ['a', 'b', 'c', 'd', 'e'], description: 'x' }), null) === null);
check('parseListingJson rejects empty string', parseListingJson('', null) === null);

const wrapped = parseListingJson('Here is the result:\n{"title":"Wrapped","bullets":["a","b","c","d","e"],"description":"d","titleCN":"包","bulletsCN":["一","二","三","四","五"],"descriptionCN":"描"}\nHope this helps!', null);
check('parseListingJson extracts JSON wrapped in prose', wrapped && wrapped.en.title === 'Wrapped');

const fb = {
  en: { title: 'FB', bullets: ['F1', 'F2', 'F3', 'F4', 'F5'], description: 'fd' },
  cn: { title: '回', bullets: ['回1', '回2', '回3', '回4', '回5'], description: '回描' }
};
const short = parseListingJson(JSON.stringify({
  title: 'Short Bullets',
  bullets: ['A: one', 'B: two', 'C: three'],
  description: 'Desc.',
  titleCN: '短',
  bulletsCN: ['一', '二', '三'],
  descriptionCN: '描。'
}), fb);
check('parseListingJson tops up short EN bullets from fallback', short && short.en.bullets.length === 5 && short.en.bullets[3] === 'F4' && short.en.bullets[4] === 'F5');
check('parseListingJson tops up short CN bullets from fallback', short && short.cn.bullets.length === 5 && short.cn.bullets[3] === '回4');

const noCn = parseListingJson(JSON.stringify({
  title: 'No CN', bullets: ['a', 'b', 'c', 'd', 'e'], description: 'd'
}), fb);
check('parseListingJson falls back to rules CN when model CN missing', noCn && noCn.cn.title === '回');

const tooShort = parseListingJson(JSON.stringify({
  title: 'Too Short', bullets: ['a', 'b'], description: 'd',
  titleCN: '短', bulletsCN: ['一', '二'], descriptionCN: '描'
}), fb);
check('parseListingJson rejects fewer than 3 bullets', tooShort === null);

const prompt = buildHybridPrompt(
  { title: 'Bottle', bullets: ['Keeps cold'], description: 'Steel bottle.' },
  ['insulated water bottle']
);
check('buildHybridPrompt includes keywords', prompt.indexOf('insulated water bottle') >= 0);
check('buildHybridPrompt includes title and bullets', prompt.indexOf('Bottle') >= 0 && prompt.indexOf('Keeps cold') >= 0);
check('buildHybridPrompt asks for JSON only', prompt.indexOf('Return ONLY the JSON object') >= 0);

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed.`);
process.exit(passed === results.length ? 0 : 1);
