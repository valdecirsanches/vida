// Cliente mínimo da API do WAHA (WhatsApp HTTP API) — https://waha.devlike.pro
import { config, features } from './config.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function call(method, path, body, { raw = false } = {}) {
  if (!features.whatsapp) throw new Error('WAHA não configurado (WAHA_URL / WAHA_API_KEY)');
  const res = await fetch(config.waha.url + path, {
    method,
    headers: { 'X-Api-Key': config.waha.apiKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`WAHA ${method} ${path} -> ${res.status} ${t.slice(0, 300)}`);
  }
  if (raw) return res;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

const session = () => config.waha.session;

export const onlyDigits = (s = '') => String(s).replace(/\D/g, '');

/** Normaliza telefone brasileiro: adiciona 55 se vier só DDD+número. */
export function normalizePhone(phone) {
  let d = onlyDigits(phone);
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d;
}

/** Descobre o chatId correto (resolve o problema do 9º dígito). */
export async function resolveChatId(phone) {
  const d = normalizePhone(phone);
  try {
    const r = await call('GET', `/api/contacts/check-exists?phone=${d}&session=${session()}`);
    if (r && r.numberExists === false) throw new Error('Este número não tem WhatsApp');
    if (r?.chatId) return r.chatId;
  } catch (e) {
    if (/não tem WhatsApp/.test(e.message)) throw e;
    console.warn('[waha] check-exists falhou, usando número direto:', e.message);
  }
  return `${d}@c.us`;
}

/** Converte um id @lid em telefone @c.us (WhatsApp esconde números em alguns casos). */
export async function lidToPhone(lid) {
  try {
    const r = await call('GET', `/api/${session()}/lids/${encodeURIComponent(lid)}`);
    return r?.pn || null;
  } catch { return null; }
}

async function typing(chatId, ms) {
  try {
    await call('POST', '/api/startTyping', { session: session(), chatId });
    await sleep(ms);
    await call('POST', '/api/stopTyping', { session: session(), chatId });
  } catch { /* opcional */ }
}

export async function sendSeen(chatId) {
  try { await call('POST', '/api/sendSeen', { session: session(), chatId }); } catch { /* opcional */ }
}

export async function sendText(chatId, text) {
  // "digitando..." proporcional ao tamanho: mais humano e reduz risco de bloqueio
  await typing(chatId, Math.min(4000, 800 + text.length * 25));
  return call('POST', '/api/sendText', { session: session(), chatId, text, linkPreview: false });
}

/** Envia áudio de voz (PTT). Precisa ser OGG/Opus. */
export async function sendVoice(chatId, oggBuffer) {
  return call('POST', '/api/sendVoice', {
    session: session(),
    chatId,
    file: { mimetype: 'audio/ogg; codecs=opus', filename: 'pergunta.ogg', data: oggBuffer.toString('base64') },
    convert: false,
  });
}

/** Baixa mídia recebida. Reescreve o host para WAHA_URL (o WAHA às vezes devolve localhost). */
export async function downloadMedia(mediaUrl) {
  const u = new URL(mediaUrl, config.waha.url);
  const res = await call('GET', u.pathname + u.search, null, { raw: true });
  return Buffer.from(await res.arrayBuffer());
}

export async function rejectCall(from, id) {
  return call('POST', `/api/${session()}/calls/reject`, { from, id });
}

export async function getSession() {
  return call('GET', `/api/sessions/${session()}`);
}

export async function updateSession(body) {
  return call('PUT', `/api/sessions/${session()}`, body);
}
