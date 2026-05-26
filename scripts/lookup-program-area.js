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

const REQUEST_NUMBER = process.argv[2] || '992408';

// Static label map for wmkf_programareaserved_research, harvested from the option-set dump.
const RESEARCH_LABELS = {
  707510000: 'Clinic/Science Interface', 707510001: 'Medical Education', 707510077: 'Aerospace Engineering',
  707510002: 'Aging', 707510078: 'Astronomy', 707510003: 'Astrophysics/Astronomy',
  707510004: 'Atomic/Quantum Physics', 707510005: 'Autism/Mental Retardation', 707510006: 'Basic Science Research',
  707510007: 'Biochemistry', 707510079: 'Biochemistry and Biophysics', 707510008: 'Biochemistry/Molecular Biology',
  707510009: 'Bioengineering', 707510010: 'Bioinformatics/Computational Biology', 707510011: 'Biological Processes',
  707510080: 'Biology', 707510012: 'Biomedical Engineering', 707510013: 'Biophysics',
  707510014: 'Biotechnology', 707510015: 'Cancer Biology', 707510016: 'Cell Biology',
  707510081: 'Chemical Engineering', 707510017: 'Chemistry', 707510082: 'Civil and Environmental Engineering',
  707510018: 'Clinical Research', 707510019: 'Cognitive Neuroscience', 707510020: 'Complex Systems',
  707510083: 'Computer Engineering', 707510021: 'Computer Science', 707510022: 'Condensed Matter Physics',
  707510084: 'Core Facilities', 707510023: 'Core Facilities/Building', 707510024: 'Developmental Biology',
  707510025: 'Disease-specific Research', 707510085: 'Earth Systems', 707510026: 'Ecology',
  707510086: 'Electrical Engineering', 707510087: 'Energy', 707510027: 'Engineering',
  707510028: 'Environmental Sciences', 707510029: 'Epigenetics', 707510030: 'Evolutionary Biology',
  707510031: 'Fellowships', 707510032: 'Fluidics', 707510033: 'Gene Editing',
  707510088: 'General Earth Sciences', 707510089: 'General Engineering', 707510090: 'General Science',
  707510034: 'Genetics/Genomics', 707510091: 'Geochemistry', 707510092: 'Geology',
  707510035: 'Geophysics', 707510036: 'Geosciences/Earth Sciences', 707510037: 'Graduate Medical School',
  707510038: 'Graphene', 707510039: 'Imaging', 707510040: 'Immunology/Autoimmune Disease',
  707510041: 'Infectious Disease', 707510042: 'Library', 707510093: 'Marine Sciences',
  707510043: 'Materials Science', 707510044: 'Mathematics', 707510094: 'Mathematics and Computer Science',
  707510095: 'Mechanical Engineering', 707510045: 'Mechanical/Electrical Engineering', 707510046: 'Mechanobiology',
  707510047: 'Medical Imaging', 707510048: 'Metabolomics', 707510049: 'Microbiology',
  707510050: 'Microbiome', 707510096: 'Mining', 707510097: 'Mixed Disciplines',
  707510098: 'Molecular and Cell Biology', 707510051: 'Molecular Genetics', 707510052: 'Nanotechnology',
  707510053: 'Neurodegenerative Disease', 707510054: 'Neurosciences', 707510055: 'Non-priority Research',
  707510056: 'Organic Chemistry', 707510099: 'Ocean Engineering', 707510057: 'Ocean Sciences',
  707510100: 'Oceanography', 707510058: 'Optics', 707510059: 'Optics/Imaging',
  707510060: 'Organic Chemistry', 707510101: 'Other Earth Sciences', 707510102: 'Other Engineering',
  707510103: 'Other Sciences', 707510061: 'Particle Physics', 707510062: 'Pharmacology',
  707510063: 'Physical/Analytical Chemistry', 707510064: 'Physics', 707510065: 'Planning',
  707510066: 'Plant Science', 707510067: 'Proteomics', 707510104: 'Psychology',
  707510105: 'Remote Sensing', 707510068: 'RNA Biology', 707510069: 'Scientific Instruments',
  707510070: 'Soft Matter Physics', 707510071: 'Stem Cells', 707510072: 'Structural Biology',
  707510073: 'Synthetic Biology', 707510074: 'Systems Biology', 707510106: 'Teaching Excellence Award',
  707510075: 'Tissue Engineering', 707510076: 'Virology',
};

async function main() {
  enterDynamicsBypassForScript('lookup-program-area-script');

  const result = await DynamicsService.queryRecords('akoya_requests', {
    select: 'akoya_requestid,akoya_requestnum,wmkf_programareaserved_research,wmkf_programareaserved_socal,wmkf_programareaservedmisc',
    filter: `akoya_requestnum eq '${REQUEST_NUMBER}'`,
    top: 5,
  });
  const records = result?.records || [];

  if (!records || records.length === 0) {
    console.log(`No request found with number ${REQUEST_NUMBER}`);
    return;
  }

  for (const r of records) {
    console.log(`\nRequest ${r.akoya_requestnum}: ${r.akoya_name}`);
    console.log(`  id: ${r.akoya_requestid}`);

    const raw = r.wmkf_programareaserved_research;
    console.log(`  wmkf_programareaserved_research raw: ${JSON.stringify(raw)}`);
    if (raw) {
      const ids = String(raw).split(',').map(s => s.trim()).filter(Boolean);
      const labels = ids.map(id => `${id} = ${RESEARCH_LABELS[id] || '(unknown)'}`);
      console.log(`  Decoded:`);
      labels.forEach(l => console.log(`    - ${l}`));
    }

    if (r.wmkf_programareaserved_socal) {
      console.log(`  wmkf_programareaserved_socal raw: ${JSON.stringify(r.wmkf_programareaserved_socal)}`);
    }
    if (r.wmkf_programareaservedmisc !== undefined && r.wmkf_programareaservedmisc !== null) {
      console.log(`  wmkf_programareaservedmisc raw: ${JSON.stringify(r.wmkf_programareaservedmisc)}`);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
