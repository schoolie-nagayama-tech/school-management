import fs from 'node:fs';

const html = fs.readFileSync('.next/analyze/client.html', 'utf8');
const m = html.match(/window\.chartData\s*=\s*(\[[\s\S]+?\]);/);
if (!m) throw new Error('No chartData');
const data = JSON.parse(m[1]);

const target = process.argv[2] || '';

function walk(node, path, acc) {
  const p = path ? path + '/' + node.label : node.label;
  if (!node.groups || node.groups.length === 0) {
    acc.push({ path: p, size: node.parsedSize || 0 });
    return;
  }
  for (const g of node.groups) walk(g, p, acc);
}

const leaves = [];
for (const chunk of data.filter((c) => c.label.endsWith('.js'))) {
  walk(chunk, '', leaves);
}

const matching = leaves.filter((l) => l.path.includes(target));
matching.sort((a, b) => b.size - a.size);

console.log(`Top 30 leaves matching "${target}":`);
for (const l of matching.slice(0, 30)) {
  console.log(`${(l.size / 1024).toFixed(1).padStart(8)} kB  ${l.path}`);
}
console.log(
  `\nTotal: ${(matching.reduce((s, l) => s + l.size, 0) / 1024).toFixed(1)} kB across ${matching.length} leaves`
);
