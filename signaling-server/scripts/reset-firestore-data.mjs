import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const args = new Set(process.argv.slice(2));
if (!args.has('--yes')) {
  console.error('Refusing to reset Firestore without --yes.');
  process.exit(1);
}

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId) {
  console.error('Set FIREBASE_PROJECT_ID before running this script.');
  process.exit(1);
}

const collections = [
  'authChallenges',
  'authCredentials',
  'chatMessages',
  'conversationMembers',
  'conversations',
  'knownContacts',
  'messageReceipts',
  'oauthIdentities',
  'oneToOneConversations',
  'remoteAnnouncements',
  'remoteIds',
  'remoteSessionsLog',
  'usernames',
  'users',
];

async function deleteWithAdmin(name, db) {
  let deleted = 0;
  while (true) {
    const snapshot = await db.collection(name).limit(450).get();
    if (snapshot.empty) break;
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snapshot.size;
  }
  return deleted;
}

async function fetchJson(url, token, init = {}) {
  const absoluteUrl = url.startsWith('http') ? url : `https://firestore.googleapis.com/v1/${url}`;
  const res = await fetch(absoluteUrl, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function deleteWithRest(name, token) {
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${name}`;
  let pageToken = '';
  let deleted = 0;
  do {
    const url = `${base}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const body = await fetchJson(url, token);
    for (const doc of body?.documents || []) {
      await fetchJson(doc.name, token, { method: 'DELETE' });
      deleted += 1;
    }
    pageToken = body?.nextPageToken || '';
  } while (pageToken);
  return deleted;
}

const accessToken = process.env.FIREBASE_ACCESS_TOKEN;

if (accessToken) {
  for (const name of collections) {
    const deleted = await deleteWithRest(name, accessToken);
    console.log(`${name}: deleted ${deleted}`);
  }
} else {
  const app = getApps().length ? getApp() : initializeApp({ projectId });
  const db = getFirestore(app);
  for (const name of collections) {
    const deleted = await deleteWithAdmin(name, db);
    console.log(`${name}: deleted ${deleted}`);
  }
}

console.log(`Firestore reset complete for project ${projectId}.`);
