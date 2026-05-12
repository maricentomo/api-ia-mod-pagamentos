require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

const allowedOrigins = [
  'https://iamod.com.br',
  'https://www.iamod.com.br',
];

if (process.env.NODE_ENV !== 'production') {
  allowedOrigins.push('http://localhost:3000', 'http://localhost:5500', 'http://127.0.0.1:5500');
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS bloqueado para origin: ${origin}`));
    }
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Preços dos planos — fonte única da verdade
const PLANS = {
  essencial: {
    mensal: { title: 'Essencial Mensal',  price: 97,   description: '12x de R$ 97 — Plano Essencial (contrato anual mensal)' },
    anual:  { title: 'Essencial Anual',   price: 970,  description: 'R$ 970 à vista — Plano Essencial (contrato anual)' },
  },
  equipe: {
    mensal: { title: 'Equipe Mensal',     price: 147,  description: '12x de R$ 147 — Plano Equipe (contrato anual mensal)' },
    anual:  { title: 'Equipe Anual',      price: 1470, description: 'R$ 1.470 à vista — Plano Equipe (contrato anual)' },
  },
  completo: {
    mensal: { title: 'Completo Mensal',   price: 247,  description: '12x de R$ 247 — Plano Completo (contrato anual mensal)' },
    anual:  { title: 'Completo Anual',    price: 2470, description: 'R$ 2.470 à vista — Plano Completo (contrato anual)' },
  },
};

app.post('/checkout', async (req, res) => {
  const { planId, billing } = req.body;

  if (!planId || !billing || !PLANS[planId] || !PLANS[planId][billing]) {
    return res.status(400).json({ error: 'Plano ou modalidade inválidos.' });
  }

  const plan = PLANS[planId][billing];
  const siteUrl = process.env.SITE_URL || 'https://iamod.com.br';

  const preference = {
    items: [
      {
        title: plan.title,
        description: plan.description,
        quantity: 1,
        currency_id: 'BRL',
        unit_price: plan.price,
      },
    ],
    back_urls: {
      success: `${siteUrl}?pagamento=sucesso`,
      failure: `${siteUrl}?pagamento=falha`,
      pending: `${siteUrl}?pagamento=pendente`,
    },
    auto_return: 'approved',
    statement_descriptor: 'IA MOD',
  };

  try {
    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MERCADO_PAGO_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(preference),
    });

    const mpData = await mpRes.json();

    if (!mpRes.ok) {
      console.error('Erro MP:', mpData);
      return res.status(500).json({ error: 'Erro ao criar preferência no Mercado Pago.' });
    }

    res.json({ init_point: mpData.init_point });
  } catch (err) {
    console.error('Erro ao chamar MP:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

app.listen(PORT, () => {
  console.log(`API IA Mod rodando na porta ${PORT}`);
});
