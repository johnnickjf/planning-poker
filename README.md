# 🃏 Planning Poker em tempo real

Planning Poker para até **10 pessoas por sala**, feito só com **HTML, CSS e JavaScript puro**
(ES Modules, sem frameworks, sem build, sem npm). Não tem backend nem banco de dados: o estado vive
na memória dos navegadores e a comunicação é **P2P via WebRTC** usando [PeerJS](https://peerjs.com/).

- Crie uma sala sem login e compartilhe o link (`…/#sala=ABC123`).
- Quem abre o link só digita o nome e entra.
- Vote com o baralho Fibonacci (`0 1 2 3 5 8 13 21 34 55 89 ? ☕`), revele e veja média, mediana,
  moda e consenso (com confete 🎉).
- Clique na carta de um colega para arremessar papelzinho, aviãozinho, ovo, coração, dardo ou
  qualquer emoji.
- Efeitos sonoros locais (começam mudos; o botão pisca quando algo toca) e uma **soundboard**
  para tocar sons para a sala inteira.

---

## Como funciona (arquitetura P2P)

```
             ┌──────────── servidor de signaling público do PeerJS ────────────┐
             │   (só serve para os navegadores se encontrarem; não vê o jogo)   │
             └──────────────────────────────────────────────────────────────────┘
                                         │
       cliente ◀──WebRTC──▶  HOST (estado oficial)  ◀──WebRTC──▶ cliente
                                ▲               ▲
                         WebRTC │               │ WebRTC
                             cliente         cliente
```

- **Topologia estrela.** Quem cria a sala é o **host**: registra o Peer ID
  `planning-poker-{roomId}` no servidor público do PeerJS e guarda o estado oficial.
  Os clientes se conectam **só ao host**, mandam ações (`vote`, `reveal`, `throw`…), e o host
  valida, atualiza o estado e retransmite o **estado completo** para todos.
- **STUN do Google** (`stun.l.google.com:19302`) ajuda os navegadores a atravessar NAT.
- **Votos ocultos.** Antes da revelação, o host envia aos clientes apenas *se* cada pessoa votou,
  nunca o valor. Abrir o DevTools não mostra o voto dos outros.
- **Identidade sem banco.** Cada navegador tem um `playerId` (UUID) no `localStorage`, junto com o
  último nome usado. Após F5 ou queda de rede, o cliente reconecta e o host o reconhece pelo
  `playerId`, devolvendo o mesmo lugar, nome e voto. O host espera **10 s** antes de remover quem
  caiu. Publicamente cada jogador é identificado por um `seatId` diferente, então ninguém consegue
  "sequestrar" o lugar de outra pessoa copiando IDs do estado.
- **Duas abas no mesmo navegador** viram jogadores diferentes: uma aba percebe (via
  `BroadcastChannel`) que outra já usa o `playerId` e gera uma identidade própria.
- **Host recarregou a página (F5)?** A aba lembra (via `sessionStorage`) que é host, recria a sala
  com o mesmo código e os clientes reconectam sozinhos em poucos segundos. Os votos da rodada se
  perdem. Se o host **fechar a aba**, os clientes veem "A sala foi encerrada porque o host saiu".
- **Rate limit** de arremessos no host: no máximo 5 por pessoa a cada 5 segundos.

### Protocolo

Mensagens JSON com campo `type`. A documentação completa está no topo de `js/network.js`.

| Direção         | Tipos                                                                   |
|-----------------|-------------------------------------------------------------------------|
| cliente → host  | `info`, `hello`, `vote`, `clearVote`, `reveal`, `newRound`, `throw`, `sound`, `leave`, `ping` |
| host → cliente  | `info`, `welcome`, `state`, `event`, `throw`, `sound`, `reject`, `roomClosed`, `hostLeaving`, `ping` |

O host é a única fonte de verdade e ignora mensagens inválidas (tipo desconhecido, mais de 1 KB,
jogador inexistente, valor fora do baralho, item desconhecido etc.).

### Estrutura

```
/
├── index.html
├── css/style.css
├── js/
│   ├── app.js        inicialização, identidade, roteamento por hash, telas
│   ├── network.js    PeerJS, host/cliente, protocolo, heartbeat e reconexão
│   ├── state.js      estado da sala, estatísticas e configurações compartilhadas
│   ├── ui.js         renderização, baralho, menu e animações de arremesso, confete
│   └── sound.js      gerenciador de áudio (Web Audio API)
├── sounds/           eventos/, arremessos/ e soundboard/ (veja sounds/README.md)
└── README.md
```

### Configurações rápidas

| Onde              | Constante                     | Para quê                                      |
|-------------------|-------------------------------|-----------------------------------------------|
| `js/state.js`     | `SOMENTE_HOST_CONTROLA`       | `true` = só o host revela / inicia nova votação |
| `js/state.js`     | `MAX_JOGADORES`, `MAX_NOME`   | Limites da sala e dos nomes                   |
| `js/state.js`     | `BARALHO`                     | Cartas disponíveis                            |
| `js/state.js`     | `ITENS_ARREMESSO`, `EMOJIS_RAPIDOS` | Itens arremessáveis (fácil de estender) |
| `js/state.js`     | `LIMITE_ARREMESSOS`           | Rate limit de arremessos                      |
| `js/network.js`   | `TIMEOUT_CONEXAO_MS`, `TOLERANCIA_DESCONEXAO_MS`, `JANELA_RECONEXAO_MS` | Timeouts |
| `js/sound.js`     | `SONS`                        | Mapa evento → arquivo MP3                     |

---

## Testar localmente

ES Modules **não funcionam via `file://`**, então sirva a pasta por HTTP:

```bash
python -m http.server 8000
```

Abra `http://localhost:8000`, crie uma sala, copie o link e abra-o em **outra aba** (ou em outro
navegador / janela anônima). Duas abas do mesmo navegador funcionam como duas pessoas diferentes.

Alternativa: a extensão **Live Server** do VS Code (botão "Go Live").

> É preciso internet mesmo no teste local: o PeerJS é carregado do unpkg e o signaling usa o
> servidor público `0.peerjs.com`.

Para testar no celular na mesma rede, acesse `http://SEU-IP:8000`. Alguns navegadores móveis exigem
HTTPS para WebRTC; nesse caso teste direto pelo GitHub Pages.

---

## Publicar no GitHub Pages

1. Crie um repositório no GitHub (ex.: `planning-poker`).
2. Envie os arquivos para a branch `main`:
   ```bash
   git init
   git add .
   git commit -m "Planning Poker"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/planning-poker.git
   git push -u origin main
   ```
3. No repositório: **Settings → Pages**.
4. Em **Build and deployment → Source**, escolha **Deploy from a branch**.
5. Selecione a branch **`main`** e a pasta **`/ (root)`**, depois clique em **Save**.
6. Aguarde 1 ou 2 minutos. O site fica em `https://SEU-USUARIO.github.io/planning-poker/`.
7. Para adicionar sons novos depois, veja `sounds/README.md` (commit + push).

Tudo usa caminhos relativos e roteamento por `#`, por isso funciona na subpasta `/planning-poker/`
sem configuração extra.

---

## Sons (`sounds/`)

Os áudios ficam em `sounds/eventos/` (automáticos da sala), `sounds/arremessos/` (itens arremessáveis)
e `sounds/soundboard/` (memes e efeitos). A lista completa e como adicionar novos sons estão em
[`sounds/README.md`](sounds/README.md).

- Cada navegador toca os sons localmente; pela rede só trafega o evento.
- Todo mundo começa com o som **mudo**; o botão 🔇 pisca quando algum som tocaria.
- Os sons só tocam depois da primeira interação com a página (política de autoplay dos navegadores).
- Arquivo ausente = silêncio, sem quebrar o app.
- Mudo e volume ficam salvos no `localStorage`.

---

## Limitações conhecidas

- **A sala morre se o host sair.** Não há migração de host nem persistência. Se o host fechar a aba,
  todos voltam para a tela "sala encerrada". Um F5 do host recria a sala, mas os votos da rodada se perdem.
- **Redes restritivas podem bloquear o WebRTC.** Redes corporativas, VPNs e alguns firewalls
  bloqueiam conexões P2P/UDP. Só há STUN (sem TURN), então se os dois lados estiverem atrás de NAT
  simétrico a conexão pode falhar. Para esses casos é preciso configurar um servidor TURN em
  `OPCOES_PEER.config.iceServers` (`js/network.js`).
- **Servidor de signaling público.** O `0.peerjs.com` é gratuito e compartilhado: pode ficar
  instável ou fora do ar. Dá para hospedar seu próprio
  [PeerServer](https://github.com/peers/peerjs-server) e apontar o PeerJS para ele.
- **Abas em segundo plano.** Navegadores reduzem timers de abas inativas; em casos extremos uma aba
  esquecida por muito tempo pode cair e reconectar.
- **Limite de 10 pessoas**, já que o host retransmite tudo para todos.
- A identificação por `playerId` não é autenticação: serve para conveniência entre colegas, não
  para cenários hostis.
