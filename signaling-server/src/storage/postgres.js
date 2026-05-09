import { pool } from '../db.js';

export function createPostgresStorage() {
  return {
    users: {
      async createUser({ id, username, displayName, token }) {
        await pool.query(
          `INSERT INTO users (id, username, display_name, token) VALUES ($1, $2, $3, $4)`,
          [id, username, displayName, token],
        );
      },

      async findUserByLegacyToken(token) {
        const { rows } = await pool.query(
          `SELECT id, username, display_name AS "displayName" FROM users WHERE token = $1`,
          [token],
        );
        return rows[0] || null;
      },

      async findUserBySessionTokenHash(tokenHash) {
        const { rows } = await pool.query(
          `SELECT u.id, u.username, u.display_name AS "displayName"
             FROM auth_credentials ac
             JOIN users u ON u.id = ac.user_id
            WHERE ac.credential_type = 'session'
              AND ac.token_hash = $1
              AND (ac.expires_at IS NULL OR ac.expires_at > now())
            ORDER BY ac.created_at DESC
            LIMIT 1`,
          [tokenHash],
        );
        return rows[0] || null;
      },

      async touchSessionToken(tokenHash) {
        await pool.query(
          `UPDATE auth_credentials SET last_used_at = now() WHERE credential_type = 'session' AND token_hash = $1`,
          [tokenHash],
        );
      },

      async findUserById(id) {
        const { rows } = await pool.query(
          `SELECT id, username, display_name AS "displayName" FROM users WHERE id = $1`,
          [id],
        );
        return rows[0] || null;
      },

      async listUsers() {
        const { rows } = await pool.query(
          `SELECT id, username, display_name AS "displayName" FROM users ORDER BY display_name ASC`,
        );
        return rows;
      },
    },

    remote: {
      async findRemoteIdByUserId(userId) {
        const { rows } = await pool.query(`SELECT remote_id FROM users WHERE id = $1`, [userId]);
        return rows[0]?.remote_id || null;
      },

      async assignRemoteId(userId, remoteId) {
        await pool.query(`UPDATE users SET remote_id = $1 WHERE id = $2`, [remoteId, userId]);
      },

      async findHostByRemoteId(remoteId) {
        const { rows } = await pool.query(
          `SELECT id, display_name AS "displayName" FROM users WHERE remote_id = $1`,
          [remoteId],
        );
        return rows[0] || null;
      },

      async saveAnnouncement({ hostUserId, pinHash, pinSalt, expiresAt, sessionId }) {
        await pool.query(
          `INSERT INTO remote_announcements
             (host_user_id, pin_hash, pin_salt, pin_attempts, expires_at, session_id, updated_at)
           VALUES ($1,$2,$3,0,$4,$5, now())
           ON CONFLICT (host_user_id) DO UPDATE
              SET pin_hash=$2, pin_salt=$3, pin_attempts=0,
                  expires_at=$4, session_id=$5, updated_at=now()`,
          [hostUserId, pinHash, pinSalt, expiresAt, sessionId],
        );
      },

      async cancelAnnouncement(hostUserId) {
        await pool.query(`DELETE FROM remote_announcements WHERE host_user_id = $1`, [hostUserId]);
      },

      async getAnnouncementStatus(hostUserId) {
        const { rows } = await pool.query(
          `SELECT expires_at, session_id FROM remote_announcements WHERE host_user_id = $1`,
          [hostUserId],
        );
        return rows[0] || null;
      },

      async connectWithPin({ hostUserId, viewerUserId, pin, hashPin, timingSafeEqual, maxAttempts }) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const { rows } = await client.query(
            `SELECT pin_hash, pin_salt, pin_attempts, expires_at, session_id
               FROM remote_announcements
              WHERE host_user_id = $1 FOR UPDATE`,
            [hostUserId],
          );

          const announcement = rows[0];
          if (!announcement) {
            await client.query('ROLLBACK');
            return { outcome: 'host_not_announcing' };
          }

          if (new Date(announcement.expires_at).getTime() < Date.now()) {
            await client.query('DELETE FROM remote_announcements WHERE host_user_id = $1', [hostUserId]);
            await client.query('COMMIT');
            return { outcome: 'pin_expired' };
          }

          if (announcement.pin_attempts >= maxAttempts) {
            await client.query('DELETE FROM remote_announcements WHERE host_user_id = $1', [hostUserId]);
            await client.query('COMMIT');
            return { outcome: 'too_many_attempts' };
          }

          const submitted = hashPin(String(pin), announcement.pin_salt);
          const ok = timingSafeEqual(submitted, announcement.pin_hash);
          if (!ok) {
            await client.query(
              `UPDATE remote_announcements SET pin_attempts = pin_attempts + 1, updated_at = now()
                WHERE host_user_id = $1`,
              [hostUserId],
            );
            await client.query('COMMIT');
            return { outcome: 'bad_pin' };
          }

          await client.query(`DELETE FROM remote_announcements WHERE host_user_id = $1`, [hostUserId]);
          await client.query(
            `INSERT INTO remote_sessions_log (session_id, host_user_id, viewer_user_id)
             VALUES ($1, $2, $3)`,
            [announcement.session_id, hostUserId, viewerUserId],
          );
          await client.query('COMMIT');

          return { outcome: 'ok', sessionId: announcement.session_id };
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          throw error;
        } finally {
          client.release();
        }
      },
    },
  };
}