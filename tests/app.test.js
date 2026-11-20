// Controlli sull'app (index.html): i testi che arrivano dalle mail non devono poter eseguire codice.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const riga = nome => (HTML.match(new RegExp('^const ' + nome + ' = .*$', 'm')) || [])[0];
const ctx = {};
vm.createContext(ctx);
vm.runInContext([riga('esc'), riga('href')].join('\n').replace(/^const /gm, 'var '), ctx);

test('esc rende innocui i caratteri HTML', () => {
  assert.strictEqual(ctx.esc('<b>"Enel" & l\'altro</b>'), '&lt;b&gt;&quot;Enel&quot; &amp; l&#39;altro&lt;/b&gt;');
});

test('i link accettano solo https e mailto', () => {
  assert.strictEqual(ctx.href('https://mail.google.com/x'), 'https://mail.google.com/x');
  assert.strictEqual(ctx.href('mailto:stop@ditta.it'), 'mailto:stop@ditta.it');
  for (const cattivo of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,x', 'http://ditta.it', '', null]) {
    assert.strictEqual(ctx.href(cattivo), '#', String(cattivo));
  }
});

test('nessun testo dai dati dentro un onclick', () => {
  // esc() dentro un attributo onclick non basta: il browser ritrasforma &#39; in apostrofo prima di eseguire il codice
  const sospetti = HTML.split('\n').filter(r => /onclick="[^"]*'\s*\+\s*esc\(/.test(r));
  assert.deepStrictEqual(sospetti, []);
});

test('ogni link dai dati passa da href()', () => {
  const sospetti = HTML.split('\n').filter(r => [...r.matchAll(/href="' \+ (\w+)/g)].some(m => m[1] !== 'href'));
  assert.deepStrictEqual(sospetti, []);
});

test("l'app non usa più google.script.run e ha la CSP", () => {
  assert.ok(!/google\.script\.run/.test(HTML));
  assert.match(HTML, /http-equiv="Content-Security-Policy"/);
});
