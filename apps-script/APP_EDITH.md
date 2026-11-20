> **Novità di stanotte:** EDITH Voce, con il tasto 🎙 vero per la macchina. Segui [VOCE_EDITH.md](VOCE_EDITH.md).

# App EDITH: installazione (5 minuti)

## 1. Aggiorna il codice
1. In `EDITH.gs` incolla il nuovo [EDITH.gs](EDITH.gs) e salva.
2. Clicca **+** accanto a "File", scegli **HTML** e chiama il file `Index` (senza .html). Incolla dentro il contenuto di [Index.html](Index.html) e salva.
3. In `appsscript.json` incolla il nuovo [appsscript.json](appsscript.json). Rispetto a prima aggiunge la parte "webapp": l'app la può aprire solo il tuo account.

## 2. Pubblica l'app
1. In alto a destra: **Esegui il deployment › Nuovo deployment**.
2. Ingranaggio › **App web**.
3. Esegui come: **Me**. Chi ha accesso: **Solo io**.
4. **Esegui il deployment** e autorizza. 
5. Copia l'**URL dell'app web**: finisce con `/exec`.

Quando aggiorni il codice in futuro: **Esegui il deployment › Gestisci deployment ›** matita › Versione: **Nuova versione** › Esegui il deployment. L'URL resta lo stesso.

## 3. Mettila sulla Home del telefono
- **iPhone (Safari):** apri l'URL, tocca Condividi › **Aggiungi alla schermata Home**.
- **Android (Chrome):** apri l'URL, tocca ⋮ › **Aggiungi a schermata Home**.

Se il telefono è collegato a più account Google, aprila con quello di EDITH, altrimenti Google mostra un errore di accesso.

## Cosa c'è nell'app
- **Home:** totali dell'anno, pagamenti in sospeso con il tasto **Pagata ✓** (spunta anche l'attività in Calendar), grafico mese per mese, ripartizione per tipo e assicurazioni per ramo. In alto c'è **Controlla posta**, che lancia subito l'elaborazione.
- **Pratiche:** l'elenco con i filtri (bollette, assicurazioni, da pagare, da verificare) e il link alla mail.
- **Posta:** spazio usato, newsletter con l'azione da scegliere, pulizia guidata e mail più pesanti. Ogni operazione che cancella chiede prima conferma e manda tutto nel Cestino, da cui si recupera per 30 giorni.
- **Edith:** scrivi o di' "**Edith, sono io**" e ti risponde. Prova "cosa devo pagare?", "quanto ho speso di luce a settembre?", "l'ultima bolletta del gas", "le assicurazioni", "quanto spazio ho?", "controlla la posta". Il tasto 🔈 le fa leggere le risposte ad alta voce.

## L'assistente
Risponde con regole sui dati del tuo Sheet. Non usa servizi esterni, non costa nulla e i dati restano nel tuo account Google. Capisce scadenze, spese, confronti, assicurazioni, spazio e posta, e risponde in modo breve a saluti, "ok", "grazie" e simili. Capisce anche i seguiti: dopo "quanto ho speso di luce a luglio?" puoi dire "e a settembre?" o "e il gas?".

Nota sul microfono: nell'app web il microfono del browser spesso è bloccato da Google. Il modo più comodo è il tasto microfono della tastiera del telefono, che funziona sempre.
