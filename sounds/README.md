# Sons

Coloque aqui os arquivos MP3 com **exatamente** estes nomes:

| Arquivo          | Quando toca                                   |
|------------------|-----------------------------------------------|
| `egg.mp3`        | Ovo atinge o alvo                             |
| `paper.mp3`      | Papelzinho atinge o alvo                      |
| `plane.mp3`      | Aviãozinho é lançado                          |
| `heart.mp3`      | Coração atinge o alvo                         |
| `dart.mp3`       | Dardo crava na carta                          |
| `reveal.mp3`     | Votos revelados                               |
| `vote.mp3`       | Alguém votou                                  |
| `join.mp3`       | Alguém entrou na sala                         |
| `newround.mp3`   | Nova votação iniciada                         |
| `consensus.mp3`  | Consenso (todos votaram igual)                |

Se algum arquivo estiver faltando, o app segue funcionando em silêncio para aquele evento.
O mapeamento fica no objeto `SONS` em `js/sound.js`. Para dar som a um item novo, adicione a
chave lá e use o mesmo nome no campo `som` do item em `ITENS_ARREMESSO` (`js/state.js`).

Dica: arquivos curtos (menos de 2 s) e leves (menos de 50 KB) funcionam melhor.
