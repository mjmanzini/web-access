import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

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
    'Firebase storage requires FIREBASE_PROJECT_ID plus either application default credentials, ' +
      'GOOGLE_APPLICATION_CREDENTIALS, or all of FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.' +
      ` Current config: ${describeFirebaseConfig(config) || 'none'}`,
  );
}

function nowTimestamp() {
  return Timestamp.fromDate(new Date());
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

function decodeBinary(value) {
  if (!value) return null;
  return Buffer.from(String(value), 'base64url');
}

function coerceDate(value) {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  return new Date(value);
}

function compareDescDates(a, b) {
  const left = a ? a.getTime() : -Infinity;
  const right = b ? b.getTime() : -Infinity;
  return right - left;
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

function conversationCollection(db) {
  return db.collection('conversations');
}

function conversationMemberCollection(db) {
  return db.collection('conversationMembers');
}

function chatMessageCollection(db) {
  return db.collection('chatMessages');
}

function messageReceiptCollection(db) {
  return db.collection('messageReceipts');
}

function oneToOneConversationCollection(db) {
  return db.collection('oneToOneConversations');
}

function remoteAnnouncementCollection(db) {
  return db.collection('remoteAnnouncements');
}

function remoteSessionLogCollection(db) {
  return db.collection('remoteSessionsLog');
}

function remoteIdCollection(db) {
  return db.collection('remoteIds');
}

function knownContactCollection(db) {
  return db.collection('knownContacts');
}

function mapUserDoc(doc) {
  if (!doc?.exists) return null;
  const data = doc.data() || {};
  return {
    id: doc.id,
    username: data.username || null,
    displayName: data.displayName || data.username || null,
    emailLower: data.emailLower || null,
    avatarUrl: data.avatarUrl || null,
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

function conversationMemberId(conversationId, userId) {
  return `${String(conversationId)}:${String(userId)}`;
}

function oneToOneConversationKey(meId, peerId) {
  return [String(meId), String(peerId)].sort().join(':');
}

function messageReceiptId(messageId, userId) {
  return `${String(messageId)}:${String(userId)}`;
}

function knownContactId(userId, contactUserId) {
  return `${String(userId)}:${String(contactUserId)}`;
}

function mapWebauthnCredentialDoc(doc) {
  if (!doc?.exists) return null;
  const data = doc.data() || {};
  return {
    id: doc.id,
    user_id: data.userId || null,
    webauthn_cred_id: decodeBinary(data.webauthnCredId) || Buffer.alloc(0),
    webauthn_pubkey: decodeBinary(data.webauthnPubkey) || Buffer.alloc(0),
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
  const canUseApplicationDefault = Boolean(config.projectId);

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

export function createFirebaseStorage() {
  async function createUser({ id, username, displayName, token }) {
    const { db } = getFirebaseContext();
    const createdAt = nowTimestamp();
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
          createdAt,
        });
        tx.create(usernameRef, {
          userId,
          username: String(username),
          createdAt,
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
      lastUsedAt: nowTimestamp(),
    }, { merge: true });
  }

  async function findUserById(id) {
    const { db } = getFirebaseContext();
    return getUserById(db, id);
  }

  async function listUsers() {
    const { db } = getFirebaseContext();
    const snap = await userCollection(db).get();
    const seen = new Set();
    return snap.docs
      .map(mapUserDoc)
      .filter(Boolean)
      .filter((user) => {
        const key = user.emailLower || user.username || user.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((left, right) => String(left.displayName || '').localeCompare(String(right.displayName || '')));
  }

  async function markKnownContact({ userId, contactUserId, reason }) {
    if (!userId || !contactUserId || String(userId) === String(contactUserId)) return;
    const { db } = getFirebaseContext();
    const now = nowTimestamp();
    const payload = { reason: reason || 'known', updatedAt: now };
    await Promise.all([
      knownContactCollection(db).doc(knownContactId(userId, contactUserId)).set({
        userId: String(userId), contactUserId: String(contactUserId), createdAt: now, ...payload,
      }, { merge: true }),
      knownContactCollection(db).doc(knownContactId(contactUserId, userId)).set({
        userId: String(contactUserId), contactUserId: String(userId), createdAt: now, ...payload,
      }, { merge: true }),
    ]);
  }

  async function setUserAvatar({ userId, avatarUrl }) {
    if (!userId) throw new Error('user_required');
    const { db } = getFirebaseContext();
    await userCollection(db).doc(String(userId)).set({
      avatarUrl: avatarUrl == null ? null : String(avatarUrl),
      avatarUpdatedAt: nowTimestamp(),
    }, { merge: true });
  }

  async function listKnownContacts(userId) {
    const { db } = getFirebaseContext();
    const snap = await knownContactCollection(db).where('userId', '==', String(userId)).get();
    const rows = await Promise.all(snap.docs.map(async (doc) => {
      const data = doc.data() || {};
      const user = await getUserById(db, data.contactUserId);
      if (!user) return null;
      return {
        ...user,
        reason: data.reason || 'known',
        lastContactAt: coerceDate(data.updatedAt || data.createdAt),
      };
    }));
    return rows.filter(Boolean).sort((left, right) => compareDescDates(left.lastContactAt, right.lastContactAt));
  }

  async function issueSessionToken({ userId, tokenHash, ttlSeconds }) {
    const { db } = getFirebaseContext();
    const createdAt = nowTimestamp();
    const expiresAt = Timestamp.fromDate(new Date(Date.now() + (Number(ttlSeconds) * 1000)));
    await authCredentialCollection(db).doc(sessionCredentialId(tokenHash)).set({
      userId: String(userId),
      credentialType: 'session',
      tokenHash: encodeBinary(tokenHash),
      createdAt,
      expiresAt,
      lastUsedAt: null,
    });
  }

  async function saveChallenge({ userId, challenge, purpose }) {
    const { db } = getFirebaseContext();
    const createdAt = nowTimestamp();
    await authChallengeCollection(db).add({
      userId: userId == null ? null : String(userId),
      userScope: challengeScope(userId),
      purpose: String(purpose),
      challenge: encodeBinary(challenge),
      createdAt,
      expiresAt: Timestamp.fromDate(new Date(createdAt.toDate().getTime() + (5 * 60 * 1000))),
    });
  }

  async function consumeChallenge({ userId, purpose }) {
    const { db } = getFirebaseContext();
    const snap = await authChallengeCollection(db)
      .where('userScope', '==', challengeScope(userId))
      .get();

    const candidates = snap.docs
      .filter((doc) => (doc.data() || {}).purpose === String(purpose))
      .sort((left, right) => compareDescDates(coerceDate(left.data()?.createdAt), coerceDate(right.data()?.createdAt)));

    const now = Date.now();
    for (const doc of candidates) {
      const data = doc.data() || {};
      const expiresAt = coerceDate(data.expiresAt);
      if (expiresAt && expiresAt.getTime() <= now) continue;
      await doc.ref.delete();
      return decodeBinary(data.challenge);
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
    const [user, credentialSnap] = await Promise.all([
      getUserById(db, userId),
      authCredentialCollection(db).where('userId', '==', String(userId)).get(),
    ]);

    const credentials = credentialSnap.docs
      .map((doc) => doc.data() || {})
      .filter((row) => row.credentialType === 'webauthn')
      .map((row) => ({
        webauthn_cred_id: decodeBinary(row.webauthnCredId) || Buffer.alloc(0),
        webauthn_transports: row.webauthnTransports ?? null,
      }));

    return { user, credentials };
  }

  async function listUserWebauthnCredentials(userId) {
    const { db } = getFirebaseContext();
    const snap = await authCredentialCollection(db).where('userId', '==', String(userId)).get();
    return snap.docs
      .map((doc) => doc.data() || {})
      .filter((row) => row.credentialType === 'webauthn')
      .map((row) => ({
        webauthn_cred_id: decodeBinary(row.webauthnCredId) || Buffer.alloc(0),
        webauthn_transports: row.webauthnTransports ?? null,
      }));
  }

  async function upsertWebauthnCredential({ userId, credentialId, publicKey, counter, transports, deviceLabel }) {
    const { db } = getFirebaseContext();
    const credentialRef = authCredentialCollection(db).doc(webauthnCredentialId(credentialId));
    const [user, existing] = await Promise.all([
      getUserById(db, userId),
      credentialRef.get(),
    ]);
    const current = existing.exists ? existing.data() || {} : {};
    await credentialRef.set({
      userId: String(userId),
      credentialType: 'webauthn',
      webauthnCredId: encodeBinary(credentialId),
      webauthnPubkey: encodeBinary(publicKey),
      webauthnCounter: Number(counter || 0),
      webauthnTransports: transports ?? null,
      deviceLabel: deviceLabel ?? current.deviceLabel ?? null,
      username: user?.username || current.username || null,
      displayName: user?.displayName || current.displayName || null,
      createdAt: current.createdAt || nowTimestamp(),
      lastUsedAt: nowTimestamp(),
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
      lastUsedAt: nowTimestamp(),
    }, { merge: true });
  }

  async function findOwnedAuthenticationCredential({ userId, credentialId }) {
    const { db } = getFirebaseContext();
    const doc = await authCredentialCollection(db).doc(webauthnCredentialId(credentialId)).get();
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
      updatedAt: nowTimestamp(),
    }, { merge: true });
  }

  async function updateUserContact({ userId, email, phone }) {
    const { db } = getFirebaseContext();
    await userCollection(db).doc(String(userId)).set({
      ...(email !== undefined ? {
        email: email || null,
        emailLower: email ? normalizeEmailKey(email) : null,
      } : {}),
      ...(phone !== undefined ? { phone: phone || null } : {}),
      updatedAt: nowTimestamp(),
    }, { merge: true });
  }

  async function findOAuthIdentityUser({ provider, providerUserId }) {
    const { db } = getFirebaseContext();
    const snap = await oauthIdentityCollection(db).doc(oauthIdentityId(provider, providerUserId)).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    return data.userId ? getUserById(db, data.userId) : null;
  }

  async function touchOAuthIdentityLogin({ provider, providerUserId }) {
    const { db } = getFirebaseContext();
    await oauthIdentityCollection(db).doc(oauthIdentityId(provider, providerUserId)).set({
      lastLoginAt: nowTimestamp(),
    }, { merge: true });
  }

  async function upsertOAuthIdentity({ provider, providerUserId, userId, email }) {
    const { db } = getFirebaseContext();
    await oauthIdentityCollection(db).doc(oauthIdentityId(provider, providerUserId)).set({
      provider: String(provider),
      providerUserId: String(providerUserId),
      userId: String(userId),
      email: email || null,
      emailLower: email ? normalizeEmailKey(email) : null,
      lastLoginAt: nowTimestamp(),
    }, { merge: true });
  }

  async function createOAuthIdentity({ provider, providerUserId, userId, email }) {
    const { db } = getFirebaseContext();
    const createdAt = nowTimestamp();
    await oauthIdentityCollection(db).doc(oauthIdentityId(provider, providerUserId)).create({
      provider: String(provider),
      providerUserId: String(providerUserId),
      userId: String(userId),
      email: email || null,
      emailLower: email ? normalizeEmailKey(email) : null,
      createdAt,
      lastLoginAt: createdAt,
    });
  }

  async function setOAuthTokens({ provider, providerUserId, refreshToken, accessToken, expiresAt, scope }) {
    const { db } = getFirebaseContext();
    const update = { updatedAt: nowTimestamp() };
    if (refreshToken) update.refreshToken = refreshToken;
    if (accessToken !== undefined) update.accessToken = accessToken || null;
    if (expiresAt !== undefined) update.accessTokenExp = expiresAt ? new Date(expiresAt) : null;
    if (scope !== undefined) update.scope = scope || null;
    await oauthIdentityCollection(db).doc(oauthIdentityId(provider, providerUserId)).set(update, { merge: true });
  }

  async function getOAuthTokensForUser({ userId, provider }) {
    const { db } = getFirebaseContext();
    const snap = await oauthIdentityCollection(db)
      .where('userId', '==', String(userId))
      .where('provider', '==', String(provider))
      .limit(1)
      .get();
    if (snap.empty) return null;
    const d = snap.docs[0].data() || {};
    return {
      provider: d.provider,
      providerUserId: d.providerUserId,
      refreshToken: d.refreshToken || null,
      accessToken: d.accessToken || null,
      accessTokenExp: d.accessTokenExp?.toDate ? d.accessTokenExp.toDate().getTime() : (d.accessTokenExp || null),
      scope: d.scope || null,
    };
  }

  async function findOrCreateOneToOneConversation({ conversationId, meId, peerId }) {
    const { db } = getFirebaseContext();
    if (String(meId) === String(peerId)) throw new Error('cannot_chat_with_self');
    const mappingKey = oneToOneConversationKey(meId, peerId);
    const mappingRef = oneToOneConversationCollection(db).doc(mappingKey);
    const conversationRef = conversationCollection(db).doc(String(conversationId));
    const meMemberRef = conversationMemberCollection(db).doc(conversationMemberId(conversationId, meId));
    const peerMemberRef = conversationMemberCollection(db).doc(conversationMemberId(conversationId, peerId));
    const createdAt = nowTimestamp();

    return db.runTransaction(async (tx) => {
      const mappingSnap = await tx.get(mappingRef);
      if (mappingSnap.exists) {
        return mappingSnap.data()?.conversationId || String(conversationId);
      }

      tx.create(conversationRef, {
        isGroup: false,
        title: null,
        createdBy: String(meId),
        createdAt,
        lastMsgAt: null,
      });
      tx.create(meMemberRef, {
        conversationId: String(conversationId),
        userId: String(meId),
        joinedAt: createdAt,
        lastReadAt: null,
        role: 'member',
      });
      tx.create(peerMemberRef, {
        conversationId: String(conversationId),
        userId: String(peerId),
        joinedAt: createdAt,
        lastReadAt: null,
        role: 'member',
      });
      tx.create(mappingRef, {
        conversationId: String(conversationId),
        members: [String(meId), String(peerId)].sort(),
        createdAt,
      });
      return String(conversationId);
    });
  }

  async function createGroupConversation({ conversationId, creatorId, memberIds, title }) {
    const { db } = getFirebaseContext();
    const ids = Array.from(new Set([String(creatorId), ...memberIds.map(String)]));
    if (ids.length < 2) throw new Error('group_needs_members');
    if (ids.length > 256) throw new Error('group_too_large');

    const conversationRef = conversationCollection(db).doc(String(conversationId));
    const createdAt = nowTimestamp();
    const cleanTitle = String(title || '').trim().slice(0, 80) || null;

    return db.runTransaction(async (tx) => {
      tx.create(conversationRef, {
        isGroup: true,
        title: cleanTitle,
        createdBy: String(creatorId),
        createdAt,
        lastMsgAt: null,
      });
      for (const userId of ids) {
        tx.create(
          conversationMemberCollection(db).doc(conversationMemberId(conversationId, userId)),
          {
            conversationId: String(conversationId),
            userId,
            joinedAt: createdAt,
            lastReadAt: null,
            role: userId === String(creatorId) ? 'admin' : 'member',
          },
        );
      }
      return String(conversationId);
    });
  }

  async function listConversations(userId) {
    const { db } = getFirebaseContext();
    const membershipSnap = await conversationMemberCollection(db).where('userId', '==', String(userId)).get();

    const rows = await Promise.all(membershipSnap.docs.map(async (membershipDoc) => {
      const membership = membershipDoc.data() || {};
      const conversationId = membership.conversationId;
      const [conversationSnap, memberSnap, messageSnap] = await Promise.all([
        conversationCollection(db).doc(String(conversationId)).get(),
        conversationMemberCollection(db).where('conversationId', '==', String(conversationId)).get(),
        chatMessageCollection(db).where('conversationId', '==', String(conversationId)).get(),
      ]);

      if (!conversationSnap.exists) return null;
      const conversation = conversationSnap.data() || {};
      const messages = messageSnap.docs
        .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
        .filter((msg) => !msg.deletedAt)
        .sort((left, right) => compareDescDates(coerceDate(left.createdAt), coerceDate(right.createdAt)));
      const latestMessage = messages[0] || null;
      const members = await Promise.all(memberSnap.docs
        .map((doc) => doc.data() || {})
        .filter((row) => Boolean(conversation.isGroup) || row.userId !== String(userId))
        .map(async (row) => {
          const user = await getUserById(db, row.userId);
          return user ? { id: user.id, displayName: user.displayName } : null;
        }));

      const lastReadAt = coerceDate(membership.lastReadAt);
      const unread = messages.filter((msg) => {
        const createdAt = coerceDate(msg.createdAt);
        return msg.senderId !== String(userId) && (!lastReadAt || (createdAt && createdAt.getTime() > lastReadAt.getTime()));
      }).length;

      return {
        id: conversationSnap.id,
        is_group: Boolean(conversation.isGroup),
        title: conversation.title || null,
        last_msg_at: coerceDate(conversation.lastMsgAt),
        last_body: latestMessage?.body || null,
        members: members.filter(Boolean),
        unread,
        _createdAt: coerceDate(conversation.createdAt),
      };
    }));

    return rows
      .filter(Boolean)
      .sort((left, right) => {
        const byLastMessage = compareDescDates(left.last_msg_at, right.last_msg_at);
        return byLastMessage !== 0 ? byLastMessage : compareDescDates(left._createdAt, right._createdAt);
      })
      .map(({ _createdAt, ...row }) => row);
  }

  async function listMessages({ conversationId, userId, before, limit }) {
    const { db } = getFirebaseContext();
    const memberSnap = await conversationMemberCollection(db)
      .doc(conversationMemberId(conversationId, userId))
      .get();
    if (!memberSnap.exists) throw new Error('forbidden');

    const beforeDate = before ? new Date(before) : null;
    const messageDocs = await chatMessageCollection(db)
      .where('conversationId', '==', String(conversationId))
      .get();

    const messages = messageDocs.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
      .filter((row) => !row.deletedAt)
      .filter((row) => {
        if (!beforeDate) return true;
        const createdAt = coerceDate(row.createdAt);
        return createdAt && createdAt.getTime() < beforeDate.getTime();
      })
      .sort((left, right) => compareDescDates(coerceDate(left.createdAt), coerceDate(right.createdAt)))
      .slice(0, Math.min(Number(limit) || 50, 200))
      .reverse()
      .map((row) => ({
        id: row.id,
        conversationId: row.conversationId,
        senderId: row.senderId,
        body: row.body,
        clientId: row.clientId || null,
        createdAt: coerceDate(row.createdAt),
      }));

    return messages;
  }

  async function persistMessage({ messageId, conversationId, senderId, body, clientId }) {
    const { db } = getFirebaseContext();
    const memberRef = conversationMemberCollection(db).doc(conversationMemberId(conversationId, senderId));
    const messageRef = chatMessageCollection(db).doc(String(messageId));
    const conversationRef = conversationCollection(db).doc(String(conversationId));
    const createdAt = nowTimestamp();

    return db.runTransaction(async (tx) => {
      const memberSnap = await tx.get(memberRef);
      if (!memberSnap.exists) throw new Error('forbidden');

      tx.create(messageRef, {
        conversationId: String(conversationId),
        senderId: String(senderId),
        body: String(body),
        clientId: clientId || null,
        createdAt,
        editedAt: null,
        deletedAt: null,
      });
      tx.set(conversationRef, { lastMsgAt: createdAt }, { merge: true });

      return {
        id: String(messageId),
        conversationId: String(conversationId),
        senderId: String(senderId),
        body: String(body),
        clientId: clientId || null,
        createdAt: createdAt.toDate(),
      };
    });
  }

  async function listConversationMemberIds(conversationId) {
    const { db } = getFirebaseContext();
    const snap = await conversationMemberCollection(db).where('conversationId', '==', String(conversationId)).get();
    return snap.docs.map((doc) => String((doc.data() || {}).userId)).filter(Boolean);
  }

  async function markDelivered({ messageId, userId }) {
    const { db } = getFirebaseContext();
    const receiptRef = messageReceiptCollection(db).doc(messageReceiptId(messageId, userId));
    const existing = await receiptRef.get();
    const current = existing.exists ? existing.data() || {} : {};
    await receiptRef.set({
      messageId: String(messageId),
      userId: String(userId),
      deliveredAt: current.deliveredAt || nowTimestamp(),
      readAt: current.readAt || null,
    }, { merge: true });
  }

  async function markRead({ messageId, userId }) {
    const { db } = getFirebaseContext();
    const receiptRef = messageReceiptCollection(db).doc(messageReceiptId(messageId, userId));
    const existing = await receiptRef.get();
    const current = existing.exists ? existing.data() || {} : {};
    await receiptRef.set({
      messageId: String(messageId),
      userId: String(userId),
      deliveredAt: current.deliveredAt || nowTimestamp(),
      readAt: current.readAt || nowTimestamp(),
    }, { merge: true });
  }

  async function touchConversationRead({ conversationId, userId }) {
    const { db } = getFirebaseContext();
    await conversationMemberCollection(db).doc(conversationMemberId(conversationId, userId)).set({
      lastReadAt: nowTimestamp(),
    }, { merge: true });
  }

  async function ensurePresenceColumns() {
    return true;
  }

  async function touchLastSeen(userId) {
    const { db } = getFirebaseContext();
    await userCollection(db).doc(String(userId)).set({
      lastSeenAt: nowTimestamp(),
    }, { merge: true });
  }

  async function getPresenceRows(userIds) {
    const { db } = getFirebaseContext();
    const rows = await Promise.all(userIds.map(async (id) => {
      const doc = await userCollection(db).doc(String(id)).get();
      if (!doc.exists) return null;
      const data = doc.data() || {};
      return {
        id: doc.id,
        lastSeenAt: coerceDate(data.lastSeenAt),
      };
    }));
    return rows.filter(Boolean);
  }

  async function findRemoteIdByUserId(userId) {
    const { db } = getFirebaseContext();
    const doc = await userCollection(db).doc(String(userId)).get();
    return doc.exists ? (doc.data() || {}).remoteId || null : null;
  }

  async function assignRemoteId(userId, remoteId) {
    const { db } = getFirebaseContext();
    const userRef = userCollection(db).doc(String(userId));
    const remoteRef = remoteIdCollection(db).doc(String(remoteId));
    try {
      await db.runTransaction(async (tx) => {
        const [userSnap, remoteSnap] = await Promise.all([
          tx.get(userRef),
          tx.get(remoteRef),
        ]);

        const currentRemoteId = userSnap.exists ? (userSnap.data() || {}).remoteId : null;
        const remoteOwner = remoteSnap.exists ? (remoteSnap.data() || {}).userId : null;
        if (remoteOwner && remoteOwner !== String(userId)) {
          const error = new Error('remote_id_taken');
          error.code = '23505';
          throw error;
        }

        if (currentRemoteId && currentRemoteId !== String(remoteId)) {
          tx.delete(remoteIdCollection(db).doc(String(currentRemoteId)));
        }

        tx.set(userRef, { remoteId: String(remoteId), updatedAt: nowTimestamp() }, { merge: true });
        tx.set(remoteRef, { userId: String(userId), updatedAt: nowTimestamp() }, { merge: true });
      });
    } catch (error) {
      if (String(error?.code) === '6' || /already exists/i.test(String(error?.message))) {
        error.code = '23505';
      }
      throw error;
    }
  }

  async function findHostByRemoteId(remoteId) {
    const { db } = getFirebaseContext();
    const remoteSnap = await remoteIdCollection(db).doc(String(remoteId)).get();
    if (!remoteSnap.exists) return null;
    const userId = (remoteSnap.data() || {}).userId;
    if (!userId) return null;
    const user = await getUserById(db, userId);
    return user ? { id: user.id, displayName: user.displayName } : null;
  }

  async function saveAnnouncement({ hostUserId, pinHash, pinSalt, expiresAt, sessionId }) {
    const { db } = getFirebaseContext();
    await remoteAnnouncementCollection(db).doc(String(hostUserId)).set({
      hostUserId: String(hostUserId),
      pinHash: encodeBinary(pinHash),
      pinSalt: encodeBinary(pinSalt),
      pinAttempts: 0,
      expiresAt: Timestamp.fromDate(new Date(expiresAt)),
      sessionId: String(sessionId),
      updatedAt: nowTimestamp(),
    });
  }

  async function cancelAnnouncement(hostUserId) {
    const { db } = getFirebaseContext();
    await remoteAnnouncementCollection(db).doc(String(hostUserId)).delete();
  }

  async function getAnnouncementStatus(hostUserId) {
    const { db } = getFirebaseContext();
    const doc = await remoteAnnouncementCollection(db).doc(String(hostUserId)).get();
    if (!doc.exists) return null;
    const data = doc.data() || {};
    return {
      expires_at: coerceDate(data.expiresAt),
      session_id: data.sessionId || null,
    };
  }

  async function connectWithPin({ hostUserId, viewerUserId, pin, hashPin, timingSafeEqual, maxAttempts }) {
    const { db } = getFirebaseContext();
    const announcementRef = remoteAnnouncementCollection(db).doc(String(hostUserId));
    const logRef = remoteSessionLogCollection(db).doc();

    return db.runTransaction(async (tx) => {
      const snap = await tx.get(announcementRef);
      if (!snap.exists) return { outcome: 'host_not_announcing' };

      const announcement = snap.data() || {};
      const expiresAt = coerceDate(announcement.expiresAt);
      if (expiresAt && expiresAt.getTime() < Date.now()) {
        tx.delete(announcementRef);
        return { outcome: 'pin_expired' };
      }

      const attempts = Number(announcement.pinAttempts || 0);
      if (attempts >= maxAttempts) {
        tx.delete(announcementRef);
        return { outcome: 'too_many_attempts' };
      }

      const submitted = hashPin(String(pin), decodeBinary(announcement.pinSalt));
      const ok = timingSafeEqual(submitted, decodeBinary(announcement.pinHash));
      if (!ok) {
        tx.set(announcementRef, {
          pinAttempts: attempts + 1,
          updatedAt: nowTimestamp(),
        }, { merge: true });
        return { outcome: 'bad_pin' };
      }

      tx.delete(announcementRef);
      tx.create(logRef, {
        sessionId: announcement.sessionId,
        hostUserId: String(hostUserId),
        viewerUserId: String(viewerUserId),
        startedAt: nowTimestamp(),
        endedAt: null,
        endReason: null,
      });
      return { outcome: 'ok', sessionId: announcement.sessionId };
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
      markKnownContact,
      listKnownContacts,
      setUserAvatar,
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
      setOAuthTokens,
      getOAuthTokensForUser,
      updateUserEmail,
      updateUserContact,
    },

    chat: {
      findOrCreateOneToOneConversation,
      createGroupConversation,
      listConversations,
      listMessages,
      persistMessage,
      listConversationMemberIds,
      markDelivered,
      markRead,
      touchConversationRead,
    },

    presence: {
      ensurePresenceColumns,
      touchLastSeen,
      getPresenceRows,
    },

    remote: {
      findRemoteIdByUserId,
      assignRemoteId,
      findHostByRemoteId,
      saveAnnouncement,
      cancelAnnouncement,
      getAnnouncementStatus,
      connectWithPin,
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