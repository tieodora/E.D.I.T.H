// Unisce i moduli in apps-script/EDITH.gs, per chi preferisce incollare a mano un file solo.
const fs = require('fs'), path = require('path');
const src = path.join(__dirname, '..', 'apps-script', 'src');
const files = fs.readdirSync(src).filter(f => f.endsWith('.gs')).sort();
fs.writeFileSync(path.join(__dirname, '..', 'apps-script', 'EDITH.gs'), files.map(f => fs.readFileSync(path.join(src, f), 'utf8')).join('\n'));
console.log('EDITH.gs ricreato da ' + files.length + ' moduli');
