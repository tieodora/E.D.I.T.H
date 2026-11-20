// Le skill di conversazione che girano sul telefono (dentro app.js, tra i segnaposto <chiacchiere>).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const carica = () => new Function(src.slice(src.indexOf('// <chiacchiere>'), src.indexOf('// </chiacchiere>')) + '; return CH;')();
const ora = new Date('2026-11-20T18:15:00');

const CASI = [
  ['come stai', /E tu|Tu\?/],
  ['sei proprio stupida', /./],
  ['chi ti ha creata', /Iron Man/],
  ['sono stanca', /./],
  ['che giorno era ieri', /giovedì 19 novembre/],
  ['che giorno sarà tra 10 giorni', /lunedì 30 novembre/],
  ['quanti giorni mancano a natale', /35 giorni a Natale/],
  ['quanti giorni mancano al 15 marzo', /al 15 marzo/],
  ['quanto manca al weekend', /Manca 1 giorno a sabato/],
  ['quanto fa 15 per 3', /fa 45/],
  ['quanto fa 120 diviso 7', /17,14/],
  ['il 20% di 150', /fa 30/],
  ['scorporo iva da 122', /imponibile è 100/],
  ['100 più iva', /122/],
  ['radice di 144', /12/],
  ['quanti chilometri sono 10 miglia', /16,09/],
  ['30 gradi celsius in fahrenheit', /86/],
  ['ricordami tra 10 minuti di togliere la pasta', /togliere la pasta/],
  ['raccontami una barzelletta', /./],
  ['che tempo fa domani', /internet/],
  ['buongiorno', /buonasera/i],
];
for (const [q, atteso] of CASI) test('chiacchiera: "' + q + '"', () => {
  const r = carica().rispondi(q, { ora });
  assert.ok(r, 'nessuna risposta');
  assert.match(r.testo, atteso);
});

test('"bene" dopo "E tu?" è una risposta, non un errore', () => {
  assert.match(carica().rispondi('bene grazie', { ora, ultima: 'Tutto bene. E tu come stai?' }).testo, /piacere|due|bello/);
});

test('i conti non vengono toccati', () => {
  const CH = carica();
  for (const q of ['cosa devo pagare', 'quanto ho speso a ottobre', 'che offerta ho', 'ci sono anomalie']) assert.strictEqual(CH.rispondi(q, { ora }), null, q);
});

test('timer: chiede di tenere aperta l\'app e passa i millisecondi', () => {
  const r = carica().rispondi('timer di 5 minuti', { ora });
  assert.strictEqual(r.timer.ms, 300000);
});

test('gioco: indovina il numero fino alla fine', () => {
  const CH = carica();
  CH.rispondi('giochiamo', { ora });
  const n = CH.stato.gioco.n;
  assert.match(CH.rispondi(String(n === 1 ? 2 : 1), { ora }).testo, /alto|basso|Di più|Di meno|Sali|Scendi/);
  assert.match(CH.rispondi(String(n), { ora }).testo, /Esatto/);
  assert.strictEqual(CH.stato.gioco, null);
});

test('fuori portata: mai due volte la stessa frase, e al secondo errore propone esempi', () => {
  const CH = carica();
  const a = CH.fuoriPortata('blu frigo'), b = CH.fuoriPortata('zorp');
  assert.notStrictEqual(a.testo, b.testo);
  assert.match(b.testo, /so fare/);
  assert.match(CH.fuoriPortata('chi era garibaldi').testo, /internet/);
});
