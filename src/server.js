import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { config, features, ROOT } from './config.js';
import { db } from './db.js';
import { pub } from './routes/public.js';
import { api } from './routes/api.js';
import { book } from './routes/book.js';
import { startScheduler } from './conversation.js';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(cookieParser(config.sessionSecret));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

const PUB = path.join(ROOT, 'public');
const page = (file) => (req, res) => res.sendFile(path.join(PUB, file));

app.get('/health', (req, res) => res.json({ ok: true, features: Object.fromEntries(Object.keys(features).map(k => [k, features[k]])) }));
app.get('/', page('index.html'));
app.get('/app', page('app.html'));
app.get('/g/:token', page('gravar.html'));
app.get('/ouvir/:token', page('ouvir.html'));

app.use(pub);                       // webhooks e rotas públicas (antes do JSON parser global e do login)
app.use(express.json({ limit: '1mb' }));
app.use(book);
app.use('/api', api);
app.use(express.static(PUB, { extensions: ['html'], maxAge: '1h' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno.' });
});

app.listen(config.port, () => {
  console.log(`🌳 Raízes rodando em ${config.publicUrl} (porta ${config.port})`);
  console.log('   Recursos:', Object.keys(features).map(k => `${k}=${features[k] ? 'ok' : '—'}`).join('  '));
  console.log(`   Banco: ${db.kind === 'mysql' ? `MySQL ${config.db.host}/${config.db.name}` : 'SQLite (DATA_DIR)'}`);
  if (config.sessionSecret === 'troque-este-segredo' || config.waha.webhookSecret.startsWith('troque')) {
    console.warn('⚠️  Defina SESSION_SECRET e WAHA_WEBHOOK_SECRET no .env antes de publicar.');
  }
  startScheduler();
});
