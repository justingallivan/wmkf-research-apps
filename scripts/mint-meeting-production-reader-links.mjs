#!/usr/bin/env node
if (!process.argv.includes('--execute')) throw new Error('Explicit --execute required for the dedicated rehearsal only');
/** Mint isolated test-reader links only. No email service is loaded or called. Never prints tokens/URLs. */
import fs from 'node:fs';
const e=JSON.parse(fs.readFileSync('/private/tmp/wmkf-meeting-production-app-env.json')),r=JSON.parse(fs.readFileSync('/private/tmp/wmkf-meeting-production-fixture.json'));Object.assign(process.env,e,{DELIBERATION_BRIEFING_SCHEMA_READY:'on'});
const {withDalContext}=await import('../lib/dataverse/core/context.js');const {ensureLivePresentationLink}=await import('../lib/services/post-presentation-materials/presentation-link-service.js');const {ensureLiveBriefingLink}=await import('../lib/services/deliberation-briefing/briefing-link-service.js');
const links=await withDalContext('meeting-rehearsal-reader-links',async()=>({presentation:await ensureLivePresentationLink({requestId:r.requestId,actorId:r.coordinatorSystemUserId}),briefing:await ensureLiveBriefingLink({requestId:r.requestId,actorId:r.coordinatorSystemUserId})}));fs.writeFileSync('/private/tmp/wmkf-meeting-production-reader-links.json',JSON.stringify(links),{mode:0o600});console.log(JSON.stringify({isolatedReaderLinksCreated:true,presentationLinkId:links.presentation.link.id,briefingLinkId:links.briefing.link.id,emailsSent:0}));
