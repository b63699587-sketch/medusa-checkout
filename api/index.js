const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const SECRET_KEY = process.env.MEDUSA_SECRET_KEY;
const BASE_URL = process.env.BASE_URL || 'https://figurinhas-copa2026.vercel.app';
const MEDUSA_API = 'https://api.v2.medusapay.com.br/v1';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const hasSupabase = !!(SUPABASE_URL && SUPABASE_SERVICE_KEY);
const ADMIN_PASSWORD = '2026Acesso*';
const ADMIN_TOKEN = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest('hex');

function authHeader() {
  const basic = Buffer.from(`${SECRET_KEY}:x`).toString('base64');
  return { authorization: `Basic ${basic}`, 'content-type': 'application/json' };
}

function makeRef() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function parseCookies(header) {
  const cookies = {};
  (header || '').split(';').forEach(c => {
    const p = c.indexOf('=');
    if (p > -1) cookies[c.slice(0, p).trim()] = c.slice(p + 1).trim();
  });
  return cookies;
}

function requireAdmin(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.admin_token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Não autorizado' });
  }
  next();
}

async function supabaseFetch(method, path, body) {
  if (!hasSupabase) return null;
  const opts = {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(`${SUPABASE_URL}${path}`, opts);
  return resp;
}

app.post('/api/checkout', async (req, res) => {
  try {
    const { produto, valor, cliente, entrega } = req.body;
    const amountCents = Math.round(valor * 100);

    const body = {
      amount: amountCents,
      paymentMethod: 'pix',
      pix: { expiresInDays: 3 },
      items: [{ title: produto, unitPrice: amountCents, quantity: 1, tangible: true }],
      customer: {
        name: cliente.nome,
        email: cliente.email,
        phone: cliente.telefone.replace(/\D/g, ''),
        document: { number: cliente.cpf.replace(/\D/g, ''), type: 'cpf' }
      },
      externalRef: makeRef(),
      traceable: false,
      ip: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1',
      postbackUrl: `${BASE_URL}/webhook`,
      metadata: JSON.stringify({ produto, cliente_nome: cliente.nome })
    };

    const resp = await fetch(`${MEDUSA_API}/transactions`, {
      method: 'POST',
      headers: authHeader(),
      body: JSON.stringify(body)
    });

    const text = await resp.text();
    const data = JSON.parse(text);

    if (!resp.ok) {
      return res.status(400).json({ error: data.message || 'Pagamento recusado', details: data });
    }

    const pix = data.pix || {};

    res.json({
      transactionId: data.id,
      status: data.status,
      pixQrCode: pix.qrcode || null,
      secureUrl: data.secureUrl || null
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/webhook', (req, res) => {
  const payload = req.body;
  console.log('Webhook recebido:', JSON.stringify(payload, null, 2));
  if (payload.type === 'transaction') {
    const t = payload.data;
    console.log(`Transacao #${t.id}: status=${t.status}, valor=${t.amount}`);
  }
  res.status(200).json({ received: true });
});

app.get('/api/transacao/:id', async (req, res) => {
  try {
    const resp = await fetch(`${MEDUSA_API}/transactions/${req.params.id}`, {
      headers: authHeader()
    });
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar transacao' });
  }
});

// === TRACKING ===
app.post('/api/track', async (req, res) => {
  try {
    const { sessionId, eventType, produto, preco, transactionId } = req.body;
    res.json({ ok: true });
    if (!hasSupabase) return;
    await supabaseFetch('POST', '/rest/v1/events', {
      session_id: sessionId,
      event_type: eventType,
      product: produto || null,
      price: preco || null,
      transaction_id: transactionId || null,
      referrer: req.headers.referer || '',
      user_agent: req.headers['user-agent'] || '',
      ip: req.ip || req.headers['x-forwarded-for'] || ''
    });
  } catch (_) {}
});

// === ADMIN ===
app.get('/admin', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.admin_token === ADMIN_TOKEN) {
    return res.redirect('/admin/dashboard');
  }
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Admin - Figurinhas Copa 2026</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Inter,sans-serif;background:#080818;color:#e0e0e0;min-height:100vh;display:flex;align-items:center;justify-content:center}
.login-card{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.10);border-radius:20px;padding:48px 40px;width:380px;max-width:90%;text-align:center}
.login-card h1{font-size:1.6em;font-weight:800;color:#fff;margin-bottom:4px}
.login-card p{color:#888;font-size:0.85em;margin-bottom:28px}
.login-card input{width:100%;padding:14px 16px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);border-radius:12px;color:#fff;font-size:1em;outline:none;transition:.2s;margin-bottom:16px}
.login-card input:focus{border-color:#00d95a;box-shadow:0 0 0 3px rgba(0,217,90,0.15)}
.login-card button{width:100%;padding:14px;background:#00d95a;color:#080818;border:none;border-radius:12px;font-size:1em;font-weight:700;cursor:pointer;transition:.2s}
.login-card button:hover{background:#00c04f;transform:translateY(-1px)}
.erro{color:#ff4444;font-size:0.85em;margin-top:12px}
</style></head>
<body>
<div class="login-card">
  <h1>🔐 Painel</h1>
  <p>Digite a senha de administrador</p>
  <form method="POST" action="/admin">
    <input type="password" name="senha" placeholder="Senha" autofocus>
    <button type="submit">Entrar</button>
  </form>
  ${req.query.erro ? '<div class="erro">Senha incorreta</div>' : ''}
</div>
</body></html>`);
});

app.post('/admin', express.urlencoded({ extended: false }), (req, res) => {
  if (req.body.senha === ADMIN_PASSWORD) {
    res.setHeader('Set-Cookie', `admin_token=${ADMIN_TOKEN}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);
    return res.redirect('/admin/dashboard');
  }
  res.redirect('/admin?erro=1');
});

app.get('/admin/dashboard', requireAdmin, async (req, res) => {
  if (!hasSupabase) {
    return res.send(configHtml());
  }
  res.send(adminDashboardHtml());
});

app.get('/api/admin/metrics', requireAdmin, async (req, res) => {
  if (!hasSupabase) {
    return res.json({ configured: false, message: 'Supabase não configurado' });
  }
  try {
    const resp = await supabaseFetch('GET', '/rest/v1/events?order=created_at.desc&limit=10000');
    if (!resp || !resp.ok) return res.json({ error: 'Erro ao consultar dados' });
    const events = await resp.json();
    const recent = events.slice(0, 100);
    const pageviews = events.filter(e => e.event_type === 'pageview').length;
    const unique = new Set(events.map(e => e.session_id)).size;
    const modalOpened = events.filter(e => e.event_type === 'modal_opened').length;
    const addressFilled = events.filter(e => e.event_type === 'address_filled').length;
    const formSubmitted = events.filter(e => e.event_type === 'form_submitted').length;
    const pixGenerated = events.filter(e => e.event_type === 'pix_generated').length;
    const pixCopied = events.filter(e => e.event_type === 'pix_copied').length;
    const pixRevenue = events.filter(e => e.event_type === 'pix_generated').reduce((s, e) => s + (Number(e.price) || 0), 0);
    const productCount = {};
    events.filter(e => e.event_type === 'pix_generated' && e.product).forEach(e => {
      productCount[e.product] = (productCount[e.product] || 0) + 1;
    });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEvents = events.filter(e => new Date(e.created_at) >= today).length;
    res.json({
      configured: true, total: events.length, pageviews, unique, modalOpened,
      addressFilled, formSubmitted, pixGenerated, pixCopied,
      pixRevenue, productCount, recent, todayEvents
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(path.join(__dirname, '..', 'public')));

module.exports = app;

function configHtml() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Admin - Figurinhas Copa 2026</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Inter,sans-serif;background:#080818;color:#e0e0e0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.10);border-radius:20px;padding:48px 40px;width:640px;max-width:100%}
.card h1{font-size:1.6em;font-weight:800;color:#fff;margin-bottom:20px}
.card ol{color:#aaa;line-height:2;font-size:0.95em;padding-left:20px}
.card ol li strong{color:#fff}
.card code{background:rgba(255,255,255,0.08);padding:2px 8px;border-radius:6px;font-size:0.9em;color:#00d95a}
.card .step{background:rgba(0,217,90,0.06);border:1px solid rgba(0,217,90,0.15);border-radius:12px;padding:16px;margin:16px 0;color:#ccc;font-size:0.9em}
.card .step b{color:#fff}
</style></head>
<body>
<div class="card">
  <h1>⚙️ Configurar Supabase</h1>
  <p style="color:#888;margin-bottom:24px">Para ver as métricas, conecte um banco de dados gratuito sem cartão de crédito.</p>
  <ol>
    <li>Acesse <strong><a href="https://supabase.com" target="_blank" style="color:#00d95a">supabase.com</a></strong> e entre com GitHub</li>
    <li>Crie um novo projeto (nome: <code>figurinhas-copa</code>)</li>
    <li>No SQL Editor, cole e execute:</li>
  </ol>
  <div class="step">
    <b>SQL - Crie a tabela de eventos:</b><br><br>
    <code style="display:block;white-space:pre-wrap;word-break:break-all;font-size:0.78em;line-height:1.5;color:#b4b4b4">
CREATE TABLE events (<br>
  id BIGSERIAL PRIMARY KEY,<br>
  created_at TIMESTAMPTZ DEFAULT NOW(),<br>
  session_id TEXT,<br>
  event_type TEXT,<br>
  product TEXT,<br>
  price NUMERIC,<br>
  transaction_id TEXT,<br>
  referrer TEXT,<br>
  user_agent TEXT,<br>
  ip TEXT<br>
);<br><br>
ALTER TABLE events ENABLE ROW LEVEL SECURITY;<br>
CREATE POLICY "anon_insert" ON events<br>
  FOR INSERT TO anon WITH CHECK (true);
    </code>
  </div>
  <ol start="4">
    <li>Vá em <strong>Settings → API</strong> e copie:</li>
  </ol>
  <div style="margin:12px 0;padding:12px 16px;background:rgba(255,255,255,0.04);border-radius:10px">
    🔗 <strong style="color:#fff">Project URL</strong><br>
    <code style="color:#00d95a;font-size:0.85em">https://xxxxxxxxxxxx.supabase.co</code>
  </div>
  <div style="margin:12px 0;padding:12px 16px;background:rgba(255,255,255,0.04);border-radius:10px">
    🔑 <strong style="color:#fff">service_role key</strong><br>
    <code style="color:#00d95a;font-size:0.85em">eyJhbGciOiJIUzI1NiIs...</code>
  </div>
  <ol start="5">
    <li>Vá no <strong>Vercel</strong> → figurinhas-copa2026 → Settings → Environment Variables</li>
    <li>Adicione:</li>
  </ol>
  <div style="margin:12px 0">
    <div style="display:flex;gap:8px;margin-bottom:6px">
      <code style="background:rgba(0,217,90,0.1);padding:4px 10px;border-radius:6px;flex:1">SUPABASE_URL</code>
      <code style="background:rgba(255,255,255,0.06);padding:4px 10px;border-radius:6px;flex:2;color:#aaa">https://xxx.supabase.co</code>
    </div>
    <div style="display:flex;gap:8px">
      <code style="background:rgba(0,217,90,0.1);padding:4px 10px;border-radius:6px;flex:1">SUPABASE_SERVICE_KEY</code>
      <code style="background:rgba(255,255,255,0.06);padding:4px 10px;border-radius:6px;flex:2;color:#aaa">eyJhbG... (service_role)</code>
    </div>
  </div>
  <ol start="7">
    <li><strong>Redeploy</strong> no Vercel e pronto! 🎉</li>
  </ol>
  <p style="color:#555;font-size:0.82em;margin-top:20px">Após configurar, recarregue esta página.</p>
</div>
</body></html>`;
}

function adminDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Dashboard - Figurinhas Copa 2026</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Inter,sans-serif;background:#080818;color:#e0e0e0;padding:32px;max-width:1200px;margin:0 auto}
h1{font-size:1.8em;font-weight:900;color:#fff;margin-bottom:4px}
.sub{color:#888;font-size:0.85em;margin-bottom:32px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:32px}
.card{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:20px}
.card .num{font-size:2em;font-weight:800;color:#fff;margin-bottom:2px}
.card .label{font-size:0.78em;color:#888;text-transform:uppercase;letter-spacing:0.5px}
.card.green{border-color:rgba(0,217,90,0.25);background:rgba(0,217,90,0.06)}
.card.green .num{color:#00d95a}
.card.yellow{border-color:rgba(255,215,0,0.25);background:rgba(255,215,0,0.06)}
.card.yellow .num{color:#ffd700}
.card.purple{border-color:rgba(155,89,255,0.25);background:rgba(155,89,255,0.06)}
.card.purple .num{color:#9b59ff}
.card.orange{border-color:rgba(255,159,67,0.25);background:rgba(255,159,67,0.06)}
.card.orange .num{color:#ff9f43}
h2{font-size:1.1em;font-weight:700;color:#fff;margin-bottom:16px;margin-top:24px}
.funnel{display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap}
.funnel .bar-wrap{flex:1;min-width:100px;background:rgba(255,255,255,0.06);border-radius:8px;height:36px;position:relative;overflow:hidden}
.funnel .bar{height:100%;border-radius:8px;display:flex;align-items:center;padding-left:12px;font-size:0.78em;font-weight:700;color:#080818;transition:width .5s}
.funnel .step-label{width:130px;font-size:0.82em;color:#ccc}
.funnel .step-val{width:70px;text-align:right;font-size:0.85em;font-weight:700;color:#fff}
table{width:100%;border-collapse:collapse;font-size:0.82em;margin-top:8px}
th{text-align:left;color:#888;font-weight:600;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.06)}
td{padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.04);color:#ccc}
.loading{color:#888;text-align:center;padding:60px 0;font-size:0.9em}
.recarregar{color:#00d95a;cursor:pointer;text-decoration:underline;font-size:0.85em;margin-left:12px}
</style></head>
<body>
<h1>📊 Dashboard</h1>
<div class="sub">Métricas em tempo real <span class="recarregar" onclick="carregar()">↻ recarregar</span></div>
<div class="grid" id="cards"></div>
<h2>🎯 Funil de Conversão</h2>
<div id="funnel"></div>
<h2>📦 Produtos Vendidos</h2>
<div id="produtos"></div>
<h2>🕐 Últimas Atividades</h2>
<div id="tabela"></div>
<script>
async function carregar() {
  document.querySelector('.loading')?.remove();
  try {
    const r = await fetch('/api/admin/metrics');
    const d = await r.json();
    if (d.error) return document.body.innerHTML += '<div class="loading" style="color:#f44">Erro: '+d.error+'</div>';
    if (!d.configured) return;
    document.getElementById('cards').innerHTML = [
      {n:d.pageviews,l:'Visitas',c:'green'},
      {n:d.unique,l:'Visitantes Únicos',c:'yellow'},
      {n:d.todayEvents,l:'Hoje',c:'purple'},
      {n:d.modalOpened,l:'Clicaram Comprar',c:''},
      {n:d.formSubmitted,l:'Finalizaram Cadastro',c:''},
      {n:d.pixGenerated,l:'Geraram Pix',c:'green'},
      {n:d.pixCopied,l:'Copiaram Pix',c:'orange'},
      {n:'R$ '+(d.pixRevenue/100).toFixed(2).replace('.',','),l:'Receita',c:'green'}
    ].map(c => '<div class="card'+(c.c?' '+c.c:'')+'"><div class="num">'+c.n+'</div><div class="label">'+c.l+'</div></div>').join('');
    const steps = [
      {label:'Visitou a página',val:d.pageviews,pct:100},
      {label:'Clicou "Comprar Agora"',val:d.modalOpened,pct:d.pageviews?Math.round(d.modalOpened/d.pageviews*100):0},
      {label:'Preencheu endereço',val:d.addressFilled,pct:d.pageviews?Math.round(d.addressFilled/d.pageviews*100):0},
      {label:'Enviou cadastro',val:d.formSubmitted,pct:d.pageviews?Math.round(d.formSubmitted/d.pageviews*100):0},
      {label:'Gerou Pix',val:d.pixGenerated,pct:d.pageviews?Math.round(d.pixGenerated/d.pageviews*100):0},
      {label:'Copiou o Pix',val:d.pixCopied,pct:d.pageviews?Math.round(d.pixCopied/d.pageviews*100):0}
    ];
    const maxVal = Math.max(...steps.map(s=>s.val), 1);
    document.getElementById('funnel').innerHTML = steps.map(s => {
      const pctW = Math.max(s.val/maxVal*100, 2);
      const barColor = ['#00d95a','#00c04f','#ffd700','#ff9f43','#e74c3c','#9b59ff'][steps.indexOf(s)];
      return '<div class="funnel"><div class="step-label">'+s.label+'</div><div class="bar-wrap"><div class="bar" style="width:'+pctW+'%;background:'+barColor+'">'+(s.val)+'</div></div><div class="step-val">'+s.pct+'%</div></div>';
    }).join('');
    const prods = d.productCount || {};
    document.getElementById('produtos').innerHTML = Object.keys(prods).length
      ? Object.entries(prods).map(([p,c]) => '<div style="margin:4px 0;display:flex;justify-content:space-between;padding:8px 12px;background:rgba(255,255,255,0.04);border-radius:8px;max-width:400px"><span>'+p+'</span><span style="color:#00d95a;font-weight:700">'+c+' vendido'+(c>1?'s':'')+'</span></div>').join('')
      : '<p style="color:#888;font-size:0.85em">Nenhuma venda ainda</p>';
    document.getElementById('tabela').innerHTML = '<table><thead><tr><th>Data</th><th>Evento</th><th>Produto</th><th>Preço</th><th>Session</th></tr></thead><tbody>'+
      (d.recent||[]).slice(0,50).map(e => '<tr><td style="white-space:nowrap">'+new Date(e.created_at).toLocaleString('pt-BR')+'</td><td>'+e.event_type+'</td><td>'+(e.product||'-')+'</td><td>'+(e.price?'R$ '+(e.price/100).toFixed(2).replace('.',','):'-')+'</td><td style="font-size:0.75em;color:#666">'+(e.session_id||'-').slice(0,12)+'</td></tr>').join('')+
      '</tbody></table>';
  } catch(e) {
    document.getElementById('cards').innerHTML = '<div style="color:#f44">Erro ao carregar</div>';
  }
}
carregar();
</script>
</body></html>`;
}
