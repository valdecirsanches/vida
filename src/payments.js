// Mercado Pago — Checkout Pro (Pix, cartão e boleto)
import { db, now, fmt } from './db.js';
import { config, features } from './config.js';

const MP = 'https://api.mercadopago.com';

async function mp(method, path, body) {
  const res = await fetch(MP + path, {
    method,
    headers: { Authorization: `Bearer ${config.payments.mpAccessToken}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Mercado Pago ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export const PRODUCTS = {
  plan: () => ({ title: 'Raízes — Plano anual (52 conversas + livro digital)', price: config.payments.planPrice }),
  book: () => ({ title: 'Raízes — Livro impresso capa dura com QR codes', price: config.payments.bookPrice }),
};

export async function createCheckout(user, product, { elderId = null, shipping = null } = {}) {
  const p = PRODUCTS[product]?.();
  if (!p) throw new Error('Produto inválido');
  const pay = (await db.run('INSERT INTO payments (user_id, product, elder_id, amount, shipping) VALUES (?,?,?,?,?)', [user.id, product, elderId, p.price, shipping ? JSON.stringify(shipping) : null]));
  const paymentId = pay.lastInsertRowid;

  if (!features.payments) {
    return { paymentId, url: null, message: 'Pagamentos ainda não configurados (MP_ACCESS_TOKEN). Pedido registrado como pendente.' };
  }
  const pref = await mp('POST', '/checkout/preferences', {
    items: [{ id: product, title: p.title, quantity: 1, currency_id: 'BRL', unit_price: p.price }],
    payer: { name: user.name, email: user.email },
    external_reference: String(paymentId),
    back_urls: {
      success: `${config.publicUrl}/app#/pagamento/ok`,
      pending: `${config.publicUrl}/app#/pagamento/pendente`,
      failure: `${config.publicUrl}/app#/pagamento/erro`,
    },
    auto_return: 'approved',
    notification_url: `${config.publicUrl}/webhooks/mercadopago`,
    statement_descriptor: 'RAIZES',
  });
  (await db.run('UPDATE payments SET mp_preference_id = ? WHERE id = ?', [pref.id, paymentId]));
  return { paymentId, url: pref.init_point };
}

/** Chamado pelo webhook: confere o pagamento direto na API (não confia no corpo do webhook). */
export async function handleNotification(mpPaymentId) {
  if (!features.payments || !mpPaymentId) return;
  const p = await mp('GET', `/v1/payments/${mpPaymentId}`);
  const local = (await db.get('SELECT * FROM payments WHERE id = ?', [Number(p.external_reference)]));
  if (!local) return;
  (await db.run('UPDATE payments SET status = ?, mp_payment_id = ?, updated_at = ? WHERE id = ?', [p.status, String(p.id), now(), local.id]));
  if (p.status === 'approved' && local.status !== 'approved' && local.product === 'plan') {
    const u = (await db.get('SELECT * FROM users WHERE id = ?', [local.user_id]));
    const base = u.plan_until && u.plan_until > now() ? new Date(u.plan_until.replace(' ', 'T') + 'Z') : new Date();
    base.setFullYear(base.getFullYear() + 1);
    (await db.run("UPDATE users SET plan = 'active', plan_until = ? WHERE id = ?", [fmt(base), u.id]));
  }
}
