# Brief: office Mac sync after the 2026-10-01 Postgres rotation

Owner-run, on the office Mac, before anything else that touches Postgres. On 2026-10-01 at about 02:25Z the app Postgres password (`neondb_owner`, Neon project `expert-reviewers-neon-db`) was rotated. The office Mac's `.env.local` still holds the dead password. Procedure: `docs/CREDENTIALS_RUNBOOK.md` → "Rotating the app Postgres password", step 4. Nothing below prints a value.

```bash
cd ~/Code/WMKF_Apps && git pull --ff-only origin main

# 1. Pull the new values from Vercel into a private temp file
ls .vercel/project.json >/dev/null 2>&1 || vercel link      # only if this checkout isn't linked yet
T=$(mktemp -d); vercel env pull "$T/pulled.env" --environment=development --yes >/dev/null

# 2. Copy only the POSTGRES*/PG*/DATABASE_URL* lines into each real env file (backups kept in $T)
cat > "$T/sync.js" <<'EOF'
const fs=require('fs'),path=require('path');const [,,src,...targets]=process.argv;
const K=/^(POSTGRES[A-Z_]*|PG[A-Z_]+|DATABASE_URL[A-Z_]*)$/;const v=l=>l.slice(l.indexOf('=')+1).replace(/^["']|["']$/g,'');
const fresh=new Map(fs.readFileSync(src,'utf8').split('\n').filter(l=>K.test(l.split('=')[0])).map(l=>[l.split('=')[0],l]));
for(const t of targets){if(!fs.existsSync(t)){console.log(t,'absent, skipped');continue;}const real=fs.realpathSync(t),b=fs.readFileSync(real,'utf8');
 fs.writeFileSync(path.join(path.dirname(src),'bak-'+path.basename(real)),b,{mode:0o600});let c=0;
 const out=b.split('\n').map(l=>{const k=l.split('=')[0];if(!K.test(k)||!fresh.has(k)||v(fresh.get(k))===v(l))return l;c++;return k+'='+JSON.stringify(v(fresh.get(k)));});
 fs.writeFileSync(real,out.join('\n'));console.log(t,'changed',c);}
EOF
node "$T/sync.js" "$T/pulled.env" .env.local ~/.codex/worktrees/feature-request/WMKF_Apps/.env.presentation-proof.local
#    expect: .env.local changed 8   (the proof file may be "absent, skipped" on this Mac)

# 3. Prove the connections work (prints only "connected" / "FAILED <code>")
cat > "$T/ping.js" <<'EOF'
const {Client}=require('pg');const t=require('fs').readFileSync('.env.local','utf8');
(async()=>{for(const k of ['POSTGRES_URL','DATABASE_URL','POSTGRES_URL_NON_POOLING','DATABASE_URL_UNPOOLED']){
 const l=t.split('\n').find(x=>x.startsWith(k+'='));if(!l){console.log(k,'absent');continue;}
 const c=new Client({connectionString:l.slice(k.length+1).replace(/^["']|["']$/g,'')});
 try{await c.connect();await c.query('select 1');console.log(k,'connected');}catch(e){console.log(k,'FAILED',e.code||'');}finally{await c.end().catch(()=>{});}}})();
EOF
NODE_PATH=$PWD/node_modules node "$T/ping.js" 2>/dev/null

# 4. Delete the temp copies (they contain secrets)
rm -rf "$T"

# 5. Factory ledger check (read-only; plan Phase 2 item 3)
npm run check:factory-ledger
node scripts/rehearse-test-request-sandbox.mjs --target=production --run-inspect=e33fa857-4b00-4c60-94da-77d4406d4027 2>/dev/null | head -20
#    expect: both managed-ledger databases "matches"; the inspect shows Test Request 1003303, status "ready"
```

If step 3 prints `FAILED`, stop and bring the output to the session. When everything passes, record the step 5 result in `docs/plans/evidence/test-request-factory/ledger-snapshot-2026-09-30.md`.
