/**
 * khuloh/firestore.js — shared lazy Firestore loader for Khuloh modules.
 * No-op fallback when Firebase credentials aren't configured.
 */
let promise;

export async function getFirestore() {
  if (!promise) {
    promise = (async () => {
      if (!process.env.FIREBASE_PROJECT_ID && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        return null;
      }
      try {
        const [{ getApps, getApp, initializeApp, applicationDefault }, { getFirestore }] = await Promise.all([
          import('firebase-admin/app'),
          import('firebase-admin/firestore'),
        ]);
        const app = getApps().length
          ? getApp()
          : initializeApp({
              projectId: process.env.FIREBASE_PROJECT_ID,
              credential: applicationDefault?.(),
            });
        return getFirestore(app);
      } catch (err) {
        console.warn('[khuloh] firestore init failed; module disabled:', err.message);
        return null;
      }
    })();
  }
  return promise;
}
