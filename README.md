# EDITH

App per bollette, assicurazioni e posta, con l'assistente vocale.

La pagina non contiene dati né segreti: al primo avvio chiede l'URL del deployment Apps Script e il token, che restano salvati solo sul telefono.

## Com'è fatto
- `index.html` (struttura), `style.css` (aspetto), `app.js` (logica), `sw.js`, `manifest.json`: l'app (GitHub Pages).
- `apps-script/src/`: lo script Google, un file per argomento (configurazione, lettura delle bollette, pratiche, promemoria, dashboard, posta, ingresso dell'app, avvisi, sicurezza, offerte, spese, assistente).
- `apps-script/EDITH.gs`: gli stessi moduli in un file solo, per chi incolla a mano (`npm run bundle` lo ricrea).
- `tests/`: test sui casi reali con servizi Google finti (`npm test`).
- `.github/workflows/edith.yml`: a ogni modifica fa i test e, se passano, aggiorna lo script e il deployment Voce. Setup in [apps-script/AUTOMATICO.md](apps-script/AUTOMATICO.md).
