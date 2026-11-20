/**
 * EDITH – l'offerta in corso per ogni fornitura, letta dalle bollette.
 * Le bollette italiane hanno un riquadro con nome dell'offerta, prezzo, quota fissa e scadenza delle condizioni:
 * qui lo leggo dal testo dell'OCR e tengo nel foglio OFFERTE una riga per fornitore e fornitura, aggiornata con l'ultima bolletta.
 */

const COLONNE_OFFERTE = ['FORNITORE', 'FORNITURA', 'OFFERTA', 'MERCATO', 'TIPO PREZZO', 'PREZZO LUCE €/KWH', 'PREZZO GAS €/SMC',
  'QUOTA FISSA €/MESE', 'POTENZA KW', 'SCADENZA CONDIZIONI', 'CONSUMO ANNUO LUCE KWH', 'CONSUMO ANNUO GAS SMC', 'POD', 'PDR',
  'DA BOLLETTA DEL', 'LINK MAIL', 'AGGIORNATO'];

/** Numero all'italiana con decimali ("0,123456" o "1.234") → Number. */
function num_(s) {
  if (s === undefined || s === null) return null;
  let t = String(s).replace(/\s/g, '');
  if (/,/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = parseFloat(t);
  return isNaN(n) ? null : n;
}

/** Prezzo unitario vicino a un'unità di misura: "0,1234 €/kWh", "€/kWh 0,1234", "0,1234 euro/kWh". */
function prezzoUnitario_(t, unita, min, max) {
  const u = '(?:€|euro|eur)\\s*\\/\\s*' + unita;
  const pattern = [
    new RegExp('(\\d+[,.]\\d{2,6})\\s*' + u, 'gi'),
    new RegExp(u + '\\s*:?\\s*(\\d+[,.]\\d{2,6})', 'gi'),
  ];
  // preferisco i valori vicini a "prezzo", "componente energia", "materia"
  const cand = [];
  pattern.forEach(re => {
    let m;
    while ((m = re.exec(t)) !== null) {
      const v = num_(m[1]);
      if (v === null || v < min || v > max) continue;
      const prima = t.slice(Math.max(0, m.index - 120), m.index).toLowerCase();
      const peso = /prezzo|componente energia|materia (prima|energia|gas)|costo (dell )?energia|spesa per la materia|\bpe\b|\bf0\b|monorari|cmem|prezzo gas/.test(prima) ? 2
        : /trasporto|oneri|accise|iva|distribuzione|perequazione|imposte/.test(prima) ? -1 : 0;
      cand.push({ v: v, peso: peso, pos: m.index });
    }
  });
  if (!cand.length) return null;
  cand.sort((a, b) => b.peso - a.peso || a.pos - b.pos);
  return cand[0].peso < 0 ? null : cand[0].v;
}

/** Dopo una delle parole chiave, il primo testo "nome" (per il nome dell'offerta). */
function nomeOfferta_(t) {
  const re = /(?:nome (?:dell[' ]?)?offerta|denominazione (?:dell[' ]?)?offerta|offerta commerciale|nome (?:del )?prodotto|offerta sottoscritta|la tua offerta|offerta)\s*[:\-]\s*([^\n]{3,60})/i;
  const m = t.match(re);
  if (!m) return '';
  return m[1].replace(/\s*(codice|cod\.|offerta n|valid|mercato|prezzo|scadenza).*$/i, '').replace(/[.;,]+$/, '').trim();
}

/** Estrae i dettagli dell'offerta dal testo di una bolletta. Restituisce null se non trova niente di utile. */
function estraiOfferta_(testo) {
  const t = String(testo || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ');
  const low = t.toLowerCase();
  const o = {};
  o.offerta = nomeOfferta_(t);
  o.mercato = /servizio di tutela|maggior tutela|tutela della vulnerabilita|tutela vulnerabil/.test(low) ? 'Tutela'
    : /tutele graduali|\bstg\b/.test(low) ? 'Tutele graduali' : /mercato libero/.test(low) ? 'Libero' : '';
  const indicizzato = /\bpun\b|\bpsv\b|indicizzat|variabile|spread|\bttf\b/.test(low);
  const fisso = /prezzo fisso|fisso per|bloccato|invariabile|prezzo fisso e invariabile/.test(low);
  o.tipoPrezzo = fisso && !/\bpun\b.*\+|spread/.test(low) ? 'Fisso' : indicizzato ? (/\bpun\b/.test(low) ? 'Variabile (PUN)' : /\bpsv\b/.test(low) ? 'Variabile (PSV)' : 'Variabile') : '';
  o.prezzoLuce = prezzoUnitario_(t, 'kwh', 0.03, 1.5);
  o.prezzoGas = prezzoUnitario_(t, 'smc', 0.1, 5);
  const qf = t.match(/(?:quota fissa|costo fisso|commercializzazione|corrispettivo fisso|canone)[^\n€]{0,80}?(?:€\s*|euro\s*)?(\d+[,.]\d{2,4})\s*(?:€|euro)?\s*\/\s*(mese|anno)/i)
    || t.match(/(?:quota fissa|costo fisso|commercializzazione|corrispettivo fisso)[^\n]{0,60}?(?:€|euro)\s*\/\s*(?:pdp\s*\/\s*)?(mese|anno)\s*:?\s*(\d+[,.]\d{2,4})/i);
  if (qf) {
    const [val, per] = /\d/.test(qf[1]) ? [qf[1], qf[2]] : [qf[2], qf[1]];
    const v = num_(val);
    if (v !== null) o.quotaFissa = Math.round((per.toLowerCase() === 'anno' ? v / 12 : v) * 100) / 100;
  }
  const pot = t.match(/potenza (?:contrattualmente )?impegnata[^\d\n]{0,25}(\d+(?:[,.]\d+)?)\s*kw\b/i);
  if (pot) o.potenza = num_(pot[1]);
  const scad = dataDopo_(t, ['condizioni economiche[^\\n]{0,60}?(?:fino al|valide fino|scadenza|scadono il|scade il)', 'scadenza (?:delle )?condizioni economiche',
    'prezzo (?:bloccato|fisso)[^\\n]{0,30}?fino al', 'valid[ae] fino al', 'offerta valida fino'], 40);
  if (scad) o.scadenzaCondizioni = scad;
  const cl = t.match(/consumo annuo[^\n\d]{0,40}(\d{1,3}(?:\.\d{3})*|\d+)\s*kwh/i);
  if (cl) o.consumoLuce = num_(cl[1]);
  const cg = t.match(/consumo annuo[^\n\d]{0,40}(\d{1,3}(?:\.\d{3})*|\d+)\s*smc/i);
  if (cg) o.consumoGas = num_(cg[1]);
  const pod = t.match(/\b(IT\s?\d{3}\s?E\s?\d{7,8}[A-Z0-9]?)\b/i);
  if (pod) o.pod = pod[1].replace(/\s/g, '').toUpperCase();
  const pdr = t.match(/\bPDR\b[^\d\n]{0,25}(\d{14})\b/i);
  if (pdr) o.pdr = pdr[1];
  const utili = ['offerta', 'prezzoLuce', 'prezzoGas', 'quotaFissa', 'scadenzaCondizioni', 'tipoPrezzo'].filter(k => o[k]).length;
  return utili >= 2 ? o : null;
}

/** Salva l'offerta letta da una bolletta (tiene la più recente per fornitore e fornitura). */
function salvaOfferta_(o, fornitore, fornitura, emissione, link) {
  if (!o) return false;
  const sh = sheet_(CONFIG.SHEET_OFFERTE);
  const map = ensureHeaders_(sh, COLONNE_OFFERTE);
  const righe = readRows_(sh).rows;
  const chi = String(fornitore || '').split(':')[0].trim();
  const es = righe.find(r => norm_(r['FORNITORE']) === norm_(chi) && norm_(r['FORNITURA']) === norm_(fornitura));
  if (es && es['DA BOLLETTA DEL'] instanceof Date && emissione && es['DA BOLLETTA DEL'] > emissione) return false;
  const obj = {
    'FORNITORE': chi, 'FORNITURA': fornitura, 'OFFERTA': o.offerta || '', 'MERCATO': o.mercato || '', 'TIPO PREZZO': o.tipoPrezzo || '',
    'PREZZO LUCE €/KWH': o.prezzoLuce || '', 'PREZZO GAS €/SMC': o.prezzoGas || '', 'QUOTA FISSA €/MESE': o.quotaFissa || '',
    'POTENZA KW': o.potenza || '', 'SCADENZA CONDIZIONI': o.scadenzaCondizioni || '', 'CONSUMO ANNUO LUCE KWH': o.consumoLuce || '',
    'CONSUMO ANNUO GAS SMC': o.consumoGas || '', 'POD': o.pod || '', 'PDR': o.pdr || '', 'DA BOLLETTA DEL': emissione || '', 'LINK MAIL': link || '', 'AGGIORNATO': new Date(),
  };
  if (es) {
    // se questa bolletta non riporta un campo, tengo quello che sapevo già (per esempio il POD)
    Object.keys(obj).forEach(k => { if (obj[k] === '' && es[k] !== '' && es[k] !== undefined) obj[k] = es[k]; });
    Object.keys(obj).forEach(k => setCell_(sh, map, es._row, k, obj[k]));
  } else appendObj_(sh, map, obj);
  return true;
}

/** Le offerte per l'app e per Edith, in formato semplice. */
function offerte_() {
  try {
    const sh = ss_().getSheetByName(CONFIG.SHEET_OFFERTE);
    if (!sh || sh.getLastRow() < 2) return [];
    const n = v => (typeof v === 'number' ? v : null);
    return readRows_(sh).rows.filter(r => r['FORNITORE']).map(r => ({
      chi: String(r['FORNITORE']), tipo: String(r['FORNITURA'] || ''), offerta: String(r['OFFERTA'] || ''), mercato: String(r['MERCATO'] || ''),
      tipoPrezzo: String(r['TIPO PREZZO'] || ''), prezzoLuce: n(r['PREZZO LUCE €/KWH']), prezzoGas: n(r['PREZZO GAS €/SMC']),
      quotaFissa: n(r['QUOTA FISSA €/MESE']), potenza: n(r['POTENZA KW']), scadenza: iso_(r['SCADENZA CONDIZIONI']),
      consumoLuce: n(r['CONSUMO ANNUO LUCE KWH']), consumoGas: n(r['CONSUMO ANNUO GAS SMC']), pod: String(r['POD'] || ''), pdr: String(r['PDR'] || ''),
      da: iso_(r['DA BOLLETTA DEL']), link: String(r['LINK MAIL'] || ''),
    }));
  } catch (e) { return []; }
}

function descriviOfferta_(o) {
  const p = [];
  p.push((o.offerta ? 'l\'offerta "' + o.offerta + '"' : 'un\'offerta') + ' di ' + o.chi + (o.mercato ? ' sul mercato ' + (o.mercato === 'Libero' ? 'libero' : 'di ' + o.mercato.toLowerCase()) : ''));
  if (o.tipoPrezzo) p.push('prezzo ' + o.tipoPrezzo.toLowerCase().replace('(pun)', 'legato al PUN').replace('(psv)', 'legato al PSV'));
  if (o.prezzoLuce) p.push('luce a ' + String(o.prezzoLuce).replace('.', ',') + ' euro al kWh');
  if (o.prezzoGas) p.push('gas a ' + String(o.prezzoGas).replace('.', ',') + ' euro allo Smc');
  if (o.quotaFissa) p.push('quota fissa ' + eur_(o.quotaFissa) + ' al mese');
  if (o.potenza) p.push('potenza ' + String(o.potenza).replace('.', ',') + ' kW');
  return p.join(', ') + '.' + (o.scadenza ? ' Le condizioni economiche scadono il ' + data_(o.scadenza) + '.' : '');
}

/**
 * Prima volta: rilegge l'ultima bolletta di ogni fornitore per riempire OFFERTE.
 * Parte da sola dentro il controllo orario finché non ha finito; si può lanciare anche a mano.
 */
function leggiOfferte(start) {
  start = start || Date.now();
  const props = PropertiesService.getScriptProperties();
  const sh = ss_().getSheetByName(CONFIG.SHEET_BOLLETTE);
  if (!sh || sh.getLastRow() < 2) { props.setProperty('OFFERTE_LETTE', '1'); return 0; }
  const fatte = String(props.getProperty('OFFERTE_FATTE') || '').split(',').filter(Boolean);
  const viste = {}, daLeggere = [];
  readRows_(sh).rows.filter(r => r['ID MAIL'] && r['DATA EMISSIONE'] instanceof Date)
    .sort((a, b) => b['DATA EMISSIONE'] - a['DATA EMISSIONE'])
    .forEach(r => { const k = norm_(String(r['FORNITORE']).split(':')[0]) + '|' + norm_(r['FORNITURA']); if (!viste[k]) { viste[k] = 1; daLeggere.push(r); } });
  let lette = 0;
  for (const r of daLeggere) {
    const id = String(r['ID MAIL']);
    if (fatte.indexOf(id) !== -1) continue;
    if (tempoScaduto_(start)) return lette;
    try {
      const msg = GmailApp.getMessageById(id);
      const pdf = msg.getAttachments({ includeInlineImages: false }).filter(a => a.getContentType() === 'application/pdf' || /\.pdf$/i.test(a.getName()))[0];
      const testo = (pdf ? ocrPdf_(pdf.copyBlob()) : '') + '\n' + msg.getPlainBody();
      if (salvaOfferta_(estraiOfferta_(testo), r['FORNITORE'], r['FORNITURA'], r['DATA EMISSIONE'], r['LINK MAIL'])) lette++;
    } catch (e) { log_('Offerte', 'Non riesco a leggere ' + r['FORNITORE'] + ': ' + e.message); }
    fatte.push(id);
    props.setProperty('OFFERTE_FATTE', fatte.slice(-50).join(','));
  }
  props.setProperty('OFFERTE_LETTE', '1');
  if (lette) log_('Offerte', lette + ' offerte lette dalle bollette');
  return lette;
}
