// Motor de conversa: convites, perguntas semanais, aprofundamento e criação das histórias.
import fs from 'node:fs';
import path from 'node:path';
import { db, q, token, now, fmt, isDuplicate } from './db.js';
import { config, features, audioDir } from './config.js';
import * as waha from './waha.js';
import * as ai from './ai.js';
import { CHAPTERS, chapterName, fill, nextQuestion } from './questions.js';

const locks = new Set();
const timers = new Map();

// ---------- utilidades ----------

export function saveAudio(elderId, buffer, ext) {
  const dir = path.join(audioDir, String(elderId));
  fs.mkdirSync(dir, { recursive: true });
  const name = `${Date.now()}-${token(4)}.${ext}`;
  fs.writeFileSync(path.join(dir, name), buffer);
  return `${elderId}/${name}`;
}

export const extFromMime = (m = '') => m.includes('webm') ? 'webm' : (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) ? 'm4a'
  : (m.includes('mpeg') || m.includes('mp3')) ? 'mp3' : m.includes('wav') ? 'wav' : 'ogg';

async function logMessage({ conv, elder, direction, kind, text, audioPath, externalId, processed = 0 }) {
  try {
    const r = await db.run(`INSERT INTO messages (conversation_id, elder_id, direction, kind, text, audio_path, external_id, processed)
      VALUES (?,?,?,?,?,?,?,?)`, [conv?.id ?? null, elder.id, direction, kind, text ?? null, audioPath ?? null, externalId ?? null, processed]);
    return r.lastInsertRowid;
  } catch (e) {
    if (isDuplicate(e)) return null; // mesma mensagem do WhatsApp entregue duas vezes
    throw e;
  }
}

export const messageExists = async (externalId) => Boolean(externalId && await db.get('SELECT 1 x FROM messages WHERE external_id = ?', [externalId]));

async function planActive(userId) {
  const u = await q.user(userId);
  if (u?.plan === 'active' && (!u.plan_until || u.plan_until > now())) return true;
  const used = (await db.get(`SELECT COUNT(*) n FROM conversations c JOIN elders e ON e.id = c.elder_id
    WHERE e.user_id = ? AND (c.question_key IS NULL OR c.question_key <> 'espontanea') AND c.question <> '(pulada pela IA)'`, [userId])).n;
  return used < config.conversation.trialConversations;
}

async function ensureChatId(elder) {
  if (elder.chat_id) return elder.chat_id;
  const chatId = await waha.resolveChatId(elder.phone);
  (await db.run('UPDATE elders SET chat_id = ? WHERE id = ?', [chatId, elder.id]));
  elder.chat_id = chatId;
  return chatId;
}

/** Fala com o idoso: grava a mensagem e, se for WhatsApp, envia (áudio + texto). */
export async function say(elder, conv, text, { voice = true } = {}) {
  let audioPath = null;
  if (voice && elder.voice && features.tts) {
    try {
      const ogg = await ai.tts(text, { voiceId: elder.voice_id });
      if (ogg) audioPath = saveAudio(elder.id, ogg, 'ogg');
    } catch (e) { console.warn('[say] TTS falhou:', e.message); }
  }
  await logMessage({ conv, elder, direction: 'out', kind: audioPath ? 'audio' : 'text', text, audioPath, processed: 1 });
  if (conv) (await db.run('UPDATE conversations SET last_out_at = ? WHERE id = ?', [now(), conv.id]));

  if (elder.channel === 'whatsapp' && features.whatsapp) {
    const chatId = await ensureChatId(elder);
    if (audioPath) {
      try { await waha.sendVoice(chatId, fs.readFileSync(path.join(audioDir, audioPath))); }
      catch (e) { console.warn('[say] sendVoice falhou, seguindo com texto:', e.message); }
    }
    await waha.sendText(chatId, text);
  }
  return audioPath;
}

// ---------- convite e consentimento ----------

export async function invite(elder) {
  const who = elder.requester_name ? `${elder.requester_name} pediu` : 'Sua família pediu';
  const text = `Olá, ${elder.call_name}! 💛 Aqui é do *Raízes*. ${who} para a gente guardar as histórias da sua vida, ` +
    `na sua própria voz, para a família ter para sempre.\n\n` +
    `Funciona assim: uma vez por semana eu mando uma pergunta, e ${elder.pronoun} responde com um áudio, do jeitinho que lembrar. Sem pressa e sem certo ou errado.\n\n` +
    `Posso começar? Responda *SIM* para aceitar.\n(Se um dia quiser parar, é só mandar *PARAR*.)`;
  (await db.run("UPDATE elders SET status = 'pending_consent' WHERE id = ?", [elder.id]));
  elder.status = 'pending_consent';
  await say(elder, null, text, { voice: false });
}

// ---------- início de conversa semanal ----------

export async function startConversation(elder, { force = false } = {}) {
  if (!['active'].includes(elder.status)) return { ok: false, reason: 'O idoso ainda não aceitou o convite.' };
  if (await q.openConversation(elder.id)) return { ok: false, reason: 'Já existe uma conversa em andamento.' };
  if (!(await planActive(elder.user_id))) return { ok: false, reason: 'O período de teste acabou. Ative o plano para continuar.', needsPlan: true };

  const asked = (await db.all('SELECT question_key FROM conversations WHERE elder_id = ?', [elder.id])).map(r => r.question_key);
  let picked, text;
  for (let tries = 0; tries < 6; tries++) {
    picked = nextQuestion(asked);
    if (!picked) break;
    const base = fill(picked.text, elder.pronoun);
    text = await ai.personalizeQuestion(elder, base, chapterName(picked.chapter));
    if (text.trim().toUpperCase() !== 'SKIP') break;
    asked.push(picked.key); // pula e marca
    (await db.run(`INSERT INTO conversations (elder_id, chapter, question, question_key, status, closed_at)
      VALUES (?,?,?,?, 'closed', ?)`, [elder.id, picked.chapter, '(pulada pela IA)', picked.key, now()]));
    picked = null;
  }
  if (!picked) {
    const titles = (await db.all('SELECT title FROM stories WHERE elder_id = ?', [elder.id])).map(r => r.title);
    picked = { key: `ia:${Date.now()}`, chapter: 'soltas' };
    text = await ai.inventQuestion(elder, titles);
  }

  const info = (await db.run(`INSERT INTO conversations (elder_id, chapter, question, question_key, last_question)
    VALUES (?,?,?,?,?)`, [elder.id, picked.chapter, text, picked.key, text]));
  const conv = await q.conversation(info.lastInsertRowid);

  const greetings = ['Bom dia', 'Olá', 'Oi'];
  const g = greetings[conv.id % greetings.length];
  const intro = conv.id % 2 ? 'Hoje eu queria ouvir uma história sua.' : 'Tenho uma pergunta especial para hoje.';
  const msg = `${g}, ${elder.call_name}! ${intro}\n\n${text}\n\nPode me responder com um áudio, com calma. 🎤`;
  const audio = await say(elder, conv, msg);
  (await db.run('UPDATE conversations SET last_question_audio = ? WHERE id = ?', [audio, conv.id]));
  return { ok: true, conversation: await q.conversation(conv.id) };
}

// ---------- recebendo respostas ----------

/**
 * Recebe algo do idoso (por WhatsApp ou pela página de gravação).
 * @param {{text?: string, audio?: Buffer, mimetype?: string, externalId?: string}} input
 */
export async function receive(elder, input) {
  let text = input.text?.trim() || null;
  const intent = !input.audio && text ? ai.parseIntent(text) : null;

  // comandos e consentimento
  if (intent === 'stop') {
    (await db.run("UPDATE elders SET status = 'stopped' WHERE id = ?", [elder.id]));
    (await db.run("UPDATE conversations SET status = 'closed', closed_at = ? WHERE elder_id = ? AND status = 'open'", [now(), elder.id]));
    elder.status = 'stopped';
    await say(elder, null, `Tudo bem, ${elder.call_name}. Não vou mandar mais perguntas. Obrigada por tudo que compartilhou! Se quiser voltar, é só mandar *VOLTAR*. 💛`, { voice: false });
    return { handled: 'stop' };
  }
  if (intent === 'pause' && elder.status === 'active') {
    (await db.run("UPDATE elders SET status = 'paused' WHERE id = ?", [elder.id]));
    await say(elder, null, `Combinado! Vou dar uma pausa. Quando quiser continuar, mande *VOLTAR*. 💛`, { voice: false });
    return { handled: 'pause' };
  }
  if (intent === 'resume' && ['paused', 'stopped'].includes(elder.status)) {
    (await db.run("UPDATE elders SET status = 'active' WHERE id = ?", [elder.id]));
    elder.status = 'active';
    await say(elder, null, `Que alegria ter ${elder.pronoun} de volta, ${elder.call_name}! 💛`, { voice: false });
    await startConversation(elder);
    return { handled: 'resume' };
  }
  if (elder.status === 'pending_consent') {
    if (intent === 'yes' || input.audio) {
      (await db.run("UPDATE elders SET status = 'active', consent_at = ? WHERE id = ?", [now(), elder.id]));
      elder.status = 'active';
      await say(elder, null, `Que maravilha, ${elder.call_name}! Vamos começar. 🥰`, { voice: false });
      await startConversation(elder, { force: true });
      return { handled: 'consent' };
    }
    if (intent === 'no') {
      (await db.run("UPDATE elders SET status = 'stopped' WHERE id = ?", [elder.id]));
      await say(elder, null, `Tudo bem, sem problema nenhum! Se mudar de ideia, mande *VOLTAR*. 💛`, { voice: false });
      return { handled: 'refused' };
    }
    await say(elder, null, `Para começarmos, é só responder *SIM*. 😊`, { voice: false });
    return { handled: 'consent_reminder' };
  }
  if (elder.status !== 'active') return { handled: 'ignored' };

  // conversa aberta (ou história espontânea)
  let conv = await q.openConversation(elder.id);
  if (!conv) {
    const info = (await db.run(`INSERT INTO conversations (elder_id, chapter, question, question_key, last_question)
      VALUES (?, 'soltas', 'História contada espontaneamente', 'espontanea', 'História contada espontaneamente')`, [elder.id]));
    conv = await q.conversation(info.lastInsertRowid);
  }

  let audioPath = null;
  if (input.audio) {
    audioPath = saveAudio(elder.id, input.audio, extFromMime(input.mimetype));
    try { text = await ai.transcribe(input.audio, input.mimetype || 'audio/ogg'); }
    catch (e) { console.warn('[receive] transcrição falhou:', e.message); }
    if (!text) text = '[áudio sem transcrição]';
  }
  const id = await logMessage({ conv, elder, direction: 'in', kind: audioPath ? 'audio' : 'text', text, audioPath, externalId: input.externalId });
  if (!id) return { handled: 'duplicate' };
  (await db.run('UPDATE conversations SET last_in_at = ? WHERE id = ?', [now(), conv.id]));

  if (elder.channel === 'whatsapp' && elder.chat_id && features.whatsapp) waha.sendSeen(elder.chat_id);
  schedule(conv.id, input.immediate ? 0 : config.conversation.debounceSeconds * 1000);
  return { handled: 'answer', conversationId: conv.id };
}

function schedule(convId, ms) {
  clearTimeout(timers.get(convId));
  timers.set(convId, setTimeout(() => { timers.delete(convId); processConversation(convId).catch(e => console.error('[process]', e)); }, ms));
}

/** Processa respostas pendentes: aprofunda ou encerra e escreve a história. */
export async function processConversation(convId) {
  if (locks.has(convId)) return schedule(convId, 5000);
  locks.add(convId);
  try {
    const conv = await q.conversation(convId);
    if (!conv || conv.status !== 'open') return;
    const pending = (await db.all("SELECT id FROM messages WHERE conversation_id = ? AND direction = 'in' AND processed = 0", [convId]));
    if (!pending.length) return;
    (await db.run(`UPDATE messages SET processed = 1 WHERE id IN (${pending.map(() => '?').join(',')})`, [...pending.map(p => p.id)]));

    const elder = await q.elder(conv.elder_id);
    const turn = conv.turns + 1;
    (await db.run('UPDATE conversations SET turns = ? WHERE id = ?', [turn, convId]));

    const answers = (await db.all("SELECT text FROM messages WHERE conversation_id = ? AND direction = 'in' ORDER BY id", [convId]))
      .map(m => m.text).join('\n');

    let done = turn > config.conversation.followUps;
    let reply = null;
    if (!done) {
      const r = await ai.followUp(elder, conv, answers, turn);
      done = r.done; reply = r.reply;
    }
    if (!done && reply) {
      (await db.run('UPDATE conversations SET last_question = ?, reminded_at = NULL WHERE id = ?', [reply, convId]));
      const audio = await say(elder, await q.conversation(convId), reply);
      (await db.run('UPDATE conversations SET last_question_audio = ? WHERE id = ?', [audio, convId]));
    } else {
      await closeConversation(convId, { thank: true, thankText: reply });
    }
  } finally { locks.delete(convId); }
}

export async function closeConversation(convId, { thank = false, thankText = null } = {}) {
  const conv = await q.conversation(convId);
  if (!conv || conv.status !== 'open') return null;
  (await db.run("UPDATE conversations SET status = 'closed', closed_at = ? WHERE id = ?", [now(), convId]));
  const elder = await q.elder(conv.elder_id);

  // monta pares pergunta/resposta na ordem
  const msgs = (await db.all('SELECT direction, text FROM messages WHERE conversation_id = ? ORDER BY id', [convId]));
  const qa = []; let lastQ = conv.question;
  for (const m of msgs) {
    if (m.direction === 'out') lastQ = m.text;
    else if (m.text && m.text !== '[áudio sem transcrição]') {
      const prev = qa[qa.length - 1];
      if (prev && prev.q === lastQ) prev.a += '\n' + m.text; else qa.push({ q: lastQ, a: m.text });
    }
  }
  const hasAnswers = msgs.some(m => m.direction === 'in');
  if (!hasAnswers) return null;

  if (thank) {
    const t = thankText || `Muito obrigada por dividir essa história, ${elder.call_name}! Ficou guardada com todo carinho. 💛 Semana que vem tem mais.`;
    await say(elder, conv, t, { voice: true }).catch(e => console.warn('[close] agradecimento falhou:', e.message));
  }

  const qaForStory = qa.length ? qa : [{ q: conv.question, a: '(A história está nos áudios. Transcrição indisponível.)' }];
  const { title, body } = await ai.writeStory(elder, conv, qaForStory);
  const transcript = qaForStory.map(x => `— ${x.q}\n${x.a}`).join('\n\n');
  const info = (await db.run(`INSERT INTO stories (elder_id, conversation_id, chapter, title, body, transcript, public_token)
    VALUES (?,?,?,?,?,?,?)`, [elder.id, convId, conv.chapter, title, body, transcript, token(12)]));
  const story = (await db.get('SELECT * FROM stories WHERE id = ?', [info.lastInsertRowid]));
  notifyFamily(elder, story).catch(e => console.warn('[notify]', e.message));
  return story;
}

async function notifyFamily(elder, story) {
  const user = await q.user(elder.user_id);
  if (!user?.phone || !features.whatsapp) return;
  const chatId = await waha.resolveChatId(user.phone);
  await waha.sendText(chatId, `🌳 *Nova história no Raízes!*\n\n${elder.call_name} contou: *"${story.title}"*\n\n` +
    `Ouça na voz ${elder.pronoun === 'o senhor' ? 'dele' : elder.pronoun === 'a senhora' ? 'dela' : 'original'}: ${config.publicUrl}/ouvir/${story.public_token}`);
}

// ---------- tarefas periódicas ----------

function localParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' });
  const parts = Object.fromEntries(f.formatToParts(d).map(p => [p.type, p.value]));
  return { weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday), hour: Number(parts.hour) };
}

const hoursAgo = (h) => fmt(new Date(Date.now() - h * 3600e3));

export async function tick() {
  const { weekday, hour } = localParts();

  // 1) perguntas semanais
  const due = (await db.all(`SELECT e.* FROM elders e WHERE e.status = 'active' AND e.weekday = ? AND e.hour = ?
    AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.elder_id = e.id AND c.status = 'open')
    AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.elder_id = e.id AND c.started_at > ? AND (c.question_key IS NULL OR c.question_key <> 'espontanea'))`, [weekday, hour, hoursAgo(24 * 6)]));
  for (const e of due) {
    try { const r = await startConversation(e); if (!r.ok) console.log(`[tick] ${e.call_name}: ${r.reason}`); }
    catch (err) { console.error('[tick] start', e.id, err.message); }
  }

  // 2) lembrete gentil se não respondeu
  const silent = (await db.all(`SELECT c.* FROM conversations c WHERE c.status = 'open' AND c.reminded_at IS NULL
    AND c.last_out_at < ? AND (c.last_in_at IS NULL OR c.last_in_at < c.last_out_at)`, [hoursAgo(config.conversation.reminderHours)]));
  for (const c of silent) {
    const e = await q.elder(c.elder_id);
    if (e.status !== 'active') continue;
    (await db.run('UPDATE conversations SET reminded_at = ? WHERE id = ?', [now(), c.id]));
    try {
      await say(e, c, `Oi, ${e.call_name}! Passando só para lembrar da nossa pergunta, sem pressa nenhuma: \n\n${c.last_question}\n\nQuando puder, me manda um áudio. 💛`, { voice: false });
    } catch (err) { console.error('[tick] lembrete', err.message); }
  }

  // 3) fecha conversas paradas (gera a história com o que tiver)
  const stale = (await db.all(`SELECT id FROM conversations WHERE status = 'open'
    AND COALESCE(last_in_at, last_out_at, started_at) < ?`, [hoursAgo(config.conversation.closeHours)]));
  for (const c of stale) await closeConversation(c.id).catch(err => console.error('[tick] close', err.message));

  // 4) respostas não processadas (ex.: servidor reiniciou durante a espera)
  const orphan = (await db.all(`SELECT DISTINCT m.conversation_id id FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE m.direction = 'in' AND m.processed = 0 AND c.status = 'open' AND m.created_at < ?`, [fmt(new Date(Date.now() - (config.conversation.debounceSeconds + 30) * 1000))]));
  for (const c of orphan) if (!timers.has(c.id)) schedule(c.id, 0);
}

export function startScheduler() {
  const run = () => tick().catch(e => console.error('[tick]', e));
  setTimeout(run, 5000);
  return setInterval(run, 5 * 60 * 1000);
}

export { CHAPTERS };
