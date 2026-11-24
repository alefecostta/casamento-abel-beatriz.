/**
 * LISTA DE CONFIRMADOS — Abel & Beatriz
 * Cole este código em: Planilha Google > Extensões > Apps Script
 * Depois: Implantar > Nova implantação > App da Web
 *   - Executar como: Eu
 *   - Quem pode acessar: Qualquer pessoa
 * Copie o link que termina em /exec e cole no site (Modo Edição > Lista de Confirmados > Configurar).
 */

// 1) TROQUE A SENHA ABAIXO (é ela que você e o Abel vão usar para ver a lista dentro do site)
const SENHA = 'troque-esta-senha';

const NOME_ABA = 'Confirmações';
const CABECALHO = ['Data', 'Nome', 'Vai comparecer?', 'Nº de pessoas', 'Acompanhantes', 'Recado'];

function getAba_() {
  const planilha = SpreadsheetApp.getActiveSpreadsheet();
  let aba = planilha.getSheetByName(NOME_ABA);
  if (!aba) {
    aba = planilha.insertSheet(NOME_ABA);
    aba.appendRow(CABECALHO);
    aba.getRange(1, 1, 1, CABECALHO.length).setFontWeight('bold').setBackground('#e9d4cf');
    aba.setFrozenRows(1);
  }
  return aba;
}

// Evita que um texto digitado pelo convidado vire fórmula na planilha
function limpar_(v, max) {
  let t = String(v == null ? '' : v).slice(0, max);
  if (/^[=+\-@]/.test(t)) t = "'" + t;
  return t;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Recebe a confirmação enviada pelo site
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const d = JSON.parse(e.postData.contents);
    const nome = limpar_(d.name, 100);
    if (!nome) return json_({ ok: false, error: 'Nome obrigatório' });
    const acompanhantes = (Array.isArray(d.companions) ? d.companions : []).slice(0, 20).map(function (c) { return limpar_(c, 100); });
    getAba_().appendRow([
      new Date(),
      nome,
      d.attendance === 'Sim' ? 'Sim' : 'Não',
      Math.max(0, Math.min(20, parseInt(d.count, 10) || 0)),
      acompanhantes.join(', '),
      limpar_(d.message, 1000)
    ]);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Devolve a lista para o site — somente com a senha correta
function doGet(e) {
  if (!e || !e.parameter || e.parameter.key !== SENHA) return json_({ ok: false, error: 'Senha incorreta' });
  const valores = getAba_().getDataRange().getValues().slice(1);
  const tz = Session.getScriptTimeZone();
  const rows = valores.reverse().map(function (r) {
    return {
      createdAt: r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'dd/MM/yyyy HH:mm') : String(r[0]),
      name: String(r[1]),
      attendance: String(r[2]),
      count: Number(r[3]) || 0,
      companions: String(r[4] || ''),
      message: String(r[5] || '')
    };
  });
  return json_({ ok: true, rows: rows });
}
