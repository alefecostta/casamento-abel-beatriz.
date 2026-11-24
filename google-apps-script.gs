/**
 * PAINEL DO CASAMENTO — Abel & Beatriz
 * Guarda: confirmações de presença, lista de presentes e dados de pagamento (PIX / Casar.com).
 *
 * Como instalar (passo a passo completo em COMO-ATIVAR-LISTA-DE-CONFIRMADOS.txt):
 *   Planilha Google > Extensões > Apps Script > cole este código > Salvar
 *   Implantar > Nova implantação > App da Web > Executar como: Eu > Quem pode acessar: Qualquer pessoa
 *
 * A senha do painel /admin fica SOMENTE aqui (nunca no site nem no GitHub).
 */
const SENHA = 'troque-esta-senha';

const ABA_RSVP = 'Confirmações';
const ABA_PRESENTES = 'Presentes';
const ABA_CONFIG = 'Configurações';
const CAB_RSVP = ['ID', 'Data', 'Nome', 'Vai comparecer?', 'Nº de pessoas', 'Acompanhantes', 'Recado'];
const CAB_PRESENTES = ['ID', 'Nome', 'Preço', 'Categoria', 'Imagem'];
const CAB_CONFIG = ['Chave', 'Valor'];
const CONFIG_CHAVES = ['pixKey', 'pixHolder', 'casarUrl'];
const FUSO = 'America/Sao_Paulo';

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
function aba_(nome, cabecalho) {
  const planilha = SpreadsheetApp.getActiveSpreadsheet();
  let aba = planilha.getSheetByName(nome);
  if (!aba) {
    aba = planilha.insertSheet(nome);
    aba.appendRow(cabecalho);
    aba.getRange(1, 1, 1, cabecalho.length).setFontWeight('bold').setBackground('#e9d4cf');
    aba.setFrozenRows(1);
  }
  return aba;
}

function linhas_(aba) {
  return aba.getDataRange().getValues().slice(1);
}

// Evita que texto digitado por alguém vire fórmula na planilha
function texto_(v, max) {
  let t = String(v == null ? '' : v).trim().slice(0, max);
  if (/^[=+\-@]/.test(t)) t = "'" + t;
  return t;
}

function semApostrofo_(v) {
  const t = String(v == null ? '' : v);
  return t.charAt(0) === "'" ? t.slice(1) : t;
}

function data_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, FUSO, 'dd/MM/yyyy HH:mm');
  return String(v || '');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Bloqueia por 15 minutos depois de 15 senhas erradas
function conferirSenha_(senha) {
  const cache = CacheService.getScriptCache();
  const falhas = Number(cache.get('falhas_senha') || 0);
  if (falhas >= 15) throw new Error('Muitas tentativas erradas. Aguarde 15 minutos.');
  if (String(senha || '') !== SENHA) {
    cache.put('falhas_senha', String(falhas + 1), 900);
    throw new Error('Senha incorreta.');
  }
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------
function listarConfirmacoes_() {
  return linhas_(aba_(ABA_RSVP, CAB_RSVP))
    .filter(function (r) { return r[0] !== '' || r[2] !== ''; })
    .map(function (r) {
      return {
        id: String(r[0]),
        createdAt: data_(r[1]),
        name: semApostrofo_(r[2]),
        attendance: String(r[3]),
        count: Number(r[4]) || 0,
        companions: semApostrofo_(r[5]),
        message: semApostrofo_(r[6])
      };
    })
    .reverse();
}

function listarPresentes_() {
  return linhas_(aba_(ABA_PRESENTES, CAB_PRESENTES))
    .filter(function (r) { return r[1] !== ''; })
    .map(function (r) {
      return {
        id: Number(r[0]),
        title: semApostrofo_(r[1]),
        price: Number(r[2]) || 0,
        category: semApostrofo_(r[3]),
        img: String(r[4] || '')
      };
    });
}

function lerConfig_() {
  const cfg = {};
  linhas_(aba_(ABA_CONFIG, CAB_CONFIG)).forEach(function (r) {
    if (CONFIG_CHAVES.indexOf(String(r[0])) >= 0) cfg[String(r[0])] = semApostrofo_(r[1]);
  });
  return cfg;
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------
function linhaPresente_(g, id) {
  const preco = Math.max(0, Math.round((Number(String(g.price).replace(',', '.')) || 0) * 100) / 100);
  let img = String(g.img || '');
  if (!/^(data:image\/|https:\/\/)/.test(img)) img = '';
  if (img.length > 49000) throw new Error('A foto é grande demais. Use uma imagem menor.');
  return [id, texto_(g.title, 150), preco, texto_(g.category || 'Outros', 60), img];
}

function salvarPresente_(g) {
  if (!g || !String(g.title || '').trim()) throw new Error('O presente precisa de um nome.');
  const aba = aba_(ABA_PRESENTES, CAB_PRESENTES);
  const dados = linhas_(aba);
  const id = Number(g.id) || 0;
  for (let i = 0; i < dados.length; i++) {
    if (Number(dados[i][0]) === id && id) {
      aba.getRange(i + 2, 1, 1, CAB_PRESENTES.length).setValues([linhaPresente_(g, id)]);
      return id;
    }
  }
  const novoId = dados.reduce(function (m, r) { return Math.max(m, Number(r[0]) || 0); }, 0) + 1;
  aba.appendRow(linhaPresente_(g, novoId));
  return novoId;
}

function apagarLinhaPorId_(aba, id) {
  const dados = linhas_(aba);
  for (let i = 0; i < dados.length; i++) {
    if (String(dados[i][0]) === String(id)) {
      aba.deleteRow(i + 2);
      return true;
    }
  }
  return false;
}

function importarPresentes_(lista) {
  if (!Array.isArray(lista) || !lista.length) throw new Error('Lista vazia.');
  const aba = aba_(ABA_PRESENTES, CAB_PRESENTES);
  const ultima = aba.getLastRow();
  if (ultima > 1) aba.deleteRows(2, ultima - 1);
  const linhas = lista.slice(0, 500).map(function (g, i) { return linhaPresente_(g, Number(g.id) || i + 1); });
  aba.getRange(2, 1, linhas.length, CAB_PRESENTES.length).setValues(linhas);
  return linhas.length;
}

function salvarConfig_(cfg) {
  const aba = aba_(ABA_CONFIG, CAB_CONFIG);
  const ultima = aba.getLastRow();
  if (ultima > 1) aba.deleteRows(2, ultima - 1);
  const linhas = CONFIG_CHAVES.map(function (k) { return [k, texto_(cfg && cfg[k], 300)]; });
  aba.getRange(2, 1, linhas.length, 2).setValues(linhas);
}

function registrarConfirmacao_(d) {
  const nome = texto_(d.name, 100);
  if (!nome) throw new Error('Nome obrigatório.');
  const acompanhantes = (Array.isArray(d.companions) ? d.companions : [])
    .slice(0, 20)
    .map(function (c) { return texto_(c, 100); })
    .filter(function (c) { return c; });
  const vai = d.attendance === 'Sim';
  aba_(ABA_RSVP, CAB_RSVP).appendRow([
    Utilities.getUuid(),
    Utilities.formatDate(new Date(), FUSO, 'dd/MM/yyyy HH:mm'),
    nome,
    vai ? 'Sim' : 'Não',
    vai ? Math.max(1, Math.min(20, parseInt(d.count, 10) || 1)) : 0,
    acompanhantes.join(', '),
    texto_(d.message, 1000)
  ]);
}

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------
// GET público: o site busca a lista de presentes e os dados de pagamento
function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.action === 'public') {
      return json_({ ok: true, gifts: listarPresentes_(), config: lerConfig_() });
    }
    if (p.action === 'list') {
      conferirSenha_(p.key);
      return json_({ ok: true, rows: listarConfirmacoes_() });
    }
    return json_({ ok: true, info: 'API do casamento Abel & Beatriz funcionando.' });
  } catch (err) {
    return json_({ ok: false, error: err.message });
  }
}

// POST: confirmação de presença (público) e ações do painel /admin (exigem senha)
function doPost(e) {
  let d;
  try {
    d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Dados inválidos.' });
  }
  const acao = d.action || 'rsvp';
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (acao === 'rsvp') {
      registrarConfirmacao_(d);
      return json_({ ok: true });
    }

    conferirSenha_(d.key);

    switch (acao) {
      case 'login':
        return json_({ ok: true });
      case 'adminData':
        return json_({ ok: true, rsvps: listarConfirmacoes_(), gifts: listarPresentes_(), config: lerConfig_() });
      case 'saveGift':
        return json_({ ok: true, id: salvarPresente_(d.gift) });
      case 'deleteGift':
        return json_({ ok: apagarLinhaPorId_(aba_(ABA_PRESENTES, CAB_PRESENTES), d.id) });
      case 'importGifts':
        return json_({ ok: true, count: importarPresentes_(d.gifts) });
      case 'deleteRsvp':
        return json_({ ok: apagarLinhaPorId_(aba_(ABA_RSVP, CAB_RSVP), d.id) });
      case 'saveConfig':
        salvarConfig_(d.config);
        return json_({ ok: true });
      default:
        return json_({ ok: false, error: 'Ação desconhecida.' });
    }
  } catch (err) {
    return json_({ ok: false, error: err.message });
  } finally {
    lock.releaseLock();
  }
}
