const fs = require('fs');
const { buildXlsx, crc32 } = require('../xlsx.js');
const assert = require('assert');
assert.strictEqual(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
const out = buildXlsx([{ header: 'Name', width: 24 }, { header: 'Phone' }, { header: 'Notes', width: 40 }],
  [['Jean-Marc Dupont', '+33 6 12 34 56 78', 'Line 1\nLine 2 & <ok>'], ['محمد العلوي', '+212 661 23 45 67', '']], 'Contacts');
fs.writeFileSync(process.argv[2] || '/tmp/test.xlsx', out);
console.log('xlsx bytes', out.length);
