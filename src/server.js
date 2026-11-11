import express from 'express';
import cookieParser from 'cookie-parser';
import http from 'node:http';
import path from 'node:path';
import { config, features, ROOT } from './config.js';
import { db } from './db.js';
import { pub } from './routes/public.js';
import { api } from './routes/api.js';
import { book } from './routes/book.js';
import { startScheduler } from './conversation.js';

const PUB = path.join(ROOT, 'public');
const page = (file) => (req, res) => res.sendFile(path.join(PUB, file));
const BACKEND_PATHS = ['/api', '/webhooks', '/livro', '/health'];

function base() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  return app;
}

// ===================== Backend (API, webhooks, livro) =====================
const backend = base();
backend.use(cookieParser(config.sessionSecret));
backend.get('/health', (req, res) => res.json({ ok: true, features: Object.fromEntries(Object.keys(features).map(k => [k, features[k]])) }));
backend.use(pub);                       // webhooks e rotas públicas (antes do JSON parser global e do login)
backend.use(express.json({ limit: '1mb' }));
backend.use(book);
backend.use('/api', api);

// ===================== Frontend (páginas e arquivos estáticos) =====================
function mountFrontend(app) {
  app.get('/', page('index.html'));
  app.get('/app', page('app.html'));
  app.get('/g/:token', page('gravar.html'));
  app.get('/ouvir/:token', page('ouvir.html'));
  app.use(express.static(PUB, { extensions: ['html'], maxAge: '1h' }));
}

/** Repassa /api, /webhooks, /livro e /health do frontend para o backend (mesma origem para o navegador). */
function proxyToBackend(req, res) {
  const up = http.request({
    host: config.backendHost, port: config.port, path: req.originalUrl, method: req.method,
    headers: { ...req.headers, 'x-forwarded-for': req.ip, 'x-forwarded-proto': req.protocol, 'x-forwarded-host': req.get('host') },
  }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', (e) => { console.error('[proxy]', e.message); if (!res.headersSent) res.status(502).json({ error: 'Servidor indisponível.' }); });
  req.pipe(up);
}

const onError = (err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Erro interno.' }); };

if (config.frontendPort && config.frontendPort !== config.port) {
  const frontend = base();
  frontend.use((req, res, next) => BACKEND_PATHS.some(p => req.path === p || req.path.startsWith(p + '/')) ? proxyToBackend(req, res) : next());
  mountFrontend(frontend);
  frontend.use(onError);
  frontend.listen(config.frontendPort, () => console.log(`   Frontend na porta ${config.frontendPort} (repassa /api para ${config.port})`));
} else {
  mountFrontend(backend); // modo porta única
}
backend.use(onError);

backend.listen(config.port, () => {
  console.log(`🌳 Raízes rodando em ${config.publicUrl} (backend na porta ${config.port})`);
  console.log('   Recursos:', Object.keys(features).map(k => `${k}=${features[k] ? 'ok' : '—'}`).join('  '));
  console.log(`   Transcrição: ${config.ai.sttProvider || '—'} · Voz: ${config.ai.ttsProvider || '—'}`);
  console.log(`   Banco: ${db.kind === 'mysql' ? `MySQL ${config.db.host}/${config.db.name}` : 'SQLite (DATA_DIR)'}`);
  if (config.sessionSecret === 'troque-este-segredo' || config.waha.webhookSecret.startsWith('troque')) {
    console.warn('⚠️  Defina SESSION_SECRET e WAHA_WEBHOOK_SECRET no .env antes de publicar.');
  }
  startScheduler();
});
