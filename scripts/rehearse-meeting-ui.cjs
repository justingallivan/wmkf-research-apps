// Read-only Mode A rehearsal of the real built Next pages. All API requests are intercepted.
// Start a local build with NEXTAUTH_SECRET=meeting-ui-local-fixture-only and schema ready.
// The synthetic JWT is valid only for that throwaway local secret. No real credentials are used.
const {
  chromium
} = require(process.cwd() + '/node_modules/playwright');
const fs = require('fs');
const out = process.env.MEETING_UI_OUTPUT_DIR || '/private/tmp/meeting-ui-next-proof';
fs.mkdirSync(out, {
  recursive: true
});
const id = '11111111-1111-4111-8111-111111111111',
  sid = '22222222-2222-4222-8222-222222222222',
  sid2 = '33333333-3333-4333-8333-333333333333';
const session = {
  sessionId: sid,
  scheduledStartIso: '2026-11-03T18:00:00Z',
  scheduledEndIso: '2026-11-03T19:30:00Z',
  ianaTimeZone: 'America/Los_Angeles',
  location: 'Virtual meeting',
  meetingLink: 'https://zoom.us/j/123456',
  status: 100000000,
  attendeeRefs: [{
    kind: 'staff',
    profileId: 7
  }],
  attendees: [],
  attendeeIssues: [],
  notes: ''
};
const slots = [{
  wmkf_deliberationslotid: '44444444-4444-4444-8444-444444444444',
  _wmkf_request_value: id,
  wmkf_order: 1,
  wmkf_minutes: 30,
  _etag: 'W/"1"',
  institution: 'Example University',
  wmkf_Request: {
    akoya_requestnum: '123456',
    akoya_title: 'Mapping how cells respond to mechanical stress'
  }
}];
const names = ['Example University', 'Sample Research Institute', 'Illustrative College', 'Example Institute of Technology', 'Sample University', 'Demonstration Research Center'];
const proposals = names.map((institution, i) => ({
  requestId: i ? id.slice(0, -1) + (i + 2) : id,
  requestNumber: String(123456 + i),
  institution,
  title: ['Mapping how cells respond to mechanical stress', 'New approaches to studying protein assembly', 'Understanding the origins of planetary systems', 'Measuring quantum behavior at larger scales', 'Tracing communication across neural circuits', 'Observing chemical reactions in real time'][i],
  programDirector: 'Fixture Director',
  projectLeader: 'Fixture Investigator',
  materialsAvailability: 'available',
  materials: i === 3 || i === 4 ? null : {
    state: i === 0 ? 'received' : i === 2 ? 'ready' : 'missing',
    invited: true,
    overdue: i === 5,
    receivedCount: i === 0 || i === 2 ? 3 : 0,
    requiredCount: 3
  },
  deliberation: i === 2 || i === 5 ? null : {
    sessionId: sid,
    scheduledStartIso: '2026-11-03T18:00:00Z',
    order: i + 1,
    minutes: 30
  },
  siteVisit: i === 3 ? null : {
    scheduledStartIso: '2026-11-12T22:00:00Z'
  },
  shareState: {
    lifecycleLabel: 'Ready for review'
  }
}));
const dashboard = {
  programId: 'research',
  programs: [{
    programId: 'research',
    name: 'Research'
  }],
  cycles: [{
    code: 'D26',
    label: 'December 2026'
  }],
  defaultCycleCode: 'D26',
  proposals,
  notices: []
};
const visit = {
  activityId: 'visit-fixture',
  etag: 'W/"1"',
  subject: 'Research presentation · Example University',
  startLocal: '2026-11-12T14:00',
  endLocal: '2026-11-12T15:00',
  timeZone: 'America/Los_Angeles',
  format: 100000001,
  locationOrLink: 'https://zoom.us/j/123456',
  organizer: {
    kind: 'staff',
    profileId: 7
  },
  requiredAttendees: [{
    kind: 'staff',
    profileId: 7
  }, {
    kind: 'manual',
    name: 'Fixture Investigator',
    email: 'investigator@example.org'
  }],
  optionalAttendees: []
};
const recipients = {
  staff: [{
    ref: {
      kind: 'staff',
      profileId: 7
    },
    name: 'Fixture Coordinator',
    email: 'coordinator@example.org'
  }],
  board: [],
  consultants: [],
  defaultAttendeeRefs: [{
    kind: 'staff',
    profileId: 7
  }]
};

const transcriptJob = {id:'transcript-fixture',status:'ready',version:1,created_at:'2026-10-24T17:00:00Z',ready_at:'2026-10-24T17:01:00Z',original_filename:'Synthetic research presentation.m4a',label:'Ready',needsAttention:false,contentAccessAllowed:true,speaker_names:{A:'Fixture Investigator',B:'Fixture Coordinator'}};
const transcriptContent = {text:'We will now move to the staff discussion.',utterances:[{speaker:'A',start:0,end:2500000,text:'This concludes the research presentation.'},{speaker:'B',start:2538000,end:2542000,text:'We will now move to the staff discussion.'}]};

(async () => {
  const browser = await chromium.launch({
    headless: true
  });
  let readyTranscript = false;
let writes = [],
    errors = [],
    evidence = [];
  try {
    const page = await browser.newPage({
      viewport: {
        width: 1440,
        height: 1000
      },
      timezoneId: 'America/Los_Angeles'
    });
    await page.context().addCookies([{
      name: 'next-auth.session-token',
      value: await require(process.cwd() + '/node_modules/next-auth/jwt').encode({
        token: {
          azureId: 'fixture-azure-id',
          lastActivity: Date.now(),
          profileId: 7,
          email: 'coordinator@example.org',
          name: 'Fixture Coordinator'
        },
        secret: 'meeting-ui-local-fixture-only',
        maxAge: 3600
      }),
      url: 'http://localhost:3197'
    }]);
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort());
    await page.route('**/_meeting-ui-axe.js', route => route.fulfill({ contentType:'application/javascript',body:fs.readFileSync(require.resolve('axe-core/axe.min.js'),'utf8') }));
    await page.route('**/api/**', async route => {
      const req = route.request(),
        url = new URL(req.url()),
        p = url.pathname;
      let body = {};
      if (req.method() !== 'GET') {
        writes.push(p);
        return route.fulfill({
          status: 409,
          json: {
            error: 'Synthetic visual test is read-only.'
          }
        });
      }
      if (p === '/api/auth/status') body = {
        enabled: true
      };else if (p === '/api/auth/session') body = {
        user: {
          name: 'Fixture Coordinator',
          email: 'coordinator@example.org',
          profileId: 7,
          azureId: 'fixture-azure-id'
        },
        expires: '2099-01-01T00:00:00Z'
      };else if (p === '/api/app-access') body = {
        apps: ['meeting-tracker', 'reviewers'],
        isSuperuser: false
      };else if (p === '/api/user-profiles') body = {
        profiles: [{
          id: 7,
          name: 'Fixture Coordinator',
          displayName: 'Fixture Coordinator',
          email: 'coordinator@example.org'
        }]
      };else if (p === '/api/user-preferences') body = {
        preferences: {
          _legacy_migration_complete: 'true'
        }
      };else if (p === '/api/meeting-tracker/dashboard') body = dashboard;else if (p === '/api/meeting-tracker/sessions') body = {
        sessions: [session, {
          ...session,
          sessionId: sid2,
          scheduledStartIso: '2026-11-03T21:00:00Z',
          scheduledEndIso: '2026-11-03T22:30:00Z',
          location: 'Conference room'
        }]
      };else if (p.startsWith('/api/meeting-tracker/sessions/')) body = {
        session: {
          ...session,
          sessionId: p.split('/').pop(),
          ...(p.endsWith('/'+sid2) ? {scheduledStartIso:'2026-11-03T21:00:00Z',scheduledEndIso:'2026-11-03T22:30:00Z',location:'Conference room'} : {})
        },
        slots
      };else if (p === '/api/meeting-tracker/recipients') body = recipients;else if (p.endsWith('/invitation')) body = {
        invitation: null,
        canSend: true,
        canReconcile: true
      };else if (p.endsWith('/materials')) body = {
        collection: null
      };else if (p.endsWith('/transcriptions')) body = {
        featureState: 'enabled', candidateSources: {}, candidates: [], jobs: readyTranscript ? [transcriptJob] : [], currentArtifact: null, publications: [], correctionDrafts: []
      };else if (p.endsWith('/transcriptions/transcript-fixture')) body = { job: transcriptJob, content: transcriptContent, candidates: []
      };else if (p.endsWith('/presentation-materials')) body = {
        materials: [],
        available: true
      };else if (p.endsWith('/presentation-link')) body = {
        link: null
      };else if (p === `/api/meeting-tracker/visits/${id}`) body = {
        siteVisit: visit,
        invitationAvailable: true,
        request: {
          requestNumber: '123456',
          institution: 'Example University',
          title: proposals[0].title
        },
        requestIdentity: {
          requestNumber: '123456',
          institution: 'Example University',
          title: proposals[0].title
        }
      };
      return route.fulfill({
        json: body
      });
    });
    async function shot(name) {
      await page.addScriptTag({ url: 'http://localhost:3197/_meeting-ui-axe.js' });
      const accessibility = await page.evaluate(async () => (await axe.run(document.querySelector('main'), { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa'] } })).violations.map(v => ({ id:v.id, impact:v.impact, targets:v.nodes.map(n=>n.target) })));
      if (accessibility.length) throw Error(name + ' accessibility violations ' + JSON.stringify(accessibility));
      await page.screenshot({
        path: `${out}/${name}.png`,
        fullPage: true
      });
      const m = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        heading: document.querySelector('h1')?.textContent,
        firstRow: document.querySelector('article')?.getBoundingClientRect().top
      }));
      if (m.scrollWidth > m.width) throw Error(name + ' horizontal overflow ' + JSON.stringify(m));
      evidence.push({
        name,
        accessibilityViolations: 0,
        ...m
      });
    }
    await page.goto('http://localhost:3197/meeting-tracker?programId=research&cycleCode=D26');
    await page.getByRole('heading', {
      name: '#123456',
      exact: true
    }).waitFor();
    await shot('landing-desktop');
    await page.getByRole('searchbox', {
      name: 'Find a request'
    }).fill('protein');
    await page.waitForFunction(() => document.querySelectorAll('article').length === 1, {}, {
      timeout: 5000
    });
    await page.getByRole('searchbox', {
      name: 'Find a request'
    }).fill('');
    await page.getByRole('combobox', {
      name: 'Materials status'
    }).selectOption('ready');
    await page.waitForFunction(() => document.querySelectorAll('article').length === 1, {}, {
      timeout: 5000
    });
    await page.getByRole('combobox', {
      name: 'Materials status'
    }).selectOption('all');
    await page.setViewportSize({
      width: 390,
      height: 844
    });
    await shot('landing-narrow');
    const first = page.locator('article').first();
    await first.getByRole('link', {
      name: /Open session/
    }).waitFor();
    await first.getByRole('link', {
      name: /Open research presentation/
    }).waitFor();
    await page.getByRole('link', {
      name: 'Proposal discussion sessions',
      exact: true
    }).click();
    await page.getByRole('heading', {
      name: 'Agenda preview'
    }).waitFor();
    await page.getByText('#123456 · Example University').waitFor();
    await page.getByRole('button', { name: /Preview agenda.*1:00 PM/ }).click();
    await page.getByRole('region', { name: 'Selected session preview' }).waitFor();
    if (!(await page.getByRole('region', {name:'Selected session preview'}).evaluate(el=>el===document.activeElement))) throw Error('Preview focus did not move');
    if (!new URL(page.url()).searchParams.has('view')) throw Error('View is not URL-addressable');
    await shot('sessions-narrow');
    await page.setViewportSize({
      width: 1440,
      height: 1000
    });
    await shot('sessions-desktop');
    await page.goto(`http://localhost:3197/meeting-tracker/visits/${id}?n=123456&cycleCode=D26&programId=research`);
    await page.getByRole('button', {
      name: 'Edit visit details'
    }).waitFor();
    await shot('workspace-setup-desktop');
    await page.setViewportSize({
      width: 390,
      height: 844
    });
    await shot('workspace-setup-narrow');
    for (const [tab, label] of [['invitations', 'Invitations'], ['materials', 'Materials collection'], ['recordings', 'Transcript preparation']]) {
      await page.getByRole('tab', {
        name: new RegExp(label)
      }).click();
      await page.waitForTimeout(200);
      await shot('workspace-' + tab + '-narrow');
      await page.setViewportSize({
        width: 1440,
        height: 1000
      });
      await shot('workspace-' + tab + '-desktop');
      await page.setViewportSize({
        width: 390,
        height: 844
      });
    }
    await page.getByRole('tab', {
      name: /Invitations/
    }).click();
    const message = page.getByRole('textbox', {
      name: /Message/
    });
    await message.fill('Keep my unsent draft');
    await page.getByRole('tab', {
      name: /Meeting setup/
    }).click();
    await page.getByRole('tab', {
      name: /Invitations/
    }).click();
    if ((await message.inputValue()) !== 'Keep my unsent draft') throw Error('Invitation draft lost');
    await page.setViewportSize({
      width: 1440,
      height: 1000
    });
    await page.goto(`http://localhost:3197/meeting-tracker/sessions/${sid}?cycleCode=D26&programId=research`);
    await page.getByRole('button', {
      name: 'Edit session details'
    }).waitFor();
    await shot('session-workspace-desktop');
    await page.setViewportSize({
      width: 390,
      height: 844
    });
    await shot('session-workspace-narrow');
    readyTranscript = true;
    await page.goto(`http://localhost:3197/meeting-tracker/visits/${id}?n=123456&cycleCode=D26&programId=research#recording-and-transcript-card`);
    await page.getByRole('tab', {name:/Transcript preparation/}).waitFor();
    await page.getByLabel('Name for Speaker A').waitFor();
    await shot('workspace-transcript-review-narrow');
    await page.setViewportSize({width:1440,height:1000});
    await shot('workspace-transcript-review-desktop');
    if (writes.length) throw Error('Unexpected writes ' + writes.join(','));
    if (errors.length) throw Error(errors.join('\n'));
    fs.writeFileSync(out + '/evidence.json', JSON.stringify({
      screens: evidence,
      checks: ['request search', 'materials select', 'both mobile actions', 'separate sessions preview', 'all visit task panels', 'invitation draft preservation', 'session workspace', 'URL-addressable sessions view', 'preview focus and scroll', 'generated speaker review', 'WCAG A/AA automated scan', 'no horizontal overflow', 'no writes', 'no browser exceptions']
    }, null, 2));
    console.log(JSON.stringify(evidence));
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exit(1);
});
