const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [rawKey, ...valueParts] = trimmed.split('=');
      const key = rawKey.trim();
      if (key && valueParts.length > 0) {
        let value = valueParts.join('=').trim();
        if (value.startsWith('"')) {
          const endQuote = value.indexOf('"', 1);
          if (endQuote > 0) value = value.slice(1, endQuote);
        }
        process.env[key] = value;
      }
    }
  });
}

const { DynamicsService } = require('../lib/services/dynamics-service');
const { enterDynamicsBypassForScript } = require('../lib/services/dynamics-context');

async function main() {
  enterDynamicsBypassForScript('test-mp');

  // 1) Single record fetch — confirm _formatted annotation comes back
  console.log('--- Test 1: single-record _formatted annotation ---');
  const single = await DynamicsService.queryRecords('akoya_requests', {
    select: 'akoya_requestnum,wmkf_programareaserved_research',
    filter: `akoya_requestnum eq '992408'`,
    top: 1,
  });
  console.log(JSON.stringify(single.records, null, 2));

  // 2) ContainValues filter — find requests tagged with Chemistry (707510017)
  console.log('\n--- Test 2: ContainValues filter on Chemistry (707510017) ---');
  const chem = await DynamicsService.queryRecords('akoya_requests', {
    select: 'akoya_requestnum,wmkf_programareaserved_research',
    filter: `Microsoft.Dynamics.CRM.ContainValues(PropertyName='wmkf_programareaserved_research',PropertyValues=['707510017'])`,
    top: 3,
  });
  console.log(`Got ${chem.totalCount} total, showing ${chem.records.length}:`);
  console.log(JSON.stringify(chem.records, null, 2));
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
