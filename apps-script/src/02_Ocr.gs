/**
 * OCR dei PDF allegati ed estrazione dei dati (tipo, date, importo).
 * L'OCR usa Google Drive: il PDF viene convertito temporaneamente in Google Doc
 * (funziona sia sui PDF "testuali" sia su quelli scansionati), letto e poi eliminato.
 */

function ocrPdf_(blob) {
  const nome = 'EDITH_OCR_tmp_' + Date.now();
  let file, pdfTemp;
  try {
    file = conRiprova_(() => Drive.Files.create({ name: nome, mimeType: MimeType.GOOGLE_DOCS }, blob, { ocrLanguage: 'it', fields: 'id' }));
  } catch (e) {
    if (eLimiteGoogle_(e)) throw e;
    // Ripiego: alcuni PDF non si convertono al caricamento ma si convertono con una copia
    pdfTemp = Drive.Files.create({ name: nome + '.pdf' }, blob.setContentType('application/pdf'), { fields: 'id' });
    file = Drive.Files.copy({ name: nome, mimeType: MimeType.GOOGLE_DOCS }, pdfTemp.id, { ocrLanguage: 'it', fields: 'id' });
  }
  try {
    return conRiprova_(() => DocumentApp.openById(file.id).getBody().getText());
  } finally {
    [file, pdfTemp].forEach(f => {
      if (!f) return;
      try { Drive.Files.remove(f.id); } catch (e) { try { DriveApp.getFileById(f.id).setTrashed(true); } catch (e2) {} }
    });
  }
}

// ---------- Regole di classificazione ----------

const TIPI_FORNITURA = [
  { tipo: 'Luce', kw: [/energia elettrica/g, /\bluce\b/g, /\bkwh\b/g, /\bpod\b/g, /potenza impegnata/g] },
  { tipo: 'Gas', kw: [/\bgas\b/g, /\bsmc\b/g, /\bpdr\b/g, /gas naturale/g] },
  { tipo: 'Acqua', kw: [/servizio idrico/g, /\bacqua\b/g, /acquedotto/g, /depurazione/g, /fognatura/g] },
  { tipo: 'Telefono/Internet', kw: [/\bfibra\b/g, /internet/g, /telefon/g, /\bmobile\b/g, /\badsl\b/g, /\bgiga\b/g, /linea fissa/g] },
  { tipo: 'Rifiuti (TARI)', kw: [/\btari\b/g, /rifiuti/g, /igiene urbana/g] },
  { tipo: 'Condominio', kw: [/condomin/g, /amministratore/g] },
];

const RAMI_ASSICURATIVI = [
  { tipo: 'Auto', kw: [/\brca\b/g, /\bauto\b/g, /autovettura/g, /veicolo/g, /\btarga\b/g] },
  { tipo: 'Moto', kw: [/\bmoto\b/g, /motociclo/g, /ciclomotore/g, /scooter/g] },
  { tipo: 'Casa', kw: [/abitazione/g, /\bcasa\b/g, /incendio/g, /fabbricato/g, /furto/g] },
  { tipo: 'Vita', kw: [/\bvita\b/g, /caso morte/g, /\btcm\b/g] },
  { tipo: 'Salute/Infortuni', kw: [/salute/g, /infortun/g, /malattia/g, /sanitari/g] },
  { tipo: 'Viaggio', kw: [/viaggio/g] },
];

const FORNITORI_NOTI = [
  'Enel', 'Hera', 'A2A', 'Plenitude', 'Eni', 'Iren', 'Acea', 'Edison', 'Sorgenia', 'Engie', 'Illumia',
  'Octopus', 'Piemonte Energy', 'Iberdrola', 'E.ON', 'Estra', 'Dolomiti', 'Duferco', 'Pulsee', 'NeN', 'Servizio Elettrico Nazionale',
  'TIM', 'Vodafone', 'WindTre', 'Iliad', 'Fastweb', 'Sky', 'Tiscali', 'Ho.', 'Kena', 'Very Mobile', 'PosteMobile',
  'Sara', 'Generali', 'UnipolSai', 'Unipol', 'Allianz', 'AXA', 'Zurich', 'Reale Mutua', 'Cattolica', 'Vittoria',
  'Prima', 'Genertel', 'Linear', 'Verti', 'ConTe', 'Quixa', 'Direct Line', 'Poste Assicura', 'Helvetia', 'HDI',
];

const MESI = {
  gennaio: 1, gen: 1, febbraio: 2, feb: 2, marzo: 3, mar: 3, aprile: 4, apr: 4, maggio: 5, mag: 5,
  giugno: 6, giu: 6, luglio: 7, lug: 7, agosto: 8, ago: 8, settembre: 9, set: 9, sett: 9,
  ottobre: 10, ott: 10, novembre: 11, nov: 11, dicembre: 12, dic: 12,
};

const RE_DATA_NUM = /(\d{1,2})\s?[\/\.\-]\s?(\d{1,2})\s?[\/\.\-]\s?(\d{2,4})/;
const RE_DATA_TXT = /(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre|gen|feb|mar|apr|mag|giu|lug|ago|sett?|ott|nov|dic)\.?\s+(\d{4})/i;
const RE_IMPORTO = /(?:€|eur(?:o)?)?\s*(\d{1,3}(?:[.\s]\d{3})*,\d{2}|\d+,\d{2})(?!\d)\s*(?:€|eur(?:o)?)?/i;

function parseData_(s) {
  let m = s.match(RE_DATA_NUM);
  let d = null;
  let idx = Infinity;
  if (m) {
    let y = +m[3]; if (y < 100) y += 2000;
    const cand = new Date(y, +m[2] - 1, +m[1], 12);
    if (cand.getMonth() === +m[2] - 1) { d = cand; idx = m.index; }
  }
  const t = s.match(RE_DATA_TXT);
  if (t && t.index < idx) {
    const cand = new Date(+t[3], MESI[t[2].toLowerCase().replace('.', '')] - 1, +t[1], 12);
    if (!isNaN(cand)) d = cand;
  }
  if (d && (d.getFullYear() < 2000 || d.getFullYear() > 2100)) return null;
  return d;
}

function parseEuro_(s) {
  const n = parseFloat(String(s).replace(/[.\s]/g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
}

/** Cerca la prima data che compare subito dopo una delle parole chiave (in ordine di priorità). */
function dataDopo_(text, keywords, finestra, valida) {
  for (const kw of keywords) {
    const re = new RegExp(kw, 'gi');
    let m;
    while ((m = re.exec(text)) !== null) {
      const d = parseData_(text.substr(m.index + m[0].length, finestra || 80));
      if (d && (!valida || valida(d))) return d;
    }
  }
  return null;
}

function importoDopo_(text, keywords) {
  for (const kw of keywords) {
    const re = new RegExp(kw, 'gi');
    let m;
    while ((m = re.exec(text)) !== null) {
      const tail = text.substr(m.index + m[0].length, 80);
      const a = tail.match(RE_IMPORTO);
      if (a) {
        const n = parseEuro_(a[1]);
        if (n !== null && n > 0 && n < 100000) return n;
      }
    }
  }
  return null;
}

function classifica_(low, regole) {
  let best = null, bestScore = 0;
  const punteggi = {};
  regole.forEach(r => {
    const score = r.kw.reduce((s, re) => s + ((low.match(re) || []).length), 0);
    punteggi[r.tipo] = score;
    if (score > bestScore) { best = r.tipo; bestScore = score; }
  });
  if (punteggi['Luce'] >= 3 && punteggi['Gas'] >= 3) return 'Luce e Gas';
  return best;
}

function fornitore_(text, mittente, oggetto) {
  // prima mittente e oggetto, solo dopo il testo (che può citare altre compagnie)
  for (const hay of [(oggetto + ' ' + mittente).toLowerCase(), text.slice(0, 3000).toLowerCase()]) {
    for (const f of FORNITORI_NOTI) {
      const re = new RegExp('(^|[^a-z])' + f.toLowerCase().replace(/[.]/g, '\\.') + '([^a-z]|$)');
      if (re.test(hay)) return f;
    }
  }
  // altrimenti: prima parte dell'oggetto ("Piemonte Energy - bollette luce") o nome del mittente
  const ogg = String(oggetto || '').replace(/^((re|fwd?|i|r):\s*)+/i, '');
  const SEP = /\s[-–|]\s|:\s/;
  const dalOggetto = SEP.test(ogg) ? ogg.split(SEP)[0].trim() : '';
  if (dalOggetto && dalOggetto.length <= 40 && !/^(re|fwd?|i|r):?$/i.test(dalOggetto)) return dalOggetto.replace(/^(re|fwd?|i|r):\s*/i, '');
  const m = String(mittente).match(/^"?([^"<]+)"?\s*</);
  return m ? m[1].trim() : String(mittente).replace(/.*@/, '').replace(/>.*/, '');
}

/**
 * Estrae i dati dal testo. tipoPratica: 'bollette' | 'assicurazioni'.
 */
function estraiDati_(text, tipoPratica, mittente, oggetto) {
  // l'oggetto va in testa: spesso contiene già "in scadenza il ..." o il numero di polizza
  const t = (String(oggetto || '') + '\n' + String(text || '')).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ');
  const low = t.toLowerCase();
  const isAss = tipoPratica === 'assicurazioni';

  const emissione = dataDopo_(t, [
    'data emissione', 'data di emissione', 'emessa il', 'data fattura', 'data documento',
    'fattura n[^\\n]{0,40}?del', 'bolletta n[^\\n]{0,40}?del', 'avviso n[^\\n]{0,40}?del', 'del giorno',
  ], 60);

  const scadenza = dataDopo_(t, isAss
    ? ['scadenza rata', 'data scadenza', 'scadenza', 'pagare entro il', 'entro il', 'scade il', 'data effetto', 'decorrenza', 'addebit\\w* (?:il|in data)']
    : ['data scadenza', 'scadenza', 'da pagare entro il', 'pagare entro', 'entro il', 'scade il', 'addebit\\w* (?:il|in data|a partire dal)', 'data (?:di )?addebito', 'pagamento entro'], 100,
    d => !emissione || d >= emissione);

  const importo = importoDopo_(t, isAss
    ? ['premio totale', 'premio lordo', 'totale da pagare', 'importo da pagare', 'importo rata', 'premio rata', 'totale', 'premio', 'importo']
    : ['totale da pagare', 'importo da pagare', 'totale bolletta', 'totale fattura', 'totale documento', 'importo totale', 'importo addebitato', 'sar[aà] addebitat[oa]', 'importo da addebitare', 'da pagare', 'totale', 'importo']);

  const docMatch = t.match(/(?:fattura|bolletta|documento)\s*(?:n\.?|nr\.?|numero|n°)?\s*[:°]?\s*([A-Z0-9\/\-]*\d[A-Z0-9\/\-]*)/i);
  const polMatch = t.match(/(?:[Pp]olizza|POLIZZA|[Cc]ontratto|CONTRATTO)\s*(?:[Nn]\.?|[Nn]r\.?|[Nn]umero|[Nn]°)?\s*[:°]?\s*(\d[A-Z0-9\/\-]{3,14}|[A-Z]{1,4}\d[A-Z0-9\/\-]{3,14})(?![a-z])/);

  const tipo = classifica_(low, isAss ? RAMI_ASSICURATIVI : TIPI_FORNITURA);
  const trovati = [tipo, scadenza, emissione, importo].filter(x => x).length;

  return {
    tipo: tipo || 'Altro',
    scadenza, emissione, importo,
    numero: (isAss ? (polMatch ? polMatch[1] : '') : (docMatch ? docMatch[1] : ''))
      .replace(/(PREMIO|IMPORTO|SCADENZA|TARGA|DEL|RATA).*$/, ''),
    fornitore: fornitore_(t, mittente || '', oggetto || ''),
    confidenza: trovati,
  };
}
