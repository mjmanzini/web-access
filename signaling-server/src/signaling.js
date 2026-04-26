/**
 * Minimal WebRTC signaling over Socket.IO.
 *
 * Roles:
 *   - "host"   : the Electron desktop capturer (offers video track)
 *   - "client" : the Next.js web/mobile viewer (answers)
 *
 * Flow:
 *   1. Host calls POST /pair/new -> gets { code, sessionId }.
 *   2. Host connects socket, emits "join" { sessionId, role: "host" }.
 *   3. Phone scans QR / types code, calls GET /pair/resolve/:code -> sessionId.
 *   4. Client connects socket, emits "join" { sessionId, role: "client" }.
 *   5. Server notifies host ("peer-joined"), host creates RTCPeerConnection offer.
 *   6. "signal" messages ({ sdp } or { candidate }) are relayed host <-> client.
 */
export function attachSignaling(io, pairing) {
  io.on('connection', (socket) => {
    let joinedSessionId = null;
    let role = null;

    socket.on('join', ({ sessionId, role: requestedRole } = {}, ack) => {
      const session = pairing.getSession(sessionId);
      if (!session) {
        ack?.({ ok: false, error: 'unknown_session' });
        return;
      }
      if (requestedRole !== 'host' && requestedRole !== 'client') {
        ack?.({ ok: false, error: 'invalid_role' });
        return;
      }
      if (requestedRole === 'host' && session.hostSocketId && session.hostSocketId !== socket.id) {
        ack?.({ ok: false, error: 'host_already_connected' });
        return;
      }
      if (requestedRole === 'client' && session.clientSocketId && session.clientSocketId !== socket.id) {
        ack?.({ ok: false, error: 'client_already_connected' });
        return;
      }

      joinedSessionId = sessionId;
      role = requestedRole;
      socket.join(sessionId);

      if (role === 'host') pairing.attachHost(sessionId, socket.id);
      else pairing.attachClient(sessionId, socket.id);

      ack?.({ ok: true });
      // Tell the *other* side that a peer is present so it can kick off SDP.
      socket.to(sessionId).emit('peer-joined', { role });
      // If the counterpart is already there, also notify this socket.
      const refreshed = pairing.getSession(sessionId);
      const hasHost = !!refreshed?.hostSocketId;
      const hasClient = !!refreshed?.clientSocketId;
      if (hasHost && hasClient) {
        socket.emit('peer-joined', { role: role === 'host' ? 'client' : 'host' });
      }
    });

    // Relay SDP offers/answers and ICE candidates to the other peer in the room.
    socket.on('signal', (payload) => {
      if (!joinedSessionId) return;
      socket.to(joinedSessionId).emit('signal', { from: role, ...payload });
    });

    socket.on('disconnect', () => {
      pairing.detachSocket(socket.id);
      if (joinedSessionId) {
        socket.to(joinedSessionId).emit('peer-left', { role });
      }
    });
  });
}
