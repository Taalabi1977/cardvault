const assert = require('assert');
const { parseCard } = require('../parser.js');
const cases = [
  [`ACME SOLUTIONS SARL
Jean-Marc Dupont
Directeur Commercial
12 rue de la Paix, 75002 Paris
Tél : +33 1 42 68 53 00
Mob. +33 6 12 34 56 78
jm.dupont@acme-solutions.fr
www.acme-solutions.fr`, { name: 'Jean-Marc Dupont', title: 'Directeur Commercial', company: 'ACME SOLUTIONS SARL', emails: ['jm.dupont@acme-solutions.fr'], website: 'www.acme-solutions.fr', phones: 2 }],
  [`Sarah K. Mitchell
Head of Partnerships
Northwind Logistics Ltd
M: +44 7700 900123
sarah.mitchell@northwind.co.uk`, { name: 'Sarah K. Mitchell', title: 'Head of Partnerships', company: 'Northwind Logistics Ltd', phones: 1 }],
  [`شركة الأطلس للتجارة
محمد العلوي
مدير المبيعات
هاتف: ٠٦٦١٢٣٤٥٦٧
m.alaoui@atlas-trade.ma`, { name: 'محمد العلوي', title: 'مدير المبيعات', company: 'شركة الأطلس للتجارة', phones: 1 }],
  [`Brightline
Tom Reyes
tom@brightline.io
+1 (415) 555-0134`, { name: 'Tom Reyes', company: 'Brightline', website: '' }],
];
let ok = 0;
for (const [text, exp] of cases) {
  const r = parseCard(text);
  try {
    for (const [k, v] of Object.entries(exp)) {
      if (k === 'phones') assert.strictEqual(r.phones.length, v, 'phones ' + JSON.stringify(r.phones));
      else assert.deepStrictEqual(r[k], v, k);
    }
    ok++;
  } catch (e) { console.log('FAIL', e.message, JSON.stringify(r, null, 1)); }
}
console.log(`${ok}/${cases.length} passed`);
// RTL-specific: reversed phone + bidi marks
const r2 = parseCard("شركة الأطلس للتجارة\n67 45 23 661 212+\n\u200em.alaoui@atlas-trade.ma\u200f\nمحمد العلوي\nشركة \u200eil AY\u200f للتجارة");
assert.deepStrictEqual(r2.phones.map((p) => p.value), ['+212 661 23 45 67']);
assert.deepStrictEqual(r2.emails, ['m.alaoui@atlas-trade.ma']);
assert.strictEqual(r2.name, 'محمد العلوي');
assert.strictEqual(r2.company, 'شركة الأطلس للتجارة');
console.log('RTL case passed');
if (ok !== cases.length) process.exit(1);
const r3 = parseCard('Tél : +33 1 42 68 53 00   Mob. +33 6 12 34 56 78');
assert.deepStrictEqual(r3.phones.map((p) => p.label), ['work', 'mobile']);
console.log('Phone label case passed');
