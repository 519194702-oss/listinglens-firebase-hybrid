/* ListingLens — Firebase AI Logic hybrid inference.
 *
 * One SDK call, two places the work can run:
 *   - on-device: Gemini Nano in Chrome (desktop, v139+) via the Prompt API.
 *     Free, private, works offline once the model is downloaded.
 *   - in-cloud: Gemini 3.5 Flash-Lite through Firebase AI Logic
 *     (Gemini Developer API backend), reached only when the on-device
 *     model is unavailable.
 *
 * The mode is PREFER_ON_DEVICE: the SDK tries the device first and falls
 * back to the cloud. Which path actually ran is read back from
 * result.response.inferenceSource and shown in the UI, so the hybrid
 * behaviour is visible instead of hidden.
 *
 * This is an ES module loaded from the Firebase JS SDK CDN
 * (firebase@13.4.0). If the CDN cannot be reached, or the Firebase
 * project config is still a placeholder, this module simply reports
 * "not configured" and the app keeps working with its built-in rules
 * engine — hybrid AI is an upgrade path, never a hard dependency.
 *
 * Docs (read 2026-11-22):
 *   https://firebase.google.com/docs/ai-logic/hybrid/web/get-started
 *   https://firebase.google.com/docs/ai-logic/hybrid/web/configuration-options
 *   https://firebase.google.com/docs/ai-logic/hybrid/web/generate-structured-output
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app-check.js';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, Schema } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-ai.js';
import { buildHybridPrompt, normalizeSource, parseListingJson } from './hybrid-pure.js';

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

function readConfig() {
  return (typeof window !== 'undefined' && window.LISTINGLENS_FIREBASE_CONFIG) || {};
}

function isPlaceholder(value) {
  return typeof value !== 'string' || value.length === 0 || value.indexOf('YOUR_') === 0;
}

/** True when the Firebase web config has real values (not placeholders). */
export function isConfigured() {
  const c = readConfig();
  return !isPlaceholder(c.apiKey) && !isPlaceholder(c.projectId) && !isPlaceholder(c.appId);
}

/** True when App Check has a real reCAPTCHA Enterprise site key. */
function appCheckConfigured() {
  return !isPlaceholder(readConfig().recaptchaSiteKey);
}

/* ------------------------------------------------------------------ */
/* Structured output schema (same shape on both inference paths)       */
/* ------------------------------------------------------------------ */

const listingSchema = Schema.object({
  properties: {
    title: Schema.string({
      description: 'Optimized English Amazon title, keyword-first, 200 characters or fewer.'
    }),
    bullets: Schema.array({
      items: Schema.string(),
      description: 'Five benefit-led English bullet points, each starting with a HEADLINE: '
    }),
    description: Schema.string({
      description: 'Optimized English product description, two short paragraphs.'
    }),
    titleCN: Schema.string({
      description: 'Localized Chinese title for Chinese buyers (Taobao/JD style), not a literal translation.'
    }),
    bulletsCN: Schema.array({
      items: Schema.string(),
      description: 'Five localized Chinese bullet points, natural Chinese e-commerce copy.'
    }),
    descriptionCN: Schema.string({
      description: 'Localized Chinese product description, two short paragraphs.'
    })
  }
});

/* ------------------------------------------------------------------ */
/* Firebase init (lazy — nothing runs until the first Optimize click)  */
/* ------------------------------------------------------------------ */

let modelPromise = null;
let appCheckState = 'not-attempted'; // 'ok' | 'skipped-no-site-key' | 'failed'

function statusDetail() {
  if (!isConfigured()) {
    return {
      state: 'not-configured',
      message:
        'Firebase AI Logic is not configured yet — fill in firebase-config.js with your Firebase project values (see FIREBASE_SETUP.md). The rules engine is running instead.'
    };
  }
  if (!appCheckConfigured()) {
    return {
      state: 'ready-no-appcheck',
      message:
        'Firebase config is set, but no reCAPTCHA Enterprise site key is configured for App Check — cloud inference will be rejected until App Check is set up. On-device inference may still work.'
    };
  }
  return { state: 'ready', message: 'Firebase AI Logic is configured. Hybrid AI will try on-device first, then the cloud.' };
}

function ensureModel() {
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    const config = readConfig();
    const firebaseApp = initializeApp({
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      storageBucket: config.storageBucket,
      messagingSenderId: config.messagingSenderId,
      appId: config.appId
    });

    if (appCheckConfigured()) {
      try {
        if (config.appCheckDebug) {
          // Debug provider for local development: the browser console prints
          // a debug token that must be registered in the Firebase console
          // (App Check > Manage debug tokens). Never commit a debug token.
          self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
        }
        initializeAppCheck(firebaseApp, {
          provider: new ReCaptchaEnterpriseProvider(config.recaptchaSiteKey),
          isTokenAutoRefreshEnabled: true
        });
        appCheckState = 'ok';
      } catch (e) {
        appCheckState = 'failed';
        console.warn('[ListingLens] App Check init failed:', e);
      }
    } else {
      appCheckState = 'skipped-no-site-key';
      console.warn('[ListingLens] No reCAPTCHA site key configured; App Check not initialized.');
    }

    const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });
    return getGenerativeModel(ai, {
      mode: InferenceMode.PREFER_ON_DEVICE,
      inCloudParams: {
        model: 'gemini-3.5-flash-lite',
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: listingSchema,
          temperature: 0.7,
          maxOutputTokens: 2048
        }
      },
      onDeviceParams: {
        promptOptions: { responseConstraint: listingSchema }
      }
    });
  })();
  return modelPromise;
}

/* ------------------------------------------------------------------ */
/* Optimize via hybrid inference                                       */
/* ------------------------------------------------------------------ */

/**
 * Run one optimization through Firebase AI Logic.
 * @param {object} input - {title, bullets, description}
 * @param {string[]} keywords - parsed target keywords
 * @param {object} fallback - the rules engine's {en, cn} output, used to
 *   top up short bullet lists and as the CN fallback
 * @param {function} onProgress - called with status strings for the UI
 * @returns {Promise<{en, cn, source, modelName, latencyMs}>}
 * @throws {Error} when hybrid inference fails or its output is unusable —
 *   the caller falls back to the rules engine.
 */
export async function optimizeWithHybrid(input, keywords, fallback, onProgress) {
  if (!isConfigured()) {
    throw new Error('Firebase is not configured (placeholder values in firebase-config.js).');
  }
  const t0 = Date.now();
  const say = (m) => { if (typeof onProgress === 'function') onProgress(m); };
  const model = await ensureModel();

  // Must run on a user gesture (the Optimize click) and before the first
  // generateContent call. If the on-device model is unavailable this
  // resolves and the request falls back to the cloud.
  say('Preparing on-device model…');
  try {
    await model.initializeDeviceModel((fraction) => {
      say('Downloading on-device model… ' + Math.round(fraction * 100) + '%');
    });
  } catch (e) {
    console.warn('[ListingLens] initializeDeviceModel failed, continuing (cloud fallback may apply):', e);
  }

  const prompt = buildHybridPrompt(input, keywords);
  say('Running hybrid inference…');
  const result = await Promise.race([
    model.generateContent(prompt),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Hybrid inference timed out after 120s.')), 120000))
  ]);
  const latencyMs = Date.now() - t0;
  const source = normalizeSource(result.response && result.response.inferenceSource);
  const modelName = source === 'on-device' ? 'Gemini Nano (on-device)' : 'Gemini 3.5 Flash-Lite (cloud)';
  const parsed = parseListingJson(result.response.text(), fallback);
  if (!parsed) {
    throw new Error('Hybrid model returned output that did not match the listing schema.');
  }
  return { en: parsed.en, cn: parsed.cn, source, modelName, latencyMs };
}

/* ------------------------------------------------------------------ */
/* Public handle for the classic-script app.js                         */
/* ------------------------------------------------------------------ */

const handle = {
  isConfigured,
  getStatus: () => ({ ...statusDetail(), appCheckState }),
  optimize: optimizeWithHybrid,
  // Exposed for the in-browser verification script (test-hybrid.mjs).
  _internals: { parseListingJson, buildHybridPrompt, normalizeSource }
};

window.ListingLensHybrid = handle;
window.dispatchEvent(new CustomEvent('listinglens-hybrid-ready', { detail: handle.getStatus() }));
