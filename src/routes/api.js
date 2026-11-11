import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, q, token, now, getSetting, setSetting } from '../db.js';
import { listVoices, tts } from '../ai.js';
import { config, features, audioDir } from '../config.js';
import { requireUser, createSession, destroySession, currentUser, hash, verify } from '../auth.js';
import * as conv from '../conversation.js';
import { CHAPTERS } from '../questions.js';
import { createCheckout } from '../payments.js';
import { normalizePhone } from '../waha.js';

export const api = express.Router();

const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');
const publicUser = (u) => ({
  id: u.id, name: u.name, email: u.email, phone: u.phone, plan: u.plan, plan_until: u.plan_until,
  planActive: u.plan === 'active' && (!u.plan_until || u.plan_until > now()),
  admin: config.adminEmails.includes(u.email.toLowerCase()),
});

// ---------- público ----------

api.get('/config', async (req, res) => res.json({
  features: { ...Object.fromEntries(Object.keys(features).map(k => [k, features[k]])) },
  prices: { plan: config.payments.planPrice, book: config.payments.bookPrice },
  trialConversations: config.conversation.trialConversations,
  chapters: CHAPTERS.map(c => ({ key: c.key, name: c.name })),
}));

api.post('/waitlist', async (req, res) => {
  const { name, email, phone, interest } = req.body || {};
  if (!emailOk(email)) return res.status(400).json({ error: 'Informe um e-mail válido.' });
  (await db.run('INSERT INTO waitlist (name, email, phone, interest) VALUES (?,?,?,?)', [name || null, email.trim().toLowerCase(), phone || null, interest || null]));
  res.json({ ok: true });
});

api.post('/auth/signup', async (req, res) => {
  const { name, email, password, phone } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Informe seu nome.' });
  if (!emailOk(email)) return res.status(400).json({ error: 'Informe um e-mail válido.' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'A senha precisa ter pelo menos 6 caracteres.' });
  const em = email.trim().toLowerCase();
  if ((await db.get('SELECT 1 FROM users WHERE email = ?', [em]))) return res.status(409).json({ error: 'Este e-mail já tem conta. Faça login.' });
  const r = (await db.run('INSERT INTO users (name, email, phone, password_hash) VALUES (?,?,?,?)', [name.trim(), em, phone ? normalizePhone(phone) : null, hash(password)]));
  await createSession(res, r.lastInsertRowid);
  res.json({ user: publicUser(await q.user(r.lastInsertRowid)) });
});

api.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const u = (await db.get('SELECT * FROM users WHERE email = ?', [(email || '').trim().toLowerCase()]));
  if (!u || !verify(password || '', u.password_hash)) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  await createSession(res, u.id);
  res.json({ user: publicUser(u) });
});

api.post('/auth/logout', async (req, res) => { await destroySession(req, res); res.json({ ok: true }); });

api.get('/me', async (req, res) => {
  const u = await currentUser(req);
  res.json({ user: u ? publicUser(u) : null });
});

// ---------- área logada ----------

api.use(requireUser);

api.patch('/me', async (req, res) => {
  const { name, phone } = req.body || {};
  (await db.run('UPDATE users SET name = COALESCE(?, name), phone = ? WHERE id = ?', [name?.trim() || null, phone ? normalizePhone(phone) : null, req.user.id]));
  res.json({ user: publicUser(await q.user(req.user.id)) });
});

async function ownElder(req, res) {
  const e = await q.elder(Number(req.params.id));
  if (!e || e.user_id !== req.user.id) { res.status(404).json({ error: 'Não encontrado.' }); return null; }
  return e;
}

const elderView = async (e) => {
  const stats = (await db.get(`SELECT
      (SELECT COUNT(*) FROM stories WHERE elder_id = ? AND hidden = 0) stories,
      (SELECT COUNT(*) FROM messages WHERE elder_id = ? AND direction = 'in' AND kind = 'audio') audios,
      (SELECT id FROM conversations WHERE elder_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1) open_conversation`, [e.id, e.id, e.id]));
  return { ...e, ...stats, link: `${config.publicUrl}/g/${e.token}` };
};

const ELDER_FIELDS = ['voice_id', 'name', 'call_name', 'pronoun', 'relation', 'requester_name', 'phone', 'birth_year', 'city', 'notes', 'channel', 'voice', 'weekday', 'hour'];

function cleanElder(body, partial = false) {
  const o = {};
  for (const k of ELDER_FIELDS) if (body[k] !== undefined) o[k] = body[k] === '' ? null : body[k];
  if (o.pronoun && !['a senhora', 'o senhor', 'você'].includes(o.pronoun)) o.pronoun = 'a senhora';
  if (o.channel && !['whatsapp', 'link'].includes(o.channel)) o.channel = 'whatsapp';
  if (o.phone) o.phone = normalizePhone(o.phone);
  if (o.voice !== undefined) o.voice = o.voice ? 1 : 0;
  if (o.weekday !== undefined) o.weekday = Math.min(6, Math.max(0, Number(o.weekday) || 0));
  if (o.hour !== undefined) o.hour = Math.min(22, Math.max(7, Number(o.hour) || 10));
  if (o.birth_year) o.birth_year = Number(o.birth_year) || null;
  if (!partial) {
    if (!o.name) throw new Error('Informe o nome.');
    if (!o.call_name) o.call_name = o.name.split(' ')[0];
    if ((o.channel || 'whatsapp') === 'whatsapp' && !o.phone) throw new Error('Informe o WhatsApp para o canal WhatsApp.');
  }
  return o;
}

api.get('/elders', async (req, res) => {
  const list = (await db.all('SELECT * FROM elders WHERE user_id = ? ORDER BY id', [req.user.id])).map(elderView);
  const elders = await Promise.all(list);
  res.json({ elders });
});

api.post('/elders', async (req, res) => {
  let o;
  try { o = cleanElder(req.body || {}); } catch (e) { return res.status(400).json({ error: e.message }); }
  o.user_id = req.user.id; o.token = token(16);
  const keys = Object.keys(o);
  const r = (await db.run(`INSERT INTO elders (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, [...keys.map(k => o[k])]));
  res.json({ elder: await elderView(await q.elder(r.lastInsertRowid)) });
});

api.get('/elders/:id', async (req, res) => {
  const e = await ownElder(req, res); if (!e) return;
  res.json({ elder: await elderView(e) });
});

api.patch('/elders/:id', async (req, res) => {
  const e = await ownElder(req, res); if (!e) return;
  let o;
  try { o = cleanElder(req.body || {}, true); } catch (err) { return res.status(400).json({ error: err.message }); }
  if (o.phone && o.phone !== e.phone) { o.chat_id = null; o.lid = null; }
  const keys = Object.keys(o);
  if (keys.length) (await db.run(`UPDATE elders SET ${keys.map(k => `${k} = ?`).join(',')} WHERE id = ?`, [...keys.map(k => o[k]), e.id]));
  if (req.body.status && ['active', 'paused'].includes(req.body.status) && ['active', 'paused'].includes(e.status)) {
    (await db.run('UPDATE elders SET status = ? WHERE id = ?', [req.body.status, e.id]));
  }
  res.json({ elder: await elderView(await q.elder(e.id)) });
});

api.delete('/elders/:id', async (req, res) => {
  const e = await ownElder(req, res); if (!e) return;
  (await db.run('DELETE FROM elders WHERE id = ?', [e.id]));
  fs.rmSync(path.join(audioDir, String(e.id)), { recursive: true, force: true });
  res.json({ ok: true });
});

api.post('/elders/:id/invite', async (req, res) => {
  const e = await ownElder(req, res); if (!e) return;
  if (e.channel !== 'whatsapp') return res.status(400).json({ error: 'No canal "link", envie o link de gravação para o idoso.' });
  if (!features.whatsapp) return res.status(400).json({ error: 'WhatsApp (WAHA) não está configurado no servidor.' });
  try { await conv.invite(e); res.json({ elder: await elderView(await q.elder(e.id)) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

api.post('/elders/:id/start', async (req, res) => {
  const e = await ownElder(req, res); if (!e) return;
  try {
    const r = await conv.startConversation(e, { force: true });
    if (!r.ok) return res.status(r.needsPlan ? 402 : 400).json({ error: r.reason, needsPlan: r.needsPlan });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

api.post('/elders/:id/finish', async (req, res) => {
  const e = await ownElder(req, res); if (!e) return;
  const c = await q.openConversation(e.id);
  if (!c) return res.status(400).json({ error: 'Nenhuma conversa aberta.' });
  const story = await conv.closeConversation(c.id, { thank: true });
  res.json({ ok: true, story });
});

api.get('/elders/:id/stories', async (req, res) => {
  const e = await ownElder(req, res); if (!e) return;
  const stories = (await db.all('SELECT * FROM stories WHERE elder_id = ? AND hidden = 0 ORDER BY id DESC', [e.id])).map(async s => ({
    ...s,
    audios: (await db.all("SELECT id, created_at FROM messages WHERE conversation_id = ? AND direction = 'in' AND audio_path IS NOT NULL ORDER BY id", [s.conversation_id])),
    listen_url: `${config.publicUrl}/ouvir/${s.public_token}`,
  }));
  res.json({ stories: await Promise.all(stories) });
});

api.get('/elders/:id/conversations', async (req, res) => {
  const e = await ownElder(req, res); if (!e) return;
  const convs = (await db.all('SELECT * FROM conversations WHERE elder_id = ? AND question != ? ORDER BY id DESC LIMIT 30', [e.id, '(pulada pela IA)']));
  const msgs = (await db.all('SELECT id, conversation_id, direction, kind, text, audio_path IS NOT NULL has_audio, created_at FROM messages WHERE elder_id = ? ORDER BY id', [e.id]));
  res.json({ conversations: convs.map(c => ({ ...c, messages: msgs.filter(m => m.conversation_id === c.id) })) });
});

api.patch('/stories/:id', async (req, res) => {
  const s = (await db.get('SELECT s.* FROM stories s JOIN elders e ON e.id = s.elder_id WHERE s.id = ? AND e.user_id = ?', [Number(req.params.id), req.user.id]));
  if (!s) return res.status(404).json({ error: 'Não encontrado.' });
  const { title, body, chapter, hidden } = req.body || {};
  (await db.run('UPDATE stories SET title = COALESCE(?, title), body = COALESCE(?, body), chapter = COALESCE(?, chapter), hidden = COALESCE(?, hidden), updated_at = ? WHERE id = ?', [title ?? null, body ?? null, chapter ?? null, hidden === undefined ? null : (hidden ? 1 : 0), now(), s.id]));
  res.json({ ok: true });
});

api.get('/messages/:id/audio', async (req, res) => {
  const m = (await db.get('SELECT m.* FROM messages m JOIN elders e ON e.id = m.elder_id WHERE m.id = ? AND e.user_id = ?', [Number(req.params.id), req.user.id]));
  sendAudio(res, m);
});

export function sendAudio(res, m) {
  if (!m?.audio_path) return res.status(404).end();
  const file = path.join(audioDir, m.audio_path);
  if (!file.startsWith(audioDir) || !fs.existsSync(file)) return res.status(404).end();
  const ext = path.extname(file).slice(1);
  res.type({ ogg: 'audio/ogg', webm: 'audio/webm', m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav' }[ext] || 'application/octet-stream');
  res.sendFile(file);
}

// ---------- vozes ----------
const isAdmin = (u) => config.adminEmails.includes(u.email.toLowerCase());

api.get('/voices', async (req, res) => {
  if (config.ai.ttsProvider !== 'elevenlabs') return res.json({ provider: config.ai.ttsProvider, voices: [], current: null });
  try {
    const voices = await listVoices({ fresh: req.query.fresh === '1' });
    res.json({ provider: 'elevenlabs', voices, current: (await getSetting('eleven_voice_id')) || config.ai.elevenVoiceId || null, canSetDefault: isAdmin(req.user) });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

const previewCache = new Map();
api.post('/voices/preview', async (req, res) => {
  const { voiceId, name } = req.body || {};
  const text = `Bom dia, ${String(name || 'Dona Maria').slice(0, 40)}! Hoje eu queria ouvir uma história sua. Como era a casa onde a senhora cresceu?`;
  const key = `${voiceId}|${text}`;
  try {
    let audio = previewCache.get(key);
    if (!audio) { audio = await tts(text, { voiceId: voiceId || null }); previewCache.set(key, audio); if (previewCache.size > 100) previewCache.clear(); }
    if (!audio) return res.status(400).json({ error: 'Voz não configurada no servidor.' });
    res.type('audio/ogg').send(audio);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

api.put('/voices/default', async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Só o administrador escolhe a voz padrão.' });
  await setSetting('eleven_voice_id', req.body?.voiceId || null);
  res.json({ ok: true });
});

api.post('/checkout', async (req, res) => {
  const { product, elderId, shipping } = req.body || {};
  try { res.json(await createCheckout(req.user, product, { elderId, shipping })); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

api.get('/admin/overview', async (req, res) => {
  if (!config.adminEmails.includes(req.user.email.toLowerCase())) return res.status(403).json({ error: 'Sem acesso.' });
  res.json({
    waitlist: (await db.all('SELECT * FROM waitlist ORDER BY id DESC')),
    users: (await db.all('SELECT id, name, email, phone, plan, plan_until, created_at FROM users ORDER BY id DESC')),
    payments: (await db.all('SELECT * FROM payments ORDER BY id DESC LIMIT 200')),
    totals: (await db.get(`SELECT (SELECT COUNT(*) FROM elders) elders, (SELECT COUNT(*) FROM stories) stories,
      (SELECT COUNT(*) FROM messages WHERE direction='in') answers`)),
  });
});
