// Painel da família — SPA simples com rotas por hash
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = (s = '') => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const STATUS = {
  new: ['Aguardando convite', 'warn'], pending_consent: ['Convite enviado', 'warn'], active: ['Ativo', 'ok'],
  paused: ['Pausado', 'off'], stopped: ['Parou', 'off'],
};
let ME = null, CFG = null;

function toast(m, err) {
  const t = $('#toast'); t.textContent = m; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.className = 'toast', 3800);
}

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'Erro'); e.status = r.status; e.data = j; throw e; }
  return j;
}

function formData(form) {
  const o = Object.fromEntries(new FormData(form));
  form.querySelectorAll('input[type=checkbox]').forEach(c => o[c.name] = c.checked);
  return o;
}

const fmtDate = (s) => s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const initials = (n) => n.split(' ').map(x => x[0]).slice(0, 2).join('').toUpperCase();

function renderNav() {
  $('#nav').innerHTML = ME
    ? `<a href="#/">Minha família</a><a href="#/plano">${ME.planActive ? 'Plano ativo ✓' : 'Assinar'}</a><a href="#/conta">Conta</a>${ME.admin ? '<a href="#/voz">Voz</a><a href="#/admin">Admin</a>' : ''}<a href="#" id="logout">Sair</a>`
    : `<a href="#/entrar">Entrar</a><a class="btn small" href="#/cadastro">Criar conta</a>`;
  const lo = $('#logout');
  if (lo) lo.onclick = async (e) => { e.preventDefault(); await api('/auth/logout', { method: 'POST' }); ME = null; location.hash = '#/entrar'; };
}

// ---------------- telas ----------------

function authView(mode) {
  const signup = mode === 'cadastro';
  view.innerHTML = `<div class="auth card">
    <h1>${signup ? 'Comece a guardar <em>histórias</em>' : 'Bem-vindo de volta'}</h1>
    <p class="muted">${signup ? `As primeiras ${CFG.trialConversations} conversas são por nossa conta.` : 'Entre para ver as histórias da sua família.'}</p>
    <form id="f">
      ${signup ? `<div class="field"><label>Seu nome</label><input name="name" required autocomplete="name"></div>` : ''}
      <div class="field"><label>E-mail</label><input name="email" type="email" required autocomplete="email"></div>
      <div class="field"><label>Senha</label><input name="password" type="password" required minlength="6" autocomplete="${signup ? 'new-password' : 'current-password'}"></div>
      ${signup ? `<div class="field"><label>Seu WhatsApp <span class="muted">(opcional)</span></label><input name="phone" placeholder="(11) 99999-9999"><div class="hint">Para te avisar quando uma história nova ficar pronta.</div></div>` : ''}
      <button class="btn" style="width:100%">${signup ? 'Criar conta' : 'Entrar'}</button>
    </form>
    <p class="center small" style="margin-top:18px">${signup ? 'Já tem conta? <a href="#/entrar">Entrar</a>' : 'Novo por aqui? <a href="#/cadastro">Criar conta</a>'}</p>
  </div>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api(signup ? '/auth/signup' : '/auth/login', { body: formData(e.target) });
      ME = r.user; renderNav(); location.hash = signup ? '#/novo' : '#/';
    } catch (err) { toast(err.message, true); }
  };
}

function configBanner() {
  const f = CFG.features; const miss = [];
  if (!f.whatsapp) miss.push('WhatsApp (WAHA)');
  if (!f.transcription) miss.push('transcrição/voz (OpenAI)');
  if (!f.claude) miss.push('IA de conversa (Claude)');
  if (!ME.admin || !miss.length) return '';
  return `<div class="banner card cfg"><div><b>Configuração do servidor:</b> falta ${miss.join(', ')}. Veja o README. O app funciona com recursos reduzidos até lá.</div></div>`;
}

async function homeView() {
  const { elders } = await api('/elders');
  view.innerHTML = `
    ${configBanner()}
    ${!ME.planActive ? `<div class="banner card"><div><b>Você está no período de teste.</b> As ${CFG.trialConversations} primeiras conversas são grátis.</div><a class="btn small" href="#/plano">Ver planos</a></div>` : ''}
    <div class="page-head"><div><div class="eyebrow">Minha família</div><h1>Olá, ${esc(ME.name.split(' ')[0])}</h1></div>
      <a class="btn" href="#/novo">+ Adicionar pessoa</a></div>
    ${elders.length ? `<div class="grid">${elders.map(e => `
      <a class="elder card" href="#/p/${e.id}">
        <div class="av">${esc(initials(e.call_name))}</div>
        <h3>${esc(e.call_name)}</h3>
        <div class="muted small">${esc(e.relation || '')}${e.relation ? ' · ' : ''}${e.channel === 'whatsapp' ? 'WhatsApp' : 'Link de gravação'}</div>
        <div style="margin-top:10px"><span class="pill ${STATUS[e.status][1]}">${STATUS[e.status][0]}</span> ${e.open_conversation ? '<span class="pill">Conversa em andamento</span>' : ''}</div>
        <div class="stats"><span>📖 ${plural(e.stories, 'história', 'histórias')}</span><span>🎤 ${plural(e.audios, 'áudio', 'áudios')}</span></div>
      </a>`).join('')}
      <a class="elder card add" href="#/novo">+ Adicionar outra pessoa</a></div>`
    : `<div class="card empty"><div class="big">🌱</div><h2>Quem você quer ouvir primeiro?</h2><p>Cadastre sua avó, seu pai, um tio querido…</p><a class="btn" href="#/novo">Adicionar pessoa</a></div>`}`;
}

function elderForm(e = {}) {
  const v = (k, d = '') => esc(e[k] ?? d);
  const chk = (k, val, d) => ((e[k] ?? d) == val ? 'checked' : '');
  return `
    <h2>Quem é</h2>
    <div class="row">
      <div class="field"><label>Nome completo</label><input name="name" required value="${v('name')}" placeholder="Maria Aparecida Souza"></div>
      <div class="field"><label>Como chamar</label><input name="call_name" value="${v('call_name')}" placeholder="Dona Maria, Vó Cida, Seu Zé"><div class="hint">É assim que o Raízes vai falar com a pessoa.</div></div>
    </div>
    <div class="field"><label>Tratamento</label><div class="seg">
      <label><input type="radio" name="pronoun" value="a senhora" ${chk('pronoun', 'a senhora', 'a senhora')}> a senhora</label>
      <label><input type="radio" name="pronoun" value="o senhor" ${chk('pronoun', 'o senhor')}> o senhor</label>
      <label><input type="radio" name="pronoun" value="você" ${chk('pronoun', 'você')}> você</label></div></div>
    <div class="row">
      <div class="field"><label>Parentesco com você</label><input name="relation" value="${v('relation')}" placeholder="Avó materna"></div>
      <div class="field"><label>Quem está pedindo</label><input name="requester_name" value="${v('requester_name')}" placeholder="Sua neta Ana"><div class="hint">Aparece no convite: "Sua neta Ana pediu…"</div></div>
    </div>
    <div class="row">
      <div class="field"><label>Ano de nascimento</label><input name="birth_year" type="number" min="1900" max="2010" value="${v('birth_year')}"></div>
      <div class="field"><label>Cidade</label><input name="city" value="${v('city')}" placeholder="Caruaru, PE"></div>
    </div>
    <div class="field"><label>Contexto para as perguntas</label><textarea name="notes" rows="3" placeholder="Ex.: Viúva desde 2019, evitar falar do falecimento. Foi costureira por 40 anos. Adora forró e as netas.">${v('notes')}</textarea>
      <div class="hint">A IA usa isso para personalizar as perguntas e evitar temas delicados.</div></div>

    <h2>Como conversar</h2>
    <div class="field"><div class="seg">
      <label><input type="radio" name="channel" value="whatsapp" ${chk('channel', 'whatsapp', 'whatsapp')}> 💬 WhatsApp (recomendado)</label>
      <label><input type="radio" name="channel" value="link" ${chk('channel', 'link')}> 🔗 Link de gravação</label></div></div>
    <div class="field"><label>WhatsApp da pessoa</label><input name="phone" value="${v('phone')}" placeholder="(81) 99999-9999"></div>
    <div class="row">
      <div class="field"><label>Dia da pergunta semanal</label><select name="weekday">${WEEKDAYS.map((d, i) => `<option value="${i}" ${(e.weekday ?? 0) == i ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
      <div class="field"><label>Horário</label><select name="hour">${Array.from({ length: 14 }, (_, i) => i + 8).map(h => `<option value="${h}" ${(e.hour ?? 10) == h ? 'selected' : ''}>${h}h</option>`).join('')}</select></div>
    </div>
    <div class="field"><label style="display:flex;gap:10px;align-items:center;font-weight:500"><input type="checkbox" name="voice" style="width:auto" ${(e.voice ?? 1) ? 'checked' : ''}> Enviar as perguntas também em áudio (voz calma e carinhosa)</label></div>
    <div class="field" id="voice-field" hidden><label>Voz das perguntas</label>
      <div class="linkbox"><select name="voice_id" data-current="${v('voice_id')}"><option value="">Voz padrão</option></select>
      <button type="button" class="btn small ghost" id="voice-play" style="white-space:nowrap">▶ Ouvir</button></div>
      <div class="hint">Ex.: uma voz masculina para o vô, feminina para a vó.</div></div>`;
}

function newView() {
  view.innerHTML = `<div class="page-head"><div><div class="eyebrow">Nova pessoa</div><h1>Quem vai contar as histórias?</h1></div></div>
    <form class="form card" id="f">${elderForm()}<button class="btn">Salvar e continuar</button></form>`;
  bindVoiceSelect();
  $('#f').onsubmit = async (ev) => {
    ev.preventDefault();
    try { const { elder } = await api('/elders', { body: formData(ev.target) }); toast('Cadastrado! 🌱'); location.hash = `#/p/${elder.id}`; }
    catch (err) { toast(err.message, true); }
  };
}

async function elderView(id, tab = 'historias') {
  const { elder: e } = await api(`/elders/${id}`);
  const st = STATUS[e.status];
  const canInvite = e.channel === 'whatsapp' && ['new', 'pending_consent', 'stopped'].includes(e.status);
  view.innerHTML = `
    <div class="profile-head"><div class="av">${esc(initials(e.call_name))}</div>
      <div><div class="eyebrow">${esc(e.relation || 'Família')}</div><h1>${esc(e.call_name)}</h1>
      <div class="small muted"><span class="pill ${st[1]}">${st[0]}</span> &nbsp;Pergunta toda ${WEEKDAYS[e.weekday].toLowerCase()} às ${e.hour}h · ${plural(e.stories, 'história', 'histórias')} · ${plural(e.audios, 'áudio', 'áudios')}</div></div></div>
    <div class="actions">
      ${canInvite ? `<button class="btn" id="invite">${e.status === 'new' ? '💌 Enviar convite no WhatsApp' : '💌 Reenviar convite'}</button>` : ''}
      ${e.status === 'active' && !e.open_conversation ? `<button class="btn" id="start">🎤 Fazer uma pergunta agora</button>` : ''}
      ${e.open_conversation ? `<button class="btn ghost" id="finish">✓ Encerrar conversa e gerar história</button>` : ''}
      ${e.status === 'active' ? `<button class="btn ghost" data-status="paused">Pausar</button>` : ''}
      ${e.status === 'paused' ? `<button class="btn ghost" data-status="active">Retomar</button>` : ''}
      <a class="btn ghost" href="/livro/${e.id}" target="_blank">📖 Ver livro</a>
    </div>
    <div class="card" style="padding:16px 18px;margin-bottom:24px">
      <label>Link de gravação de ${esc(e.call_name)} ${e.channel === 'whatsapp' ? '<span class="muted" style="font-weight:400">(alternativa ao WhatsApp)</span>' : ''}</label>
      <div class="linkbox"><input readonly value="${esc(e.link)}"><button class="btn small" id="copy">Copiar</button></div>
      <div class="hint">Funciona em qualquer celular: botão grande para gravar, sem instalar nada. Não compartilhe com estranhos.</div></div>
    <div class="tabs">
      <a href="#/p/${e.id}" class="${tab === 'historias' ? 'on' : ''}">Histórias</a>
      <a href="#/p/${e.id}/conversas" class="${tab === 'conversas' ? 'on' : ''}">Conversas</a>
      <a href="#/p/${e.id}/ajustes" class="${tab === 'ajustes' ? 'on' : ''}">Ajustes</a>
    </div>
    <div id="tab"></div>`;

  const act = (sel, fn) => { const b = $(sel); if (b) b.onclick = async () => { b.disabled = true; try { await fn(); } catch (err) { toast(err.message, true); if (err.data?.needsPlan) location.hash = '#/plano'; } finally { b.disabled = false; } }; };
  act('#invite', async () => { await api(`/elders/${e.id}/invite`, { method: 'POST' }); toast('Convite enviado! Quando responder SIM, a primeira pergunta sai na hora.'); route(); });
  act('#start', async () => { await api(`/elders/${e.id}/start`, { method: 'POST' }); toast('Pergunta enviada! 🎤'); route(); });
  act('#finish', async () => { await api(`/elders/${e.id}/finish`, { method: 'POST' }); toast('História criada! 📖'); location.hash = `#/p/${e.id}`; route(); });
  document.querySelectorAll('[data-status]').forEach(b => b.onclick = async () => { await api(`/elders/${e.id}`, { method: 'PATCH', body: { status: b.dataset.status } }); route(); });
  act('#copy', async () => { await navigator.clipboard.writeText(e.link); toast('Link copiado!'); });

  const box = $('#tab');
  if (tab === 'historias') {
    const { stories } = await api(`/elders/${e.id}/stories`);
    const chName = (k) => CFG.chapters.find(c => c.key === k)?.name || 'Histórias soltas';
    box.innerHTML = stories.length ? stories.map(s => `
      <article class="story card"><div class="ch">${esc(chName(s.chapter))} · ${fmtDate(s.created_at)}</div>
        <h3>${esc(s.title)}</h3><div class="body">${s.body.split(/\n+/).filter(Boolean).map(p => `<p>${esc(p)}</p>`).join('')}</div>
        ${s.audios.map(a => `<audio controls preload="none" src="/api/messages/${a.id}/audio"></audio>`).join('')}
        <div class="tools"><button class="btn small ghost" data-edit="${s.id}">✏️ Editar</button>
          <button class="btn small ghost" data-share="${esc(s.listen_url)}">🔗 Compartilhar</button>
          <button class="btn small danger" data-hide="${s.id}">Remover do livro</button></div></article>`).join('')
      : `<div class="card empty"><div class="big">📖</div><h3>As histórias aparecem aqui</h3><p>Assim que ${esc(e.call_name)} responder uma conversa, ela vira um capítulo do livro.</p></div>`;
    box.querySelectorAll('[data-share]').forEach(b => b.onclick = async () => {
      const url = b.dataset.share;
      if (navigator.share) navigator.share({ title: 'Uma história no Raízes', url }).catch(() => {}); else { await navigator.clipboard.writeText(url); toast('Link copiado!'); }
    });
    box.querySelectorAll('[data-hide]').forEach(b => b.onclick = async () => {
      if (!confirm('Remover esta história do livro? Os áudios continuam guardados.')) return;
      await api(`/stories/${b.dataset.hide}`, { method: 'PATCH', body: { hidden: true } }); route();
    });
    box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editStory(stories.find(s => s.id == b.dataset.edit)));
  }
  if (tab === 'conversas') {
    const { conversations } = await api(`/elders/${e.id}/conversations`);
    box.innerHTML = conversations.length ? conversations.map(c => `
      <div class="conv card"><div class="small muted">${fmtDate(c.started_at)} · ${c.status === 'open' ? '<span class="pill warn">em andamento</span>' : '<span class="pill ok">concluída</span>'}</div>
        <div class="q">${esc(c.question)}</div>
        ${c.messages.map(m => `<div class="msg ${m.direction}">${esc(m.text || '')}${m.has_audio ? `<audio controls preload="none" src="/api/messages/${m.id}/audio"></audio>` : ''}<small>${m.direction === 'in' ? esc(e.call_name) : 'Raízes'} · ${fmtDate(m.created_at)}</small></div>`).join('')}
      </div>`).join('')
      : `<div class="card empty"><div class="big">💬</div><p>Nenhuma conversa ainda.</p></div>`;
  }
  if (tab === 'ajustes') {
    box.innerHTML = `<form class="form card" id="f">${elderForm(e)}
      <div style="display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap"><button class="btn">Salvar</button><button type="button" class="btn danger" id="del">Excluir pessoa e todos os áudios</button></div></form>`;
    bindVoiceSelect();
    $('#f').onsubmit = async (ev) => { ev.preventDefault(); try { await api(`/elders/${e.id}`, { method: 'PATCH', body: formData(ev.target) }); toast('Salvo!'); route(); } catch (err) { toast(err.message, true); } };
    $('#del').onclick = async () => {
      if (prompt(`Isso apaga TODAS as histórias e áudios de ${e.call_name}. Digite APAGAR para confirmar.`) !== 'APAGAR') return;
      await api(`/elders/${e.id}`, { method: 'DELETE' }); location.hash = '#/';
    };
  }
}

function editStory(s) {
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<form class="modal card"><h2>Editar história</h2>
    <div class="field"><label>Título</label><input name="title" value="${esc(s.title)}"></div>
    <div class="field"><label>Capítulo</label><select name="chapter">${[...CFG.chapters, { key: 'soltas', name: 'Histórias soltas' }].map(c => `<option value="${c.key}" ${c.key === s.chapter ? 'selected' : ''}>${c.name}</option>`).join('')}</select></div>
    <div class="field"><label>Texto</label><textarea name="body">${esc(s.body)}</textarea></div>
    <details style="margin-bottom:16px"><summary class="small muted" style="cursor:pointer">Ver transcrição original</summary><pre style="white-space:pre-wrap;font-size:14px">${esc(s.transcript || '')}</pre></details>
    <div style="display:flex;gap:10px"><button class="btn">Salvar</button><button type="button" class="btn ghost" id="cancel">Cancelar</button></div></form>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.onclick = (ev) => { if (ev.target === bg) close(); };
  $('#cancel', bg).onclick = close;
  $('form', bg).onsubmit = async (ev) => { ev.preventDefault(); await api(`/stories/${s.id}`, { method: 'PATCH', body: formData(ev.target) }); close(); toast('História atualizada!'); route(); };
}

async function planView() {
  const { elders } = await api('/elders');
  const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  view.innerHTML = `<div class="page-head"><div><div class="eyebrow">Planos</div><h1>Guarde um ano inteiro de histórias</h1></div></div>
    ${ME.planActive ? `<div class="banner card"><div>✅ <b>Plano ativo</b> até ${new Date(ME.plan_until.replace(' ', 'T') + 'Z').toLocaleDateString('pt-BR')}.</div></div>` : ''}
    <div class="plans">
      <div class="card"><h3>Plano anual</h3><div class="amount">${brl(CFG.prices.plan)}</div><p class="muted">52 conversas semanais, histórias com IA, áudios guardados e livro digital. Pix, cartão (até 12×) ou boleto.</p>
        <button class="btn" id="buy-plan" style="width:100%">${ME.planActive ? 'Renovar por mais 1 ano' : 'Assinar agora'}</button></div>
      <div class="card"><h3>Livro impresso</h3><div class="amount">${brl(CFG.prices.book)}</div><p class="muted">Capa dura, com QR code de voz em cada capítulo.</p>
        <form id="book">
          <div class="field"><label>De quem é o livro?</label><select name="elderId">${elders.map(e => `<option value="${e.id}">${esc(e.call_name)}</option>`).join('')}</select></div>
          <div class="field"><label>Endereço de entrega</label><textarea name="address" rows="3" required placeholder="Rua, número, bairro, cidade, UF, CEP"></textarea></div>
          <button class="btn ghost" style="width:100%" ${elders.length ? '' : 'disabled'}>Encomendar livro</button></form></div>
    </div>`;
  const go = async (body) => {
    const r = await api('/checkout', { body });
    if (r.url) location.href = r.url; else toast(r.message || 'Pedido registrado.');
  };
  $('#buy-plan').onclick = () => go({ product: 'plan' }).catch(err => toast(err.message, true));
  $('#book').onsubmit = (ev) => { ev.preventDefault(); const f = formData(ev.target); go({ product: 'book', elderId: Number(f.elderId), shipping: { address: f.address } }).catch(err => toast(err.message, true)); };
}

function accountView() {
  view.innerHTML = `<div class="page-head"><div><div class="eyebrow">Conta</div><h1>Seus dados</h1></div></div>
    <form class="form card" id="f">
      <div class="field"><label>Nome</label><input name="name" value="${esc(ME.name)}"></div>
      <div class="field"><label>E-mail</label><input value="${esc(ME.email)}" disabled></div>
      <div class="field"><label>Seu WhatsApp</label><input name="phone" value="${esc(ME.phone || '')}" placeholder="(11) 99999-9999"><div class="hint">Avisamos aqui quando uma história nova ficar pronta.</div></div>
      <button class="btn">Salvar</button></form>`;
  $('#f').onsubmit = async (ev) => { ev.preventDefault(); const r = await api('/me', { method: 'PATCH', body: formData(ev.target) }); ME = r.user; toast('Salvo!'); };
}

function paymentView(kind) {
  const msg = { ok: ['🎉', 'Pagamento aprovado!', 'Obrigado! Seu plano será ativado assim que o Mercado Pago confirmar (normalmente em segundos).'],
    pendente: ['⏳', 'Pagamento em processamento', 'Assim que for confirmado (Pix e boleto podem levar um tempo), o plano é ativado automaticamente.'],
    erro: ['😕', 'O pagamento não foi concluído', 'Nenhum valor foi cobrado. Você pode tentar novamente.'] }[kind] || ['', '', ''];
  view.innerHTML = `<div class="card empty"><div class="big">${msg[0]}</div><h2>${msg[1]}</h2><p>${msg[2]}</p><a class="btn" href="#/">Voltar ao painel</a></div>`;
}

async function adminView() {
  const d = await api('/admin/overview');
  const tbl = (rows, cols) => `<table class="t"><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr>${rows.map(r => `<tr>${cols.map(c => `<td>${esc(r[c] ?? '')}</td>`).join('')}</tr>`).join('')}</table>`;
  view.innerHTML = `<div class="page-head"><h1>Admin</h1></div>
    <p>${d.totals.elders} pessoas · ${d.totals.stories} histórias · ${d.totals.answers} respostas</p>
    <h2>Lista de espera (${d.waitlist.length})</h2><div class="card" style="padding:16px;overflow:auto">${tbl(d.waitlist, ['created_at', 'name', 'email', 'phone', 'interest'])}</div>
    <h2 style="margin-top:30px">Usuários (${d.users.length})</h2><div class="card" style="padding:16px;overflow:auto">${tbl(d.users, ['created_at', 'name', 'email', 'phone', 'plan', 'plan_until'])}</div>
    <h2 style="margin-top:30px">Pagamentos</h2><div class="card" style="padding:16px;overflow:auto">${tbl(d.payments, ['created_at', 'user_id', 'product', 'amount', 'status', 'shipping'])}</div>`;
}

// ---------------- vozes ----------------

let VOICES = null;
async function loadVoices(fresh) {
  if (!VOICES || fresh) VOICES = await api('/voices' + (fresh ? '?fresh=1' : ''));
  return VOICES;
}
const PT_LABELS = { female: 'feminina', male: 'masculina', neutral: 'neutra', young: 'jovem', middle_aged: 'meia-idade', 'middle aged': 'meia-idade', old: 'madura',
  brazilian: 'brasileiro', portuguese: 'português', american: 'americano', british: 'britânico', australian: 'australiano', spanish: 'espanhol' };
const tr = (x) => x ? (PT_LABELS[String(x).toLowerCase()] || String(x).replaceAll('_', ' ')) : '';
const voiceLabel = (v) => [tr(v.labels.gender), tr(v.labels.age), tr(v.labels.accent)].filter(Boolean).join(' · ');

let playing = null;
async function playVoice(voiceId, btn, name) {
  if (playing) { playing.pause(); playing = null; }
  const old = btn.textContent; btn.disabled = true; btn.textContent = 'Gerando…';
  try {
    const r = await fetch('/api/voices/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voiceId, name }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erro ao gerar amostra');
    playing = new Audio(URL.createObjectURL(await r.blob()));
    btn.textContent = '🔊 Tocando'; await playing.play();
    playing.onended = () => { btn.textContent = old; };
  } catch (err) { toast(err.message, true); btn.textContent = old; }
  finally { btn.disabled = false; }
}

/** Preenche o seletor de voz do formulário da pessoa (se a ElevenLabs estiver ativa). */
async function bindVoiceSelect(root = document) {
  const field = $('#voice-field', root); if (!field) return;
  try {
    const d = await loadVoices();
    if (d.provider !== 'elevenlabs' || !d.voices.length) return;
    const sel = $('select[name=voice_id]', field);
    const cur = sel.dataset.current;
    const def = d.voices.find(v => v.voice_id === d.current);
    sel.options[0].textContent = `Voz padrão${def ? ` (${def.name})` : ''}`;
    for (const v of d.voices) sel.add(new Option(`${v.name}${voiceLabel(v) ? ' · ' + voiceLabel(v) : ''}${v.portuguese ? ' · PT' : ''}`, v.voice_id, false, v.voice_id === cur));
    field.hidden = false;
    $('#voice-play', field).onclick = (ev) => playVoice(sel.value || d.current, ev.target, $('input[name=call_name]', root)?.value);
  } catch { /* sem vozes: campo fica oculto */ }
}

async function voicesView(fresh = false) {
  view.innerHTML = '<div class="card empty"><p>Carregando vozes da ElevenLabs…</p></div>';
  let d;
  try { d = await loadVoices(fresh); } catch (err) { view.innerHTML = `<div class="card empty"><h3>Não consegui listar as vozes</h3><p>${esc(err.message)}</p><p class="small muted">Confira a ELEVENLABS_API_KEY no .env e se ela tem permissão de leitura de vozes.</p></div>`; return; }
  if (d.provider !== 'elevenlabs') {
    view.innerHTML = `<div class="card empty"><h3>ElevenLabs não configurada</h3><p>Coloque <code>ELEVENLABS_API_KEY</code> no .env do servidor e reinicie para escolher vozes aqui.</p></div>`; return;
  }
  const genders = [...new Set(d.voices.map(v => v.labels.gender).filter(Boolean))];
  view.innerHTML = `<div class="page-head"><div><div class="eyebrow">Voz do Raízes</div><h1>Escolha quem faz as perguntas</h1>
      <p class="muted" style="margin:6px 0 0">Ouça cada voz falando em português e escolha a padrão. Em cada pessoa, nos Ajustes, dá para usar outra voz.</p></div>
      <button class="btn ghost small" id="refresh">↻ Atualizar lista</button></div>
    <div class="card" style="padding:14px;margin-bottom:18px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <input id="vq" placeholder="Buscar pelo nome…" style="flex:1;min-width:180px">
      <select id="vg" style="width:auto"><option value="">Todas</option>${genders.map(g => `<option value="${esc(g)}">${g === 'female' ? 'Femininas' : g === 'male' ? 'Masculinas' : esc(g)}</option>`).join('')}</select>
      <label style="display:flex;gap:6px;align-items:center;margin:0;font-weight:500"><input type="checkbox" id="vpt" style="width:auto"> Só verificadas em português</label>
    </div>
    <div class="grid" id="vlist"></div>`;
  const draw = () => {
    const qv = $('#vq').value.toLowerCase(), g = $('#vg').value, pt = $('#vpt').checked;
    const list = d.voices.filter(v => (!qv || v.name.toLowerCase().includes(qv)) && (!g || v.labels.gender === g) && (!pt || v.portuguese));
    $('#vlist').innerHTML = list.map(v => `
      <div class="card" style="padding:20px;${v.voice_id === d.current ? 'border:2px solid var(--accent)' : ''}">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:start"><h3 style="font-size:21px;margin:0">${esc(v.name)}</h3>
          ${v.voice_id === d.current ? '<span class="pill ok">✓ Padrão</span>' : ''}</div>
        <div class="small muted" style="margin:4px 0 10px">${esc(voiceLabel(v) || v.category || '')}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${v.portuguese ? '<span class="pill ok">Português</span>' : ''}${v.category ? `<span class="pill">${esc(v.category)}</span>` : ''}${v.labels.use_case ? `<span class="pill">${esc(v.labels.use_case)}</span>` : ''}</div>
        ${v.description ? `<p class="small muted" style="margin:0 0 12px">${esc(v.description.slice(0, 140))}</p>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn small" data-pt="${v.voice_id}">▶ Ouvir em português</button>
          ${v.preview_url ? `<button class="btn small ghost" data-orig="${esc(v.preview_url)}">Amostra original</button>` : ''}
          ${d.canSetDefault && v.voice_id !== d.current ? `<button class="btn small ghost" data-use="${v.voice_id}">Usar como padrão</button>` : ''}
        </div>
        <div class="hint" style="margin-top:10px">ID: <code>${esc(v.voice_id)}</code></div>
      </div>`).join('') || '<div class="card empty"><p>Nenhuma voz com esse filtro.</p></div>';
    $('#vlist').querySelectorAll('[data-pt]').forEach(b => b.onclick = () => playVoice(b.dataset.pt, b));
    $('#vlist').querySelectorAll('[data-orig]').forEach(b => b.onclick = () => { if (playing) playing.pause(); playing = new Audio(b.dataset.orig); playing.play(); });
    $('#vlist').querySelectorAll('[data-use]').forEach(b => b.onclick = async () => {
      await api('/voices/default', { method: 'PUT', body: { voiceId: b.dataset.use } });
      d.current = b.dataset.use; VOICES = d; toast('Voz padrão atualizada! 🎙️'); draw();
    });
  };
  ['vq', 'vg', 'vpt'].forEach(id => $('#' + id).oninput = draw);
  $('#refresh').onclick = () => voicesView(true);
  draw();
}

// ---------------- roteador ----------------

async function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [a, b, c] = h.split('/');
  try {
    if (!ME && !['entrar', 'cadastro'].includes(a)) { location.hash = '#/entrar'; return; }
    if (ME && ['entrar', 'cadastro'].includes(a)) { location.hash = '#/'; return; }
    if (a === 'entrar' || a === 'cadastro') return authView(a);
    if (a === 'novo') return newView();
    if (a === 'p') return await elderView(b, c || 'historias');
    if (a === 'plano') return await planView();
    if (a === 'conta') return accountView();
    if (a === 'pagamento') { const r = await api('/me'); ME = r.user; renderNav(); return paymentView(b); }
    if (a === 'admin') return await adminView();
    if (a === 'voz') return await voicesView();
    return await homeView();
  } catch (err) {
    if (err.status === 401) { ME = null; renderNav(); location.hash = '#/entrar'; return; }
    view.innerHTML = `<div class="card empty"><p>${esc(err.message)}</p><a class="btn" href="#/">Voltar</a></div>`;
  }
}

(async () => {
  [CFG, { user: ME }] = await Promise.all([fetch('/api/config').then(r => r.json()), api('/me')]);
  renderNav();
  addEventListener('hashchange', () => { renderNav(); route(); scrollTo(0, 0); });
  route();
})();
