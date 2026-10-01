# Sons

```
sounds/
├── eventos/      sons automáticos da sala
├── arremessos/   sons dos 6 itens arremessáveis
└── soundboard/   sons exclusivos da soundboard (memes e efeitos)
```

## Sons automáticos (máx. 3 s)

Tocam sozinhos quando o evento acontece. O mapa evento → arquivo fica em `SONS_AUTOMATICOS` (`js/sound.js`):

| Evento                                | Arquivo                       |
|---------------------------------------|-------------------------------|
| Todos os votos iguais (consenso)      | `eventos/consenso.mp3`        |
| Todos os votos diferentes             | `eventos/divergencia.mp3`     |
| Nova votação                          | `eventos/nova-rodada.mp3`     |
| Alguém entrou na sala                 | `eventos/entrada.mp3`         |
| Arremesso: papelzinho                 | `arremessos/papel.mp3`        |
| Arremesso: aviãozinho                 | `arremessos/aviao.mp3`        |
| Arremesso: ovo                        | `arremessos/ovo.mp3`          |
| Arremesso: coração                    | `arremessos/coracao.mp3`      |
| Arremesso: dardo                      | `arremessos/dardo.mp3`        |
| Arremesso: emoji 😀 (botão principal) | `arremessos/emoji.mp3`        |

`eventos/voto.mp3` não toca sozinho (votar não tem som), mas está na soundboard.
Votar, revelar e os emojis pequenos do seletor não têm som.

## Soundboard (máx. 5 s)

Botão **Sons** no cabeçalho da sala. Lista **todos** os sons, em três grupos: *Memes*, *Efeitos* e
*Sons da sala* (os automáticos). Quem clica toca o som para a sala inteira.

Para adicionar um som novo:
1. Coloque o MP3 em `sounds/soundboard/` (nome em minúsculas, com hífens: `meu-som.mp3`).
2. Inclua uma linha em `SOUNDBOARD` no `js/state.js`:
   ```js
   { id: 'sb-meu-som', arquivo: 'sounds/soundboard/meu-som.mp3', rotulo: 'Meu som', emoji: '🔊', grupo: 'Memes' },
   ```

## Detalhes

- Todos começam **mudos** para cada pessoa; o botão 🔇 pisca quando algum som tocaria.
- O volume de cada arquivo é normalizado e o que passar do limite é cortado com fade-out
  (`DURACAO_MAXIMA` em `js/sound.js`).
- Cada arquivo é baixado uma única vez, mesmo usado em vários lugares.
- Arquivo ausente = silêncio, sem quebrar o app.
