# Abel & Beatriz — Site do Casamento 💍

Site do casamento de Abel & Beatriz — 23/01/2027, 16:30, Sítio de Dite (Sanharó, Pindaí-BA).

## Estrutura

| Arquivo | O que é |
|---|---|
| `index.html` | O site completo em um arquivo só (é o que o GitHub Pages publica) |
| `admin/` | Painel dos noivos (login com senha): convidados, presentes e PIX |
| `fonte/` | Código-fonte separado em partes (`index.html`, `app.js`, `default-data.js`, `admin.html`, CSS) e o servidor opcional `server.js` |
| `google-apps-script.gs` | Código da Planilha Google que guarda convidados, presentes e PIX |
| `COMO-ATIVAR-LISTA-DE-CONFIRMADOS.txt` | Passo a passo para ligar o painel |

## Painel dos noivos — `/admin`

Abra `…/admin/` e entre com a senha para:

- ver quem confirmou presença (acompanhantes, recados, totais, baixar em Excel);
- adicionar, editar e excluir presentes (com foto) — aparecem no site na hora;
- configurar a chave PIX e o link do Casar.com.

Os dados ficam numa Planilha Google dos noivos (veja `COMO-ATIVAR-LISTA-DE-CONFIRMADOS.txt`).

Textos e fotos do site: abra o site com `?admin` no final do endereço, use **Editar Site** e depois **⬇️ Baixar HTML** para gerar o novo `index.html`.

> ⚠️ Nunca coloque a senha real neste repositório — ela fica só no Google Apps Script.
