const test = require('node:test');
const assert = require('node:assert');
const { carica, OGGI } = require('./carica');
const riempi = require('./dati');
const GG = 864e5;

function nuovo(giorniFa = 0) {
  const E = carica(); riempi(E);
  const k = E.creaTokenVoce();
  E.__props.EDITH_TOKEN_DATA = String(OGGI.getTime() - giorniFa * GG);
  return { E, k };
}
const post = (E, corpo) => JSON.parse(E.doPost({ postData: { contents: JSON.stringify(corpo) } }).testo);

test('token giusto: accesso consentito e registrato', () => {
  const { E, k } = nuovo();
  assert.strictEqual(E.verificaToken_(k).ok, true);
  const r = post(E, { k, f: 'apiChiedi', a: ['prossima scadenza', []] });
  assert.strictEqual(r.ok, true);
  assert.match(r.r.testo, /AXA/);
  assert.ok(!r.k, 'nessun rinnovo per un token fresco');
  assert.ok(E.__fogli.ACCESSI.righe.some(x => x[1] === 'apiChiedi' && x[2] === 'ok'));
});

test('token sbagliato o mancante: rifiutato e annotato', () => {
  const { E } = nuovo();
  assert.strictEqual(post(E, { k: 'sbagliato', f: 'apiDati', a: [] }).ok, false);
  assert.strictEqual(post(E, { f: 'apiDati', a: [] }).ok, false);
  assert.ok(E.__fogli.ACCESSI.righe.some(x => /RIFIUTATO/.test(x[2])));
});

test('funzioni fuori elenco non si possono chiamare', () => {
  const { E, k } = nuovo();
  const r = post(E, { k, f: 'creaTokenVoce', a: [] });
  assert.strictEqual(r.ok, false);
});

test('dopo 30 giorni il token si rinnova da solo, il vecchio vale ancora 7 giorni', () => {
  const { E, k } = nuovo(31);
  const r = post(E, { k, f: 'apiDati', a: [] });
  assert.strictEqual(r.ok, true);
  assert.ok(r.k && r.k !== k, 'l\'app riceve il token nuovo');
  assert.strictEqual(E.verificaToken_(r.k).ok, true);
  const vecchio = E.verificaToken_(k);
  assert.strictEqual(vecchio.ok, true);
  assert.strictEqual(vecchio.nuovo, r.k, 'un secondo telefono col vecchio token riceve quello nuovo');
  E.__props.EDITH_TOKEN_VECCHIO_FINO = String(OGGI.getTime() - 1);
  assert.strictEqual(E.verificaToken_(k).ok, false, 'finita la grazia, il vecchio non vale più');
});

test('dopo 90 giorni senza usarla il token scade', () => {
  const { E, k } = nuovo(91);
  const r = post(E, { k, f: 'apiDati', a: [] });
  assert.strictEqual(r.ok, false);
  assert.match(r.errore, /scaduto/i);
});

test('creaTokenVoce annulla subito i token precedenti', () => {
  const { E, k } = nuovo();
  E.creaTokenVoce();
  assert.strictEqual(E.verificaToken_(k).ok, false);
});

test('5 tentativi falliti in un\'ora: arriva una mail', () => {
  const { E } = nuovo();
  for (let i = 0; i < 5; i++) post(E, { k: 'x', f: 'apiDati', a: [] });
  assert.ok(E.__posta.some(m => /tentativi/i.test(m.s)));
});

test('la pagina senza token dice solo che EDITH è privata', () => {
  const { E } = nuovo();
  E.HtmlService.createHtmlOutput = h => ({ html: h, setTitle() { return this; }, addMetaTag() { return this; }, setXFrameOptionsMode() { return this; } });
  E.HtmlService.XFrameOptionsMode = { ALLOWALL: 1 };
  const out = E.doGet({ parameter: {} });
  assert.match(String(out.html || ''), /privata/i);
});

test("l'URL dello script non mostra mai l'app, neanche con il token giusto", () => {
  const { E, k } = nuovo();
  assert.match(E.doGet({ parameter: { k } }).html, /privata/);
  assert.match(E.doGet({ parameter: {} }).html, /privata/);
});

test('EDITH.gs (il file unico) è uguale ai moduli di src: rilancia "npm run bundle" se fallisce', () => {
  const fs = require('fs'), path = require('path');
  const src = path.join(__dirname, '..', 'apps-script', 'src');
  const atteso = fs.readdirSync(src).filter(f => f.endsWith('.gs')).sort().map(f => fs.readFileSync(path.join(src, f), 'utf8')).join('\n');
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'EDITH.gs'), 'utf8') === atteso, 'EDITH.gs non è aggiornato');
});

test("la riga dell'intestazione o una riga inventata non si possono modificare", () => {
  const { E, k } = nuovo();
  const foglio = E.CONFIG.SHEET_BOLLETTE;
  const intest = E.__fogli[foglio].righe[0].slice();
  for (const riga of [1, 0, -3, 2.5, 'x', 99999]) {
    const r = post(E, { k, f: 'apiSegnaPagata', a: [foglio, riga] });
    assert.strictEqual(r.ok, false, String(riga));
    assert.strictEqual(r.errore, 'Riga non valida');
  }
  assert.deepStrictEqual(E.__fogli[foglio].righe[0], intest);
});

test("gli errori interni non arrivano all'app, ma finiscono nel LOG", () => {
  const { E, k } = nuovo();
  E.apiDati = () => { throw new Error('dettaglio interno di Google'); };
  const r = post(E, { k, f: 'apiDati', a: [] });
  assert.strictEqual(r.ok, false);
  assert.ok(!/dettaglio interno/.test(r.errore), r.errore);
  assert.ok(E.__fogli.LOG.righe.some(x => /dettaglio interno/.test(x[2])));
});
