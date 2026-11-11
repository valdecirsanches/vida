# 🌳 Raízes

Histórias de família guardadas na voz de quem viveu. Toda semana o Raízes manda uma pergunta **em áudio pelo WhatsApp** para o idoso. Ele responde com áudio, a IA faz perguntas de aprofundamento e, no fim, cada conversa vira um capítulo de livro com **QR code que toca a voz original**.

## O que está incluído

| Parte | Rota | Descrição |
|---|---|---|
| Site de vendas | `/` | Landing page, preços, FAQ e lista de espera |
| Painel da família | `/app` | Cadastro/login, pessoas, histórias, conversas, edição, planos, admin |
| Gravação do idoso | `/g/:token` | Botão gigante de gravar, alternativa ao WhatsApp |
| Ouvir história | `/ouvir/:token` | Página aberta pelo QR code do livro (player + texto) |
| Livro | `/livro/:id` | Livro A5 pronto para imprimir/salvar PDF, com sumário e QR codes |
| Webhook WhatsApp | `POST /webhooks/waha/:secret` | Recebe mensagens, áudios e ligações do WAHA |
| Webhook pagamento | `POST /webhooks/mercadopago` | Ativa o plano anual quando o pagamento é aprovado |

**Stack:** Node.js 20.6+ (Express 5) · MySQL/MariaDB (ou SQLite para desenvolvimento) · WAHA · Claude · OpenAI (transcrição e voz) · Mercado Pago. Sem build de frontend: HTML/CSS/JS puros em `public/`.

## Como a conversa funciona

1. A família cadastra a pessoa e clica em **Enviar convite**. O idoso recebe uma mensagem explicando o Raízes e aceita respondendo **SIM**.
2. No dia/horário escolhido, chega a pergunta (texto + **áudio com voz calma**). O banco tem ~40 perguntas em 10 capítulos da vida, e o Claude adapta cada uma ao contexto informado (e pula temas sensíveis).
3. O idoso responde com um ou vários áudios. O sistema espera `DEBOUNCE_SECONDS` de silêncio, transcreve e responde com um comentário específico + uma pergunta de aprofundamento (`FOLLOW_UPS` vezes).
4. Ao final, agradece e o Claude escreve a história **em primeira pessoa, fiel ao relato**. A família recebe aviso no WhatsApp com o link.
5. Sem resposta em 48h: um único lembrete. Parada há 96h: fecha e gera a história com o que tiver.
6. Comandos do idoso: **PARAR**, **PAUSAR**, **VOLTAR**. Se ele **ligar**, a chamada é recusada e ele recebe um pedido para mandar áudio. A API do WAHA não faz nem atende ligações com áudio, por isso o fluxo é por mensagens de voz.

Áudios espontâneos (fora de uma pergunta) também viram história, no capítulo "Histórias soltas".

## Instalação

```bash
cp .env.example .env      # preencha as chaves
npm install
npm start                 # http://localhost:3000
```

Na primeira execução o app cria o banco `DB_NAME` (se `DB_CREATE_DATABASE=true`) e todas as tabelas.

### Banco MySQL

O `.env.example` já aponta para `192.168.15.160`. Esse é um IP de rede local: **o servidor do app precisa estar na mesma rede** (ou com VPN/túnel até ela). Se você publicar o app num VPS fora da sua rede, use um MySQL acessível de lá. Sem `DB_HOST`, o app usa SQLite em `data/raizes.db`.

Os **áudios ficam em `DATA_DIR/audio`**, não no banco. Faça backup dessa pasta junto com o MySQL.

### WhatsApp (WAHA)

1. A sessão `WAHA_SESSION` precisa estar `WORKING` (QR code escaneado no painel do WAHA). Use um número dedicado ao Raízes.
2. Com o app publicado em HTTPS e `PUBLIC_URL` correto, rode:
   ```bash
   npm run setup:waha
   ```
   Isso adiciona o webhook do Raízes (eventos `message` e `call.received`) **mantendo os webhooks que já existem** na sessão.
3. O envio de áudio usa `POST /api/sendVoice` em OGG/Opus. Se o seu WAHA não permitir envio de mídia, o texto da pergunta sai normalmente e o app registra um aviso no log.

### IA

- `ANTHROPIC_API_KEY`: conversa e escrita das histórias. Sem ela, o app usa perguntas genéricas e a história fica com a transcrição bruta.
- `OPENAI_API_KEY`: transcrição dos áudios e voz das perguntas. Sem ela, os áudios são guardados mas não transcritos, e as perguntas saem só em texto.

### Pagamentos

Com `MP_ACCESS_TOKEN`, os botões de assinatura e livro abrem o Checkout Pro do Mercado Pago (Pix, cartão, boleto). O webhook confere o pagamento direto na API do Mercado Pago antes de ativar o plano por 1 ano. Os pedidos de **livro impresso** ficam na tela Admin com o endereço. Basta abrir `/livro/:id`, salvar em PDF e mandar para a gráfica.

## Publicação

```bash
docker compose up -d --build
```

Coloque atrás de um proxy HTTPS (Nginx, Caddy, Traefik). O webhook do WAHA e os QR codes dependem de `PUBLIC_URL` correto.

## Estrutura

```
src/
  server.js          rotas e inicialização
  config.js          variáveis de ambiente
  db.js              MySQL/SQLite (mesma API assíncrona)
  conversation.js    motor de conversa + agendador (a cada 5 min)
  questions.js       banco de perguntas por capítulo
  ai.js              Claude + OpenAI
  waha.js            cliente da API do WAHA
  payments.js        Mercado Pago
  routes/            api (painel), public (gravação, ouvir, webhooks), book (livro)
public/              landing, painel, gravação, ouvir
```

## Segurança

- Troque `SESSION_SECRET` e `WAHA_WEBHOOK_SECRET` por valores longos e aleatórios.
- Use senhas fortes e diferentes para o MySQL e para a chave do WAHA.
- Links de gravação e de histórias usam tokens aleatórios e não são indexados (`noindex`).
