// Camada de banco: MySQL/MariaDB em produção (DB_HOST definido) ou SQLite local (padrão para desenvolvimento).
// API única e assíncrona: db.get / db.all / db.run  (placeholders "?")
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

export const token = (bytes = 18) => crypto.randomBytes(bytes).toString('base64url');
/** Data/hora UTC no formato 'YYYY-MM-DD HH:MM:SS' (funciona igual em MySQL e SQLite). */
export const fmt = (d) => d.toISOString().replace('T', ' ').slice(0, 19);
export const now = () => fmt(new Date());

// ---------- esquemas ----------

const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT, password_hash TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'trial', plan_until TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS elders (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, call_name TEXT NOT NULL, pronoun TEXT NOT NULL DEFAULT 'a senhora', relation TEXT, requester_name TEXT,
  phone TEXT, chat_id TEXT, lid TEXT, birth_year INTEGER, city TEXT, notes TEXT, channel TEXT NOT NULL DEFAULT 'whatsapp',
  voice INTEGER NOT NULL DEFAULT 1, weekday INTEGER NOT NULL DEFAULT 0, hour INTEGER NOT NULL DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'new', consent_at TEXT, token TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS conversations (id INTEGER PRIMARY KEY, elder_id INTEGER NOT NULL REFERENCES elders(id) ON DELETE CASCADE,
  chapter TEXT NOT NULL, question TEXT NOT NULL, question_key TEXT, status TEXT NOT NULL DEFAULT 'open', turns INTEGER NOT NULL DEFAULT 0,
  last_question TEXT, last_question_audio TEXT, started_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_out_at TEXT, last_in_at TEXT, reminded_at TEXT, closed_at TEXT);
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
  elder_id INTEGER NOT NULL REFERENCES elders(id) ON DELETE CASCADE, direction TEXT NOT NULL, kind TEXT NOT NULL, text TEXT, audio_path TEXT,
  external_id TEXT UNIQUE, processed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS stories (id INTEGER PRIMARY KEY, elder_id INTEGER NOT NULL REFERENCES elders(id) ON DELETE CASCADE,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL, chapter TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  transcript TEXT, public_token TEXT NOT NULL UNIQUE, hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS waitlist (id INTEGER PRIMARY KEY, name TEXT, email TEXT NOT NULL, phone TEXT, interest TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product TEXT NOT NULL, elder_id INTEGER, amount REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending', mp_preference_id TEXT, mp_payment_id TEXT,
  shipping TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
`;

const T = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
const NOW = 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP';
const MYSQL_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(200) NOT NULL, email VARCHAR(190) NOT NULL UNIQUE,
    phone VARCHAR(32), password_hash VARCHAR(100) NOT NULL, plan VARCHAR(16) NOT NULL DEFAULT 'trial', plan_until DATETIME NULL, created_at ${NOW}) ${T}`,
  `CREATE TABLE IF NOT EXISTS sessions (token VARCHAR(64) PRIMARY KEY, user_id INT NOT NULL, expires_at DATETIME NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ${T}`,
  `CREATE TABLE IF NOT EXISTS elders (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, name VARCHAR(200) NOT NULL, call_name VARCHAR(120) NOT NULL,
    pronoun VARCHAR(16) NOT NULL DEFAULT 'a senhora', relation VARCHAR(120), requester_name VARCHAR(160), phone VARCHAR(32), chat_id VARCHAR(80), lid VARCHAR(80),
    birth_year INT, city VARCHAR(160), notes TEXT, channel VARCHAR(16) NOT NULL DEFAULT 'whatsapp', voice TINYINT NOT NULL DEFAULT 1,
    weekday TINYINT NOT NULL DEFAULT 0, hour TINYINT NOT NULL DEFAULT 10, status VARCHAR(24) NOT NULL DEFAULT 'new', consent_at DATETIME NULL,
    token VARCHAR(64) NOT NULL UNIQUE, created_at ${NOW}, INDEX (chat_id), INDEX (lid), INDEX (status, weekday, hour),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ${T}`,
  `CREATE TABLE IF NOT EXISTS conversations (id INT AUTO_INCREMENT PRIMARY KEY, elder_id INT NOT NULL, chapter VARCHAR(32) NOT NULL, question TEXT NOT NULL,
    question_key VARCHAR(64), status VARCHAR(16) NOT NULL DEFAULT 'open', turns INT NOT NULL DEFAULT 0, last_question TEXT, last_question_audio VARCHAR(255),
    started_at ${NOW}, last_out_at DATETIME NULL, last_in_at DATETIME NULL, reminded_at DATETIME NULL, closed_at DATETIME NULL,
    INDEX (elder_id, status), FOREIGN KEY (elder_id) REFERENCES elders(id) ON DELETE CASCADE) ${T}`,
  `CREATE TABLE IF NOT EXISTS messages (id INT AUTO_INCREMENT PRIMARY KEY, conversation_id INT NULL, elder_id INT NOT NULL, direction VARCHAR(4) NOT NULL,
    kind VARCHAR(8) NOT NULL, text MEDIUMTEXT, audio_path VARCHAR(255), external_id VARCHAR(190) UNIQUE, processed TINYINT NOT NULL DEFAULT 0, created_at ${NOW},
    INDEX (conversation_id, direction, processed),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE, FOREIGN KEY (elder_id) REFERENCES elders(id) ON DELETE CASCADE) ${T}`,
  `CREATE TABLE IF NOT EXISTS stories (id INT AUTO_INCREMENT PRIMARY KEY, elder_id INT NOT NULL, conversation_id INT NULL, chapter VARCHAR(32) NOT NULL,
    title VARCHAR(255) NOT NULL, body MEDIUMTEXT NOT NULL, transcript MEDIUMTEXT, public_token VARCHAR(64) NOT NULL UNIQUE, hidden TINYINT NOT NULL DEFAULT 0,
    created_at ${NOW}, updated_at ${NOW},
    FOREIGN KEY (elder_id) REFERENCES elders(id) ON DELETE CASCADE, FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL) ${T}`,
  `CREATE TABLE IF NOT EXISTS settings (k VARCHAR(64) PRIMARY KEY, v TEXT) ${T}`,
  `CREATE TABLE IF NOT EXISTS waitlist (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(200), email VARCHAR(190) NOT NULL, phone VARCHAR(32),
    interest VARCHAR(120), created_at ${NOW}) ${T}`,
  `CREATE TABLE IF NOT EXISTS payments (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, product VARCHAR(16) NOT NULL, elder_id INT NULL,
    amount DECIMAL(10,2) NOT NULL, status VARCHAR(24) NOT NULL DEFAULT 'pending', mp_preference_id VARCHAR(120), mp_payment_id VARCHAR(64), shipping TEXT,
    created_at ${NOW}, updated_at ${NOW}, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ${T}`,
];

// Colunas novas em bancos já existentes (ignoradas se já existirem)
const MIGRATIONS = [
  { mysql: 'ALTER TABLE elders ADD COLUMN voice_id VARCHAR(64) NULL', sqlite: 'ALTER TABLE elders ADD COLUMN voice_id TEXT' },
];

// ---------- adaptadores ----------

async function createMysql() {
  const mysql = (await import('mysql2/promise')).default;
  const base = { host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password };
  if (config.db.createDatabase) {
    const c = await mysql.createConnection(base);
    await c.query(`CREATE DATABASE IF NOT EXISTS \`${config.db.name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await c.end();
  }
  const pool = mysql.createPool({
    ...base, database: config.db.name, connectionLimit: 10, charset: 'utf8mb4',
    dateStrings: true,            // datas voltam como 'YYYY-MM-DD HH:MM:SS'
    decimalNumbers: true,
    timezone: 'Z',
  });
  pool.on('connection', (conn) => conn.query("SET time_zone = '+00:00'"));
  for (const s of MYSQL_SCHEMA) await pool.query(s);
  for (const m of MIGRATIONS) await pool.query(m.mysql).catch(e => { if (e.code !== 'ER_DUP_FIELDNAME') throw e; });
  return {
    kind: 'mysql',
    async all(sql, params = []) { const [rows] = await pool.execute(sql, params.map(nul)); return rows; },
    async get(sql, params = []) { return (await this.all(sql, params))[0]; },
    async run(sql, params = []) {
      const [r] = await pool.execute(sql, params.map(nul));
      return { lastInsertRowid: r.insertId, changes: r.affectedRows };
    },
    close: () => pool.end(),
  };
}
const nul = (v) => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v;

async function createSqlite() {
  let Database;
  try { Database = (await import('better-sqlite3')).default; }
  catch { throw new Error('SQLite indisponível (better-sqlite3 não instalado). Configure DB_HOST para usar MySQL.'); }
  const s = new Database(path.join(config.dataDir, 'raizes.db'));
  s.pragma('journal_mode = WAL');
  s.pragma('foreign_keys = ON');
  s.exec(SQLITE_SCHEMA);
  for (const m of MIGRATIONS) { try { s.exec(m.sqlite); } catch (e) { if (!/duplicate column/i.test(e.message)) throw e; } }
  return {
    kind: 'sqlite',
    async all(sql, params = []) { return s.prepare(sql).all(...params.map(nul)); },
    async get(sql, params = []) { return s.prepare(sql).get(...params.map(nul)); },
    async run(sql, params = []) { const r = s.prepare(sql).run(...params.map(nul)); return { lastInsertRowid: Number(r.lastInsertRowid), changes: r.changes }; },
    close: async () => s.close(),
  };
}

export const db = config.db.host ? await createMysql() : await createSqlite();

/** Erro de chave duplicada (os dois bancos). */
export const isDuplicate = (e) => e?.code === 'ER_DUP_ENTRY' || e?.code === 'SQLITE_CONSTRAINT_UNIQUE';

export const q = {
  elder: (id) => db.get('SELECT * FROM elders WHERE id = ?', [id]),
  openConversation: (elderId) => db.get("SELECT * FROM conversations WHERE elder_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1", [elderId]),
  conversation: (id) => db.get('SELECT * FROM conversations WHERE id = ?', [id]),
  user: (id) => db.get('SELECT * FROM users WHERE id = ?', [id]),
};

// ---------- configurações (chave/valor) ----------
const settingsCache = new Map();
export async function getSetting(k) {
  if (settingsCache.has(k)) return settingsCache.get(k);
  const row = await db.get('SELECT v FROM settings WHERE k = ?', [k]);
  settingsCache.set(k, row?.v ?? null);
  return row?.v ?? null;
}
export async function setSetting(k, v) {
  await db.run('DELETE FROM settings WHERE k = ?', [k]);
  if (v !== null && v !== undefined && v !== '') await db.run('INSERT INTO settings (k, v) VALUES (?, ?)', [k, String(v)]);
  settingsCache.set(k, v || null);
}
