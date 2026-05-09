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
  };
}