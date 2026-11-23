# Firebase setup for ListingLens hybrid AI

Time: about 10 minutes in the Firebase console. No Google login is done
by the app itself — you do these steps in your own browser, and the app
only ever reads the config values you paste into `firebase-config.js`.

## 1. Create a Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com/) and
   click **Add project** (or pick an existing project).
2. Give it a name (e.g. `listinglens-hybrid`). You do **not** need Google
   Analytics for this.

## 2. Enable Firebase AI Logic

1. In the console, go to **AI Services > AI Logic** (in older console
   layouts: **Build > AI Logic**).
2. Click **Get started** and follow the guided workflow.
3. When asked for a **Gemini API provider**, choose the **Gemini Developer
   API** (free tier, no billing needed for text inference).
4. The workflow **automatically enforces Firebase App Check for AI Logic**.
   That is required — cloud requests are rejected without it.

## 3. Register this app as a Web app and copy the config

1. In the console, go to **Project settings** (gear icon) **> Your apps >
   Add app > Web** (`</>`).
2. Give it a nickname (e.g. `listinglens-web`). No Firebase Hosting needed.
3. The console shows you a `firebaseConfig` object. Copy these values into
   `firebase-config.js` (names only — your values stay in your copy):

   | `firebase-config.js` field | Where it comes from |
   |---|---|
   | `apiKey` | Web app config `apiKey` |
   | `authDomain` | Web app config `authDomain` |
   | `projectId` | Web app config `projectId` |
   | `storageBucket` | Web app config `storageBucket` |
   | `messagingSenderId` | Web app config `messagingSenderId` |
   | `appId` | Web app config `appId` |
   | `recaptchaSiteKey` | App Check > your web app > **reCAPTCHA Enterprise** (see step 4) |

## 4. Set up App Check (reCAPTCHA Enterprise + debug token)

1. In the console, go to **App Check**, select your web app, and choose
   **reCAPTCHA Enterprise** as the provider. Copy the **site key** into
   `recaptchaSiteKey` in `firebase-config.js`.
2. For **local development**, the app uses the App Check **debug provider**
   (`appCheckDebug: true` in `firebase-config.js`):
   - Run the app from `localhost`, open the browser's developer console.
     You will see a line like `AppCheck debug token: "123a4567-..."`.
   - In the console, go to **App Check > Apps**, open your app's overflow
     menu, choose **Manage debug tokens**, and register that token.
   - The token is stored in that browser only. **Never commit it, never
     share it** — it lets anyone call your Firebase resources.
   - To use the app in another browser/machine, set
     `self.FIREBASE_APPCHECK_DEBUG_TOKEN` to that token string instead of
     `true` (in the browser console before the app loads, or in a local-only
     override — do not put it in the repo).
3. For the **hosted demo / submission video**, either keep the debug token
   registered for the recording browser, or switch `appCheckDebug` to
   `false` and rely on reCAPTCHA Enterprise attestation.

## 5. Enable on-device inference in Chrome (for the demo)

1. Use **Chrome on Desktop, version 139 or higher**.
2. Open `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` and
   set it to **Enabled**, then restart Chrome.
3. Open DevTools > Console and run `await LanguageModel.availability();`
   — it should print `available`, `downloading`, or `downloadable`.
   If it says `downloadable`, run `await LanguageModel.create();` once to
   start the model download (it runs in the background; later requests use
   the downloaded model).

## 6. Verify it works

1. Serve the app (`python3 -m http.server 8000`) and open
   `http://localhost:8000`.
2. The hybrid status line should read "Firebase AI Logic is configured"
   and the checkbox should be enabled.
3. Click **Load sample product**, then **Optimize listing**.
4. The badge above the output should say **🖥️ On-device · Gemini Nano**
   (if the model is downloaded) or **☁️ Cloud · Gemini 3.5 Flash-Lite via
   Firebase AI Logic** (if not) — either way, the English rewrite comes
   from the model and the score should move 40 → ~95.
5. If the badge says **⚙️ Rules engine**, read the note under the output:
   it names the exact failure (e.g. App Check token not registered, or
   the model output failed validation) and the app fell back safely.

## What you do NOT need

- **No Google Account Quota.** The app uses text inference only; the
  quota request windows in the hackathon rules are for image generation
  and other advanced features. Text inference is free within the Gemini
  Developer API free-tier limits.
- **No billing.** The Gemini Developer API free tier covers this app's
  usage; the guided setup does not ask for a card.
- **No server.** The whole app is static; Firebase AI Logic is a client
  SDK plus a Google-run proxy, and your Gemini API key never appears in
  the code.
