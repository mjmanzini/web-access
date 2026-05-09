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

function authChallengeCollection(db) {
  return db.collection('authChallenges');
}

function oauthIdentityCollection(db) {
  return db.collection('oauthIdentities');
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

function webauthnCredentialId(credentialId) {
  return `webauthn:${encodeBinary(credentialId)}`;
}

function oauthIdentityId(provider, providerUserId) {
  return `${String(provider)}:${String(providerUserId)}`;
}

function challengeScope(userId) {
  return userId == null ? '__global__' : `user:${String(userId)}`;
}

function mapWebauthnCredentialDoc(doc) {
  if (!doc?.exists) return null;
  const data = doc.data() || {};
  return {
    id: doc.id,
    user_id: data.userId || null,
    webauthn_cred_id: Buffer.from(String(data.webauthnCredId || ''), 'base64url'),
    webauthn_pubkey: Buffer.from(String(data.webauthnPubkey || ''), 'base64url'),
    webauthn_counter: Number(data.webauthnCounter || 0),
    webauthn_transports: data.webauthnTransports ?? null,
    username: data.username || null,
    displayName: data.displayName || null,
  };
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

  async function saveChallenge({ userId, challenge, purpose }) {
    const { db } = getFirebaseContext();
    await authChallengeCollection(db).add({
      userId: userId == null ? null : String(userId),
      userScope: challengeScope(userId),
      purpose: String(purpose),
      challenge: encodeBinary(challenge),
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromDate(new Date(Date.now() + (5 * 60 * 1000))),
    });
  }

  async function consumeChallenge({ userId, purpose }) {
    const { db } = getFirebaseContext();
    const snap = await authChallengeCollection(db)
      .where('userScope', '==', challengeScope(userId))
      .where('purpose', '==', String(purpose))
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();

    const now = Date.now();
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const expiresAt = coerceDate(data.expiresAt);
      if (expiresAt && expiresAt.getTime() <= now) continue;
      await doc.ref.delete();
      return Buffer.from(String(data.challenge || ''), 'base64url');
    }

    return null;
  }

  async function findUserByUsername(username) {
    const { db } = getFirebaseContext();
    const usernameSnap = await usernameCollection(db).doc(normalizeUsernameKey(username)).get();
    if (!usernameSnap.exists) return null;
    const data = usernameSnap.data() || {};
    if (!data.userId) return null;
    return getUserById(db, data.userId);
  }

  async function getRegistrationOptionsContext(userId) {
    const { db } = getFirebaseContext();
    const [user, credentials] = await Promise.all([
      getUserById(db, userId),
      authCredentialCollection(db)
        .where('credentialType', '==', 'webauthn')
        .where('userId', '==', String(userId))
        .get(),
    ]);

    return {
      user,
      credentials: credentials.docs.map((doc) => {
        const data = doc.data() || {};
        return {
          webauthn_cred_id: Buffer.from(String(data.webauthnCredId || ''), 'base64url'),
          webauthn_transports: data.webauthnTransports ?? null,
        };
      }),
    };
  }

  async function listUserWebauthnCredentials(userId) {
    const { db } = getFirebaseContext();
    const snap = await authCredentialCollection(db)
      .where('credentialType', '==', 'webauthn')
      .where('userId', '==', String(userId))
      .get();
    return snap.docs.map((doc) => {
      const data = doc.data() || {};
      return {
        webauthn_cred_id: Buffer.from(String(data.webauthnCredId || ''), 'base64url'),
        webauthn_transports: data.webauthnTransports ?? null,
      };
    });
  }

  async function upsertWebauthnCredential({ userId, credentialId, publicKey, counter, transports, deviceLabel }) {
    const { db } = getFirebaseContext();
    const user = await getUserById(db, userId);
    const ref = authCredentialCollection(db).doc(webauthnCredentialId(credentialId));
    const existing = await ref.get();
    const current = existing.exists ? existing.data() || {} : {};
    await ref.set({
      userId: String(userId),
      credentialType: 'webauthn',
      webauthnCredId: encodeBinary(credentialId),
      webauthnPubkey: encodeBinary(publicKey),
      webauthnCounter: Number(counter || 0),
      webauthnTransports: transports ?? null,
      deviceLabel: deviceLabel ?? current.deviceLabel ?? null,
      username: user?.username || current.username || null,
      displayName: user?.displayName || current.displayName || null,
      createdAt: current.createdAt || FieldValue.serverTimestamp(),
      lastUsedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  async function findAuthenticationCredential(credentialId) {
    const { db } = getFirebaseContext();
    const doc = await authCredentialCollection(db).doc(webauthnCredentialId(credentialId)).get();
    const credential = mapWebauthnCredentialDoc(doc);
    if (!credential || credential.user_id == null) return null;

    if (!credential.username || !credential.displayName) {
      const user = await getUserById(db, credential.user_id);
      if (user) {
        credential.username = credential.username || user.username;
        credential.displayName = credential.displayName || user.displayName;
      }
    }

    return credential;
  }

  async function updateWebauthnCounter({ credentialRowId, newCounter }) {
    const { db } = getFirebaseContext();
    await authCredentialCollection(db).doc(String(credentialRowId)).set({
      webauthnCounter: Number(newCounter || 0),
      lastUsedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  async function findOwnedAuthenticationCredential({ userId, credentialId }) {
    const doc = await authCredentialCollection(getFirebaseContext().db)
      .doc(webauthnCredentialId(credentialId))
      .get();
    const credential = mapWebauthnCredentialDoc(doc);
    if (!credential || credential.user_id !== String(userId)) return null;
    return credential;
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

  async function updateUserContact({ userId, email, phone }) {
    const { db } = getFirebaseContext();
    await userCollection(db).doc(String(userId)).set({
      ...(email !== undefined ? {
        email: email || null,
        emailLower: email ? normalizeEmailKey(email) : null,
      } : {}),
      ...(phone !== undefined ? {
        phone: phone || null,
      } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  async function findOAuthIdentityUser({ provider, providerUserId }) {
    const { db } = getFirebaseContext();
    const snap = await oauthIdentityCollection(db)
      .doc(oauthIdentityId(provider, providerUserId))
      .get();
    if (!snap.exists) return null;

    const data = snap.data() || {};
    if (!data.userId) return null;
    return getUserById(db, data.userId);
  }

  async function touchOAuthIdentityLogin({ provider, providerUserId }) {
    const { db } = getFirebaseContext();
    await oauthIdentityCollection(db)
      .doc(oauthIdentityId(provider, providerUserId))
      .set({
        lastLoginAt: FieldValue.serverTimestamp(),
      }, { merge: true });
  }

  async function upsertOAuthIdentity({ provider, providerUserId, userId, email }) {
    const { db } = getFirebaseContext();
    await oauthIdentityCollection(db)
      .doc(oauthIdentityId(provider, providerUserId))
      .set({
        provider: String(provider),
        providerUserId: String(providerUserId),
        userId: String(userId),
        email: email || null,
        emailLower: email ? normalizeEmailKey(email) : null,
        lastLoginAt: FieldValue.serverTimestamp(),
      }, { merge: true });
  }

  async function createOAuthIdentity({ provider, providerUserId, userId, email }) {
    const { db } = getFirebaseContext();
    await oauthIdentityCollection(db)
      .doc(oauthIdentityId(provider, providerUserId))
      .create({
        provider: String(provider),
        providerUserId: String(providerUserId),
        userId: String(userId),
        email: email || null,
        emailLower: email ? normalizeEmailKey(email) : null,
        createdAt: FieldValue.serverTimestamp(),
        lastLoginAt: FieldValue.serverTimestamp(),
      });
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
      saveChallenge,
      consumeChallenge,
      issueSessionToken,
      findUserByUsername,
      getRegistrationOptionsContext,
      listUserWebauthnCredentials,
      upsertWebauthnCredential,
      findAuthenticationCredential,
      updateWebauthnCounter,
      findOwnedAuthenticationCredential,
      findOAuthIdentityUser,
      touchOAuthIdentityLogin,
      findUserByEmail,
      upsertOAuthIdentity,
      createOAuthIdentity,
      updateUserEmail,
      updateUserContact,
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