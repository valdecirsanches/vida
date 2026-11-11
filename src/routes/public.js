// Rotas públicas: página de gravação do idoso, página de ouvir história, webhooks.
import express from 'express';
import multer from 'multer';
import { db, q, now } from '../db.js';
import { config, features } from '../config.js';
import * as conv from '../conversation.js';
import * as waha from '../waha.js';
import { handleNotification } from '../payments.js';
import { sendAudio } from './api.js';

export const pub = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ===================== Página de gravação (idoso) =====================

const elderByToken = (t) => (db.get('SELECT * FROM elders WHERE token = ?', [t]));

pub.get('/api/g/:token', async (req, res) => {
  const e = await elderByToken(req.params.token);
  if (!e) return res.status(404).json({ error: 'Link inválido.' });
  const c = await q.openConversation(e.id);
  const lastOut = c && (await db.get("SELECT id, text, audio_path IS NOT NULL has_audio FROM messages WHERE conversation_id = ? AND direction = 'out' ORDER BY id DESC LIMIT 1", [c.id]));
  const pending = c && (await db.get("SELECT COUNT(*) n FROM messages WHERE conversation_id = ? AND direction = 'in' AND processed = 0", [c.id])).n;
  const stories = (await db.get('SELECT COUNT(*) n FROM stories WHERE elder_id = ? AND hidden = 0', [e.id])).n;
  res.json({
    call_name: e.call_name, pronoun: e.pronoun, requester_name: e.requester_name, status: e.status, stories,
    conversation: c ? { id: c.id, question: lastOut?.text || c.last_question, audioId: lastOut?.has_audio ? lastOut.id : null, processing: pending > 0 } : null,
  });
});

pub.post('/api/g/:token/consent', async (req, res) => {
  const e = await elderByToken(req.params.token);
  if (!e) return res.status(404).json({ error: 'Link inválido.' });
  if (e.status !== 'active') {
    (await db.run("UPDATE elders SET status = 'active', consent_at = ? WHERE id = ?", [now(), e.id]));
  }
  const fresh = await q.elder(e.id);
  if (!await q.openConversation(e.id)) {
    const r = await conv.startConversation(fresh, { force: true });
    if (!r.ok) return res.status(400).json({ error: r.reason });
  }
  res.json({ ok: true });
});

pub.post('/api/g/:token/answer', upload.single('audio'), async (req, res) => {
  const e = await elderByToken(req.params.token);
  if (!e) return res.status(404).json({ error: 'Link inválido.' });
  if (e.status !== 'active') return res.status(400).json({ error: 'Aceite o convite primeiro.' });
  if (!req.file && !req.body?.text?.trim()) return res.status(400).json({ error: 'Grave um áudio ou escreva sua resposta.' });
  try {
    const r = await conv.receive(e, req.file
      ? { audio: req.file.buffer, mimetype: req.file.mimetype, immediate: true }
      : { text: req.body.text, immediate: true });
    res.json({ ok: true, ...r });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Não consegui salvar. Tente de novo.' }); }
});

pub.get('/api/g/:token/audio/:msgId', async (req, res) => {
  const e = await elderByToken(req.params.token);
  const m = e && (await db.get('SELECT * FROM messages WHERE id = ? AND elder_id = ?', [Number(req.params.msgId), e.id]));
  sendAudio(res, m);
});

// ===================== Ouvir uma história (link do QR code) =====================

const storyByToken = (t) => (db.get('SELECT * FROM stories WHERE public_token = ? AND hidden = 0', [t]));

pub.get('/api/ouvir/:token', async (req, res) => {
  const s = await storyByToken(req.params.token);
  if (!s) return res.status(404).json({ error: 'História não encontrada.' });
  const e = await q.elder(s.elder_id);
  const audios = (await db.all("SELECT id FROM messages WHERE conversation_id = ? AND direction = 'in' AND audio_path IS NOT NULL ORDER BY id", [s.conversation_id]));
  res.json({ title: s.title, body: s.body, chapter: s.chapter, created_at: s.created_at, elder: { call_name: e.call_name, name: e.name }, audios: audios.map(a => a.id) });
});

pub.get('/api/ouvir/:token/audio/:msgId', async (req, res) => {
  const s = await storyByToken(req.params.token);
  const m = s && (await db.get("SELECT * FROM messages WHERE id = ? AND conversation_id = ? AND direction = 'in'", [Number(req.params.msgId), s.conversation_id]));
  sendAudio(res, m);
});

// ===================== Webhook do WAHA =====================

function samePhone(a, b) {
  const x = waha.onlyDigits(a), y = waha.onlyDigits(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // Brasil: ignora a diferença do 9º dígito (55 + DDD + 8 últimos)
  if (x.startsWith('55') && y.startsWith('55')) return x.slice(2, 4) === y.slice(2, 4) && x.slice(-8) === y.slice(-8);
  return false;
}

async function findElderByChat(from, payload) {
  const direct = (await db.get("SELECT * FROM elders WHERE (chat_id = ? OR lid = ?) AND status != 'new' ORDER BY id DESC", [from, from]));
  if (direct) return direct;

  let phoneJid = from;
  if (from.endsWith('@lid')) {
    const d = payload?._data || {};
    phoneJid = d.key?.senderPn || d.key?.remoteJidAlt || d.Info?.SenderAlt || d.Info?.Sender || await waha.lidToPhone(from);
    if (!phoneJid) return null;
  }
  const candidates = (await db.all("SELECT * FROM elders WHERE channel = 'whatsapp' AND status != 'new' ORDER BY id DESC"));
  const e = candidates.find(c => samePhone(c.chat_id || c.phone, phoneJid) || samePhone(c.phone, phoneJid));
  if (e && from.endsWith('@lid')) (await db.run('UPDATE elders SET lid = ? WHERE id = ?', [from, e.id]));
  return e || null;
}

pub.post('/webhooks/waha/:secret', express.json({ limit: '5mb' }), async (req, res) => {
  if (req.params.secret !== config.waha.webhookSecret) return res.status(403).end();
  res.json({ ok: true }); // responde rápido; processa em segundo plano
  handleWaha(req.body).catch(err => console.error('[webhook waha]', err));
});

async function handleWaha(evt) {
  if (!evt || (evt.session && evt.session !== config.waha.session)) return;
  const p = evt.payload || {};

  if (evt.event === 'call.received') {
    if (!p.from || p.isGroup) return;
    try { await waha.rejectCall(p.from, p.id); } catch (e) { console.warn('[call] reject:', e.message); }
    const e = await findElderByChat(p.from, p);
    const msg = e
      ? `Oi, ${e.call_name}! Por aqui eu não consigo atender ligação 📞, mas adoro ouvir áudio! 🎤 Aperte e segure o microfone e me conte. 💛`
      : config.waha.callRejectMessage;
    await waha.sendText(p.from, msg).catch(err => console.warn('[call] msg:', err.message));
    return;
  }

  if (evt.event !== 'message') return;
  if (p.fromMe || !p.from || /@g\.us$|@newsletter$|status@broadcast/.test(p.from)) return;

  // webhook repetido (inclusive em paralelo): não baixa nem transcreve de novo
  if (inFlight.has(p.id) || await conv.messageExists(p.id)) return;
  inFlight.add(p.id);
  try { await handleIncoming(p); } finally { setTimeout(() => inFlight.delete(p.id), 60_000); }
}

const inFlight = new Set();

async function handleIncoming(p) {
  const elder = await findElderByChat(p.from, p);
  if (!elder) return; // número desconhecido: ignora

  const mediaUrl = p.media?.url || p.mediaUrl;
  const mimetype = p.media?.mimetype || p._data?.mimetype || '';
  if (p.hasMedia && mediaUrl && /audio|ogg|opus/.test(mimetype || 'audio')) {
    const buf = await waha.downloadMedia(mediaUrl);
    await conv.receive(elder, { audio: buf, mimetype: mimetype || 'audio/ogg', externalId: p.id });
  } else if (p.body?.trim()) {
    await conv.receive(elder, { text: p.body, externalId: p.id });
  }
}

// ===================== Webhook do Mercado Pago =====================

pub.post('/webhooks/mercadopago', express.json(), async (req, res) => {
  res.sendStatus(200);
  const type = req.query.type || req.query.topic || req.body?.type;
  const id = req.query['data.id'] || req.body?.data?.id || (req.query.topic === 'payment' ? req.query.id : null);
  if (type === 'payment' && id) handleNotification(id).catch(err => console.error('[mp]', err.message));
});

export { features };
