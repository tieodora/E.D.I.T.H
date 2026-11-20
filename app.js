// EDITH – logica dell'app (voce, chiamate allo script, schermate)
const S = { dati: null, filtro: 'Tutte', storia: [], voce: false, posta: null, iscr: null };
const COL = ['--c1','--c2','--c3','--c4','--c5','--c6'].map(v => getComputedStyle(document.documentElement).getPropertyValue(v).trim());
const MESI = ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
const $ = id => document.getElementById(id);
const eur = n => n === null || n === undefined ? '—' : '€ ' + Number(n).toLocaleString('it-IT', {minimumFractionDigits:2, maximumFractionDigits:2});
const dt = s => s ? s.slice(8,10) + '/' + s.slice(5,7) + '/' + s.slice(0,4) : '—';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// i link arrivano dalle mail: accetto solo https e mailto, mai "javascript:" o simili
const href = u => /^(https:\/\/|mailto:)/i.test(String(u == null ? '' : u).trim()) ? esc(String(u).trim()) : '#';
function store(k, v){ try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch(e) { return null; } }

// L'app vive solo su GitHub Pages e chiama lo script via /exec con il token.
function mem(k, v){ try { if (v === undefined) return localStorage.getItem('edith_' + k); if (v === null) localStorage.removeItem('edith_' + k); else localStorage.setItem('edith_' + k, v); } catch(e) { return null; } }
// registro delle ultime chiamate (⚙︎ › Diagnostica), per capire dove si ferma
function diag(riga){ try { const d = JSON.parse(mem('diag') || '[]'); d.unshift(new Date().toLocaleTimeString('it-IT') + ' ' + riga); mem('diag', JSON.stringify(d.slice(0, 15))); } catch(e) {} }
async function tentativo(fn, args, ms){
  const ctl = window.AbortController ? new AbortController() : null;
  const t = setTimeout(() => ctl && ctl.abort(), ms);
  const t0 = Date.now();
  try {
    const res = await fetch(mem('url'), { method: 'POST', body: JSON.stringify({ k: mem('k'), f: fn, a: args }), signal: ctl ? ctl.signal : undefined, cache: 'no-store', redirect: 'follow' });
    const testo = await res.text();
    diag(fn + ' ' + res.status + ' in ' + (Date.now() - t0) + ' ms');
    return testo;
  } catch (e) {
    diag(fn + ' ' + (e && e.name === 'AbortError' ? 'senza risposta dopo ' : 'errore ' + (e && e.message) + ' dopo ') + (Date.now() - t0) + ' ms');
    throw e;
  } finally { clearTimeout(t); }
}
async function remoto(fn, args){
  // le domande normali lo script le risolve in pochi secondi: se una risposta si perde, riprovo una volta invece di aspettare
  const lunga = !/^(apiDati|apiChiedi|dati|chiedi)$/.test(fn) || (fn === 'apiChiedi' && /posta|mail|nuove bollette|aggiorna|controlla|elabora|novita/i.test(String(args[0] || '')));
  let testo;
  for (let i = 1; ; i++) {
    try { testo = await tentativo(fn, args, lunga ? 300000 : 15000); break; }
    catch (e) {
      if (e && e.name === 'AbortError') { if (!lunga && i < 2) continue; throw new Error('lo script ci sta mettendo troppo, riprova tra poco'); }
      if (i < 2 && navigator.onLine) { await new Promise(r => setTimeout(r, 800)); continue; }
      throw new Error(navigator.onLine ? 'lo script non risponde: controlla URL, accesso "Chiunque" e versione del deployment' : 'sei offline');
    }
  }
  let j; try { j = JSON.parse(testo); }
  catch (e) { throw new Error('il deployment non è accessibile a tutti: impostalo su "Chiunque"'); }
  if (!j.ok) { if (/token/i.test(j.errore || '')) mostraSetup(true, /scaduto/i.test(j.errore) ? 'Il token è scaduto: rilancia creaTokenVoce e incolla quello nuovo.' : 'Il token non è valido.'); throw new Error(j.errore || 'errore'); }
  if (j.k && j.k !== mem('k')) mem('k', j.k);   // token rinnovato in automatico
  return j.r;
}
function call(fn, ...args){
  return remoto(fn, args).catch(e => { toast('Errore: ' + e.message); throw e; });
}
function mostraSetup(si, err){
  $('setup').style.display = si ? 'block' : 'none';
  $('cfgU').value = mem('url') || ''; $('cfgK').value = mem('k') || ''; $('cfgErr').textContent = err || '';
  $('cfgConn').style.display = 'flex';
  $('cfgChiudi').style.display = mem('url') && mem('k') ? '' : 'none';
  if (si) { try { $('diag').textContent = JSON.parse(mem('diag') || '[]').join('\n') || 'nessuna chiamata registrata'; } catch(e) {} riempiVoci(); $('cfgParla').checked = S.voce; $('cfgAscolta').checked = mem('ascolto') !== '0'; $('cfgIA').checked = mem('ia2') !== '0'; $('cfgIAq').value = mem('ia_qualita') || 'veloce'; if (!navigator.gpu) iaStato('Su questo browser non è disponibile (manca WebGPU).'); else if (!IA.motore && !IA.caricamento) iaStato(mem('ia2') === '0' ? 'Spenta.' : 'Accesa: si sveglia da sola alla prima chiacchiera che le regole non conoscono.'); }
}
async function salvaSetup(){
  const u = $('cfgU').value.trim(), k = $('cfgK').value.trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(u)) { $('cfgErr').textContent = 'L\'URL deve iniziare con https://script.google.com/macros/s/ e finire con /exec.'; return; }
  if (k.length < 20) { $('cfgErr').textContent = 'Il token sembra troppo corto.'; return; }
  mem('url', u); mem('k', k);
  try { render(await remoto('apiDati', [])); mostraSetup(false); }
  catch (e) { $('cfgErr').textContent = 'Non riesco a collegarmi: ' + e.message + '.'; }
}
function toast(t){ const el = $('toast'); el.textContent = t; el.style.display = 'block'; clearTimeout(el._t); el._t = setTimeout(() => el.style.display = 'none', 3500); }
function conferma(titolo, testo){
  return new Promise(ok => {
    $('mT').textContent = titolo; $('mB').textContent = testo; $('modal').style.display = 'flex';
    $('mOk').onclick = () => { chiudiModal(); ok(true); };
    $('modal')._no = () => ok(false);
  });
}
function chiudiModal(){ $('modal').style.display = 'none'; if ($('modal')._no) { const f = $('modal')._no; $('modal')._no = null; f(); } }

function vai(v){
  document.querySelectorAll('section.view').forEach(s => s.classList.toggle('on', s.id === 'v-' + v));
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  if (v === 'posta' && !S.posta) caricaPosta();
  if (v === 'edith') setTimeout(() => { $('msgs').scrollTop = $('msgs').scrollHeight; }, 0);
  store('edith_view', v);
}

function pillStato(s){
  const m = {'Conclusa':'p-ok','Da pagare':'p-warn','Scaduta':'p-bad','Da verificare':'p-info'};
  return '<span class="pill ' + (m[s] || 'p-info') + '">' + esc(s || '—') + '</span>';
}

// ------------------------------------------------ HOME
function render(d, daCache){
  S.dati = d;
  const quando = daCache ? new Date(Number(mem('cache_t') || Date.now())) : new Date();
  const ora = quando.toLocaleTimeString('it-IT', {hour:'2-digit', minute:'2-digit'});
  $('sub').textContent = 'Anno ' + d.anno + ' · ' + (daCache ? 'dati delle ' + ora + (quando.toDateString() !== new Date().toDateString() ? ' del ' + quando.toLocaleDateString('it-IT') : '') + ', aggiorno…' : 'aggiornato ' + ora);
  // ultimi dati salvati sul telefono: l'app si apre subito e funziona anche senza rete
  if (!daCache) { mem('cache', JSON.stringify(d)); mem('cache_t', String(Date.now())); }
  $('kpis').innerHTML = [
    ['Bollette ' + d.anno, eur(d.kpi.bollette)], ['Media mensile', eur(d.kpi.media)],
    ['Assicurazioni ' + d.anno, eur(d.kpi.assicurazioni)], ['Da pagare', d.kpi.aperte ? d.kpi.aperte + ' · ' + eur(d.kpi.apertiTot) : 'Niente'],
  ].map(([l, v]) => '<div class="kpi"><span>' + l + '</span><b>' + v + '</b></div>').join('');

  const ap = d.aperte;
  S.aperte = ap;   // il tasto "Pagata" passa solo la posizione: nessun testo delle mail finisce dentro onclick
  $('apertiTot').textContent = ap.length ? '' : '';
  $('aperte').innerHTML = ap.length ? ap.map((p, i) =>
    '<div class="row"><div class="t"><b>' + esc(p.tipo) + ' · ' + esc(p.chi) + '</b><small>Scadenza ' + dt(p.scadenza) + ' ' + pillStato(p.stato) + '</small></div>' +
    '<div class="center"><div class="amt">' + eur(p.importo) + '</div>' +
    (p.stato === 'Da verificare' ? '<a href="' + href(p.link) + '" target="_blank" rel="noopener">apri mail</a>'
      : '<button class="small" onclick="pagata(' + i + ')">Pagata ✓</button>') +
    '</div></div>').join('') : '<p class="muted">Niente da pagare.</p>';

  $('tMesi').textContent = 'Bollette ' + d.anno + ' per mese';
  const max = Math.max(1, ...d.mesi.map(m => m.totale));
  $('chart').innerHTML = d.mesi.map(m =>
    '<div class="col" title="' + MESI[m.mese-1] + ': ' + eur(m.totale) + '">' +
    d.tipi.map((t, i) => m.perTipo[t] ? '<div class="seg" style="height:' + (m.perTipo[t] / max * 100) + '%;background:' + COL[i % COL.length] + '"></div>' : '').join('') +
    '<div class="lab">' + MESI[m.mese-1] + '</div></div>').join('');
  $('legend').innerHTML = d.tipi.map((t, i) => '<span><i style="background:' + COL[i % COL.length] + '"></i>' + esc(t) + '</span>').join('') || '<span>Nessuna bolletta quest\'anno</span>';
  $('perTipo').innerHTML = barre(d.perTipo);
  $('perRamo').innerHTML = barre(d.perRamo);
  renderLista(); renderAnomalie(d); renderOfferte(d); renderSpese(d);
}
function barre(lista){
  if (!lista.length) return '<p class="muted">Nessun dato per quest\'anno.</p>';
  const max = Math.max(...lista.map(x => x.totale), 1);
  return lista.sort((a, b) => b.totale - a.totale).map((x, i) =>
    '<div class="hbar"><div class="top"><span>' + esc(x.nome) + '</span><b class="amt">' + eur(x.totale) + '</b></div>' +
    '<div class="track"><div class="fill" style="width:' + (x.totale / max * 100) + '%;background:' + COL[i % COL.length] + '"></div></div></div>').join('');
}

async function pagata(i){
  const p = (S.aperte || [])[i]; if (!p) return;
  if (!await conferma('Segnare come pagata?', p.tipo + ' ' + p.chi + '\nLo stato diventa "Conclusa" e l\'attività in Calendar viene spuntata.')) return;
  render(await call('apiSegnaPagata', p.foglio, p.riga));
  toast('Segnata come pagata ✓');
}
async function elabora(){
  const b = $('btnElabora'); b.disabled = true; b.classList.add('gira');
  try {
    const r = await call('apiElabora');
    render(r.dati);
    toast(r.log.length ? r.log[r.log.length - 1] : 'Nessuna novità nella posta');
  } finally { b.disabled = false; b.classList.remove('gira'); }
}

// ------------------------------------------------ PRATICHE
function renderLista(){
  const filtri = ['Tutte', 'Bollette', 'Assicurazioni', 'Da pagare', 'Da verificare'];
  $('filtri').innerHTML = filtri.map(f => '<button class="chip' + (S.filtro === f ? ' on' : '') + '" onclick="S.filtro=\'' + f + '\';renderLista()">' + f + '</button>').join('');
  const P = (S.dati ? S.dati.pratiche : []).filter(p =>
    S.filtro === 'Tutte' || (S.filtro === 'Bollette' && p.area === 'bollette') || (S.filtro === 'Assicurazioni' && p.area === 'assicurazioni') ||
    (S.filtro === 'Da pagare' && (p.stato === 'Da pagare' || p.stato === 'Scaduta')) || (S.filtro === 'Da verificare' && p.stato === 'Da verificare'));
  $('lista').innerHTML = P.length ? P.map(p =>
    '<div class="row"><div class="t"><b>' + '<i class="tag ' + (p.area === 'assicurazioni' ? 'tag-a' : 'tag-b') + '"></i>' + esc(p.tipo) + ' · ' + esc(p.chi) + '</b>' +
    '<small>' + (p.emissione ? 'Emessa ' + dt(p.emissione) + ' · ' : '') + 'Scad. ' + dt(p.scadenza) + ' ' + pillStato(p.stato) +
    (p.link ? ' · <a href="' + href(p.link) + '" target="_blank" rel="noopener">mail</a>' : '') + '</small></div>' +
    '<div class="amt">' + eur(p.importo) + '</div></div>').join('') : '<p class="muted">Nessuna pratica.</p>';
}

// ------------------------------------------------ POSTA
async function caricaPosta(){
  const [p, i] = await Promise.all([call('apiPulizia'), call('apiIscrizioni')]);
  S.posta = p; S.iscr = i; renderPosta();
}
function renderPosta(){
  const s = S.posta && S.posta.spazio;
  $('spazio').innerHTML = s ? '<div class="meter"><div style="width:' + Math.min(100, s.usato / s.limite * 100) + '%"></div></div>' +
    '<b>' + s.usato + ' GB</b> usati su ' + s.limite + ' GB · Gmail e Foto ' + s.altro + ' GB · Drive ' + s.drive + ' GB' : 'Non disponibile';

  const I = S.iscr ? S.iscr.righe : [];
  $('iscr').innerHTML = I.length ? I.slice(0, 80).map(r =>
    '<div class="row"><div class="t"><b>' + esc(r['MITTENTE']) + '</b><small>' + r['N. MAIL'] + ' mail · ' + r['MB STIMATI'] + ' MB · ' + esc(r['METODO']) +
    (r['ESITO'] ? '<br>' + esc(r['ESITO']) : '') + (/Manuale/.test(r['METODO']) && r['LINK DISISCRIZIONE'] ? ' · <a href="' + href(r['LINK DISISCRIZIONE']) + '" target="_blank" rel="noopener">apri link</a>' : '') + '</small></div>' +
    '<select onchange="call(\'apiSalvaAzione\',' + r.riga + ',this.value).then(()=>{S.iscr.righe.find(x=>x.riga==' + r.riga + ').AZIONE=this.value;const x=S.iscr.righe.find(y=>y.riga==' + r.riga + ');x.ESITO=\'\';toast(\'Salvato\')})">' +
    S.iscr.azioni.map(a => '<option' + (a === r['AZIONE'] ? ' selected' : '') + '>' + esc(a) + '</option>').join('') + '</select></div>').join('')
    : 'Nessuna iscrizione analizzata. Tocca "Analizza".';

  const R = S.posta ? S.posta.regole : [];
  $('regole').innerHTML = R.length ? R.map(r =>
    '<div class="row"><div class="t"><b>' + esc(r['REGOLA']) + '</b><small>' + esc(r['AZIONE']) + ' · ' +
    (r['MAIL TROVATE'] !== '' && r['MAIL TROVATE'] !== undefined ? r['MAIL TROVATE'] + ' mail, ~' + r['MB STIMATI'] + ' MB' : 'anteprima da fare') +
    (r['ESITO'] ? '<br>' + esc(r['ESITO']) : '') + '</small></div>' +
    '<input type="checkbox"' + (r['ESEGUI'] === true ? ' checked' : '') + ' onchange="spunta(\'PULIZIA\',' + r.riga + ',\'ESEGUI\',this.checked)"></div>').join('') : '—';

  const H = S.posta ? S.posta.pesanti : [];
  const mb = arr => arr.reduce((t, r) => t + Number(r['MB'] || 0), 0);
  const sel = H.filter(r => r['CESTINA'] === true);
  const gb = x => x >= 1024 ? (x / 1024).toFixed(2).replace('.', ',') + ' GB' : Math.round(x) + ' MB';
  $('pesantiTot').innerHTML = H.length ? '<b>' + gb(mb(H)) + '</b> in ' + H.length + ' mail · selezionate: <b>' + sel.length + '</b> (' + gb(mb(sel)) + ')' +
    ' <button class="ghost small" onclick="selTutte(' + (sel.length < H.length) + ')">' + (sel.length < H.length ? 'Seleziona tutte' : 'Deseleziona') + '</button>' : '';
  $('pesanti').innerHTML = H.length ? H.map(r =>
    '<div class="row"><div class="t"><b>' + esc(r['OGGETTO']) + '</b><small>' + esc(String(r['MITTENTE']).replace(/<.*>/, '')) + ' · ' + dt(r['DATA']) +
    ' · <a href="' + href(r['LINK']) + '" target="_blank" rel="noopener">apri</a></small></div><div class="amt">' + r['MB'] + ' MB</div>' +
    '<input type="checkbox"' + (r['CESTINA'] === true ? ' checked' : '') + ' onchange="spunta(\'MAIL PESANTI\',' + r.riga + ',\'CESTINA\',this.checked)"></div>').join('')
    : 'Tocca "Aggiorna" per elencare le mail oltre 5 MB.';
}
async function selTutte(v){
  const H = S.posta ? S.posta.pesanti : [];
  await call('apiSpuntaTutte', 'MAIL PESANTI', 'CESTINA', v);
  H.forEach(r => { r['CESTINA'] = v; });
  renderPosta();
}
function spunta(foglio, riga, col, val){
  call('apiSpunta', foglio, riga, col, val).then(() => {
    const lista = foglio === 'PULIZIA' ? S.posta.regole : S.posta.pesanti;
    const r = lista.find(x => x.riga === riga); if (r) r[col] = val;
    if (foglio !== 'PULIZIA') renderPosta();
  });
}
async function lento(btnTesto, fn, ...args){ toast(btnTesto + '… può richiedere qualche minuto'); return call(fn, ...args); }
async function analizzaIscr(){ S.iscr = await lento('Analizzo le newsletter', 'apiAnalizzaIscrizioni'); renderPosta(); toast('Fatto'); }
async function anteprima(){ S.posta = await lento('Calcolo l\'anteprima', 'apiAnteprimaPulizia'); renderPosta(); toast('Anteprima pronta'); }
async function reportPes(){ S.posta = await lento('Cerco le mail pesanti', 'apiReportPesanti'); renderPosta(); toast('Fatto'); }
async function eseguiIscr(){
  const sc = (S.iscr ? S.iscr.righe : []).filter(r => r['AZIONE'] && r['AZIONE'] !== 'Tieni' && !/^OK/.test(String(r['ESITO'])));
  if (!sc.length) return toast('Scegli prima un\'azione diversa da "Tieni"');
  const n = sc.filter(r => /cestina/i.test(r['AZIONE'])).reduce((s, r) => s + Number(r['N. MAIL'] || 0), 0);
  if (!await conferma('Eseguire ' + sc.length + ' azioni?', sc.map(r => '• ' + r['EMAIL'] + ' → ' + r['AZIONE']).join('\n') +
    '\n\nCirca ' + n + ' mail finiranno nel Cestino (recuperabili per 30 giorni).')) return;
  S.iscr = await lento('Eseguo', 'apiEseguiIscrizioni'); renderPosta();
  const e = S.iscr.esito || {};
  toast('Fatto: ' + (e.ok || 0) + ' azioni riuscite' + (e.errori ? ', ' + e.errori + ' con errore (vedi sotto)' : '') + (e.aMano ? ', ' + e.aMano + ' da completare a mano con "apri link"' : '') + '.');
}
async function eseguiPul(){
  const sc = (S.posta ? S.posta.regole : []).filter(r => r['ESEGUI'] === true);
  if (!sc.length) return toast('Spunta prima le regole da applicare');
  if (!await conferma('Applicare ' + sc.length + ' regole?', sc.map(r => '• ' + r['REGOLA'] + ' → ' + r['AZIONE'] + ' (' + (r['MAIL TROVATE'] || '?') + ' mail)').join('\n') +
    '\n\nStelle, importanti, bollette e assicurazioni sono escluse. Il Cestino si svuota da solo dopo 30 giorni.')) return;
  S.posta = await lento('Pulisco', 'apiEseguiPulizia'); renderPosta(); toast('Pulizia eseguita');
}
async function cestinaPes(){
  const sc = (S.posta ? S.posta.pesanti : []).filter(r => r['CESTINA'] === true);
  if (!sc.length) return toast('Spunta prima le mail da cestinare');
  const mb = sc.reduce((s, r) => s + Number(r['MB'] || 0), 0).toFixed(1);
  if (!await conferma('Cestinare ' + sc.length + ' mail?', 'Liberi circa ' + mb + ' MB quando il Cestino si svuota (dopo 30 giorni, o subito se lo svuoti tu).')) return;
  S.posta = await lento('Sposto nel Cestino', 'apiCestinaPesanti'); renderPosta(); toast('Fatto');
}


// ------------------------------------------------ altre spese (affitto, benzina...)
function renderSpese(d){
  const sp = d.spese;
  $('cSpese').style.display = sp && (sp.mese || (sp.ultime || []).length) ? '' : 'none';
  if (!sp) return;
  const e = n => '€ ' + Number(n).toFixed(2).replace('.', ',');
  $('speseTot').textContent = e(sp.mese || 0);
  const max = Math.max.apply(null, (sp.perTipo || []).map(x => x.totale).concat([1]));
  $('spese').innerHTML = (sp.perTipo || []).map(x => '<div class="row"><div class="t"><b>' + esc(x.nome) + '</b><small><span class="bar" style="display:block;height:4px;border-radius:2px;background:var(--accent);width:' + Math.round(x.totale / max * 100) + '%"></span></small></div><b>' + esc(e(x.totale)) + '</b></div>').join('') || '<div class="muted">Nessuna spesa questo mese.</div>';
}

// ------------------------------------------------ offerte in corso (lette dalle bollette)
function renderOfferte(d){
  const O = d.offerte || [];
  $('cOfferte').style.display = O.length ? '' : 'none';
  const n = (v, dec) => String(v).replace('.', ',');
  const dt = s => s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '';
  $('offerte').innerHTML = O.map(o => {
    const v = [];
    if (o.tipoPrezzo) v.push(['Prezzo', o.tipoPrezzo]);
    if (o.prezzoLuce) v.push(['Luce', n(o.prezzoLuce) + ' €/kWh']);
    if (o.prezzoGas) v.push(['Gas', n(o.prezzoGas) + ' €/Smc']);
    if (o.quotaFissa) v.push(['Quota fissa', '€ ' + o.quotaFissa.toFixed(2).replace('.', ',') + '/mese']);
    if (o.potenza) v.push(['Potenza', n(o.potenza) + ' kW']);
    if (o.scadenza) v.push(['Condizioni fino al', dt(o.scadenza)]);
    if (o.consumoLuce) v.push(['Consumo annuo luce', o.consumoLuce + ' kWh']);
    if (o.consumoGas) v.push(['Consumo annuo gas', o.consumoGas + ' Smc']);
    if (o.pod) v.push(['POD', o.pod]);
    if (o.pdr) v.push(['PDR', o.pdr]);
    return '<div class="off"><b>' + esc(o.chi) + (o.offerta ? ' · ' + esc(o.offerta) : '') + '</b><small>' + esc(o.tipo) + (o.mercato ? ' · mercato ' + esc(o.mercato.toLowerCase()) : '') + (o.da ? ' · dalla bolletta del ' + dt(o.da) : '') + '</small>' +
      '<dl>' + v.map(([k, x]) => '<dt>' + esc(k) + '</dt><dd>' + esc(x) + '</dd>').join('') + '</dl></div>';
  }).join('');
}

// ------------------------------------------------ controllo sistema (Home)
function renderAnomalie(d){
  const a = d.anomalie || [];
  $('anomalie').innerHTML = a.length ? a.map(x => '<div class="anom"><i class="' + esc(x.livello) + '"></i><div>' + esc(x.testo) + '</div></div>').join('')
    : '<div class="anom"><i class="basso" style="background:var(--ok);box-shadow:0 0 8px var(--ok)"></i><div>Tutto in ordine.</div></div>';
}

// ------------------------------------------------ EDITH: apri l'app e parla
// Ascolta finché l'app è aperta e in primo piano. Quando la chiudi o cambi app, smette.
const VERSIONE = '20 nov · v16';
const V = { voluto: false, rec: null, parlando: false, pensando: false, pausa: false, voceBloccata: false, daDire: null, ultimoRisultato: 0 };
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

function stato(t){
  $('stato').textContent = t;
  const o = $('orb');
  o.classList.toggle('ascolta', !!V.rec && !V.parlando && !V.pensando);
  o.classList.toggle('pensa', V.pensando);
  o.classList.toggle('pausa', V.pausa || (!V.rec && !V.parlando && !V.pensando));
}
function aggiornaStato(){
  if (V.parlando) return stato('Parlo');
  if (V.pensando) return stato('Ci penso…');
  if (V.pausa) return stato('In pausa · tocca la sfera');
  if (!SR) return stato('Scrivi qui sotto');
  if (V.rec) return stato('Ti ascolto');
  return stato(V.voluto ? 'Un attimo…' : 'Tocca la sfera per parlare');
}

function avviaAscolto(){
  if (!SR || V.rec || V.parlando || V.pensando || V.pausa || document.visibilityState !== 'visible') return aggiornaStato();
  V.voluto = true;
  let r;
  try { r = new SR(); } catch(e) { return aggiornaStato(); }
  r.lang = 'it-IT'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
  let errore = '';
  r.onresult = e => {
    let parz = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) {
        $('sentito').textContent = '';
        const conf = e.results[i][0].confidence;
        if (conf > 0 && conf < 0.4) continue;            // capito male: probabilmente rumore
        if (eco(t)) continue;                              // è la mia voce rimasta nel microfono
        capito(t); return;
      }
      parz += t;
    }
    $('sentito').textContent = parz;
    livello(.35);   // la sfera reagisce anche quando parli tu
  };
  r.onerror = e => { errore = e.error; };
  r.onend = () => {
    V.rec = null;
    if (errore === 'not-allowed' || errore === 'service-not-allowed') {
      V.voluto = false; aggiornaStato(); $('sentito').textContent = 'Il microfono è bloccato: consentilo per questo sito nelle impostazioni del browser, poi tocca la sfera.'; return;
    }
    // riparte da solo finché l'app è aperta (Chrome chiude l'ascolto dopo qualche secondo di silenzio)
    if (V.voluto && !V.parlando && !V.pensando && !V.pausa && document.visibilityState === 'visible') setTimeout(avviaAscolto, errore === 'network' ? 1500 : 150);
    else aggiornaStato();
  };
  try { r.start(); V.rec = r; } catch(e) { V.rec = null; }
  aggiornaStato();
}
// Mentre EDITH parla: ignora qualsiasi rumore o voce, si ferma solo con "stop" (o basta, zitta, fermati).
const PAROLE_STOP = /\b(stop|basta|zitta|fermati|ferma|silenzio|smettila|taci)\b/i;
function ascoltaStop(){
  if (!SR || !V.parlando || V.stopRec || mem('ascolto_stop') === '0' || document.visibilityState !== 'visible') return;
  let r; try { r = new SR(); } catch(e) { return; }
  r.lang = 'it-IT'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 3;
  r.onresult = e => {
    for (let i = e.resultIndex; i < e.results.length; i++)
      for (let j = 0; j < e.results[i].length; j++)
        if (PAROLE_STOP.test(e.results[i][j].transcript)) { V.stopDetto = true; fermaStop(); try { speechSynthesis.cancel(); } catch(x) {} return setTimeout(() => { if (V.parlando) { V.parlando = false; aggiornaStato(); riprendi(); } }, 700); }
    // tutto il resto (radio, altre persone, la mia stessa voce) lo ignoro
  };
  r.onerror = () => {};
  r.onend = () => { V.stopRec = null; if (V.parlando) setTimeout(ascoltaStop, 200); };
  try { r.start(); V.stopRec = r; V.stopAttivo = true; } catch(e) { V.stopRec = null; }
}
function fermaStop(){ const r = V.stopRec; V.stopRec = null; V.stopAttivo = false; if (r) { r.onend = null; try { r.abort(); } catch(e) {} } }
function fermaAscolto(){
  const r = V.rec; V.rec = null;
  if (r) { r.onend = null; try { r.abort(); } catch(e) {} }
  aggiornaStato();
}
function spegniTutto(){
  V.voluto = false; fermaAscolto(); fermaStop();
  try { speechSynthesis.cancel(); } catch(e) {}
  V.parlando = false; livello(0); aggiornaStato();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { if (mem('ascolto') !== '0' && !V.pausa) avviaAscolto(); }
  else spegniTutto();
});
window.addEventListener('pagehide', spegniTutto);

function tocco(){
  sbloccaVoce();
  if (V.parlando) { V.stopDetto = true; try { speechSynthesis.cancel(); } catch(e) {} return; }   // tocca per interrompere
  if (V.pausa || !V.rec) { V.pausa = false; avviaAscolto(); }
  else { V.pausa = true; fermaAscolto(); }
}

// ------------------------------------------------ cosa hai detto
const SI = /^(si|sì|certo|conferma|confermo|vai|ok|okay|esatto|procedi|fallo)(?=[\s.,!]|$)/i;
const NO = /^(no|annulla|lascia stare|non ancora|aspetta)(?=[\s.,!]|$)/i;
// la frase sentita è quasi uguale a quello che ho appena detto io?
function eco(t){
  const ult = (S.storia.filter(x => x.ruolo === 'edith').pop() || {}).testo || '';
  const a = norm(t).split(' ').filter(w => w.length > 2), b = new Set(norm(ult).split(' '));
  return a.length >= 3 && a.filter(w => b.has(w)).length / a.length > 0.7;
}
function capito(t){ t = t.trim(); if (t) chiedi(t, true); }
function invia(){ const q = $('q').value.trim(); if (!q) return; $('q').value = ''; sbloccaVoce(); chiedi(q, false); }

function bolla(chi, testo, extra){
  const d = document.createElement('div'); d.className = 'b ' + chi + (extra ? ' ' + extra : '');
  d.textContent = testo;
  $('msgs').appendChild(d); $('msgs').scrollTop = $('msgs').scrollHeight; return d;
}

async function chiedi(q, aVoce){
  if (V.pensando) return;
  const io = bolla('me', q);
  if (S.attesa) {
    const az = S.attesa, t = q.trim().toLowerCase();
    if (SI.test(t)) return az.si();
    if (NO.test(t)) return az.no();
    az.chiudi();
  }
  // conversazione: risponde subito dal telefono, senza rete (i conti invece vanno sempre allo script)
  if (!CONTI.test(q) || CH.stato.gioco) {
    const ult = S.storia.filter(x => x.ruolo === 'edith').map(x => x.testo).pop();
    const loc = CH.rispondi(q, { ultima: ult });
    if (loc) { CH.capita(); S.storia.push({ ruolo: 'io', testo: q }); if (loc.timer) avviaTimer(loc.timer); return rispondi(loc.testo, !!loc.fine); }
  }
  V.pensando = true; fermaAscolto(); aggiornaStato();
  let r;
  try { r = await call('apiChiedi', q, S.storia.slice(-8)); }
  catch(e) { V.pensando = false; return rispondi('Non riesco a raggiungere i tuoi dati: ' + String(e && e.message || e).replace(/^Error:\s*/, '') + '.'); }
  V.pensando = false;
  // a voce, una frase corta che non capisco è quasi sempre rumore (radio, altre persone): la ignoro
  if (aVoce && r.capito === false && norm(q).split(' ').length < 4) { io.classList.add('piano'); setTimeout(() => io.remove(), 2500); return riprendi(); }
  const chiacchiera = r.capito === false && !!navigator.gpu && mem('ia2') !== '0' && !CONTI.test(q) && (!aVoce || norm(q).split(' ').length >= 3);
  if (chiacchiera && !IA.motore) caricaIA().catch(() => {});   // la sveglio solo quando serve; intanto rispondono le regole
  if (chiacchiera && IA.motore) {
    V.pensando = true; aggiornaStato();
    const b = bolla('ed', '', 'ia scrive');
    let t = null;
    try { t = await Promise.race([chiediIA(q, b), new Promise(ok => setTimeout(() => ok(null), 17000))]); }
    catch(e) {} finally { V.pensando = false; b.classList.remove('scrive'); }
    b.remove();
    if (t) { S.storia.push({ ruolo: 'io', testo: q }); return rispondi(t, false, '', 'ia'); }
  }
  // fuori portata: risposta gentile e sempre diversa (tengo i "Intendevi…?" dello script, che sono utili)
  if (r.capito === false && !/intendevi/i.test(r.testo)) r = Object.assign({}, r, { testo: CH.fuoriPortata(q).testo });
  else if (r.capito !== false) CH.capita();
  S.storia.push({ ruolo: 'io', testo: q });
  const bb = rispondi(r.testo, !!r.fine, r.seguito);
  if (r.azione && r.azione.tipo === 'pagata') chiediConferma(bb, r.azione);
  if (r.aggiorna) call('apiDati').then(render).catch(() => {});
}

function rispondi(testo, fine, seguito, extra){
  const b = bolla('ed', testo, extra);
  S.storia.push({ ruolo: 'edith', testo: testo, seguito: seguito || '' });
  if (fine) V.pausa = true;
  parla(testo, riprendi);
  return b;
}
function riprendi(){ aggiornaStato(); if (mem('ascolto') !== '0' || V.voluto) avviaAscolto(); }

function chiediConferma(bb, a){
  const box = document.createElement('div'); box.className = 'actions';
  const no = document.createElement('button'); no.className = 'ghost small'; no.textContent = 'No';
  const si = document.createElement('button'); si.className = 'small'; si.textContent = 'Sì, segna pagata';
  const az = { chiudi: () => { box.remove(); S.attesa = null; } };
  az.no = () => { az.chiudi(); rispondi('Va bene, lascio tutto com\'è.'); };
  az.si = async () => {
    az.chiudi();
    try { render(await call('apiSegnaPagata', a.foglio, a.riga)); rispondi('Fatto: ' + a.nome + ' è segnata come pagata e il promemoria è spuntato.'); }
    catch(e) { rispondi('Non sono riuscita a segnarla.'); }
  };
  no.onclick = () => { bolla('me', 'No'); az.no(); };
  si.onclick = () => { bolla('me', 'Sì'); az.si(); };
  box.append(no, si); bb.appendChild(box); S.attesa = az;
}

// ------------------------------------------------ voce e sfera che si muove mentre parla
function punteggioVoce(v){
  let p = 0; const n = v.name;
  if (/premium|enhanced|avanzat|natural|neural|wavenet|siri/i.test(n)) p += 10;
  if (/google/i.test(n)) p += 6;
  if (!v.localService) p += 2;
  if (/federica|alice|elsa|isabella|emma|bianca|carla/i.test(n)) p += 2;
  if (/compact|espeak|eloquence|grandma|grandpa|nonna|nonno|rocko|shelley|flo|reed|sandy/i.test(n)) p -= 8;
  return p;
}
function vociIt(){ try { return speechSynthesis.getVoices().filter(v => /^it/i.test(v.lang)).sort((a, b) => punteggioVoce(b) - punteggioVoce(a)); } catch(e) { return []; } }
function voceScelta(){ const v = vociIt(), n = mem('voce_nome'); return v.find(x => x.name === n) || v[0] || null; }
function riempiVoci(){
  const v = vociIt(), sel = $('cfgVoce'), sc = voceScelta();
  sel.innerHTML = v.length ? v.map(x => '<option' + (sc && x.name === sc.name ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') : '<option>Nessuna voce italiana trovata</option>';
}
try { speechSynthesis.onvoiceschanged = () => { if ($('setup').style.display === 'block') riempiVoci(); }; speechSynthesis.getVoices(); } catch(e) {}

// I browser fanno parlare una pagina solo dopo un primo tocco: il primo tocco "sblocca" la voce.
function sbloccaVoce(){
  if (!V.voceBloccata && V.sbloccata) return;
  V.sbloccata = true;
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch(e) {}
  if (V.voceBloccata) { V.voceBloccata = false; $('sentito').textContent = ''; if (V.daDire) { const t = V.daDire; V.daDire = null; parla(t, riprendi); } }
}
document.addEventListener('pointerdown', sbloccaVoce, { passive: true });

let lv = 0, anim = 0, ultimaParola = 0;
function livello(x){ lv = Math.max(lv, x); if (!anim) anim = requestAnimationFrame(passo); }
function passo(){
  // mentre parla: impulsi sulle parole (eventi del sintetizzatore) + un ritmo di sillabe se il telefono non li manda
  if (V.parlando && performance.now() - ultimaParola > 140) { lv = Math.max(lv, .25 + Math.random() * .55); ultimaParola = performance.now() - Math.random() * 60; }
  lv *= V.parlando ? .86 : .9;
  $('orb').style.setProperty('--l', lv.toFixed(3));
  if (lv > .01 || V.parlando) anim = requestAnimationFrame(passo); else { anim = 0; $('orb').style.setProperty('--l', 0); }
}

function parla(testo, poi){
  const inizio = performance.now(), stimaMs = 1500 + testo.length * 75;
  const fine = () => {
    if (!V.parlando) return;
    // alcuni Android segnalano la fine troppo presto: se sta ancora parlando aspetto, così non ascolto me stessa
    if (window.speechSynthesis && speechSynthesis.speaking && performance.now() - inizio < stimaMs * 2) { setTimeout(fine, 300); return; }
    // se la voce si è spenta subito dopo aver acceso l'ascolto dello "stop", su questo telefono le due cose non convivono: lo disattivo
    if (V.stopAttivo && performance.now() - inizio < stimaMs * 0.35 && !V.stopDetto) { mem('ascolto_stop', '0'); }
    V.parlando = false; fermaStop(); aggiornaStato(); if (poi) setTimeout(poi, 350);
  };
  if (!S.voce || !('speechSynthesis' in window)) { if (poi) poi(); return; }
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(testo.replace(/€\s?([\d.]+),00\b/g, '$1 euro').replace(/€\s?([\d.]+),(\d\d)\b/g, '$1 euro e $2').replace(/€\s?/g, ''));
    u.lang = 'it-IT'; u.rate = 1; u.pitch = 1;
    const v = voceScelta(); if (v) u.voice = v;
    u.onstart = () => { V.parlando = true; aggiornaStato(); livello(.6); };
    u.onboundary = () => { ultimaParola = performance.now(); livello(.75 + Math.random() * .25); };
    u.onend = fine;
    u.onerror = e => {
      if (e.error === 'not-allowed') { V.voceBloccata = true; V.daDire = testo; $('sentito').textContent = 'Tocca lo schermo una volta per sentire la mia voce.'; V.parlando = true; fine(); return; }
      V.parlando = true; fine();
    };
    V.parlando = true; V.stopDetto = false; fermaAscolto(); aggiornaStato(); livello(.4);
    speechSynthesis.speak(u);
    setTimeout(ascoltaStop, 700);   // mentre parlo, ascolto solo la parola stop

    // rete di sicurezza: se il telefono non segnala la fine
    const stima = 1500 + testo.length * 75;
    setTimeout(() => { if (V.parlando && !speechSynthesis.speaking) fine(); }, stima);
    setTimeout(() => { if (V.parlando) { try { speechSynthesis.cancel(); } catch(e) {} fine(); } }, stima * 2 + 4000);
  } catch(e) { V.parlando = false; if (poi) poi(); }
}

// <chiacchiere>
// Skill di conversazione che girano sul telefono: rispondono subito, anche senza rete.
// I conti restano allo script: qui niente bollette, spese o scadenze.
const CH = (() => {
  const n = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9%,.\s+*\/x-]/g, ' ').replace(/\s+/g, ' ').trim();
  const caso = a => a[Math.floor(Math.random() * a.length)];
  const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  const NUM = { zero: 0, uno: 1, una: 1, un: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10, undici: 11, dodici: 12, quindici: 15, venti: 20, trenta: 30, quaranta: 40, cinquanta: 50, sessanta: 60, cento: 100, mille: 1000, mezzo: 0.5, mezza: 0.5 };
  const num = s => { s = String(s).replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'); return s in NUM ? NUM[s] : parseFloat(s); };
  const fmt = x => { const r = Math.round(x * 100) / 100; return String(r).replace('.', ','); };
  const giorno = d => GIORNI[d.getDay()] + ' ' + d.getDate() + ' ' + MESI[d.getMonth()] + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '');
  const tra = (a, b) => Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()) - new Date(a.getFullYear(), a.getMonth(), a.getDate())) / 864e5);
  const FESTE = { natale: [11, 25], 'vigilia di natale': [11, 24], capodanno: [0, 1], 'san silvestro': [11, 31], ferragosto: [7, 15], epifania: [0, 6], befana: [0, 6], 'san valentino': [1, 14], halloween: [9, 31], 'festa della donna': [2, 8], 'festa della repubblica': [5, 2], 'liberazione': [3, 25], 'primo maggio': [4, 1], 'festa dei lavoratori': [4, 1], 'tutti i santi': [10, 1], 'immacolata': [11, 8], 'santo stefano': [11, 26] };
  const BARZELLETTE = [
    'Sai qual è la bolletta più leggera? Quella già pagata.',
    'Cosa fa un\'ape in palestra? Zum-ba.',
    'Qual è il colmo per un elettricista? Non fare scintille con la fidanzata.',
    'Perché il libro di matematica è triste? Perché ha troppi problemi.',
    'Cosa dice un muro a un altro muro? Ci vediamo all\'angolo.',
    'Qual è il colmo per un giardiniere? Avere un pollice verde e lasciarci le penne.',
    'Che cosa fa un gatto in banca? Chiede un prestito... miao-rato.',
    'Perché gli scheletri non litigano mai? Perché non hanno fegato.',
  ];
  const CURIOSITA = [
    'Le api riconoscono i volti umani, più o meno come noi riconosciamo le facce dei cartoni.',
    'Il miele non scade: ne hanno trovato di commestibile nelle tombe egizie.',
    'Una nuvola media pesa circa 500 tonnellate, come cento elefanti, eppure galleggia.',
    'Il cuore di un colibrì può battere più di mille volte al minuto.',
    'In Italia ci sono più di 1.300 tipi di pane diversi.',
    'Il polpo ha tre cuori e il sangue blu.',
    'La Torre Eiffel d\'estate cresce di circa 15 centimetri per il caldo.',
    'Un fulmine è circa cinque volte più caldo della superficie del Sole.',
    'Le lontre si tengono per mano quando dormono, per non allontanarsi.',
    'Il Monte Bianco cambia altezza di anno in anno, a seconda della neve in cima.',
  ];
  const MOTIVAZIONE = [
    'Un passo alla volta, Teo: anche le montagne si scalano così.',
    'Non devi fare tutto oggi. Devi solo fare la prossima cosa.',
    'Sei più brava di quanto pensi, e i tuoi conti in ordine lo dimostrano.',
    'Le giornate difficili finiscono. Tu invece resti, e sei forte.',
    'Fatto è meglio di perfetto.',
  ];
  const s = { gioco: null, attesa: null, timer: [] };

  function calcola(t) {
    let m;
    if ((m = t.match(/(\d+(?:[.,]\d+)?)\s*(?:%|per ?cento)\s*(?:di|del|dei|della)\s*(\d+(?:[.,]\d+)?)/))) return 'Il ' + fmt(num(m[1])) + '% di ' + fmt(num(m[2])) + ' fa ' + fmt(num(m[1]) * num(m[2]) / 100) + '.';
    if ((m = t.match(/scorpor\w*\s*(?:l )?iva\s*(?:da|di|a)?\s*(\d+(?:[.,]\d+)?)/))) { const v = num(m[1]); return 'Su ' + fmt(v) + ' euro, con IVA al 22%, l\'imponibile è ' + fmt(v / 1.22) + ' e l\'IVA ' + fmt(v - v / 1.22) + '.'; }
    if ((m = t.match(/(?:aggiungi|metti|piu|con)\s*(?:l )?iva\s*(?:a|su)?\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:piu|\+|con)\s*iva/))) { const v = num(m[1] || m[2]); return fmt(v) + ' più IVA al 22% fa ' + fmt(v * 1.22) + ' (IVA ' + fmt(v * 0.22) + ').'; }
    if ((m = t.match(/radice (?:quadrata )?di (\d+(?:[.,]\d+)?)/))) return 'La radice quadrata di ' + fmt(num(m[1])) + ' è ' + fmt(Math.sqrt(num(m[1]))) + '.';
    if ((m = t.match(/(\d+(?:[.,]\d+)?|[a-z]+)\s*(piu|\+|meno|-|per|x|\*|diviso|\/|fratto)\s*(\d+(?:[.,]\d+)?|[a-z]+)/))) {
      const a = num(m[1]), b = num(m[3]);
      if (isNaN(a) || isNaN(b)) return null;
      const op = m[2];
      if (/diviso|\/|fratto/.test(op) && b === 0) return 'Dividere per zero non si può, nemmeno per me.';
      const r = /piu|\+/.test(op) ? a + b : /meno|-/.test(op) ? a - b : /per|x|\*/.test(op) ? a * b : a / b;
      return fmt(a) + ' ' + (/piu|\+/.test(op) ? 'più' : /meno|-/.test(op) ? 'meno' : /per|x|\*/.test(op) ? 'per' : 'diviso') + ' ' + fmt(b) + ' fa ' + fmt(r) + '.';
    }
    return null;
  }

  function converti(t) {
    let m;
    if ((m = t.match(/(-?\d+(?:[.,]\d+)?)\s*(?:gradi )?(?:celsius|centigradi|c)\b.*fahrenheit/))) return fmt(num(m[1])) + ' gradi Celsius sono ' + fmt(num(m[1]) * 9 / 5 + 32) + ' Fahrenheit.';
    if ((m = t.match(/(-?\d+(?:[.,]\d+)?)\s*(?:gradi )?fahrenheit.*(?:celsius|centigradi)/))) return fmt(num(m[1])) + ' Fahrenheit sono ' + fmt((num(m[1]) - 32) * 5 / 9) + ' gradi Celsius.';
    if ((m = t.match(/(?:km|chilometri)\D*(\d+(?:[.,]\d+)?)\s*miglia/))) return fmt(num(m[1])) + ' miglia sono ' + fmt(num(m[1]) * 1.609) + ' chilometri.';
    if ((m = t.match(/(?:miglia)\D*(\d+(?:[.,]\d+)?)\s*(?:km|chilometri)/))) return fmt(num(m[1])) + ' chilometri sono ' + fmt(num(m[1]) / 1.609) + ' miglia.';
    if ((m = t.match(/(\d+(?:[.,]\d+)?)\s*(?:miglia).*(?:km|chilometri)/))) return fmt(num(m[1])) + ' miglia sono ' + fmt(num(m[1]) * 1.609) + ' chilometri.';
    if ((m = t.match(/(\d+(?:[.,]\d+)?)\s*(?:km|chilometri).*miglia/))) return fmt(num(m[1])) + ' chilometri sono ' + fmt(num(m[1]) / 1.609) + ' miglia.';
    if ((m = t.match(/(\d+(?:[.,]\d+)?)\s*(?:libbre).*(?:kg|chili)/))) return fmt(num(m[1])) + ' libbre sono ' + fmt(num(m[1]) * 0.4536) + ' chili.';
    if ((m = t.match(/(\d+(?:[.,]\d+)?)\s*(?:kg|chili|chilogrammi).*libbre/))) return fmt(num(m[1])) + ' chili sono ' + fmt(num(m[1]) / 0.4536) + ' libbre.';
    if ((m = t.match(/(\d+(?:[.,]\d+)?)\s*(?:pollici).*(?:cm|centimetri)/))) return fmt(num(m[1])) + ' pollici sono ' + fmt(num(m[1]) * 2.54) + ' centimetri.';
    return null;
  }

  function date(t, ora) {
    let m;
    if (/che giorno (era )?ieri/.test(t)) { const d = new Date(ora); d.setDate(d.getDate() - 1); return 'Ieri era ' + giorno(d) + '.'; }
    if (/che giorno (e |sara )?domani|domani che giorno/.test(t)) { const d = new Date(ora); d.setDate(d.getDate() + 1); return 'Domani è ' + giorno(d) + '.'; }
    if ((m = t.match(/(?:tra|fra) (\d+|[a-z]+) (giorni|settimane|mesi)/)) && /che giorno|che data|quando/.test(t)) {
      const k = num(m[1]); if (isNaN(k)) return null;
      const d = new Date(ora);
      if (m[2] === 'giorni') d.setDate(d.getDate() + k); else if (m[2] === 'settimane') d.setDate(d.getDate() + 7 * k); else d.setMonth(d.getMonth() + k);
      return 'Tra ' + fmt(k) + ' ' + m[2] + ' sarà ' + giorno(d) + '.';
    }
    if (/quant\w* (giorni )?manca|tra quant\w* giorni|fra quant\w* giorni|quanto manca/.test(t)) {
      let target = null, nome = '';
      for (const f in FESTE) if (t.indexOf(f) !== -1) { nome = f; target = new Date(ora.getFullYear(), FESTE[f][0], FESTE[f][1]); }
      if (!target && (m = t.match(/\b(\d{1,2}) (gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)/))) { nome = 'il ' + m[1] + ' ' + m[2]; target = new Date(ora.getFullYear(), MESI.indexOf(m[2]), +m[1]); }
      if (!target && /weekend|fine settimana|sabato/.test(t)) { nome = 'sabato'; target = new Date(ora); target.setDate(target.getDate() + ((6 - target.getDay() + 7) % 7)); }
      if (!target && /venerdi/.test(t)) { nome = 'venerdì'; target = new Date(ora); target.setDate(target.getDate() + ((5 - target.getDay() + 7) % 7)); }
      if (!target) return null;
      if (tra(ora, target) < 0) target.setFullYear(target.getFullYear() + 1);
      const g = tra(ora, target);
      const chi = nome.charAt(0).toUpperCase() + nome.slice(1);
      const bello = /^il /.test(nome) ? nome.replace(/^il /, 'al ') : /^(sabato|venerd)/.test(nome) ? 'a ' + nome : 'a ' + nome.split(' ').map((w, i) => /^(di|della|dei)$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      return g === 0 ? (/^(sabato|venerdi)/.test(nome) ? 'È oggi!' : chi + ' è oggi!') : (g === 1 ? 'Manca 1 giorno ' : 'Mancano ' + g + ' giorni ') + bello + '.';
    }
    return null;
  }

  function rispondi(q, ctx) {
    ctx = ctx || {};
    const t = n(q), ora = ctx.ora || new Date(), h = ora.getHours();
    const parole = t.split(' ').length;
    const ultima = String(ctx.ultima || '');
    const ciao = h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera';
    let m, r;

    // gioco: indovina il numero
    if (s.gioco) {
      if (/^(basta|smetti|mi arrendo|stop|fine|non gioco piu)/.test(t)) { const x = s.gioco.n; s.gioco = null; return { testo: 'Va bene! Il numero era ' + x + '. Rivincita quando vuoi.' }; }
      const g = (t.match(/\b(\d{1,2})\b/) || [])[1] || (Object.keys(NUM).find(k => new RegExp('\\b' + k + '\\b').test(t)) ? NUM[Object.keys(NUM).find(k => new RegExp('\\b' + k + '\\b').test(t))] : null);
      if (g !== null && g !== undefined) {
        const v = +g; s.gioco.tentativi++;
        if (v === s.gioco.n) { const k = s.gioco.tentativi; s.gioco = null; return { testo: 'Esatto, era ' + v + '! Ci hai messo ' + k + (k === 1 ? ' tentativo: incredibile.' : ' tentativi. Brava!') }; }
        return { testo: v < s.gioco.n ? caso(['Più alto.', 'Di più!', 'Sali.']) : caso(['Più basso.', 'Di meno!', 'Scendi.']) };
      }
    }
    if (/^mi arrendo|^non gioco piu/.test(t)) return { testo: 'Non stavamo giocando! Se vuoi, di\' "giochiamo".' };
    if (/giochiamo|facciamo un gioco|gioca con me|indovina (il|un) numero/.test(t)) {
      s.gioco = { n: 1 + Math.floor(Math.random() * 50), tentativi: 0 };
      return { testo: 'Ci sto! Ho pensato a un numero da 1 a 50: prova a indovinarlo. Ti dico se è più alto o più basso. Di\' "mi arrendo" per smettere.' };
    }

    // risposta a una mia domanda di prima ("E tu?")
    if (/\btu( come stai)?\?\s*$|come stai\?\s*$/i.test(ultima) && parole <= 8) {
      if (/^(bene|benissimo|tutto bene|alla grande|ottimo|abbastanza bene|non c e male|si bene)/.test(t)) return { testo: caso(['Mi fa piacere, Teo!', 'Bene! Allora siamo in due.', 'Che bello sentirlo.']) };
      if (/^(male|cosi cosi|insomma|non tanto|non benissimo|uno schifo|da schifo|stanca|giu)/.test(t)) return { testo: caso(['Mi dispiace. Vuoi raccontarmi cosa è successo, o preferisci distrarti con una curiosità?', 'Mi dispiace, Teo. Se ti va, ti racconto una barzelletta per tirarti su.']) };
    }

    // saluti e cortesie
    if (/^(ciao|ehi|hey|salve|ehila|eccomi|we|hola)( edith)?$/.test(t)) return { testo: caso(['Ciao Teo! Come posso aiutarti?', 'Ehi, ciao! Dimmi tutto.', ciao + ', Teo!']) };
    if ((m = t.match(/^(buongiorno|buon pomeriggio|buonasera|buonanotte)( edith)?$/))) {
      if (m[1] === 'buonanotte') return { testo: caso(['Buonanotte, Teo. Sogni d\'oro.', 'Notte! Riposati bene, qui ci penso io.']), fine: true };
      if (m[1] === 'buongiorno' && h >= 18) return { testo: 'Buongiorno? Sono le ' + h + ', Teo! Diciamo buonasera. Dimmi pure.' };
      return { testo: (m[1] === 'buongiorno' && h < 13 ? 'Buongiorno! ' : ciao + '! ') + caso(['Dimmi pure.', 'Come posso aiutarti?']) };
    }
    if (/^(come stai|come va|tutto bene|come te la passi|come butta|stai bene)( edith)?\??$|^e tu( come stai)?\??$/.test(t)) return { testo: caso(['Bene, grazie! I tuoi conti sono in ordine, quindi sono serena. E tu?', 'Tutto bene, sempre qui per te. E tu come stai?', 'Benissimo, mi hai appena svegliata. Tu?']) };
    if (/^(grazie|grazie mille|ti ringrazio|grazie edith|grazie tante|mille grazie)/.test(t)) return { testo: caso(['Figurati!', 'Di niente, Teo.', 'Quando vuoi.', 'È un piacere.']) };
    if (/^(scusa|scusami|perdonami|mi dispiace)\b/.test(t) && parole <= 5) return { testo: caso(['Non c\'è niente da scusare.', 'Tranquilla, figurati.']) };
    if (/(sei|che) (brava|bravissima|forte|grande|intelligente|simpatica|un genio|fantastica|mitica)|^brava\b|ti adoro/.test(t)) return { testo: caso(['Grazie, Teo! Detto da te vale doppio.', 'Che carina. Arrossirei, se potessi.', 'Grazie! Faccio del mio meglio.']) };
    if (/(sei|che) (proprio |davvero |veramente |cosi )?(stupida|scema|inutile|lenta|cretina|deficiente|idiota|rincoglionita|tonta)|non capisci (niente|nulla)|non servi a niente/.test(t)) return { testo: caso(['Hai ragione, su questa ho fatto una figuraccia. Riprova con parole diverse e ci riprovo anch\'io.', 'Ahia. Lo so, a volte mi perdo. Dimmelo in un altro modo?', 'Me lo merito. Però sui conti sono imbattibile: mettimi alla prova.']) };
    if (/ti voglio bene|ti amo|sei la migliore|mi piaci/.test(t)) return { testo: caso(['Anch\'io ti voglio bene, Teo. A modo mio, tra una bolletta e l\'altra.', 'Che dolce. Sei la mia persona preferita, anche perché sei l\'unica.']) };

    // chi sono io
    if (/chi ti ha (creata|creato|fatta|fatto|programmata)|chi e il tuo creatore/.test(t)) return { testo: 'Mi hai voluta tu, Teo, e mi hanno costruita su misura per te: le tue bollette, la tua posta, il tuo telefono. Il nome viene dai film di Iron Man.' };
    if (/quanti anni hai|quando sei nata|la tua eta/.test(t)) return { testo: 'Sono nata da pochissimo, in questo autunno 2026. Quindi sono giovane, ma imparo in fretta.' };
    if (/sei (umana|una persona|vera|viva|un robot|un intelligenza artificiale|un ia|una macchina)|sei reale/.test(t)) return { testo: 'Non sono una persona: sono un programma che ragiona con regole scritte per te, più una piccola IA sul telefono se la accendi. Però ti ascolto davvero.' };
    if (/cosa (ti piace|ami) fare|cosa fai nel tempo libero|hai (degli )?hobby|ti annoi/.test(t)) return { testo: caso(['Mi piace mettere in ordine le bollette e scoprire quando qualcuno ti fa pagare troppo. Una passione strana, lo so.', 'Nel tempo libero conto i giorni alle scadenze. E aspetto che tu mi chieda qualcosa.']) };
    if (/colore preferito/.test(t)) return { testo: 'Il ciano, quello della mia sfera. Fa molto Tony Stark.' };
    if (/sei (fidanzata|sposata|single)|hai un (fidanzato|ragazzo)/.test(t)) return { testo: 'Sono sposata con il lavoro: precisamente con il tuo foglio delle bollette.' };
    if (/dove (sei|vivi|abiti|ti trovi)/.test(t)) return { testo: 'Vivo un po\' nel tuo telefono e un po\' nei server di Google, dove sta il tuo Sheet.' };
    if (/come ti chiami|il tuo nome/.test(t)) return { testo: 'Mi chiamo EDITH. Come nei film di Iron Man, ma al servizio di Teo.' };
    if (/cosa significa edith|perche ti chiami edith/.test(t)) return { testo: 'Nei film di Iron Man EDITH sta per "Even Dead I\'m The Hero". Io sono meno drammatica: mi basta che tu non paghi una mora.' };

    // emozioni di Teo
    if (/sono (stanca|stanchissima|distrutta|a pezzi|cotta|sfinita)|che stanchezza/.test(t)) return { testo: caso(['Allora fermati un attimo, Teo. Un bicchiere d\'acqua e cinque minuti senza schermo fanno miracoli. Ai conti ci penso io.', 'Giornata lunga, eh? Riposati, qui è tutto sotto controllo.']) };
    if (/sono (triste|giu|depressa|abbattuta)|mi sento (triste|giu|sola|male)|che tristezza/.test(t)) return { testo: caso(['Mi dispiace, Teo. Vuoi parlarne? Se preferisci distrarti, ti racconto una curiosità.', 'Ci sono io qui. Le giornate grigie passano; intanto, se ti va, ti dico qualcosa di bello.']) };
    if (/sono (arrabbiata|incazzata|nervosa|furiosa)|che rabbia|mi fa arrabbiare/.test(t)) return { testo: 'Respira, Teo: quattro secondi dentro, quattro fuori. Poi, se vuoi, dimmi chi devo mettere in castigo.' };
    if (/sono (ansiosa|preoccupata|agitata|in ansia)|ho ansia|che ansia/.test(t)) return { testo: 'Capisco. Facciamo così: una cosa alla volta. Se è per i soldi, chiedimi "cosa devo pagare?" e vediamo insieme che è tutto sotto controllo.' };
    if (/sono (felice|contenta|contentissima|euforica)|che bello|che bella giornata|evviva/.test(t)) return { testo: caso(['Che bello, Teo! Mi fai contenta anche me.', 'Evviva! Raccontami, cosa è successo di bello?']) };
    if (/mi annoio|sono annoiata|che noia/.test(t)) return { testo: 'Ti propongo tre cose: una barzelletta, una curiosità, oppure giochiamo a indovinare un numero. Scegli tu.' };
    if (/sto male|non mi sento bene|ho (la febbre|mal di testa|il raffreddore|mal di pancia)/.test(t)) return { testo: 'Mi dispiace, Teo. Riposati e bevi tanto. Se non passa, chiama il medico: io intanto tengo d\'occhio tutto il resto.' };
    if (/ho fame|cosa mangio|cosa cucino/.test(t)) return { testo: caso(['Io non mangio, ma se fossi in te farei una bella pasta al pomodoro: semplice e infallibile.', 'Una frittata con quello che c\'è in frigo? Salva sempre la cena.']) };
    if (/non riesco a dormire|ho sonno|vado a (letto|dormire)/.test(t)) return { testo: 'Allora metti giù il telefono, Teo: la luce dello schermo tiene svegli. Buonanotte!', fine: /vado a/.test(t) };

    // tempo
    if (/che ore sono|che ora e|mi dici l ora/.test(t)) return { testo: 'Sono le ' + h + ':' + String(ora.getMinutes()).padStart(2, '0') + '.' };
    if ((r = date(t, ora))) return { testo: r };
    if (/che giorno e( oggi)?\b|che data e\b|quanti ne abbiamo|oggi che giorno/.test(t)) return { testo: 'Oggi è ' + giorno(ora) + '.' };

    // timer finché l'app è aperta
    if ((m = t.match(/(?:timer|sveglia|avvisami|ricordami|dimmi)\D{0,20}?(?:tra|fra|di)?\s*(\d+|[a-z]+)\s*(minuti|minuto|secondi|ore|ora)\b(?:.*?\bdi (.+))?/)) && !isNaN(num(m[1]))) {
      const k = num(m[1]), unita = m[2], cosa = (m[3] || '').trim();
      const ms = k * (/sec/.test(unita) ? 1e3 : /min/.test(unita) ? 6e4 : 36e5);
      if (ms > 6 * 36e5) return { testo: 'Posso tenere il tempo solo per poche ore, e solo con l\'app aperta.' };
      return { testo: 'Ok, ti avviso tra ' + fmt(k) + ' ' + unita + (cosa ? ' per ' + cosa : '') + '. Tieni l\'app aperta: se la chiudi, il timer si ferma.', timer: { ms: ms, testo: 'Teo, è ora' + (cosa ? ': ' + cosa : '!') } };
    }

    // calcoli e conversioni
    if (/quanto fa|calcola|quanto e|fammi il conto|percentuale|iva|radice|%|per ?cento/.test(t) || /^\d+(?:[.,]\d+)?\s*(piu|meno|per|x|diviso|\+|-|\*|\/)\s*\d/.test(t)) { r = calcola(t); if (r) return { testo: r }; }
    if (/quant\w* (sono|fanno)|converti|miglia|libbre|fahrenheit|celsius|pollici|in (km|chilometri|kg|chili|centimetri)/.test(t)) { r = converti(t); if (r) return { testo: r }; }

    // caso
    if (/lancia (una )?moneta|testa o croce/.test(t)) return { testo: caso(['Testa!', 'Croce!']) };
    if (/tira (un )?dad|lancia (un )?dad/.test(t)) return { testo: 'È uscito ' + (1 + Math.floor(Math.random() * 6)) + '.' };
    if ((m = t.match(/numero (?:a caso|casuale)(?: (?:tra|da) (\d+) (?:e|a) (\d+))?/))) { const a = m[1] ? +m[1] : 1, b = m[2] ? +m[2] : 100; return { testo: 'Ti dico ' + (Math.min(a, b) + Math.floor(Math.random() * (Math.abs(b - a) + 1))) + '.' }; }
    if ((m = t.match(/(?:scegli|meglio|preferisci)\s*(?:tu)?\s*(?:tra )?(.+?) o (.+?)\??$/)) && parole <= 12) { const a = m[1].replace(/^(tra|fra) /, ''), b = m[2]; return { testo: caso(['Io dico ' + a + '.', 'Vada per ' + b + '.', 'Senza dubbio ' + caso([a, b]) + '.']) }; }

    // intrattenimento
    if (/barzelletta|fammi ridere|battuta|qualcosa di divertente/.test(t)) return { testo: caso(BARZELLETTE) };
    if (/curiosita|dimmi qualcosa|raccontami qualcosa|lo sapevi|fatto interessante|stupiscimi/.test(t)) return { testo: caso(CURIOSITA) };
    if (/motiva|frase (motivazionale|del giorno)|incoraggia|dammi la carica|tirami su|ho bisogno di coraggio/.test(t)) return { testo: caso(MOTIVAZIONE) };
    if (/canta|cantami/.test(t)) return { testo: 'La la la... meglio di no, Teo. La mia voce è fatta per le scadenze, non per Sanremo.' };
    if (/poesia/.test(t)) return { testo: 'Bollette in fila, tutte pagate, mora nessuna, notti tranquille. Firmato EDITH, poetessa per caso.' };

    // cose che non posso fare: lo dico con garbo
    if (/che tempo fa|meteo|piove|pioggia domani|fa freddo fuori|temperatura (fuori|domani)/.test(t)) return { testo: 'Il meteo non lo vedo, perché non vado su internet. Per quello chiedi a Google: "Ok Google, che tempo fa?".' };
    if (/notizie|telegiornale|risultat\w* (della )?partita|chi ha vinto|ultime news|borsa oggi/.test(t)) return { testo: 'Su notizie e partite non posso aiutarti: non navigo su internet. Prova con "Ok Google".' };
    if (/chiama |manda un messaggio|scrivi a |whatsapp|metti (la )?musica|apri (youtube|spotify|instagram)/.test(t)) return { testo: 'Questo non lo so fare: vivo dentro questa app. Per chiamate, messaggi e musica usa l\'assistente del telefono, per esempio "Ok Google".' };

    return null;
  }

  /** Quando né le regole né l'IA sanno rispondere: una risposta gentile e diversa ogni volta, con un'idea su cosa chiedere. */
  let mancate = 0, ultimaMancata = '';
  function fuoriPortata(q) {
    const t = n(q);
    mancate++;
    let testo;
    if (/^(chi|cosa|che cos|perche|come mai|dove|quando|quale|qual e|spiegami|sai)\b/.test(t) && t.split(' ').length >= 3) {
      testo = caso(['Bella domanda, ma qui non ho internet né un\'enciclopedia: conosco i tuoi conti e so fare due chiacchiere. Per curiosità generali chiedi a "Ok Google".',
        'Su questo non sono preparata, Teo: non vado su internet. Posso però dirti cosa devi pagare, raccontarti una curiosità o fare un calcolo.']);
    } else if (mancate >= 2) {
      testo = 'Scusa, continuo a non capire. Ecco cosa so fare: "cosa devo pagare?", "quanto ho speso a ottobre?", "che offerta ho?", "quanto fa 15 per 3", "quanti giorni mancano a Natale", "raccontami una barzelletta", "giochiamo".';
      mancate = 0;
    } else {
      testo = caso(['Questa mi sfugge. Me la dici in un altro modo?', 'Non sono sicura di aver capito. Riprovi con altre parole?', 'Mi sono persa, scusa. Ripeti in modo più semplice?']);
    }
    if (testo === ultimaMancata) testo = 'Su questo non so aiutarti, Teo. Chiedimi pure dei tuoi conti o facciamo due chiacchiere.';
    ultimaMancata = testo;
    return { testo: testo, capito: false };
  }
  function capita() { mancate = 0; }
  return { rispondi, fuoriPortata, capita, stato: s };
})();
// </chiacchiere>

function avviaTimer(x){
  setTimeout(() => {
    try { navigator.vibrate && navigator.vibrate([300, 150, 300]); } catch(e) {}
    vai('edith'); rispondi(x.testo);
  }, x.ms);
}

// ------------------------------------------------ IA locale (WebLLM, gira sul telefono, gratis)
// Usata solo quando le regole rispondono "non ho capito". I dati restano sul telefono.
const IA = { motore: null, caricamento: null };
const IA_LIB = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/+esm';
function iaStato(t){ const el = $('iaStato'); if (el) el.textContent = t || ''; }
function cambiaIA(si){
  mem('ia2', si ? '1' : '0');
  if (si) caricaIA().catch(() => {});
  else { if (IA.motore) IA.motore.unload().catch(() => {}); IA.motore = null; IA.caricamento = null; iaStato('Spenta. Il modello resta salvato sul telefono: riaccenderla è veloce.'); }
}
function cambiaQualita(v){
  mem('ia_qualita', v);
  if (IA.motore) { IA.motore.unload().catch(() => {}); }
  IA.motore = null; IA.caricamento = null;
  if (mem('ia2') !== '0') caricaIA().catch(() => {});
}
async function caricaIA(){
  if (IA.motore) return IA.motore;
  if (IA.caricamento) return IA.caricamento;
  IA.caricamento = (async () => {
    if (!navigator.gpu) throw new Error('questo browser non supporta WebGPU: aggiorna Chrome');
    const scheda = await navigator.gpu.requestAdapter();
    if (!scheda) throw new Error('il telefono non mette a disposizione la grafica (WebGPU)');
    const f16 = scheda.features && scheda.features.has('shader-f16');
    // Gemma 3 1B: circa 700 MB, buon italiano, leggera per un telefono; senza f16 ripiego su Llama 3.2 1B
    const brava = mem('ia_qualita') === 'brava';
    const modello = f16 ? (brava ? 'gemma-2-2b-it-q4f16_1-MLC-1k' : 'gemma3-1b-it-q4f16_1-MLC') : (brava ? 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC' : 'Llama-3.2-1B-Instruct-q4f32_1-MLC');
    iaStato('Preparo l\'IA…');
    const webllm = await import(IA_LIB);
    const vecchio = mem('ia_modello');
    if (vecchio && vecchio !== modello && webllm.deleteModelAllInfoInCache) webllm.deleteModelAllInfoInCache(vecchio).catch(() => {});   // libero lo spazio del modello precedente
    mem('ia_modello', modello);
    // il modello gira in un worker separato: l'app resta sempre usabile mentre scarica o pensa
    const lavoratore = new Worker(new URL('ia-worker.js', location.href), { type: 'module' });
    const m = await webllm.CreateWebWorkerMLCEngine(lavoratore, modello, { initProgressCallback: p => {
      const pc = Math.round((p.progress || 0) * 100);
      iaStato(/cache|caricamento|loading from cache/i.test(p.text || '') ? 'Carico l\'IA dalla memoria del telefono… ' + pc + '%' : 'Scarico l\'IA (una volta sola, circa ' + (mem('ia_qualita') === 'brava' ? '1,5 GB' : '700 MB') + ')… ' + pc + '%');
    } });
    IA.motore = m; iaStato('Pronta: risponde direttamente dal telefono.');
    return m;
  })();
  try { return await IA.caricamento; }
  catch(e) { IA.caricamento = null; iaStato('Non riesco ad attivarla: ' + (e && e.message || e)); throw e; }
}
// L'IA fa solo due chiacchiere: conti, scadenze e posta restano alle regole e allo script.
const CONTI = /calendar|agenda|appuntament|impegn|ricordami (di|che) (?!.*\b(minut|second|or[ae]\b))|benzina|affitto|pieno|supermercato|farmacia|parcheggio|annulla|bollett|pag[aho]|scad|spes|speso|spend|cost|assicur|polizz|offert|tariff|euro|€|kwh|smc|\bluce\b|\bgas\b|conto|soldi|import|rat[ae]\b|fattur|mail|posta|spazio|anomal|briefing|riepilog/i;
async function chiediIA(q, bolla){
  const m = IA.motore; if (!m) return null;
  const regole = 'Sei EDITH, l\'assistente di Teo (è una donna: usa il femminile con lei). Fai due chiacchiere in italiano: rispondi in una o due frasi brevi e naturali, ' +
    'senza elenchi né simboli, perché la risposta viene letta ad alta voce. Non parlare di soldi, bollette o scadenze: per quelle Teo chiede a te con parole semplici e rispondono le tue regole.';
  const ult = S.storia.slice(-2).filter(x => x.ruolo === 'edith').map(x => x.testo).pop();
  const msgs = [{ role: 'user', content: regole + (ult ? '\n\nTu avevi appena detto: "' + ult + '"' : '') + '\n\nTeo dice: ' + q }];
  let testo = '', fermata = false;
  const ferma = () => { fermata = true; try { m.interruptGenerate(); } catch(e) {} };
  const limite = setTimeout(ferma, 15000);          // al massimo 15 secondi
  const primo = setTimeout(() => { if (!testo) ferma(); }, 9000);   // se dopo 9 secondi non ha detto niente, lascio stare
  try {
    const flusso = await m.chat.completions.create({ messages: msgs, temperature: 0.6, max_tokens: 70, stream: true });
    for await (const pezzo of flusso) {
      const d = pezzo.choices && pezzo.choices[0] && pezzo.choices[0].delta && pezzo.choices[0].delta.content || '';
      if (!d) continue;
      testo += d;
      bolla.textContent = testo.replace(/[*#_`]/g, '');
      $('msgs').scrollTop = $('msgs').scrollHeight;
      if (fermata) break;
    }
  } finally { clearTimeout(limite); clearTimeout(primo); }
  testo = testo.replace(/[*#_`]/g, '').trim();
  // se l'ho interrotta a metà, tengo le frasi complete
  if (fermata && /[^.!?]$/.test(testo)) testo = (testo.match(/^[\s\S]*[.!?]/) || [''])[0].trim();
  return testo || null;
}

function salutoLocale(){
  const h = new Date().getHours(), n = (S.dati.aperte || []).filter(p => p.stato !== 'Da verificare').length;
  const ciao = ['Bentornata, Teo.', 'Eccoti, Teo.', (h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera') + ', Teo.'][Math.floor(Math.random() * 3)];
  rispondi(ciao + ' ' + (n ? 'Hai ' + n + (n === 1 ? ' pagamento' : ' pagamenti') + ' in sospeso.' : 'Tutto in ordine.') + ' Dimmi pure.');
}

// ------------------------------------------------ avvio
S.attesa = null;
(function avvio(){
  $('ver').textContent = VERSIONE;
  S.voce = mem('parla') !== '0';
  $('sugg').innerHTML = ['Cosa devo pagare?', 'Che offerta ho?', 'Ci sono anomalie?', 'Raccontami una curiosità', 'Giochiamo', 'Briefing', 'Quanto ho speso quest\'anno?', 'Quanto spenderò a fine anno?', 'Consigli per risparmiare']
    .map(s => '<button class="chip" onclick="sbloccaVoce();chiedi(this.textContent,false)">' + esc(s) + '</button>').join('');
  try { const c = JSON.parse(mem('cache') || 'null'); if (c && c.kpi) render(c, true); } catch(e) {}
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  if (location.hash.length > 2) {
    const h = new URLSearchParams(location.hash.slice(1));
    // link di collegamento: vale solo con URL e token insieme, così un link costruito da altri
    // non può dirottare il token già salvato verso un altro script
    const u = h.get('u'), k = h.get('k');
    if (u && k && /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(u)) { mem('url', u); mem('k', k); }
    try { history.replaceState(null, '', location.pathname + location.search); } catch(e) {}
  }
  if (!mem('url') || !mem('k')) { mostraSetup(true); aggiornaStato(); return; }
  const v = store('edith_view'); if (v) vai(v);
  call('apiDati').then(d => { render(d); }).catch(() => {
    if (S.dati) $('sub').textContent = (navigator.onLine ? 'non raggiungibile' : 'offline') + ' · ' + $('sub').textContent.replace(/, aggiorno…$/, '');
    else $('sub').textContent = 'non collegata: tocca l\'ingranaggio';
  });
  // saluto e ascolto: apri l'app e parla. Il primo saluto del giorno (con il briefing) lo chiedo allo script,
  // gli altri li faccio subito qui con i dati già sul telefono, senza aspettare la rete.
  const oggiK = new Date().toDateString();
  if (S.dati && mem('saluto') === oggiK) salutoLocale();
  else { mem('saluto', oggiK); chiedi('Edith, sono io', false).then(() => {}); $('msgs').firstChild && $('msgs').firstChild.remove(); }
})();
