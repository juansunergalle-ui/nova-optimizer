'use strict';

/* ============================================================
   Autenticación Google OAuth 2.0 (sin dependencias externas)
   Sesiones en memoria + cookie HttpOnly firmada por token.
   ============================================================ */

const crypto = require('crypto');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

// Mapa de sesiones: token -> { user, createdAt }
const sessions = new Map();

// Limpieza periódica de sesiones vencidas
setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(token);
  }
}, 60 * 60 * 1000).unref();

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx < 0) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  });
  return out;
}

function serializeCookie(name, value, maxAgeSec, secure) {
  const parts = [name + '=' + encodeURIComponent(value), 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeSec != null) parts.push('Max-Age=' + maxAgeSec);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearCookie(name) {
  return name + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { user, createdAt: Date.now() });
  return token;
}

function getSession(req) {
  const token = parseCookies(req).nova_session;
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return null;
  }
  return s.user;
}

function destroySession(req) {
  const token = parseCookies(req).nova_session;
  if (token) sessions.delete(token);
}

function isConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function authUrl(baseUrl, state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: baseUrl + '/auth/google/callback',
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
    state,
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
}

async function exchangeCode(baseUrl, code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      code,
      redirect_uri: baseUrl + '/auth/google/callback',
      grant_type: 'authorization_code',
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.id_token) {
    throw new Error(data.error_description || data.error || 'Error al intercambiar el código con Google');
  }

  // Decodificar el payload del id_token (JWT): sub, email, name, picture
  const payloadB64 = data.id_token.split('.')[1];
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

  return {
    id: payload.sub,
    email: payload.email || '',
    name: payload.name || payload.email || 'Usuario',
    picture: payload.picture || '',
    emailVerified: !!payload.email_verified,
  };
}

module.exports = {
  parseCookies,
  serializeCookie,
  clearCookie,
  createSession,
  getSession,
  destroySession,
  isConfigured,
  authUrl,
  exchangeCode,
};
