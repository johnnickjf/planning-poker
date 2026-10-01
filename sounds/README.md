# Sons

## Sons automáticos (máx. 3 s)

Tocam sozinhos quando o evento acontece. O mapa evento → arquivo fica em `SONS_AUTOMATICOS` (`js/sound.js`):

| Evento                              | Arquivo           |
|-------------------------------------|-------------------|
| Todos os votos iguais (consenso)    | `consensus.mp3`   |
| Todos os votos diferentes           | `reveal.mp3`      |
| Nova votação                        | `newround.mp3`    |
| Alguém entrou na sala               | `join.mp3`        |
| Arremesso: papelzinho               | `paper.mp3`       |
| Arremesso: aviãozinho               | `plane.mp3`       |
| Arremesso: ovo                      | `egg.mp3`         |
| Arremesso: coração                  | `heart.mp3`       |
| Arremesso: dardo                    | `dart.mp3`        |
| Arremesso: emoji 😀 (botão principal) | `emoji.mp3`     |

Votar, revelar e os emojis pequenos do seletor não têm som.
Para tirar o som de um evento, apague a linha dele em `SONS_AUTOMATICOS`; para trocar, aponte para outro arquivo.

## Soundboard (máx. 5 s)

Botão **Sons** no cabeçalho da sala: lista **todos** os arquivos (inclusive os usados nos eventos) e
quem clica toca o som para a sala inteira. A lista (arquivo, nome e emoji de cada botão) fica em
`SOUNDBOARD` no `js/state.js`. Os sons exclusivos da soundboard ficam em `sounds/soundboard/`.

## Detalhes

- Todos começam **mudos** para cada pessoa; o botão 🔇 pisca quando algum som tocaria.
- O volume de cada arquivo é normalizado e o que passar do limite é cortado com fade-out
  (`DURACAO_MAXIMA` em `js/sound.js`).
- Cada arquivo é baixado uma única vez, mesmo usado em vários lugares.
- Arquivo ausente = silêncio, sem quebrar o app.
