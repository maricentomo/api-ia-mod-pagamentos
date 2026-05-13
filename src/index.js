require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3001;
const SPREADSHEET_ID = '1Ob3_WW_oprXPWkJ-4_z2ac4OneKOAqyAFnDRLSyNh1o';

const allowedOrigins = [
  'https://iamod.com.br',
  'https://www.iamod.com.br',
];
if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.push('http://localhost:3000', 'http://localhost:5500', 'http://127.0.0.1:5500');
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error(`CORS bloqueado para origin: ${origin}`));
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// ── Google Sheets ──────────────────────────────
const getSheets = () => {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON não configurado');
  const credentials = JSON.parse(raw);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
};

const saveToSheet = async (sheetName, row) => {
  try {
    const sheets = getSheets();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:I`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [row] },
    });
    console.log(`Salvo na aba "${sheetName}":`, row[1], row[2]);
  } catch (err) {
    console.error('Erro ao salvar na planilha:', err.message);
  }
};

const now = () => new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

// ── Planos ─────────────────────────────────────
const PLANS = {
  essencial: {
    mensal: { title: 'Essencial Mensal',  price: 97,   impl: 197, description: '12x de R$ 97 — Plano Essencial (contrato anual mensal)' },
    anual:  { title: 'Essencial Anual',   price: 970,  impl: 0,   description: 'R$ 970 à vista — Plano Essencial (contrato anual)' },
  },
  equipe: {
    mensal: { title: 'Equipe Mensal',     price: 147,  impl: 297, description: '12x de R$ 147 — Plano Equipe (contrato anual mensal)' },
    anual:  { title: 'Equipe Anual',      price: 1470, impl: 0,   description: 'R$ 1.470 à vista — Plano Equipe (contrato anual)' },
  },
  completo: {
    mensal: { title: 'Completo Mensal',   price: 247,  impl: 497, description: '12x de R$ 247 — Plano Completo (contrato anual mensal)' },
    anual:  { title: 'Completo Anual',    price: 2470, impl: 0,   description: 'R$ 2.470 à vista — Plano Completo (contrato anual)' },
  },
  brandkit: {
    avista: { title: 'Brand Kit Completo', price: 700, impl: 0,   description: 'Brand Kit Completo — Logo, cores, fontes, mascote, pack Canva e artes para gráfica' },
  },
};

const SHEET_NAME  = (planId) => planId === 'brandkit' ? 'Brand Kit' : 'Agenda';
const BILLING_LABEL = { mensal: 'Mensal', anual: 'Anual à vista', avista: 'À vista' };

const mpPost = async (url, token, body) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { ok: res.ok, data };
};

// ── Health ─────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true }));

// ── Checkout ───────────────────────────────────
app.post('/checkout', async (req, res) => {
  const { planId, billing, customer = {} } = req.body;

  if (!planId || !billing || !PLANS[planId] || !PLANS[planId][billing]) {
    return res.status(400).json({ error: 'Plano ou modalidade inválidos.' });
  }

  const plan    = PLANS[planId][billing];
  const siteUrl = process.env.SITE_URL || 'https://iamod.com.br';
  const token   = process.env.MERCADO_PAGO_ACCESS_TOKEN;

  try {
    let initPoint = null;
    let pedidoId  = null;

    if (billing === 'mensal') {
      // 1️⃣ Cria a assinatura mensal (12x)
      const { ok: subOk, data: subData } = await mpPost(
        'https://api.mercadopago.com/preapproval_plan',
        token,
        {
          reason: plan.title,
          back_url: `${siteUrl}/obrigado.html?plan=${planId}&billing=mensal`,
          auto_recurring: {
            frequency: 1,
            frequency_type: 'months',
            repetitions: 12,
            transaction_amount: plan.price,
            currency_id: 'BRL',
          },
        }
      );
      if (!subOk) {
        console.error('Erro MP preapproval_plan:', subData);
        return res.status(500).json({ error: 'Erro ao criar assinatura no Mercado Pago.' });
      }
      const subscriptionUrl = subData.init_point;

      // 2️⃣ Cria preferência da taxa de implementação (pagamento único)
      //    Após pagar, redireciona para obrigado.html que mostra botão da assinatura
      const successUrl = `${siteUrl}/assinar.html?plan=${planId}&sub=${encodeURIComponent(subscriptionUrl)}`;
      const { ok: implOk, data: implData } = await mpPost(
        'https://api.mercadopago.com/checkout/preferences',
        token,
        {
          items: [{
            title: `Implementação — Plano ${plan.title}`,
            description: `Taxa de implementação única do ${plan.title}`,
            quantity: 1,
            currency_id: 'BRL',
            unit_price: plan.impl,
          }],
          back_urls: {
            success: successUrl,
            failure: `${siteUrl}?pagamento=falha`,
            pending: `${siteUrl}?pagamento=pendente`,
          },
          auto_return: 'approved',
          statement_descriptor: 'IA MOD',
        }
      );
      if (!implOk) {
        console.error('Erro MP impl preference:', implData);
        return res.status(500).json({ error: 'Erro ao criar preferência de implementação.' });
      }
      initPoint = implData.init_point;
      pedidoId  = implData.id || '';

    } else {
      // Anual à vista ou brandkit — pagamento único
      const { ok, data: mpData } = await mpPost(
        'https://api.mercadopago.com/checkout/preferences',
        token,
        {
          items: [{ title: plan.title, description: plan.description, quantity: 1, currency_id: 'BRL', unit_price: plan.price }],
          back_urls: {
            success: `${siteUrl}/obrigado.html?plan=${planId}&billing=${billing}`,
            failure: `${siteUrl}?pagamento=falha`,
            pending: `${siteUrl}?pagamento=pendente`,
          },
          auto_return: 'approved',
          statement_descriptor: 'IA MOD',
        }
      );
      if (!ok) {
        console.error('Erro MP preferences:', mpData);
        return res.status(500).json({ error: 'Erro ao criar preferência no Mercado Pago.' });
      }
      initPoint = mpData.init_point;
      pedidoId  = mpData.id || '';
    }

    // Salva na planilha
    await saveToSheet(SHEET_NAME(planId), [
      now(),
      customer.name  || '',
      customer.email || '',
      customer.phone || '',
      plan.title,
      `R$ ${plan.price.toLocaleString('pt-BR')}`,
      BILLING_LABEL[billing] || billing,
      'Pendente',
      pedidoId,
    ]);

    res.json({ init_point: initPoint });

  } catch (err) {
    console.error('Erro interno:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

app.listen(PORT, () => console.log(`API IA Mod rodando na porta ${PORT}`));
