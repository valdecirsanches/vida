// Registra o webhook do Raízes na sessão do WAHA, preservando webhooks que já existem.
// Uso: npm run setup:waha
import { config, features } from '../config.js';
import { getSession, updateSession } from '../waha.js';

if (!features.whatsapp) { console.error('Configure WAHA_URL e WAHA_API_KEY no .env'); process.exit(1); }
if (config.publicUrl.includes('localhost')) console.warn('⚠️  PUBLIC_URL é localhost: o WAHA não vai conseguir chamar o webhook. Use a URL pública do servidor.');

const url = `${config.publicUrl}/webhooks/waha/${config.waha.webhookSecret}`;
const s = await getSession();
console.log(`Sessão "${s.name}" — status: ${s.status}${s.me ? ` — número: ${s.me.id}` : ''}`);

const current = s.config?.webhooks || [];
const others = current.filter(w => !w.url.includes('/webhooks/waha/'));
const webhooks = [...others, {
  url,
  events: ['message', 'call.received'],
  retries: { policy: 'exponential', delaySeconds: 2, attempts: 5 },
}];

await updateSession({ name: s.name, config: { ...(s.config || {}), webhooks } });
console.log(`✅ Webhook configurado: ${url.replace(config.waha.webhookSecret, '***')}`);
if (others.length) console.log(`   (${others.length} webhook(s) existente(s) mantido(s))`);
if (s.status !== 'WORKING') console.warn('⚠️  A sessão não está WORKING. Escaneie o QR code no painel do WAHA.');
