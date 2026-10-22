// Marks reviewed false positives in a local SonarQube with the reason, so the scan stays clean.
// Usage: SONAR_ADMIN_PASSWORD=... node scripts/sonar-false-positives.mjs   (run by scripts/sonar.sh)
const host = process.env.SONAR_HOST ?? 'http://localhost:9000';
const password = process.env.SONAR_ADMIN_PASSWORD;
if (!password) throw new Error('Set SONAR_ADMIN_PASSWORD (scripts/sonar.sh stores it in .sonar/admin-password)');
const credentials = Buffer.from(['admin', password].join(':')).toString('base64');
const auth = `Basic ${credentials}`;

const REVIEWED = [
  {
    rule: /:S4790$/,
    file: /(src\/rom\/rom\.ts|scripts\/make-rom-challenges\.mjs)$/,
    why: 'SHA-1 identifies ROM dumps against their published No-Intro checksums; it is not a security control (ownership proofs use SHA-256).',
  },
];

async function api(path, params) {
  const res = await fetch(`${host}/api/${path}`, {
    method: params ? 'POST' : 'GET',
    headers: { authorization: auth, ...(params ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body: params ? new URLSearchParams(params) : undefined,
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? undefined : res.json();
}

const { issues } = await api('issues/search?componentKeys=linked-past&resolved=false&ps=500');
for (const issue of issues) {
  const match = REVIEWED.find((r) => r.rule.test(issue.rule) && r.file.test(issue.component));
  if (!match) continue;
  await api('issues/add_comment', { issue: issue.key, text: match.why });
  await api('issues/do_transition', { issue: issue.key, transition: 'falsepositive' });
  console.log(`false positive: ${issue.rule} ${issue.component.replace('linked-past:', '')}:${issue.line}`);
}
