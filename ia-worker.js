// EDITH – IA locale: il modello gira qui, separato dall'app, così l'app non si blocca mai.
import { WebWorkerMLCEngineHandler } from 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/+esm';
const gestore = new WebWorkerMLCEngineHandler();
self.onmessage = m => gestore.onmessage(m);
