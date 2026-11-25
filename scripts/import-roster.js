#!/usr/bin/env node
/**
 * Import the official university roster used to verify University IDs at registration.
 * Usage: npm run roster:import -- path/to/roster.csv
 * CSV columns (header required): university_id,email,full_name   (email/full_name optional)
 */
const fs = require('fs');
const { run, tx } = require('../src/db');

const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('Usage: npm run roster:import -- roster.csv'); process.exit(1); }
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim());
const header = lines.shift().split(',').map((h) => h.trim().toLowerCase());
const idx = (k) => header.indexOf(k);
if (idx('university_id') < 0) { console.error('CSV must have a university_id column'); process.exit(1); }
let n = 0;
tx(() => {
  for (const line of lines) {
    const cols = line.split(',').map((c) => c.trim());
    const id = cols[idx('university_id')];
    if (!id) continue;
    run(`INSERT INTO university_roster (university_id, email, full_name) VALUES (?, ?, ?)
         ON CONFLICT(university_id) DO UPDATE SET email = excluded.email, full_name = excluded.full_name`,
      id, idx('email') >= 0 ? cols[idx('email')] || null : null, idx('full_name') >= 0 ? cols[idx('full_name')] || null : null);
    n++;
  }
});
console.log(`Imported ${n} roster entries.`);
