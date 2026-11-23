/* ListingLens — Firebase project configuration.
 *
 * HOW TO FILL THIS IN (see FIREBASE_SETUP.md for the full walkthrough):
 *   1. Create a Firebase project in the Firebase console.
 *   2. In the console, open AI Services > AI Logic and run the guided setup
 *      (choose the Gemini Developer API; it enables Firebase App Check).
 *   3. Register this app as a Web app (Project settings > Your apps) and
 *      copy the config object it shows you into the fields below.
 *   4. In App Check, register a reCAPTCHA Enterprise site key, and for local
 *      development register the App Check debug token printed in the browser
 *      console (see FIREBASE_SETUP.md).
 *
 * SECURITY: these values are the public Firebase *web* config — they are
 * meant to be embedded in a web app (the Gemini API key itself stays on
 * Firebase's servers and is never in this file). Even so, keep this file's
 * real values out of any public demo you do not own, and never put an
 * App Check debug token in here: debug tokens must stay private.
 */

window.LISTINGLENS_FIREBASE_CONFIG = {
  // Firebase web app config — values from the user's Firebase console
  // (web app listinglens-web, registered 2026-11-22).
  apiKey: 'AIzaSyAVTaeP5wBX20Hm5fxp_MndrUtjior2DLc',
  authDomain: 'listinglens-hybrid.firebaseapp.com',
  projectId: 'listinglens-hybrid',
  storageBucket: 'listinglens-hybrid.firebasestorage.app',
  messagingSenderId: '267777122044',
  appId: '1:267777122044:web:64deced9a8a6ed3df08179',

  // reCAPTCHA Enterprise site key for Firebase App Check (App Check >
  // your web app > reCAPTCHA Enterprise). Required: App Check is enforced
  // for Firebase AI Logic, so cloud inference is rejected without it.
  recaptchaSiteKey: 'YOUR_RECAPTCHA_ENTERPRISE_SITE_KEY',

  // Set to true while developing locally so the App Check *debug provider*
  // is used: the browser console will print a debug token that you must
  // register in the Firebase console (App Check > Manage debug tokens).
  // Keep this true only for local development / the demo recording.
  appCheckDebug: true
};
