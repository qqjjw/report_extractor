// Codex controls the same visible report windows through this local-only bridge.
const fs = require('node:fs');
const path = require('node:path');
async function main() {
  const [action = 'state', ...flags] = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < flags.length; i += 2) args[flags[i].replace(/^--/, '')] = flags[i + 1];
  const { port, token } = JSON.parse(fs.readFileSync(path.join(__dirname, '.local/bridge.json'), 'utf8'));
  const response = await fetch(`http://127.0.0.1:${port}/${action === 'state' ? 'state' : 'command'}`, {
    method: action === 'state' ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(action === 'state' ? {} : { body: JSON.stringify({ action, args }) }),
    signal:AbortSignal.timeout(action==='state'?5000:60000)
  });
  const value = await response.json();
  if (!response.ok) throw Error(value.error || `HTTP ${response.status}`);
  const compactEvidence = (evidence, query = '') => {
    if (!evidence || args.full === 'true') return evidence;
    const lines = evidence.text.split('\n');
    const terms = query.split(/\s+/).filter(Boolean);
    return { sectionTitle: evidence.sectionTitle, context: evidence.context, header: lines[0], matchingRows: terms.length ? lines.filter(line => terms.some(term => line.replace(/\s+/g, '').includes(term.replace(/\s+/g, '')))) : lines, hash: evidence.hash, url: evidence.url, position:evidence.position };
  };
  if (action === 'state') {
    // Keep normal agent output compact; raw table bodies stay out of state summaries.
    console.log(JSON.stringify(value, null, 2));
  } else if (action === 'search') {
    console.log(JSON.stringify(Object.fromEntries(Object.entries(value).map(([target, r]) => [target, { ...r, evidence: compactEvidence(r.evidence, args.query) }])), null, 2));
  } else if (action === 'read'||action==='source-read') console.log(JSON.stringify(compactEvidence(value, args.query), null, 2));
  else console.log(JSON.stringify(value, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
