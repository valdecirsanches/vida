import bcrypt from 'bcryptjs';
import { db, token, fmt, now } from './db.js';
import { config } from './config.js';

const COOKIE = 'rz_session';
const DAYS = 30;

export async function createSession(res, userId) {
  const t = token(24);
  const exp = fmt(new Date(Date.now() + DAYS * 864e5));
  (await db.run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)', [t, userId, exp]));
  res.cookie(COOKIE, t, {
    httpOnly: true, sameSite: 'lax', secure: config.publicUrl.startsWith('https'), maxAge: DAYS * 864e5, signed: true,
  });
}

export async function destroySession(req, res) {
  const t = req.signedCookies?.[COOKIE];
  if (t) (await db.run('DELETE FROM sessions WHERE token = ?', [t]));
  res.clearCookie(COOKIE);
}

export async function currentUser(req) {
  const t = req.signedCookies?.[COOKIE];
  if (!t) return null;
  const row = (await db.get(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?`, [t, now()]));
  return row || null;
}

export async function requireUser(req, res, next) {
  const u = await currentUser(req);
  if (!u) return res.status(401).json({ error: 'Faça login para continuar.' });
  req.user = u;
  next();
}

export const hash = (p) => bcrypt.hashSync(p, 10);
export const verify = (p, h) => bcrypt.compareSync(p, h);
