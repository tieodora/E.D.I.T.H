/**
 * EDITH – spese fuori dalle bollette.
 * - SPESE FISSE: una riga per spesa che si ripete ogni mese (per esempio l'affitto). Ogni mese, dal giorno indicato,
 *   EDITH la copia da sola nel foglio SPESE. Puoi aggiungere righe o mettere ATTIVA = NO per sospenderne una.
 * - SPESE: tutte le spese, anche quelle dette a voce ("ho fatto benzina, sono 50 euro"): data, importo, tipologia.
 */

const COLONNE_SPESE = ['DATA', 'IMPORTO', 'TIPOLOGIA', 'NOTA', 'FONTE', 'REGISTRATA IL'];
const COLONNE_SPESE_FISSE = ['NOME', 'IMPORTO', 'GIORNO DEL MESE', 'TIPOLOGIA', 'ATTIVA'];
const SPESE_FISSE_INIZIALI = [['Affitto', 300, 1, 'Casa', 'SI']];

const TIPOLOGIE_SPESA = [
  ['Benzina', /\b(benzina|carburante|diesel|gasolio|metano per l auto|gpl|pieno|rifornimento|distributore)\b/],
  ['Spesa', /\b(spesa|supermercato|alimentari|conad|coop|esselunga|carrefour|lidl|eurospin|pam|despar|mercato)\b/],
  ['Ristorante', /\b(ristorante|pizzeria|pizza|cena fuori|pranzo fuori|sushi|trattoria|aperitivo|kebab|mcdonald\w*)\b/],
  ['Bar', /\b(bar|caffe|colazione|cappuccino|brioche)\b/],
  ['Auto', /\b(parcheggio|autostrada|pedaggio|telepass|meccanico|gomme|tagliando|lavaggio|bollo auto|revisione)\b/],
  ['Trasporti', /\b(treno|autobus|bus|metro|biglietto|taxi|uber|aereo|volo)\b/],
  ['Salute', /\b(farmacia|medicine|medicinali|medico|dentista|visita|analisi|ticket)\b/],
  ['Casa', /\b(affitto|condominio|ikea|ferramenta|pulizie|bricolage)\b/],
  ['Abbigliamento', /\b(vestiti|scarpe|abbigliamento|maglia|pantaloni|giacca|zara)\b/],
  ['Svago', /\b(cinema|teatro|concerto|libro|libri|netflix|spotify|palestra|abbonamento)\b/],
  ['Regali', /\b(regalo|regali)\b/],
  ['Animali', /\b(veterinario|crocchette|cane|gatto)\b/],
];

function tipologiaSpesa_(t) {
  const x = (TIPOLOGIE_SPESA.find(([, re]) => re.test(t)) || [])[0];
  return x || null;
}

/** "ho fatto benzina, sono 50 euro" → { importo: 50, tipologia: 'Benzina', data } ; null se non è una spesa da registrare. */
function capisciSpesa_(t) {
  if (/^(quanto|quando|quali|quale|cosa|come|dove|perche)\b/.test(t)) return null;
  const m = t.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:euro|eur)\b/) || t.match(/\beuro\s*(\d+(?:[.,]\d{1,2})?)/) ||
    (tipologiaSpesa_(t) ? t.match(/\b(?:sono|di|da|per)\s+(\d+(?:[.,]\d{1,2})?)\b/) : null);
  if (!m) return null;
  // la frase arriva senza virgole ("23,40 euro" diventa "23 40 euro"): due cifre subito prima di "euro" sono i centesimi
  const cent = t.match(/(\d+)\s(\d{2})\s*(?:euro|eur)\b/);
  const importo = Math.round(parseFloat(cent ? cent[1] + '.' + cent[2] : m[1].replace(',', '.')) * 100) / 100;
  if (!(importo > 0) || importo > 20000) return null;
  const tipologia = tipologiaSpesa_(t);
  const verbo = /\b(ho fatto|ho speso|ho pagato|ho preso|ho comprato|segna|aggiungi|registra|metti|spesi|pagati|spesa di|sono)\b/.test(t);
  if (!tipologia && !/\b(ho speso|segna|aggiungi|registra)\b/.test(t)) return null;
  if (!verbo && !tipologia) return null;
  const data = new Date();
  if (/\bieri\b/.test(t)) data.setDate(data.getDate() - 1);
  else if (/\bl altro ieri\b|\bavantieri\b/.test(t)) data.setDate(data.getDate() - 2);
  data.setHours(12, 0, 0, 0);
  return { importo: importo, tipologia: tipologia || 'Altro', data: data };
}

function registraSpesa_(s, nota, fonte) {
  const sh = sheet_(CONFIG.SHEET_SPESE);
  const map = ensureHeaders_(sh, COLONNE_SPESE);
  appendObj_(sh, map, { 'DATA': s.data, 'IMPORTO': s.importo, 'TIPOLOGIA': s.tipologia, 'NOTA': nota || '', 'FONTE': fonte || 'voce', 'REGISTRATA IL': new Date() });
  try { svuotaCache_(); } catch (e) { }
}

/** Toglie l'ultima spesa detta a voce (per "annulla"). */
function annullaUltimaSpesa_() {
  const sh = ss_().getSheetByName(CONFIG.SHEET_SPESE);
  if (!sh || sh.getLastRow() < 2) return null;
  const righe = readRows_(sh).rows.filter(r => r['FONTE'] === 'voce');
  const u = righe[righe.length - 1];
  if (!u) return null;
  sh.deleteRows(u._row, 1);
  try { svuotaCache_(); } catch (e) { }
  return u;
}

/** Copia ogni mese le spese fisse nel foglio SPESE (una volta sola per mese). */
function registraSpeseFisse_() {
  const ss = ss_();
  let shF = ss.getSheetByName(CONFIG.SHEET_SPESE_FISSE);
  if (!shF) {
    shF = sheet_(CONFIG.SHEET_SPESE_FISSE);
    const mapF = ensureHeaders_(shF, COLONNE_SPESE_FISSE);
    SPESE_FISSE_INIZIALI.forEach(r => appendObj_(shF, mapF, { 'NOME': r[0], 'IMPORTO': r[1], 'GIORNO DEL MESE': r[2], 'TIPOLOGIA': r[3], 'ATTIVA': r[4] }));
  }
  const fisse = readRows_(shF).rows.filter(r => r['NOME'] && typeof r['IMPORTO'] === 'number' && !/^(no|n|falso|false)$/i.test(String(r['ATTIVA'])));
  if (!fisse.length) return 0;
  const sh = sheet_(CONFIG.SHEET_SPESE);
  const map = ensureHeaders_(sh, COLONNE_SPESE);
  const oggi = new Date(), mese = Utilities.formatDate(oggi, CONFIG.TIMEZONE, 'yyyy-MM');
  const gia = readRows_(sh).rows.filter(r => r['FONTE'] === 'fissa' && r['DATA'] instanceof Date && Utilities.formatDate(r['DATA'], CONFIG.TIMEZONE, 'yyyy-MM') === mese).map(r => String(r['NOTA']));
  let n = 0;
  fisse.forEach(f => {
    const g = Math.min(Math.max(Number(f['GIORNO DEL MESE']) || 1, 1), 28);
    if (oggi.getDate() < g || gia.indexOf(String(f['NOME'])) !== -1) return;
    appendObj_(sh, map, { 'DATA': new Date(oggi.getFullYear(), oggi.getMonth(), g, 12), 'IMPORTO': f['IMPORTO'], 'TIPOLOGIA': f['TIPOLOGIA'] || f['NOME'], 'NOTA': String(f['NOME']), 'FONTE': 'fissa', 'REGISTRATA IL': new Date() });
    n++;
  });
  if (n) { log_('Spese fisse', n + ' spese fisse del mese registrate'); try { svuotaCache_(); } catch (e) { } }
  return n;
}

/** Le spese in formato semplice. */
function spese_() {
  try {
    const sh = ss_().getSheetByName(CONFIG.SHEET_SPESE);
    if (!sh || sh.getLastRow() < 2) return [];
    return readRows_(sh).rows.filter(r => r['DATA'] instanceof Date && typeof r['IMPORTO'] === 'number')
      .map(r => ({ data: iso_(r['DATA']), importo: r['IMPORTO'], tipo: String(r['TIPOLOGIA'] || 'Altro'), nota: String(r['NOTA'] || ''), fonte: String(r['FONTE'] || '') }))
      .sort((a, b) => b.data.localeCompare(a.data));
  } catch (e) { return []; }
}

/** Riepilogo per l'app: totale del mese, per tipologia, ultime spese. */
function riepilogoSpese_() {
  const S = spese_(), mese = iso_(new Date()).slice(0, 7);
  const delMese = S.filter(s => s.data.slice(0, 7) === mese);
  const per = {}; delMese.forEach(s => { per[s.tipo] = (per[s.tipo] || 0) + s.importo; });
  return { mese: round2_(delMese.reduce((t, s) => t + s.importo, 0)), perTipo: Object.keys(per).map(k => ({ nome: k, totale: round2_(per[k]) })).sort((a, b) => b.totale - a.totale), ultime: S.slice(0, 8) };
}

/** Risposte di Edith sulle spese (registrazione, annullamento, domande). Restituisce null se la frase non c'entra. */
function rispostaSpese_(t, c) {
  if (/^(annulla|cancella|togli|elimina)\b.*\b(spesa|ultima|benzina|registrazione)\b|^annulla$|ho sbagliato( la)? spesa/.test(t)) {
    const u = annullaUltimaSpesa_();
    return { testo: u ? 'Fatto: ho tolto ' + u['TIPOLOGIA'] + ' da ' + eur_(u['IMPORTO']) + '.' : 'Non trovo spese dette a voce da togliere.' };
  }
  const s = capisciSpesa_(t);
  if (s) {
    registraSpesa_(s, '', 'voce');
    const quando = iso_(s.data) === iso_(new Date()) ? 'oggi' : 'il ' + data_(iso_(s.data));
    return { testo: 'Segnato: ' + s.tipologia.toLowerCase() + ', ' + eur_(s.importo) + ', ' + quando + '.' + (s.tipologia === 'Altro' ? ' Non ho capito la tipologia: la puoi cambiare nel foglio SPESE.' : '') + ' Se ho sbagliato, di\' "annulla".', aggiorna: true };
  }
  const tipo = tipologiaSpesa_(t);
  const generiche = /spese (varie|extra|del mese|di questo mese|fuori dalle bollette|quotidiane)|altre spese|tutte le spese|uscite/.test(t);
  if ((tipo || generiche) && /quanto|quante|spes[aoi]|speso|pagato|totale|elenco|lista|ultim/.test(t) && !c.ass && !c.tipo) {
    const S = spese_(), oggi = new Date();
    let mese = c.mesi.length ? c.mesi[0] : (/quest anno|nel \d{4}|in tutto l anno/.test(t) ? null : oggi.getMonth());
    const anno = c.anno;
    const del = S.filter(x => x.data.slice(0, 4) === anno && (mese === null || +x.data.slice(5, 7) === mese + 1) && (!tipo || x.tipo === tipo));
    const quando = mese === null ? 'nel ' + anno : aMese_(mese) + (anno !== String(oggi.getFullYear()) ? ' ' + anno : '');
    if (/ultim/.test(t) && del.length) { const u = del[0]; return { testo: 'L\'ultima ' + (tipo ? 'spesa di ' + tipo.toLowerCase() : 'spesa') + ' è del ' + data_(u.data) + ': ' + eur_(u.importo) + (tipo ? '' : ' (' + u.tipo.toLowerCase() + ')') + '.' }; }
    if (!del.length) return { testo: cap_(quando) + ' non ho spese' + (tipo ? ' di ' + tipo.toLowerCase() : '') + ' registrate.' };
    const tot = del.reduce((a, x) => a + x.importo, 0);
    if (tipo) return { testo: cap_(quando) + ' hai speso ' + eur_(tot) + ' di ' + tipo.toLowerCase() + ' (' + del.length + (del.length === 1 ? ' volta' : ' volte') + ').' };
    const per = {}; del.forEach(x => { per[x.tipo] = (per[x.tipo] || 0) + x.importo; });
    return { testo: cap_(quando) + ' hai ' + eur_(tot) + ' di spese fuori dalle bollette: ' + Object.keys(per).sort((a, b) => per[b] - per[a]).map(k => k.toLowerCase() + ' ' + eur_(per[k])).join(', ') + '.' };
  }
  return null;
}
