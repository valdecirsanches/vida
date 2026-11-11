// Livro de memórias pronto para imprimir (ou salvar em PDF pelo navegador).
import express from 'express';
import QRCode from 'qrcode';
import { db, q } from '../db.js';
import { config } from '../config.js';
import { currentUser } from '../auth.js';
import { CHAPTERS, chapterName } from '../questions.js';

export const book = express.Router();

const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paras = (t = '') => t.split(/\n{1,}/).map(p => p.trim()).filter(Boolean).map(p => `<p>${esc(p)}</p>`).join('');

book.get('/livro/:id', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return res.redirect('/app');
  const e = await q.elder(Number(req.params.id));
  if (!e || e.user_id !== u.id) return res.status(404).send('Livro não encontrado');

  const stories = (await db.all('SELECT * FROM stories WHERE elder_id = ? AND hidden = 0 ORDER BY id', [e.id]));
  const order = [...CHAPTERS.map(c => c.key), 'soltas'];
  const groups = order.map(k => ({ key: k, name: chapterName(k), items: stories.filter(s => s.chapter === k) })).filter(g => g.items.length);

  const qr = {};
  for (const s of stories) {
    qr[s.id] = await QRCode.toDataURL(`${config.publicUrl}/ouvir/${s.public_token}`, { margin: 0, width: 220, color: { dark: '#3b2a1e', light: '#0000' } });
  }

  let n = 0;
  const toc = groups.map(g => `<li><span>${esc(g.name)}</span><ol>${g.items.map(s => `<li>${esc(s.title)}</li>`).join('')}</ol></li>`).join('');
  const chapters = groups.map(g => `
    <section class="chapter-open"><div class="num">${String(++n).padStart(2, '0')}</div><h2>${esc(g.name)}</h2></section>
    ${g.items.map(s => `
      <article class="story">
        <h3>${esc(s.title)}</h3>
        <div class="body">${paras(s.body)}</div>
        <aside class="listen"><img src="${qr[s.id]}" alt=""><span>Aponte a câmera do celular<br>e ouça esta história<br>na voz de ${esc(e.call_name)}</span></aside>
      </article>`).join('')}`).join('');

  res.send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(e.name)} — Livro de memórias</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,500;9..144,700&family=Newsreader:ital,opsz,wght@0,6..72,400;1,6..72,400&display=swap" rel="stylesheet">
<style>
  @page { size: A5; margin: 18mm 16mm 20mm; }
  :root { --ink:#3b2a1e; --soft:#8a6f5a; --paper:#fbf6ee; --accent:#b4552d; }
  * { box-sizing: border-box; }
  body { margin:0; background:#e9e1d4; color:var(--ink); font: 400 15px/1.7 'Newsreader', Georgia, serif; }
  .page { background:var(--paper); max-width: 148mm; margin: 24px auto; padding: 22mm 18mm; box-shadow: 0 10px 40px #0002; }
  .toolbar { position: sticky; top:0; background:#3b2a1ee6; color:#fff; padding:10px 16px; display:flex; gap:12px; align-items:center; justify-content:center; font-family: system-ui; font-size:14px; z-index:5 }
  .toolbar button { background:var(--accent); color:#fff; border:0; border-radius:999px; padding:8px 18px; font-weight:600; cursor:pointer }
  .cover { min-height: 180mm; display:flex; flex-direction:column; justify-content:center; text-align:center; border: 1px solid #d9c9b3; outline: 6px double #d9c9b3; outline-offset: -14px; }
  .cover .tree { font-size: 56px; }
  .cover h1 { font: 300 40px/1.1 'Fraunces', serif; margin: 18px 0 8px; letter-spacing: -.5px }
  .cover .sub { font-style: italic; color: var(--soft); font-size: 17px }
  .cover .meta { margin-top: 40px; font-size: 13px; letter-spacing: 3px; text-transform: uppercase; color: var(--soft) }
  h2, h3 { font-family: 'Fraunces', serif; font-weight: 500; }
  .toc h2 { font-size: 26px; margin-top:0 }
  .toc > ol { list-style:none; padding:0 } .toc > ol > li > span { font: 600 13px system-ui; letter-spacing: 2px; text-transform: uppercase; color: var(--accent) }
  .toc ol ol { margin: 4px 0 16px; padding-left: 18px }
  .chapter-open { min-height: 120mm; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; break-before: page; }
  .chapter-open .num { font: 300 64px 'Fraunces', serif; color: var(--accent); opacity:.8 }
  .chapter-open h2 { font-size: 30px; margin: 0 }
  .story { break-before: page; padding-top: 6mm }
  .story h3 { font-size: 24px; line-height:1.2; margin: 0 0 16px }
  .story .body p { margin: 0 0 .9em; text-align: justify; hyphens: auto }
  .story .body p:first-child::first-letter { float:left; font: 500 52px/0.9 'Fraunces', serif; padding: 4px 8px 0 0; color: var(--accent) }
  .listen { display:flex; gap:14px; align-items:center; margin-top: 22px; padding-top: 14px; border-top: 1px solid #e3d6c3; font: 12px/1.4 system-ui; color: var(--soft); break-inside: avoid }
  .listen img { width: 26mm; height: 26mm }
  .empty { text-align:center; color: var(--soft); font-style: italic }
  @media print { body { background: none } .page { box-shadow:none; margin:0; padding:0; max-width:none } .toolbar { display:none } .sheet { break-after: page } }
</style></head><body>
<div class="toolbar">Livro de ${esc(e.call_name)} · ${stories.length} ${stories.length === 1 ? 'história' : 'histórias'} <button onclick="print()">Imprimir / salvar PDF</button></div>
<div class="page">
  <div class="cover sheet"><div class="tree">🌳</div><h1>${esc(e.name)}</h1>
    <div class="sub">Histórias de uma vida, contadas na própria voz</div>
    <div class="meta">${e.birth_year ? esc(e.birth_year) + ' · ' : ''}${esc(e.city || '')}${e.city ? ' · ' : ''}Raízes</div></div>
  ${stories.length ? `<div class="toc sheet"><h2>Sumário</h2><ol>${toc}</ol></div>${chapters}` : '<p class="empty">Ainda não há histórias. Elas aparecem aqui conforme as conversas acontecem.</p>'}
</div></body></html>`);
});
