// IA: Claude (texto) + OpenAI (transcrição e voz). Tudo tem plano B sem chave.
import { config, features } from './config.js';

const SYSTEM = `Você é a entrevistadora do Raízes, um serviço que guarda as histórias de vida de pessoas idosas para as famílias delas.
Você conversa em português do Brasil, com carinho, respeito e paciência, como uma neta curiosa e educada.
Frases curtas e simples. Nada de gírias de internet, emojis em excesso ou linguagem técnica.
Nunca pressione assuntos dolorosos (luto, doença, separação): se a pessoa demonstrar tristeza, acolha e mude para algo leve.
Nunca invente fatos sobre a pessoa.`;

async function claude(prompt, { maxTokens = 800, system = SYSTEM } = {}) {
  const res = await fetch(`${config.ai.anthropicBase}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': config.ai.anthropicKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.ai.anthropicModel,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return j.content?.map(c => c.text || '').join('').trim();
}

function parseJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Resposta da IA sem JSON');
  return JSON.parse(m[0]);
}

const describe = (e) => [
  `Nome: ${e.name} (chamar de "${e.call_name}", tratar por "${e.pronoun}")`,
  e.relation && `Parentesco com quem contratou: ${e.relation}`,
  e.birth_year && `Nascimento: ${e.birth_year}`,
  e.city && `Cidade: ${e.city}`,
  e.notes && `Observações da família: ${e.notes}`,
].filter(Boolean).join('\n');

/** Adapta a pergunta do banco à pessoa (ou pula se for sensível). */
export async function personalizeQuestion(elder, question, chapter) {
  if (!features.claude) return question;
  try {
    const out = await claude(`Pessoa entrevistada:\n${describe(elder)}\n\nPróxima pergunta planejada (capítulo "${chapter}"):\n"${question}"\n\n` +
      `Reescreva a pergunta de forma calorosa e natural para essa pessoa, em no máximo 2 frases curtas, tratando-a por "${elder.pronoun}". ` +
      `Se as observações da família indicarem que o tema é delicado ou não se aplica (ex.: pessoa viúva recente, não teve filhos), responda apenas SKIP.\n` +
      `Responda só com a pergunta (ou SKIP), sem aspas.`, { maxTokens: 200 });
    return out || question;
  } catch (e) { console.warn('[ai] personalize:', e.message); return question; }
}

/** Cria uma pergunta nova quando o banco acabar. */
export async function inventQuestion(elder, pastTitles) {
  if (!features.claude) return 'Me conta uma história da sua vida que eu ainda não ouvi?';
  try {
    return await claude(`Pessoa:\n${describe(elder)}\n\nHistórias já contadas:\n- ${pastTitles.join('\n- ')}\n\n` +
      `Crie UMA pergunta nova, curta e afetuosa, sobre um tema da vida dela ainda não explorado. Responda só a pergunta.`, { maxTokens: 150 });
  } catch { return 'Me conta uma história da sua vida que eu ainda não ouvi?'; }
}

const GENERIC_FOLLOWUPS = [
  'Que bonito! E como {p} se sentia naquela época?',
  'Nossa, que lembrança! Tem mais algum detalhe dessa história que {p} gostaria de contar?',
  'E quem mais estava com {p} nesse momento?',
];

/**
 * Decide a próxima fala depois de uma resposta.
 * @returns {{ reply: string, done: boolean }}
 */
export async function followUp(elder, conv, answers, turn) {
  const p = elder.pronoun;
  if (!features.claude) {
    const t = GENERIC_FOLLOWUPS[turn % GENERIC_FOLLOWUPS.length];
    return { reply: t.replaceAll('{p}', p), done: false };
  }
  const prompt = `Pessoa:\n${describe(elder)}\n\nPergunta inicial: "${conv.question}"\n\nO que a pessoa já respondeu nesta conversa (transcrição de áudio, pode ter erros):\n"""${answers}"""\n\n` +
    `Escreva a próxima fala: um comentário curto e genuíno sobre algo ESPECÍFICO que ela contou (1 frase) + UMA pergunta de aprofundamento ` +
    `que puxe detalhes concretos (nomes, lugares, cheiros, sentimentos, o que aconteceu depois). Trate por "${p}".\n` +
    `Se a pessoa disse que não quer falar disso, ou a história já está completa, marque done=true e escreva só um agradecimento carinhoso.\n` +
    `Responda em JSON: {"reply": "...", "done": false}`;
  try {
    const j = parseJson(await claude(prompt, { maxTokens: 300 }));
    return { reply: String(j.reply || '').trim(), done: Boolean(j.done) };
  } catch (e) {
    console.warn('[ai] followUp:', e.message);
    return { reply: GENERIC_FOLLOWUPS[turn % GENERIC_FOLLOWUPS.length].replaceAll('{p}', p), done: false };
  }
}

/** Transforma a conversa numa história escrita, fiel às palavras da pessoa. */
export async function writeStory(elder, conv, qa) {
  const fallback = { title: conv.question.replace(/\?.*$/, '').slice(0, 80), body: qa.map(x => x.a).join('\n\n') };
  if (!features.claude) return fallback;
  const transcript = qa.map(x => `PERGUNTA: ${x.q}\nRESPOSTA: ${x.a}`).join('\n\n');
  try {
    const j = parseJson(await claude(
      `Pessoa:\n${describe(elder)}\n\nTranscrição de uma conversa por áudio:\n"""${transcript}"""\n\n` +
      `Escreva esta história como um capítulo de livro de memórias, em PRIMEIRA PESSOA, na voz de ${elder.call_name}.\n` +
      `Regras: preserve as expressões, o jeito de falar e todos os fatos; corrija só erros óbvios de transcrição; ` +
      `não invente nada que não foi dito; remova as perguntas; parágrafos curtos; de 120 a 600 palavras conforme o material.\n` +
      `Crie também um título evocativo e curto (máx. 8 palavras).\n` +
      `Responda em JSON: {"title": "...", "body": "..."}`,
      { maxTokens: 2000, system: 'Você é uma editora de livros de memórias. Escreve em português do Brasil com sensibilidade e fidelidade absoluta ao relato.' }));
    return { title: String(j.title || fallback.title), body: String(j.body || fallback.body) };
  } catch (e) { console.warn('[ai] writeStory:', e.message); return fallback; }
}

/** Interpreta respostas curtas de consentimento. */
export function parseIntent(text = '') {
  const t = text.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/^(parar|pare|sair|cancelar|nao quero mais|stop)\b/.test(t)) return 'stop';
  if (/^(pausar|pausa)\b/.test(t)) return 'pause';
  if (/^(voltar|continuar|retomar)\b/.test(t)) return 'resume';
  if (/^(sim|pode|claro|aceito|quero|ok|tudo bem|vamos|bora|s)\b/.test(t)) return 'yes';
  if (/^(nao|n)\b/.test(t)) return 'no';
  return null;
}

// ---------- Transcrição e voz: ElevenLabs (preferida) ou OpenAI ----------
import { spawn } from 'node:child_process';
import { getSetting } from './db.js';

let voicesCache = { at: 0, list: [] };
/** Lista as vozes da conta ElevenLabs (cache de 10 min). */
export async function listVoices({ fresh = false } = {}) {
  if (!config.ai.elevenKey) return [];
  if (!fresh && Date.now() - voicesCache.at < 600_000 && voicesCache.list.length) return voicesCache.list;
  const all = [];
  let next = null;
  for (let i = 0; i < 10; i++) {
    const qs = new URLSearchParams({ page_size: '100', ...(next ? { next_page_token: next } : {}) });
    const res = await fetch(`${config.ai.elevenBase}/v2/voices?${qs}`, { headers: { 'xi-api-key': config.ai.elevenKey } });
    if (!res.ok) throw new Error(`ElevenLabs vozes ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    all.push(...(j.voices || []));
    if (!j.has_more || !j.next_page_token) break;
    next = j.next_page_token;
  }
  voicesCache = {
    at: Date.now(),
    list: all.map(v => ({
      voice_id: v.voice_id, name: v.name, category: v.category, description: v.description || '',
      labels: v.labels || {}, preview_url: v.preview_url || null,
      portuguese: (v.verified_languages || []).some(l => String(l.language || '').startsWith('pt')),
    })),
  };
  return voicesCache.list;
}

/** Voz a usar: a da pessoa > padrão escolhido no painel > .env > primeira da conta. */
export async function resolveVoice(voiceId) {
  if (voiceId) return voiceId;
  const chosen = await getSetting('eleven_voice_id');
  if (chosen) return chosen;
  if (config.ai.elevenVoiceId) return config.ai.elevenVoiceId;
  const list = await listVoices();
  return list.find(v => v.portuguese)?.voice_id || list[0]?.voice_id || null;
}

const extOf = (m) => m.includes('webm') ? 'webm' : (m.includes('mp4') || m.includes('m4a')) ? 'm4a'
  : (m.includes('mpeg') || m.includes('mp3')) ? 'mp3' : m.includes('wav') ? 'wav' : 'ogg';

export async function transcribe(buffer, mimetype = 'audio/ogg') {
  const provider = config.ai.sttProvider;
  if (!provider) return null;
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimetype.split(';')[0] }), `audio.${extOf(mimetype)}`);
  let url, headers;
  if (provider === 'elevenlabs') {
    form.append('model_id', config.ai.elevenSttModel);
    form.append('language_code', 'por');
    form.append('tag_audio_events', 'false');
    url = `${config.ai.elevenBase}/v1/speech-to-text`;
    headers = { 'xi-api-key': config.ai.elevenKey };
  } else {
    form.append('model', config.ai.transcribeModel);
    form.append('language', 'pt');
    form.append('prompt', 'Relato de memórias de uma pessoa idosa brasileira, com nomes de pessoas, cidades e expressões regionais.');
    url = `${config.ai.openaiBase}/v1/audio/transcriptions`;
    headers = { Authorization: `Bearer ${config.ai.openaiKey}` };
  }
  const res = await fetch(url, { method: 'POST', headers, body: form });
  if (!res.ok) throw new Error(`Transcrição (${provider}) ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).text?.trim() || '';
}

const isOgg = (b) => b.length > 4 && b.subarray(0, 4).toString('latin1') === 'OggS';

/** Converte qualquer áudio para OGG/Opus com ffmpeg (se o provedor não entregar em OGG). */
function toOggOpus(buffer) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-c:a', 'libopus', '-b:a', '48k', '-f', 'ogg', 'pipe:1']);
    const out = [];
    ff.stdout.on('data', (d) => out.push(d));
    ff.on('error', reject);
    ff.on('close', (code) => code === 0 ? resolve(Buffer.concat(out)) : reject(new Error('ffmpeg falhou')));
    ff.stdin.on('error', () => {});
    ff.stdin.end(buffer);
  });
}

/** Gera áudio OGG/Opus (formato de mensagem de voz do WhatsApp). */
export async function tts(text, { voiceId = null } = {}) {
  const provider = config.ai.ttsProvider;
  if (!provider) return null;
  let res;
  if (provider === 'elevenlabs') {
    const voice = await resolveVoice(voiceId);
    if (!voice) throw new Error('Nenhuma voz disponível na conta ElevenLabs');
    res = await fetch(`${config.ai.elevenBase}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=opus_48000_64`, {
      method: 'POST',
      headers: { 'xi-api-key': config.ai.elevenKey, 'Content-Type': 'application/json', Accept: 'audio/ogg' },
      body: JSON.stringify({
        text,
        model_id: config.ai.elevenTtsModel,
        language_code: 'pt',
        voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true, speed: 0.92 },
      }),
    });
  } else {
    res = await fetch(`${config.ai.openaiBase}/v1/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.ai.openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ai.ttsModel, voice: config.ai.ttsVoice, input: text, response_format: 'opus',
        instructions: 'Português do Brasil. Voz calorosa, calma e sorridente, falando devagar e com clareza, como uma neta conversando com carinho com a avó.',
      }),
    });
  }
  if (!res.ok) throw new Error(`Voz (${provider}) ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (isOgg(buf)) return buf;
  try { return await toOggOpus(buf); }
  catch (e) { throw new Error(`Áudio não veio em OGG e a conversão falhou (instale ffmpeg): ${e.message}`); }
}
