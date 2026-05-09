import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';

let firebaseContext;

function normalizePrivateKey(value) {
  return value ? value.replace(/\\n/g, '\n') : value;
}

function readFirebaseConfig() {
  return {
    projectId: process.env.FIREBASE_PROJECT_ID || undefined,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || undefined,
    privateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || undefined,
    databaseURL: process.env.FIREBASE_DATABASE_URL || undefined,
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || undefined,
  };
}

function describeFirebaseConfig(config) {
  return [
    config.projectId ? `project=${config.projectId}` : null,
    config.clientEmail ? 'clientEmail=set' : null,
    config.privateKey ? 'privateKey=set' : null,
    config.storageBucket ? `storageBucket=${config.storageBucket}` : null,
    config.databaseURL ? 'databaseURL=set' : null,
    config.credentialsPath ? `credentialsPath=${config.credentialsPath}` : null,
  ].filter(Boolean).join(', ');
}

function buildMissingConfigError(config) {
  return new Error(
    'Firebase storage requires either GOOGLE_APPLICATION_CREDENTIALS or all of ' +
      'FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.' +
      ` Current config: ${describeFirebaseConfig(config) || 'none'}`,
  );
}

function normalizeUsernameKey(username) {
  return String(username || '').trim().toLowerCase();
}

function normalizeEmailKey(email) {
  return String(email || '').trim().toLowerCase();
}

function encodeBinary(value) {
  if (value == null) return null;
  return Buffer.from(value).toString('base64url');
}

function coerceDate(value) {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  return new Date(value);
}

function userCollection(db) {
  return db.collection('users');
}

function usernameCollection(db) {
  return db.collection('usernames');
}

function authCredentialCollection(db) {
  return db.collection('authCredentials');
}

function mapUserDoc(doc) {
  if (!doc?.exists) return null;
  const data = doc.data() || {};
  return {
    id: doc.id,
    username: data.username || null,
    displayName: data.displayName || data.username || null,
  };
}

function sessionCredentialId(tokenHash) {
  return `session:${encodeBinary(tokenHash)}`;
}

async function getUserById(db, id) {
  const snap = await userCollection(db).doc(String(id)).get();
  return mapUserDoc(snap);
}

function initializeFirebaseContext() {
  const config = readFirebaseConfig();
  const hasInlineCredential = Boolean(config.projectId && config.clientEmail && config.privateKey);
  const canUseApplicationDefault = Boolean(config.credentialsPath);

  if (!hasInlineCredential && !canUseApplicationDefault) {
    throw buildMissingConfigError(config);
  }

  const existingApp = getApps().length ? getApp() : null;
  const app = existingApp || initializeApp({
    ...(config.projectId ? { projectId: config.projectId } : {}),
    ...(config.storageBucket ? { storageBucket: config.storageBucket } : {}),
    ...(config.databaseURL ? { databaseURL: config.databaseURL } : {}),
    ...(hasInlineCredential
      ? {
          credential: cert({
            projectId: config.projectId,
            clientEmail: config.clientEmail,
            privateKey: config.privateKey,
          }),
        }
      : {}),
  });

  return {
    app,
    db: getFirestore(app),
    config,
    details: describeFirebaseConfig(config),
  };
}

export function getFirebaseContext() {
  if (!firebaseContext) {
    firebaseContext = initializeFirebaseContext();
  }

  return firebaseContext;
}

function buildNotImplemented(namespace, method) {
  return () => {
    const { details } = getFirebaseContext();
    const suffix = details ? ` (${details})` : '';
    throw new Error(`Firebase storage adapter not implemented for ${namespace}.${method}${suffix}`);
  };
}

function buildAsyncNotImplemented(namespace, method) {
  return async (..._args) => {
    const { details } = getFirebaseContext();
    const suffix = details ? ` (${details})` : '';
    throw new Error(`Firebase storage adapter not implemented for ${namespace}.${method}${suffix}`);
  };
}

export function createFirebaseStorage() {
  async function createUser({ id, username, displayName, token }) {
    const { db } = getFirebaseContext();
    const userId = String(id);
    const usernameKey = normalizeUsernameKey(username);
    const usernameRef = usernameCollection(db).doc(usernameKey);
    const userRef = userCollection(db).doc(userId);

    try {
      await db.runTransaction(async (tx) => {
        const [usernameSnap, userSnap] = await Promise.all([
          tx.get(usernameRef),
          tx.get(userRef),
        ]);

        if (usernameSnap.exists || userSnap.exists) {
          const error = new Error('username_taken');
          error.code = '23505';
          throw error;
        }

        tx.create(userRef, {
          username: String(username),
          usernameLower: usernameKey,
          displayName: String(displayName || username),
          token: String(token),
          createdAt: FieldValue.serverTimestamp(),
        });
        tx.create(usernameRef, {
          userId,
          username: String(username),
          createdAt: FieldValue.serverTimestamp(),
        });
      });
    } catch (error) {
      if (String(error?.code) === '6' || /already exists/i.test(String(error?.message))) {
        error.code = '23505';
      }
      throw error;
    }
  }

  async function findUserByLegacyToken(token) {
    const { db } = getFirebaseContext();
    const snap = await userCollection(db)
      .where('token', '==', String(token))
      .limit(1)
      .get();
    return mapUserDoc(snap.docs[0]);
  }

  async function findUserBySessionTokenHash(tokenHash) {
    const { db } = getFirebaseContext();
    const sessionSnap = await authCredentialCollection(db).doc(sessionCredentialId(tokenHash)).get();
    if (!sessionSnap.exists) return null;

    const data = sessionSnap.data() || {};
    const expiresAt = coerceDate(data.expiresAt);
    if (expiresAt && expiresAt.getTime() <= Date.now()) return null;
    if (data.credentialType !== 'session' || !data.userId) return null;

    return getUserById(db, data.userId);
  }

  async function touchSessionToken(tokenHash) {
    const { db } = getFirebaseContext();
    await authCredentialCollection(db).doc(sessionCredentialId(tokenHash)).set({
      lastUsedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  async function findUserById(id) {
    const { db } = getFirebaseContext();
    return getUserById(db, id);
  }

  async function listUsers() {
    const { db } = getFirebaseContext();
    const snap = await userCollection(db)
      .orderBy('displayName', 'asc')
      .get();
    return snap.docs.map(mapUserDoc).filter(Boolean);
  }

  async function issueSessionToken({ userId, tokenHash, ttlSeconds }) {
    const { db } = getFirebaseContext();
    const expiresAt = Timestamp.fromDate(new Date(Date.now() + (Number(ttlSeconds) * 1000)));
    await authCredentialCollection(db).doc(sessionCredentialId(tokenHash)).set({
      userId: String(userId),
      credentialType: 'session',
      tokenHash: encodeBinary(tokenHash),
      createdAt: FieldValue.serverTimestamp(),
      expiresAt,
      lastUsedAt: null,
    });
  }

  async function findUserByUsername(username) {
    const { db } = getFirebaseContext();
    const usernameSnap = await usernameCollection(db).doc(normalizeUsernameKey(username)).get();
    if (!usernameSnap.exists) return null;
    const data = usernameSnap.data() || {};
    if (!data.userId) return null;
    return getUserById(db, data.userId);
  }

  async function findUserByEmail(email) {
    const { db } = getFirebaseContext();
    const snap = await userCollection(db)
      .where('emailLower', '==', normalizeEmailKey(email))
      .limit(1)
      .get();
    return mapUserDoc(snap.docs[0]);
  }

  async function updateUserEmail({ userId, email }) {
    const { db } = getFirebaseContext();
    await userCollection(db).doc(String(userId)).set({
      email: email || null,
      emailLower: email ? normalizeEmailKey(email) : null,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  return {
    users: {
      createUser,
      findUserByLegacyToken,
      findUserBySessionTokenHash,
      touchSessionToken,
      findUserById,
      listUsers,
    },

    auth: {
      saveChallenge: buildAsyncNotImplemented('auth', 'saveChallenge'),
      consumeChallenge: buildAsyncNotImplemented('auth', 'consumeChallenge'),
      issueSessionToken,
      findUserByUsername,
      getRegistrationOptionsContext: buildAsyncNotImplemented('auth', 'getRegistrationOptionsContext'),
      listUserWebauthnCredentials: buildAsyncNotImplemented('auth', 'listUserWebauthnCredentials'),
      upsertWebauthnCredential: buildAsyncNotImplemented('auth', 'upsertWebauthnCredential'),
      findAuthenticationCredential: buildAsyncNotImplemented('auth', 'findAuthenticationCredential'),
      updateWebauthnCounter: buildAsyncNotImplemented('auth', 'updateWebauthnCounter'),
      findOwnedAuthenticationCredential: buildAsyncNotImplemented('auth', 'findOwnedAuthenticationCredential'),
      findOAuthIdentityUser: buildAsyncNotImplemented('auth', 'findOAuthIdentityUser'),
      touchOAuthIdentityLogin: buildAsyncNotImplemented('auth', 'touchOAuthIdentityLogin'),
      findUserByEmail,
      upsertOAuthIdentity: buildAsyncNotImplemented('auth', 'upsertOAuthIdentity'),
      createOAuthIdentity: buildAsyncNotImplemented('auth', 'createOAuthIdentity'),
      updateUserEmail,
    },

    chat: {
      findOrCreateOneToOneConversation: buildAsyncNotImplemented('chat', 'findOrCreateOneToOneConversation'),
      listConversations: buildAsyncNotImplemented('chat', 'listConversations'),
      listMessages: buildAsyncNotImplemented('chat', 'listMessages'),
      persistMessage: buildAsyncNotImplemented('chat', 'persistMessage'),
      listConversationMemberIds: buildAsyncNotImplemented('chat', 'listConversationMemberIds'),
      markDelivered: buildAsyncNotImplemented('chat', 'markDelivered'),
      markRead: buildAsyncNotImplemented('chat', 'markRead'),
      touchConversationRead: buildAsyncNotImplemented('chat', 'touchConversationRead'),
    },

    presence: {
      ensurePresenceColumns: buildAsyncNotImplemented('presence', 'ensurePresenceColumns'),
      touchLastSeen: buildAsyncNotImplemented('presence', 'touchLastSeen'),
      getPresenceRows: buildAsyncNotImplemented('presence', 'getPresenceRows'),
    },

    remote: {
      findRemoteIdByUserId: buildAsyncNotImplemented('remote', 'findRemoteIdByUserId'),
      assignRemoteId: buildAsyncNotImplemented('remote', 'assignRemoteId'),
      findHostByRemoteId: buildAsyncNotImplemented('remote', 'findHostByRemoteId'),
      saveAnnouncement: buildAsyncNotImplemented('remote', 'saveAnnouncement'),
      cancelAnnouncement: buildAsyncNotImplemented('remote', 'cancelAnnouncement'),
      getAnnouncementStatus: buildAsyncNotImplemented('remote', 'getAnnouncementStatus'),
      connectWithPin: buildAsyncNotImplemented('remote', 'connectWithPin'),
    },

    meta: {
      backend: 'firebase',
      assertReady: () => {
        const { app, db, details } = getFirebaseContext();
        return {
          appName: app.name,
          backend: 'firebase',
          details,
          firestoreReady: Boolean(db),
        };
      },
      getContext: getFirebaseContext,
      getConfig: readFirebaseConfig,
      getFirestore: () => getFirebaseContext().db,
      notImplemented: buildNotImplemented('meta', 'notImplemented'),
    },
  };
}