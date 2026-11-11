import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

// Carrega .env (Node >= 20.6) sem dependências externas
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* sem .env, usa variáveis do ambiente */ }

const env = (k, d = '') => (process.env[k] ?? d).toString().trim();
const num = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && process.env[k] !== '' ? v : d; };

export const config = {
  port: num('PORT', 5187),                 // backend: API, webhooks, livro
  frontendPort: num('FRONTEND_PORT', 5188), // site e painel (0 = tudo na porta do backend)
  backendHost: env('BACKEND_HOST', '127.0.0.1'),
  publicUrl: env('PUBLIC_URL', 'http://localhost:3000').replace(/\/$/, ''),
  dataDir: path.resolve(ROOT, env('DATA_DIR', './data')),
  timezone: env('TZ', 'America/Sao_Paulo'),
  sessionSecret: env('SESSION_SECRET', 'troque-este-segredo'),
  adminEmails: env('ADMIN_EMAILS').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),

  db: {
    host: env('DB_HOST'),               // vazio = SQLite local em DATA_DIR
    port: num('DB_PORT', 3306),
    user: env('DB_USER'),
    password: env('DB_PASSWORD'),
    name: env('DB_NAME', 'raizes'),
    createDatabase: env('DB_CREATE_DATABASE', 'true') !== 'false',
  },

  waha: {
    url: env('WAHA_URL').replace(/\/$/, ''),
    apiKey: env('WAHA_API_KEY'),
    session: env('WAHA_SESSION', 'default'),
    webhookSecret: env('WAHA_WEBHOOK_SECRET', 'troque-este-segredo-do-webhook'),
    callRejectMessage: env('WAHA_CALL_REJECT_MESSAGE',
      'Oi! Por aqui eu não consigo atender ligação 📞, mas adoro ouvir áudio! 🎤 Aperte e segure o microfone e me conte. 💛'),
  },

  ai: {
    anthropicKey: env('ANTHROPIC_API_KEY'),
    anthropicBase: env('ANTHROPIC_BASE_URL', 'https://api.anthropic.com').replace(/\/$/, ''),
    anthropicModel: env('ANTHROPIC_MODEL', 'claude-sonnet-5-5'),
    openaiKey: env('OPENAI_API_KEY'),
    openaiBase: env('OPENAI_BASE_URL', 'https://api.openai.com').replace(/\/$/, ''),
    transcribeModel: env('OPENAI_TRANSCRIBE_MODEL', 'gpt-4o-transcribe'),
    ttsModel: env('OPENAI_TTS_MODEL', 'gpt-4o-mini-tts'),
    ttsVoice: env('OPENAI_TTS_VOICE', 'coral'),
    elevenKey: env('ELEVENLABS_API_KEY'),
    elevenBase: env('ELEVENLABS_BASE_URL', 'https://api.elevenlabs.io').replace(/\/$/, ''),
    elevenVoiceId: env('ELEVENLABS_VOICE_ID'),
    elevenTtsModel: env('ELEVENLABS_TTS_MODEL', 'eleven_multilingual_v2'),
    elevenSttModel: env('ELEVENLABS_STT_MODEL', 'scribe_v2'),
    // Provedor escolhido: ElevenLabs se houver chave, senão OpenAI
    get sttProvider() { return this.elevenKey ? 'elevenlabs' : this.openaiKey ? 'openai' : null; },
    get ttsProvider() { return this.elevenKey ? 'elevenlabs' : this.openaiKey ? 'openai' : null; },
  },

  conversation: {
    followUps: num('FOLLOW_UPS', 2),            // perguntas de aprofundamento por conversa
    debounceSeconds: num('DEBOUNCE_SECONDS', 40), // espera o idoso terminar de mandar vários áudios
    reminderHours: num('REMINDER_HOURS', 48),
    closeHours: num('CLOSE_HOURS', 96),
    trialConversations: num('TRIAL_CONVERSATIONS', 2),
  },

  payments: {
    mpAccessToken: env('MP_ACCESS_TOKEN'),
    planPrice: num('PLAN_PRICE', 299),
    bookPrice: num('BOOK_PRICE', 199),
  },
};

export const audioDir = path.join(config.dataDir, 'audio');
fs.mkdirSync(audioDir, { recursive: true });

export const features = {
  get whatsapp() { return Boolean(config.waha.url && config.waha.apiKey); },
  get claude() { return Boolean(config.ai.anthropicKey); },
  get transcription() { return Boolean(config.ai.sttProvider); },
  get tts() { return Boolean(config.ai.ttsProvider); },
  get payments() { return Boolean(config.payments.mpAccessToken); },
};
