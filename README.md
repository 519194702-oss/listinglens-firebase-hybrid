# ListingLens — Bilingual Amazon Listing Optimizer, now with Firebase AI Logic hybrid inference

#BuildHybridAI 2026 · Track: **Web (Chrome)**

Paste a draft Amazon listing and get back an optimized version in **English and Chinese** (true localization, not literal translation), plus an SEO score with a before/after breakdown and concrete fixes.

Built by an e-commerce operator: the optimization rules come from real listing work (JD.com flagship store, Amazon listing copywriting) — keyword-first titles, benefit-led bullets, honest specs.

## What is new here vs. the GenHacks version

This project extends [ListingLens (GenHacks 2026)](https://github.com/519194702-oss/genhacks-listing-optimizer) with **Firebase AI Logic hybrid inference** — one SDK call, two places the work can run:

- **On-device first:** Gemini Nano in Chrome (desktop, v139+) rewrites the listing right on the user's machine — free, private, and it keeps working offline once the model is downloaded.
- **Cloud fallback:** when the on-device model is unavailable, the same prompt goes to Gemini 3.5 Flash-Lite through Firebase AI Logic (Gemini Developer API backend), protected by Firebase App Check.
- **The path is visible:** every optimization shows a badge naming where it actually ran — 🖥️ On-device · Gemini Nano, ☁️ Cloud · Gemini 3.5 Flash-Lite via Firebase AI Logic, or ⚙️ Rules engine (offline fallback) — plus how long it took. The inference source comes from the SDK's `response.inferenceSource`, not from a guess.
- **Structured output on both paths:** the model must return a JSON object matching a fixed listing schema (`inCloudParams.generationConfig.responseSchema` for the cloud, `onDeviceParams.promptOptions.responseConstraint` for the device), so both paths return the same shape.
- **The rules engine stays:** it is the final fallback and the scorer, so the app always produces an output — hybrid AI is an upgrade, never a hard dependency. The Chinese localizer from the original project is kept for the CN output when the model's Chinese text fails validation.

## What it does

- **Input:** product title, up to 5 bullet points, description, target keywords.
- **Optimize — three engines, in priority order:**
  1. **Hybrid AI** (when Firebase is configured and the box is ticked): Gemini Nano on-device first, Gemini 3.5 Flash-Lite in the cloud as fallback, via Firebase AI Logic.
  2. **Live AI (BYOK):** paste your own OpenAI API key for GPT-4o-mini rewrites (key stays in your browser only).
  3. **Built-in rules engine:** keyword-first English title (≤ 200 chars), 5 benefit-led bullets, rewritten description, and a template-based Chinese localization. No key, no network.
- **SEO score 0–100** with a breakdown (keyword coverage, title length, bullet completeness, readability) and specific fix suggestions. Shows before → after.
- **Copy buttons** for every output block.
- **Sample product:** one click loads a weak water-bottle listing — watch it go from 40 → 95.

## Run it

Static site, no build step. The Firebase SDK is loaded from the official CDN (firebase@13.4.0), so the app needs internet for the hybrid path only — the rules engine works fully offline.

```bash
# from this folder
python3 -m http.server 8000
# then open http://localhost:8000
```

Or open `index.html` directly in a browser, or host it on GitHub Pages.

## Enable hybrid AI (your Firebase project)

Out of the box the app runs on the rules engine and shows a clear
"not configured" note. To turn on hybrid inference, follow
**[FIREBASE_SETUP.md](FIREBASE_SETUP.md)** — it takes about 10 minutes in
the Firebase console and needs no code changes beyond pasting your project's
web config into `firebase-config.js`. Text inference only: no Google
Account Quota is needed.

## Files

- `index.html` — page structure, hybrid status + inference-path badge
- `styles.css` — styling, including the path badge
- `app.js` — rules engine (fact extraction, scoring, EN optimizer, CN localizer), BYOK client, UI wiring, hybrid attempt. Pure logic is exported for Node (`module.exports`) so the engine can be tested headlessly: `node -e "const m=require('./app.js'); console.log(m.optimizeListing(m.SAMPLE))"`.
- `firebase-config.js` — your Firebase project config (placeholder values in the repo; never commit real keys or debug tokens)
- `firebase-ai.js` — Firebase AI Logic hybrid integration: App Check (debug provider for local dev), `PREFER_ON_DEVICE` model, JSON schema on both paths, `inferenceSource` read-back, strict output validation, graceful fallback
- `FIREBASE_SETUP.md` — the exact console steps and the exact values to copy
- `README.md` — this file

## Honest notes

- The rules engine's spec claims (e.g. "24-hour cold / 12-hour hot") are standard category templates — verify them against the real product before publishing a listing.
- The demo score is computed by the same engine that writes the copy, so it measures rule compliance, not marketplace ranking.
- The Chinese localizer is template-based (fact-driven). For arbitrary products it stays honest by only using facts found in the input; the hybrid AI path gives fuller rewrites.
- On-device inference needs Chrome on Desktop v139+ with the Prompt API flag enabled (`chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`) and the on-device model downloaded; every other browser or device uses the cloud fallback. In headless Chromium (used for the local verification in this repo) there is no on-device model, so the hybrid code paths were verified up to the configuration gate and the rules fallback — the live on-device/cloud round-trip needs a real Firebase project and a real Chrome, both documented in FIREBASE_SETUP.md.
- Verification limits (2026-11-22, local run): the 16/16 headless-Chromium checks used the real Firebase SDK 13.4.0 files served locally, because the sandbox's headless Chrome cannot reach the Firebase CDN (connection failed on the gstatic module requests; curl from the same machine reaches them, HTTP 200). The shipped files still load the SDK from the CDN. The cloud round-trip was not tested live — it needs a real Firebase project config.
- The Firebase web config in `firebase-config.js` is public-by-design (the Gemini API key stays on Firebase's servers), but an App Check debug token must never be committed — it is a private credential.

## License

MIT
