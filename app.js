'use strict';
/* ListingLens — bilingual Amazon listing optimizer.
 * Pure logic is testable in Node (module.exports guard at the bottom);
 * DOM wiring runs only when `document` exists.
 * Demo mode needs no API key. BYOK (own OpenAI key) is optional. */

/* ---------------- sample product (weak listing, good product) ---------------- */
const SAMPLE = {
  title: 'Water Bottle',
  bullets: [
    'Good bottle',
    'Keeps water cold',
    'Nice design',
    'Easy to carry',
    'Good for gym'
  ],
  description: 'This is a water bottle made of 18/8 stainless steel with double-wall vacuum insulation. It holds 32 oz. The lid has a straw and does not leak. It is BPA free.',
  keywords: 'insulated water bottle, stainless steel water bottle, 32 oz water bottle, leak proof water bottle, gym water bottle'
};

/* ---------------- helpers ---------------- */
const SMALL_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'for', 'with', 'of', 'in', 'on', 'to', 'by']);
const KEEP_CASE = new Set(['bpa', 'oz', 'ml', 'fda', 'usb', 'led']);

function titleCase(s) {
  return s.split(/\s+/).map((w, i) => {
    const low = w.toLowerCase();
    if (KEEP_CASE.has(low)) return (low === 'oz' || low === 'ml') ? low : low.toUpperCase();
    if (i > 0 && SMALL_WORDS.has(low)) return low;
    return low.charAt(0).toUpperCase() + low.slice(1);
  }).join(' ');
}

function parseKeywords(raw) {
  return (raw || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
    .filter((k, i, a) => a.indexOf(k) === i);
}

function normText(t) { return (t || '').toLowerCase(); }

/* ---------------- fact extraction ---------------- */
function extractFacts(input) {
  const kwText = Array.isArray(input.keywords) ? input.keywords.join(' ') : (input.keywords || '');
  const all = [input.title, (input.bullets || []).join(' '), input.description, kwText].join(' ');
  const facts = {};
  const cap = all.match(/(\d+(?:\.\d+)?)\s*(oz|ml|l|liters?|litres?)\b/i);
  if (cap) {
    facts.capacity = cap[1] + ' ' + (cap[2].toLowerCase() === 'oz' ? 'oz' : cap[2].toLowerCase());
    facts.capacityMl = /oz/i.test(cap[2]) ? Math.round(parseFloat(cap[1]) * 29.5735) : null;
  }
  if (/18\s*\/\s*8|stainless/i.test(all)) facts.material = '18/8 stainless steel';
  else if (/steel/i.test(all)) facts.material = 'stainless steel';
  if (/vacuum|insulat/i.test(all)) facts.insulated = true;
  if (/leak[-\s]?proof|does not leak|no leak|leakproof/i.test(all)) facts.leakproof = true;
  if (/straw/i.test(all)) facts.strawLid = true;
  if (/bpa[-\s]?free/i.test(all)) facts.bpaFree = true;
  const uses = [];
  if (/\bgym\b/i.test(all)) uses.push('gym');
  if (/hiking|trail|outdoor|camping/i.test(all)) uses.push('outdoor');
  if (/office|desk|work/i.test(all)) uses.push('office');
  if (/school|kids/i.test(all)) uses.push('school');
  facts.uses = uses;
  return facts;
}

/* ---------------- scoring ---------------- */
const BANNED_WORDS = ['best', 'no.1', '#1', 'guaranteed', 'amazing', 'perfect', 'number 1', 'top rated'];
const ALLOWED_ACRONYMS = new Set(['BPA', 'FDA', 'USB', 'LED', 'UV']);

function allCapsWords(text) {
  // Ignore the headline prefix before the first ':' (Amazon-style lead-ins).
  const body = text.includes(':') ? text.slice(text.indexOf(':') + 1) : text;
  return (body.match(/\b[A-Z]{3,}\b/g) || []).filter(w => !ALLOWED_ACRONYMS.has(w));
}

function keywordFound(kw, title, hay) {
  // Found if the exact phrase appears anywhere (hyphens treated as spaces),
  // or if every word of the keyword appears in the title (Amazon weights title words heavily).
  const norm = s => s.toLowerCase().replace(/-/g, ' ');
  if (norm(hay).includes(norm(kw))) return true;
  const titleWords = new Set(norm(title).split(/[^a-z0-9]+/).filter(Boolean));
  return norm(kw).split(/[^a-z0-9]+/).filter(Boolean).every(w => titleWords.has(w));
}

function scoreListing(listing, keywords) {
  const title = listing.title || '';
  const bullets = listing.bullets || [];
  const desc = listing.description || '';
  const hay = normText([title, bullets.join(' '), desc].join(' '));
  const parts = {};
  const suggestions = [];

  // 1. Keyword coverage (25)
  if (!keywords.length) {
    parts.keyword = 0;
    suggestions.push('Add target keywords — keyword coverage cannot be measured without them.');
  } else {
    const found = keywords.filter(k => keywordFound(k, title, hay));
    parts.keyword = Math.round(25 * found.length / keywords.length);
    keywords.filter(k => !keywordFound(k, title, hay)).forEach(k => {
      suggestions.push('Add the keyword "' + k + '" to the title or a bullet point.');
    });
  }

  // 2. Title (25): length 15 + primary keyword first 10
  const tlen = title.length;
  parts.title = 0;
  if (tlen >= 120 && tlen <= 200) parts.title += 15;
  else if (tlen >= 80 && tlen < 120) parts.title += 10;
  else parts.title += 5;
  if (tlen < 120 || tlen > 200) suggestions.push('Title is ' + tlen + ' characters — aim for 120–200 characters.');
  if (keywords.length && normText(title).startsWith(keywords[0])) parts.title += 10;
  else if (keywords.length) suggestions.push('Put your primary keyword "' + keywords[0] + '" at the start of the title.');

  // 3. Bullets (25): count 10 + length 10 + benefit-led 5
  parts.bullets = 0;
  if (bullets.length >= 5) parts.bullets += 10;
  else {
    parts.bullets += bullets.length * 2;
    suggestions.push('Use all 5 bullet points — you have ' + bullets.length + '.');
  }
  let lenOk = 0, ledOk = 0;
  bullets.forEach(b => {
    if (b.length >= 60 && b.length <= 250) lenOk++;
    if (b.includes(':')) ledOk++;
  });
  parts.bullets += Math.min(10, lenOk * 2) + Math.min(5, ledOk);
  if (lenOk < bullets.length) suggestions.push('Keep each bullet between 60 and 250 characters.');
  if (ledOk < bullets.length) suggestions.push('Start each bullet with a benefit headline, e.g. "LEAK-PROOF: ...".');

  // 4. Readability (25)
  parts.readability = 25;
  const caps = [title].concat(bullets, [desc]).flatMap(part => allCapsWords(part));
  if (caps.length) {
    parts.readability -= 5;
    suggestions.push('Avoid words in ALL CAPS in the body text (' + caps.slice(0, 3).join(', ') + ').');
  }
  if (/!!|\?\?/.test(title + desc)) {
    parts.readability -= 5;
    suggestions.push('Remove repeated exclamation or question marks.');
  }
  const banned = BANNED_WORDS.filter(w => hay.includes(w));
  if (banned.length) {
    parts.readability -= 5;
    suggestions.push('Avoid superlatives Amazon flags, e.g. "' + banned[0] + '".');
  }
  if (bullets.some(b => b.length > 300)) {
    parts.readability -= 5;
    suggestions.push('Shorten bullets over 300 characters.');
  }
  parts.readability = Math.max(0, parts.readability);

  const total = Math.max(0, Math.min(100, parts.keyword + parts.title + parts.bullets + parts.readability));
  return { total, parts, suggestions };
}

/* ---------------- EN optimization (rules engine) ---------------- */
function joinTitle(segments) {
  return segments.length > 1 ? segments[0] + ' - ' + segments.slice(1).join(', ') : segments[0];
}

function optimizeENTitle(input, facts, keywords) {
  const primary = keywords.length ? titleCase(keywords[0]) : titleCase(input.title || 'Product');
  const segments = [primary];
  if (facts.capacity) segments.push(facts.capacity);
  if (facts.material) segments.push(titleCase(facts.material));
  if (facts.leakproof) segments.push('Leak Proof');
  if (facts.uses && facts.uses.length) segments.push(titleCase(facts.uses[0]) + ' Water Bottle');
  if (facts.strawLid) segments.push('with Straw Lid');
  if (facts.bpaFree) segments.push('BPA-Free');
  let title = joinTitle(segments);
  if (title.length > 200) {
    // Drop lowest-priority trailing segments until it fits.
    while (title.length > 200 && segments.length > 2) {
      segments.pop();
      title = joinTitle(segments);
    }
    if (title.length > 200) title = title.slice(0, 197) + '...';
  }
  return title;
}

function factBulletsEN(facts) {
  const out = [];
  if (facts.insulated) out.push('24-HOUR COLD, 12-HOUR HOT: Double-wall vacuum insulation keeps drinks ice-cold for 24 hours or hot for 12 — with zero condensation or sweating.');
  if (facts.leakproof) out.push('LEAK-PROOF STRAW LID: The flip-top straw lid seals tight for spill-free sipping on the go, and pops open with one hand.');
  if (facts.material) out.push('PREMIUM 18/8 STAINLESS STEEL: Food-grade 18/8 stainless steel will not rust, retains no flavor, and is built to last.');
  if (facts.capacity) {
    const ml = facts.capacityMl ? ' (' + facts.capacityMl + ' ml)' : '';
    const use = facts.uses && facts.uses.length ? ' — sized for the ' + facts.uses.join(', the ') + '.' : '.';
    out.push('ALL-DAY HYDRATION: A full ' + facts.capacity + ml + ' means fewer refills' + use);
  }
  if (facts.bpaFree) out.push('BPA-FREE & SAFE: Made with 100% BPA-free materials, so every sip is clean and safe for the whole family.');
  return out;
}

function rewriteBulletEN(text) {
  let t = (text || '').trim().replace(/\.$/, '');
  if (!t) return '';
  const low = t.toLowerCase();
  if (/cold|insulat|hot/.test(low)) return 'KEEPS DRINKS COLD: ' + t.charAt(0).toUpperCase() + t.slice(1) + ' — insulation that actually lasts all day.';
  if (/carry|portable|light/.test(low)) return 'LIGHTWEIGHT & PORTABLE: ' + t.charAt(0).toUpperCase() + t.slice(1) + ' — easy to take anywhere.';
  if (/design|look|color|style/.test(low)) return 'CLEAN, MODERN DESIGN: ' + t.charAt(0).toUpperCase() + t.slice(1) + ' — looks good anywhere you take it.';
  if (/gym|workout|sport|fitness/.test(low)) return 'BUILT FOR ACTIVE DAYS: ' + t.charAt(0).toUpperCase() + t.slice(1) + ' — your gym and trail companion.';
  return 'EVERYDAY ESSENTIAL: ' + t.charAt(0).toUpperCase() + t.slice(1) + '.';
}

function optimizeEN(input, facts, keywords) {
  const title = optimizeENTitle(input, facts, keywords);
  let bullets = factBulletsEN(facts);
  const rewritten = (input.bullets || []).map(rewriteBulletEN).filter(Boolean);
  // Add rewritten originals that are not near-duplicates of fact bullets.
  rewritten.forEach(rb => {
    if (bullets.length < 5 && !bullets.some(b => b.toLowerCase().includes(rb.split(':')[0].toLowerCase().slice(0, 8)))) bullets.push(rb);
  });
  // At most one generic filler bullet.
  if (bullets.length < 5) {
    bullets.push('SATISFACTION PROMISE: If you are not completely happy with your purchase, contact us — we will make it right.');
  }
  bullets = bullets.slice(0, 5);
  const noun = keywords.length ? keywords[0] : 'product';
  const mat = facts.material ? 'food-grade ' + facts.material : 'premium materials';
  let p1 = 'Meet your new everyday companion. ';
  if (facts.insulated) {
    p1 += 'This ' + (facts.capacity ? facts.capacity + ' ' : '') + noun + ' pairs ' + mat + ' with double-wall vacuum insulation to keep drinks cold for 24 hours or hot for 12. ';
  } else {
    p1 += 'This ' + noun + ' is made with ' + mat + ' and built to last. ';
  }
  if (facts.leakproof) p1 += 'The leak-proof straw lid seals tight for spill-free sipping on the go. ';
  if (facts.bpaFree) p1 += 'The BPA-free build keeps every sip clean.';
  let p2;
  if (facts.capacity) {
    p2 = 'From morning workouts to long hikes and busy workdays, one fill lasts for hours — fewer refills, more doing. Rinse, refill, and go: this ' + noun + ' is the one you will reach for every day.';
  } else {
    p2 = 'Made for everyday use — at home, at work, or on the go. Rinse and enjoy: it is the one you will reach for every day.';
  }
  return { title, bullets, description: p1.trim() + '\n\n' + p2 };
}

/* ---------------- CN localization (true localization, not literal translation) ---------------- */
function cnCoreTerm(keywords, facts) {
  const kw = (keywords || []).join(' ');
  if (/water bottle|insulated/.test(kw) || facts.insulated) return '保温水杯';
  if (/\bmug\b/.test(kw)) return '马克杯';
  if (/\bbottle\b/.test(kw)) return '水杯';
  if (/\bcup\b/.test(kw)) return '水杯';
  return keywords.length ? keywords[0] : '商品';
}

function localizeCN(en, facts, keywords) {
  const capCN = facts.capacity ? facts.capacity.replace('oz', 'oz（约' + (facts.capacityMl || '') + 'ml）') : '';
  const coreCN = cnCoreTerm(keywords, facts);
  const titleParts = [coreCN];
  if (capCN) titleParts.push(capCN);
  if (facts.material) titleParts.push('18/8食品级不锈钢');
  if (facts.leakproof) titleParts.push('防漏吸管盖');
  if (facts.bpaFree) titleParts.push('BPA免费');
  if (facts.uses && facts.uses.length) {
    const useCN = { gym: '健身', outdoor: '户外', office: '办公', school: '上学' };
    titleParts.push(facts.uses.map(u => useCN[u] || u).join('/') + '便携');
  }
  const title = titleParts.join(' ');

  const bullets = [];
  if (facts.insulated) bullets.push('24小时保冷，12小时保温：双层真空隔热，冰水放一整天还是冰的，热水半天还烫手，杯身不起水珠、不烫手。');
  if (facts.leakproof) bullets.push('防漏吸管盖：翻盖吸管设计，密封严实不漏水，单手就能打开喝水，运动、开车都方便。');
  if (facts.material) bullets.push('18/8食品级不锈钢：食品级 18/8 不锈钢，不生锈、不串味，结实耐用。');
  if (facts.capacity) {
    const useCN = facts.uses && facts.uses.length ? { gym: '健身', outdoor: '爬山', office: '上班', school: '上学' } : {};
    const useText = facts.uses && facts.uses.length ? facts.uses.map(u => useCN[u] || u).join('、') + '一整天不用频繁接水。' : '一整天不用频繁接水。';
    bullets.push(facts.capacity + '大容量：一次装满 ' + facts.capacity + (facts.capacityMl ? '（约' + facts.capacityMl + 'ml）' : '') + '，' + useText);
  }
  if (facts.bpaFree) bullets.push('BPA免费，喝得放心：100% 不含 BPA，全家人都能放心用。');
  // At most one generic filler bullet.
  if (bullets.length < 5) {
    bullets.push('贴心售后：收到后有任何问题请联系我们，我们会负责到底。');
  }
  let c1 = '每天陪你的补水搭子。';
  if (facts.insulated) {
    c1 += '这款' + (capCN ? capCN + ' ' : '') + coreCN + '采用' + (facts.material ? '食品级 18/8 不锈钢' : '优质材质') + '，双层真空隔热，保冷 24 小时、保温 12 小时。';
  } else {
    c1 += '这款' + coreCN + '用料扎实，做工细致。';
  }
  if (facts.leakproof) c1 += '防漏吸管盖喝水方便，密封严实不漏水。';
  if (facts.bpaFree) c1 += 'BPA 免费，每一口都放心。';
  const c2 = facts.capacity
    ? '早上健身、周末爬山、上班忙碌，一次装满能喝好几个小时，不用总跑去接水。冲一冲、装满水、带上走，就是每天都会伸手去拿的那只杯子。'
    : '居家、办公、出门都能用，冲一冲就能接着用，就是每天都会伸手去拿的那只杯子。';
  return { title, bullets: bullets.slice(0, 5), description: c1.trim() + '\n\n' + c2 };
}

/* ---------------- full optimization ---------------- */
function optimizeListing(input) {
  const kwRaw = Array.isArray(input.keywords) ? input.keywords.join(', ') : (input.keywords || '');
  const keywords = parseKeywords(kwRaw);
  const facts = extractFacts(input);
  const before = scoreListing(
    { title: input.title || '', bullets: input.bullets || [], description: input.description || '' },
    keywords
  );
  const en = optimizeEN(input, facts, keywords);
  const after = scoreListing(en, keywords);
  const cn = localizeCN(en, facts, keywords);
  return { en, cn, before, after, facts, keywords };
}

/* ---------------- BYOK live AI (optional) ---------------- */
async function optimizeWithLLM(input, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        messages: [
          { role: 'system', content: 'You are an expert Amazon listing copywriter who is fluent in English and Chinese e-commerce. Return ONLY valid JSON with keys: title, bullets (array of 5 strings), description, titleCN, bulletsCN (array of 5 strings), descriptionCN. English title must be 200 characters or fewer. Bullets must be benefit-led ("HEADLINE: detail"). The Chinese version must be localized for Chinese buyers (natural Taobao/JD-style copy), not a literal translation.' },
          { role: 'user', content: 'Optimize this Amazon listing. Target keywords: ' + (input.keywords || []).join(', ') + '\nTitle: ' + (input.title || '') + '\nBullets:\n' + (input.bullets || []).join('\n') + '\nDescription: ' + (input.description || '') }
        ]
      })
    });
    if (!res.ok) throw new Error('OpenAI request failed: ' + res.status);
    const data = await res.json();
    const parsed = JSON.parse(data.choices[0].message.content);
    if (!parsed.title || !Array.isArray(parsed.bullets) || parsed.bullets.length < 1) throw new Error('Unexpected AI response shape');
    return {
      title: parsed.title,
      bullets: parsed.bullets.slice(0, 5),
      description: parsed.description || ''
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- DOM wiring (browser only) ---------------- */
if (typeof document !== 'undefined') {
  const $ = id => document.getElementById(id);
  const KEY_STORAGE = 'listinglens_openai_key';

  function fillInputs(p) {
    $('in-title').value = p.title || '';
    $('in-bullets').value = (p.bullets || []).join('\n');
    $('in-desc').value = p.description || '';
    $('in-keywords').value = Array.isArray(p.keywords) ? p.keywords.join(', ') : (p.keywords || '');
  }

  function showError(msg) {
    const el = $('input-error');
    if (!msg) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false; el.textContent = msg;
  }

  function renderScore(res) {
    $('score-card').hidden = false;
    $('score-before').textContent = res.before.total;
    $('score-after').textContent = res.after.total;
    $('bar-before').style.width = res.before.total + '%';
    $('bar-after').style.width = res.after.total + '%';
    const labels = { keyword: 'Keyword coverage', title: 'Title', bullets: 'Bullet points', readability: 'Readability' };
    $('breakdown').innerHTML = '';
    Object.keys(labels).forEach(k => {
      const row = document.createElement('div');
      row.className = 'bd-row';
      const a = document.createElement('span'); a.textContent = labels[k] + ' (after)';
      const b = document.createElement('b'); b.textContent = res.after.parts[k] + ' / 25';
      row.appendChild(a); row.appendChild(b);
      $('breakdown').appendChild(row);
    });
    const sug = $('suggestions');
    sug.innerHTML = '';
    if (res.after.suggestions.length) {
      const h = document.createElement('h4'); h.textContent = 'Still to fix';
      const ul = document.createElement('ul');
      res.after.suggestions.forEach(s => {
        const li = document.createElement('li'); li.textContent = s; ul.appendChild(li);
      });
      sug.appendChild(h); sug.appendChild(ul);
    }
  }

  function setInferenceBadge(source, modelName, latencyMs) {
    const badge = $('path-badge');
    badge.hidden = false;
    const lat = (latencyMs != null) ? ' · ' + (latencyMs / 1000).toFixed(1) + 's' : '';
    if (source === 'on-device') {
      badge.className = 'path-badge on-device';
      badge.textContent = '🖥️ On-device · ' + modelName + lat + ' — nothing left this device';
    } else if (source === 'cloud' || source === 'openai') {
      badge.className = 'path-badge cloud';
      badge.textContent = '☁️ Cloud · ' + modelName + lat;
    } else {
      badge.className = 'path-badge rules';
      badge.textContent = '⚙️ ' + modelName + lat;
    }
  }

  function updateHybridStatus() {
    const hybrid = window.ListingLensHybrid;
    const statusEl = $('hybrid-status');
    const box = $('in-use-hybrid');
    if (!hybrid) {
      statusEl.textContent = 'Hybrid AI module is still loading…';
      box.disabled = true;
      return;
    }
    const st = hybrid.getStatus();
    statusEl.textContent = st.message + (st.appCheckState === 'failed' ? ' (App Check init failed — see console.)' : '');
    if (st.state === 'not-configured') {
      box.checked = false;
      box.disabled = true;
    } else {
      box.disabled = false;
    }
  }

  function renderOutput(en, cn, note) {
    $('output-card').hidden = false;
    $('engine-note').textContent = note;
    $('en-title').textContent = en.title;
    $('en-title-count').textContent = '(' + en.title.length + ' chars)';
    const eb = $('en-bullets'); eb.innerHTML = '';
    en.bullets.forEach(b => { const li = document.createElement('li'); li.textContent = b; eb.appendChild(li); });
    $('en-desc').textContent = en.description;
    $('cn-title').textContent = cn.title;
    $('cn-title-count').textContent = '(' + cn.title.length + ' 字)';
    const cb = $('cn-bullets'); cb.innerHTML = '';
    cn.bullets.forEach(b => { const li = document.createElement('li'); li.textContent = b; cb.appendChild(li); });
    $('cn-desc').textContent = cn.description;
  }

  function collectInput() {
    return {
      title: $('in-title').value.trim(),
      bullets: $('in-bullets').value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 5),
      description: $('in-desc').value.trim(),
      keywords: parseKeywords($('in-keywords').value)
    };
  }

  function textForCopy(key) {
    switch (key) {
      case 'en-title': return $('en-title').textContent;
      case 'en-bullets': return Array.from($('en-bullets').children).map(li => li.textContent).join('\n');
      case 'en-desc': return $('en-desc').textContent;
      case 'cn-title': return $('cn-title').textContent;
      case 'cn-bullets': return Array.from($('cn-bullets').children).map(li => li.textContent).join('\n');
      case 'cn-desc': return $('cn-desc').textContent;
      default: return '';
    }
  }

  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e2) { /* ignore */ }
      document.body.removeChild(ta);
    }
    const old = btn.textContent;
    btn.textContent = 'Copied ✓';
    setTimeout(() => { btn.textContent = old; }, 1500);
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Hybrid AI status: the firebase-ai.js module loads as an ES module and
    // may arrive after this handler runs, so check now and on its ready event.
    updateHybridStatus();
    window.addEventListener('listinglens-hybrid-ready', updateHybridStatus);
    setTimeout(() => {
      if (!window.ListingLensHybrid) {
        $('hybrid-status').textContent = 'Hybrid AI module did not load (could not reach the Firebase CDN) — the rules engine is running instead.';
        $('in-use-hybrid').disabled = true;
      }
    }, 5000);

    // Restore saved key if the user opted in before.
    try {
      const saved = localStorage.getItem(KEY_STORAGE);
      if (saved) { $('in-apikey').value = saved; $('in-remember').checked = true; $('key-status').textContent = 'A key is saved in this browser.'; }
    } catch (e) { /* storage unavailable */ }

    $('btn-sample').addEventListener('click', () => { fillInputs(SAMPLE); showError(''); });

    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        $('out-en').hidden = tab.dataset.lang !== 'en';
        $('out-cn').hidden = tab.dataset.lang !== 'cn';
      });
    });

    document.querySelectorAll('.btn.copy').forEach(btn => {
      btn.addEventListener('click', () => copyText(textForCopy(btn.dataset.copy), btn));
    });

    $('btn-clear-key').addEventListener('click', () => {
      try { localStorage.removeItem(KEY_STORAGE); } catch (e) { /* ignore */ }
      $('in-apikey').value = '';
      $('in-remember').checked = false;
      $('key-status').textContent = 'Saved key cleared.';
    });

    $('btn-optimize').addEventListener('click', async () => {
      const input = collectInput();
      if (!input.title && !input.bullets.length && !input.description) {
        showError('Paste a title, bullets, or description first — or load the sample product.');
        return;
      }
      showError('');
      const btn = $('btn-optimize');
      btn.disabled = true;
      btn.textContent = 'Optimizing…';
      try {
        const key = $('in-apikey').value.trim();
        if ($('in-remember').checked && key) {
          try { localStorage.setItem(KEY_STORAGE, key); } catch (e) { /* ignore */ }
        } else if (!$('in-remember').checked) {
          try { localStorage.removeItem(KEY_STORAGE); } catch (e) { /* ignore */ }
        }
        const res = optimizeListing(input);
        let note = 'Optimized with the built-in rules engine (demo mode — no API key used).';
        // 1) Firebase AI Logic hybrid inference (on-device first, cloud fallback).
        const hybrid = window.ListingLensHybrid;
        if ($('in-use-hybrid').checked && hybrid && hybrid.isConfigured()) {
          try {
            const ai = await hybrid.optimize(input, res.keywords, { en: res.en, cn: res.cn },
              (m) => { btn.textContent = m; });
            const afterAI = scoreListing(ai.en, res.keywords);
            renderScore({ before: res.before, after: afterAI });
            renderOutput(ai.en, ai.cn, 'Optimized with Firebase AI Logic hybrid inference.');
            setInferenceBadge(ai.source, ai.modelName, ai.latencyMs);
            return;
          } catch (e) {
            note = 'Hybrid AI failed (' + (e && e.message ? e.message : 'error') + ') — fell back to the built-in rules engine.';
          }
        }
        // 2) Optional live AI via the user's own OpenAI key.
        if ($('in-use-ai').checked && key) {
          try {
            const aiEn = await optimizeWithLLM(input, key);
            const aiCn = localizeCN(aiEn, res.facts, res.keywords);
            const afterAI = scoreListing(aiEn, res.keywords);
            renderScore({ before: res.before, after: afterAI });
            renderOutput(aiEn, aiCn, 'Optimized with live AI (GPT-4o-mini). Chinese version localized by the built-in localizer.');
            setInferenceBadge('openai', 'GPT-4o-mini (BYOK OpenAI)', null);
            return;
          } catch (e) {
            note = 'Live AI failed (' + (e && e.message ? e.message : 'error') + ') — fell back to the built-in rules engine.';
          }
        }
        // 3) Built-in rules engine — always works, no key, no network.
        renderScore(res);
        renderOutput(res.en, res.cn, note);
        setInferenceBadge('rules', 'Rules engine (offline fallback)', null);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Optimize listing →';
      }
    });
  });
}

/* Node test exports */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SAMPLE, parseKeywords, extractFacts, scoreListing, optimizeEN, localizeCN, optimizeListing };
}
