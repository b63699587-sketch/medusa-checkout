const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const SECRET_KEY = process.env.MEDUSA_SECRET_KEY;
const BASE_URL = process.env.BASE_URL || 'https://medusa-checkout.vercel.app';
const MEDUSA_API = 'https://api.v2.medusapay.com.br/v1';

function authHeader() {
  const basic = Buffer.from(`${SECRET_KEY}:x`).toString('base64');
  return { authorization: `Basic ${basic}`, 'content-type': 'application/json' };
}

function makeRef() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
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

app.use(express.static(path.join(__dirname, '..', 'public')));

module.exports = app;
