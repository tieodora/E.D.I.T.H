/**
 * Carica tutto il codice di apps-script/src in una sandbox Node con servizi Google finti,
 * così i test girano su GitHub senza toccare la tua posta né il tuo Sheet.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'apps-script', 'src');
const OGGI = new Date('2026-11-20T12:00:00');

function pad(n) { return String(n).padStart(2, '0'); }
function formatDate(d, tz, f) {
  const Y = d.getFullYear(), M = pad(d.getMonth() + 1), D = pad(d.getDate()), h = pad(d.getHours());
  return f.replace('yyyy', Y).replace('MM', M).replace('dd', D).replace('HH', h).replace('mm', pad(d.getMinutes()))
    .replace(/^d$/, String(d.getDate()));
}

/** Foglio finto: una tabella in memoria con le stesse funzioni di SpreadsheetApp che usa EDITH. */
class Foglio {
  constructor(nome, righe) { this.nome = nome; this.righe = righe || []; }
  getName() { return this.nome; }
  getLastRow() { return this.righe.length; }
  getLastColumn() { return this.righe.reduce((m, r) => Math.max(m, r.length), 0); }
  getRange(r, c, nr = 1, nc = 1) {
    const self = this;
    return {
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => ((self.righe[r - 1 + i] || [])[c - 1 + j] ?? ''))),
      getValue: () => (self.righe[r - 1] || [])[c - 1] ?? '',
      setValue: v => { while (self.righe.length < r) self.righe.push([]); self.righe[r - 1][c - 1] = v; },
      setValues(vs) { vs.forEach((row, i) => row.forEach((v, j) => { while (self.righe.length < r + i) self.righe.push([]); self.righe[r - 1 + i][c - 1 + j] = v; })); return this; },
      setNumberFormat() { return this; }, setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; },
    };
  }
  appendRow(r) { this.righe.push(r.slice()); }
  deleteRows(da, n) { this.righe.splice(da - 1, n); }
  setFrozenRows() {} autoResizeColumns() {}
}

function carica(opz = {}) {
  const props = Object.assign({}, opz.props || {});
  const fogli = {};
  const posta = [];
  const cache = {};
  class D extends Date {
    constructor(...a) { if (a.length) super(...a); else super(OGGI.getTime()); }
    static now() { return OGGI.getTime(); }
  }
  const ss = {
    getId: () => 'ID_TEST',
    getSheetByName: n => fogli[n] || null,
    insertSheet: n => (fogli[n] = new Foglio(n)),
  };
  let uuid = 0;
  const ctx = {
    console, Math, JSON, RegExp, String, Number, Array, Object, Boolean, Error, isNaN, parseFloat, parseInt, Infinity, encodeURIComponent,
    Date: D,
    Logger: { log: () => {} },
    Utilities: {
      formatDate,
      getUuid: () => 'aaaaaaaa-bbbb-cccc-dddd-' + String(++uuid).padStart(12, '0'),
      sleep: () => {},
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in props ? props[k] : null),
        getProperties: () => Object.assign({}, props),
        setProperty: (k, v) => { props[k] = String(v); },
        setProperties: o => Object.keys(o).forEach(k => { props[k] = String(o[k]); }),
        deleteProperty: k => { delete props[k]; },
      }),
    },
    CacheService: { getScriptCache: () => ({ get: k => (cache[k] === undefined ? null : cache[k]), put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => null, openById: () => ss },
    ScriptApp: { getProjectTriggers: () => [{ getHandlerFunction: () => 'elaboraTutto' }] },
    GmailApp: { sendEmail: (a, s, t, o) => posta.push({ a, s, t, o }) },
    Gmail: { Users: { getProfile: () => ({ emailAddress: 'io@example.com' }) } },
    Drive: { About: { get: () => ({ storageQuota: { usage: 5 * 2 ** 30, limit: 15 * 2 ** 30, usageInDrive: 2 * 2 ** 30 } }) } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ testo: t, setMimeType() { return this; } }) },
    HtmlService: { createHtmlOutput: h => ({ html: h, setTitle() { return this; } }) },
  };
  vm.createContext(ctx);
  const files = fs.readdirSync(SRC).filter(f => f.endsWith('.gs')).sort();
  // "const" e "let" in cima ai file diventano "var", così restano visibili dai test (in Apps Script sono globali).
  const codice = files.map(f => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n').replace(/^(const|let) /gm, 'var ');
  vm.runInContext(codice, ctx, { filename: 'EDITH.gs' });
  ctx.CONFIG.SHEET_ID = 'ID_TEST';
  ctx.__props = props; ctx.__fogli = fogli; ctx.__posta = posta;
  ctx.__foglio = (nome, righe) => (fogli[nome] = new Foglio(nome, righe));
  return ctx;
}

module.exports = { carica, OGGI };
