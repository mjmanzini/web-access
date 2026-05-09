function buildNotImplemented(namespace, method, details) {
  return () => {
    const suffix = details ? ` (${details})` : '';
    throw new Error(`Firebase storage adapter not implemented for ${namespace}.${method}${suffix}`);
  };
}

function buildAsyncNotImplemented(namespace, method, details) {
  return async (..._args) => {
    const suffix = details ? ` (${details})` : '';
    throw new Error(`Firebase storage adapter not implemented for ${namespace}.${method}${suffix}`);
  };
}

export function createFirebaseStorage() {
  const details = [
    process.env.FIREBASE_PROJECT_ID ? `project=${process.env.FIREBASE_PROJECT_ID}` : null,
    process.env.FIREBASE_CLIENT_EMAIL ? 'clientEmail=set' : null,
    process.env.FIREBASE_PRIVATE_KEY ? 'privateKey=set' : null,
  ].filter(Boolean).join(', ');

  return {
    users: {
      createUser: buildAsyncNotImplemented('users', 'createUser', details),
      findUserByLegacyToken: buildAsyncNotImplemented('users', 'findUserByLegacyToken', details),
      findUserBySessionTokenHash: buildAsyncNotImplemented('users', 'findUserBySessionTokenHash', details),
      touchSessionToken: buildAsyncNotImplemented('users', 'touchSessionToken', details),
      findUserById: buildAsyncNotImplemented('users', 'findUserById', details),
      listUsers: buildAsyncNotImplemented('users', 'listUsers', details),
    },

    auth: {
      saveChallenge: buildAsyncNotImplemented('auth', 'saveChallenge', details),
      consumeChallenge: buildAsyncNotImplemented('auth', 'consumeChallenge', details),
      issueSessionToken: buildAsyncNotImplemented('auth', 'issueSessionToken', details),
      findUserByUsername: buildAsyncNotImplemented('auth', 'findUserByUsername', details),
      getRegistrationOptionsContext: buildAsyncNotImplemented('auth', 'getRegistrationOptionsContext', details),
      listUserWebauthnCredentials: buildAsyncNotImplemented('auth', 'listUserWebauthnCredentials', details),
      upsertWebauthnCredential: buildAsyncNotImplemented('auth', 'upsertWebauthnCredential', details),
      findAuthenticationCredential: buildAsyncNotImplemented('auth', 'findAuthenticationCredential', details),
      updateWebauthnCounter: buildAsyncNotImplemented('auth', 'updateWebauthnCounter', details),
      findOwnedAuthenticationCredential: buildAsyncNotImplemented('auth', 'findOwnedAuthenticationCredential', details),
      findOAuthIdentityUser: buildAsyncNotImplemented('auth', 'findOAuthIdentityUser', details),
      touchOAuthIdentityLogin: buildAsyncNotImplemented('auth', 'touchOAuthIdentityLogin', details),
      findUserByEmail: buildAsyncNotImplemented('auth', 'findUserByEmail', details),
      upsertOAuthIdentity: buildAsyncNotImplemented('auth', 'upsertOAuthIdentity', details),
      createOAuthIdentity: buildAsyncNotImplemented('auth', 'createOAuthIdentity', details),
      updateUserEmail: buildAsyncNotImplemented('auth', 'updateUserEmail', details),
    },

    chat: {
      findOrCreateOneToOneConversation: buildAsyncNotImplemented('chat', 'findOrCreateOneToOneConversation', details),
      listConversations: buildAsyncNotImplemented('chat', 'listConversations', details),
      listMessages: buildAsyncNotImplemented('chat', 'listMessages', details),
      persistMessage: buildAsyncNotImplemented('chat', 'persistMessage', details),
      listConversationMemberIds: buildAsyncNotImplemented('chat', 'listConversationMemberIds', details),
      markDelivered: buildAsyncNotImplemented('chat', 'markDelivered', details),
      markRead: buildAsyncNotImplemented('chat', 'markRead', details),
      touchConversationRead: buildAsyncNotImplemented('chat', 'touchConversationRead', details),
    },

    presence: {
      ensurePresenceColumns: buildAsyncNotImplemented('presence', 'ensurePresenceColumns', details),
      touchLastSeen: buildAsyncNotImplemented('presence', 'touchLastSeen', details),
      getPresenceRows: buildAsyncNotImplemented('presence', 'getPresenceRows', details),
    },

    remote: {
      findRemoteIdByUserId: buildAsyncNotImplemented('remote', 'findRemoteIdByUserId', details),
      assignRemoteId: buildAsyncNotImplemented('remote', 'assignRemoteId', details),
      findHostByRemoteId: buildAsyncNotImplemented('remote', 'findHostByRemoteId', details),
      saveAnnouncement: buildAsyncNotImplemented('remote', 'saveAnnouncement', details),
      cancelAnnouncement: buildAsyncNotImplemented('remote', 'cancelAnnouncement', details),
      getAnnouncementStatus: buildAsyncNotImplemented('remote', 'getAnnouncementStatus', details),
      connectWithPin: buildAsyncNotImplemented('remote', 'connectWithPin', details),
    },

    meta: {
      backend: 'firebase',
      assertReady: buildNotImplemented('meta', 'assertReady', details),
    },
  };
}