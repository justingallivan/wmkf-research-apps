---
title: "Wishlist & Brainstorming"
domain: docs-governance
kind: plan
status: draft
summary: "Working collection of ideas, observations, and future directions for the app suite. Not commitments — just things we've thought about and want to..."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
---

# Wishlist & Brainstorming

Working collection of ideas, observations, and future directions for the app suite. Not commitments — just things we've thought about and want to keep track of.

**Started:** March 2026

---

## The Grant Cycle

### The new cycle (draft, as of March 2026)

Leadership is considering eliminating concept calls and Phase I proposals entirely. Instead, institutions submit up to 3 five-page proposals directly, twice a year (June and December board meetings). See `6_month_timeline_v2.pdf` for the full timeline.

The new flow:

1. **Proposals submitted** (Day 1, Monday) — 3 per institution, cover sheet + 5 pages. No concepts, no Phase I. This is the only submission.

2. **AI analysis, summarize & flag** (Day 2, Tuesday) — AI processes all proposals overnight. Expertise matching to Board members, PDs, and consultants. Triage flags generated. **This is our app suite — it's on the official timeline.**

3. **Released to staff** (Day 3, Wednesday) — PDs get proposals with AI summaries and flags already attached.

4. **Staff read and review flags** (~4 weeks) — PDs review proposals and the AI-generated flags. Human approval required on all triage decisions.

5. **AI Triage Meeting** (~1 month in) — First big cut. Rescue borderline proposals or finalize decline notes. Consultants invited for proposals in their domains.

6. **PD Triage Meetings** — Further winnowing. Produces the "Save for Now" (SFN) list — proposals that survive and keep advancing. Everything not on the SFN list is declined.

7. **Weekly Research Program Meetings** (~4 weeks) — Discuss the SFN list in depth. More proposals fall off.

8. **Program Committee gets personalized shortlists** — SFN proposals matched to committee members by expertise. Committee can request full proposals.

9. **Consultant reviews due** (~7 weeks after submission) — Standing advisors on retainer with domain expertise review proposals in their areas. They know what the Foundation is looking for.

10. **Finalize recommendations → 1-page writeups** — Staff prepare 1-page summaries for finalists (20-30 proposals).

11. **Diligent Book sent to Program Chairs** — Writeups with staff recommendations + full proposals.

12. **Program Chairs Meeting** — Discuss, finalize review list. **Peer reviewers and site visits invited at this point** — much later than in the old process.

13. **Peer reviews due** (~1 month after invitation)

14. **Pre-site visit meetings** — Discuss reviews, prepare questions.

15. **Site visits** (~4 weeks) — Conducted remotely.

16. **Ranking meetings, finalize writeups** — Final staff deliberations.

17. **Leadership and Program Chairs notified** — Ranked recommendations with summary spreadsheet.

18. **Mailing books** — Materials sent to Board members.

19. **Board Meeting** — Decisions made. June or December.

Key changes from the old cycle:
- No concept calls, no Phase I — a much simpler front end
- AI is a named step on Day 2, not an optional tool
- More proposals hit you at once (3 per institution vs. 1 through the old funnel)
- Consultants provide early expert signal (catching time machine problems before peer review)
- Peer reviewers come in much later — only after Program Chairs have weighed in
- 1-page writeups instead of longer format
- The whole thing runs in ~6 months, twice a year

### The old cycle (for reference)

1. **Concepts** — Institutions submit up to 4 one-page concepts per program (SE and MR). A PD reads them and gives feedback on a concept call with institutional liaisons (not the scientists themselves). Institutions then pick their strongest concept to advance.

2. **Phase I proposals** — One per institution per program, 3 pages. All PDs read all proposals. Multiple rounds of internal meetings to triage and rank. Ranked list presented to program chairs and Foundation leadership for approval. Top proposals invited to Phase II.

3. **Phase II proposals** — 10 pages. Lead PD assigned. Peer reviewers found and managed (COI forms, invitations, follow-ups, deadline tracking). Writeups started before reviews arrive. Reviews integrated when they come in.

4. **Site visits** — Scheduled in advance, conducted remotely. Can be skipped if proposal is clearly not competitive.

5. **Staff deliberations** — Deeper discussion of fewer proposals, similar to Phase I ranking process.

6. **Program chair + leadership meeting** — Present recommendations.

7. **Full board meeting** — Decisions made. June or December.

### Key dynamics (still relevant in the new cycle):

**The time machine problem.** Ambitious, transformative proposals are exciting but may not be feasible. The new cycle addresses this partly by bringing in consultants early for expert signal, rather than waiting until peer review to discover the team can't deliver.

**Reviewer conservatism vs. philanthropic risk tolerance.** Peer reviewers focus on what can go wrong. The Foundation can swing for the fences. A proposal with one glowing review and one scathing one isn't a 5/10 — it's a signal that something interesting is happening. PDs arbitrate, and sometimes argue why a critical review misses the point. This is fundamentally different from the federal panel system where mixed reviews produce tepid scores and tepid proposals don't get funded.

**Overlapping cycles.** Two 6-month cycles per year, offset. Staff can be ranking proposals for the June board while processing new submissions for December.

### Staff:

- Two research programs: Science & Engineering (SE) and Medical Research (MR)
- Two PDs per program (four total), all PhDs — can evaluate science but aren't experts in every funded area
- Consultants on retainer with domain expertise (e.g., data science) — know what the Foundation looks for
- SoCal program (non-science, different workflows, less technically savvy staff) — lower priority for tooling but will want similar capabilities eventually
- Special projects and staff-directed giving also exist but can stay on AkoyaGO for now

---

## Concrete Ideas

### Day 2 Pipeline: AI Analysis, Summarize & Flag
This is the most time-critical capability in the new cycle — proposals arrive Monday, AI analysis must be ready Tuesday. Needs to handle a batch of potentially 100+ proposals overnight:
- Summarize each proposal (we can already do this)
- Generate triage flags (new capability — scope fit, feasibility concerns, overlap with existing grants, integrity flags)
- Match proposals to expertise profiles — which Board member, PD, or consultant should see this?
- Produce a structured output per proposal: summary, flags, expertise matches, key metadata
- All results written back to Dynamics/SharePoint for staff to access Wednesday morning

### Expertise Registry & Matching
Build a "stable" of expertise profiles for Board scientists, PDs, and consultants:
- Maintain domain expertise profiles (could be as simple as keywords/areas, or as rich as publication histories)
- When proposals arrive, automatically suggest who should review each one
- Personalized shortlists for Program Committee members based on their expertise
- Similar matching logic to Reviewer Finder, but for internal routing instead of external peer review
- Profiles would need to be maintained — add new consultants, update areas as Board composition changes

### Reviewer Management Agent
An autonomous agent that handles the logistics of the reviewer lifecycle:
- Send initial invitations (already working via Dynamics email)
- Track responses — accepted, declined, no response
- Send COI forms to accepted reviewers
- Track COI form completion
- Send proposal materials when COI is cleared
- Monitor review deadlines — nudge as deadlines approach
- Detect dropped-out reviewers (no response after multiple follow-ups)
- Escalate to PD when human judgment is needed ("three reviewers declined, should I find replacements?")
- Handle reviewer payments ($250 per review)
- All activity tracked as CRM email activities on the proposal record

In the new cycle, peer reviewers are invited later (after Program Chairs meeting) but consultant reviews are needed earlier. The agent could manage both tracks.

### Triage Flags
AI-generated flags that surface things PDs should look at. All require human approval — flags inform, they don't decide. Possible flag types:
- **Scope** — proposal doesn't fit Foundation priorities or program areas
- **Overlap** — similar to something already funded or previously declined
- **Feasibility** — ambitious claims without clear methodology (time machine detector)
- **Integrity** — PI or team has integrity concerns (connects to existing Integrity Screener)
- **Budget** — unusual budget items or scale
- **Expertise gap** — no one on staff or the consultant roster has relevant domain knowledge
- Could evolve based on what PDs actually find useful

### 1-Page Writeup Generator
The new cycle calls for 1-page writeups for finalists (20-30 total) instead of the longer format:
- Pull proposal data from Dynamics
- Generate concise 1-page summary with staff recommendation
- Interactive editing (like the existing Phase II writeup app)
- Output formatted for the Diligent Book
- Batch generation for all finalists at once

### Diligent Book Assembly
Package 20-30 writeups with recommendations and full proposals for Program Chairs:
- Automated assembly from components already in SharePoint/Dynamics
- Table of contents, consistent formatting
- Could be PDF or whatever format Diligent expects
- Sent on schedule (Feb 12 / Aug 13 in the timeline)

### PD Dashboard
A program director's home screen for the cycle:
- Where are we in the timeline? What's due next?
- My proposals, organized by status (new → flagged → SFN → finalist → peer review → site visit → ranked)
- What needs attention (flags to review, reviews overdue, writeups due)
- Quick access to each proposal's summary, flags, reviews, reviewer status
- Cycle-level view: how many proposals at each stage, what's the workload

### Meeting Slide Generation
Auto-generate presentation slides for board meetings and program chair meetings:
- Pull title, presenter, graphical abstract from the writeup
- Pull proposal metadata from Dynamics (PI, institution, program)
- Simple, clean layout — could be more modern than PowerPoint
- Low effort, nice quality-of-life improvement

### Proposal Picker (Shared Component)
Browse and search Dynamics proposals from within any app:
- Filter by grant cycle, status, program, PD assignment
- Search by title, PI, institution, keyword
- Pull metadata directly from CRM fields
- Pull documents from SharePoint
- Usable across all apps

### Batch Cycle Processing
"Process all proposals for the June cycle":
- Select a grant cycle
- Pull all proposals at the appropriate status
- Run them through whatever processing is needed (summarize, flag, generate writeups)
- Track progress across the batch
- Results go back to Dynamics/SharePoint

### Analytics & Reporting
- Proposals per cycle, by program
- Acceptance/triage rates at each stage
- Time-to-decision metrics
- Reviewer response and completion rates
- Reviewer payment tracking
- Consultant utilization
- Could feed into board reports or internal planning

### Document Assembly
- Currently handled in Power Automate (cover page + proposal + budget → single PDF)
- May want to bring this into the app suite for tighter integration
- In the new cycle, the "Diligent Book" is a major assembly task

### Full-Document AI Processing
Currently stripping graphics from PDFs to save tokens. As costs come down and vision capabilities improve:
- Pass full proposals with figures to Claude
- Let Claude interpret graphical abstracts, data figures, experimental schematics
- Richer analysis that accounts for visual content, not just text
- Build the infrastructure to handle this now; optimize economics later

### Decline Notes
The new timeline mentions "finalize decline notes" at triage. Could be AI-assisted:
- Draft a brief, professional decline note based on the proposal and the reason for triage
- PD reviews and edits
- Sent via Dynamics email, tracked on the CRM record
- Templates by decline reason, personalized per proposal

### Virtual Review Panel
Multiple LLMs debating the merits of a proposal in a structured panel format:
- Panel of 3 AI reviewers with assigned roles: Optimist (steelman), Skeptic (strawman), and Neutral arbiter
- Could use different models (Claude, Gemini, ChatGPT) for genuine diversity of reasoning, or same model with different system prompts
- Structured rounds: opening assessments → direct responses to each other's points → final verdicts
- Neutral arbiter synthesizes where the panel agrees, where they disagree, and what the key tensions are
- Steelman/strawman framing keeps the debate productive — Optimist must make the strongest possible case, Skeptic must find the real weaknesses (not nitpick)
- Token-conscious design: focus debate on the big questions (feasibility, significance, innovation) rather than letting models burn tokens on minor methodological details
- Output: a structured panel report that surfaces genuine tensions in the proposal, not just a list of pros and cons
- Different from a single-model evaluation — the back-and-forth forces each "reviewer" to defend positions and respond to challenges
- Could be especially useful for borderline proposals where the interesting question is "should we take this risk?"

---

## Open Questions

- **Timeline finalization:** The new cycle is draft. What changes before it's adopted? How does this affect what we build first?

- **SFN list mechanics:** How is the "Save for Now" list managed in Dynamics? New status field? Does it need its own tracking?

- **Consultant onboarding:** How do we capture consultant expertise profiles? Who maintains them? What format works?

- **Board member expertise:** Same questions — how do we know which Board members are scientists and what their domains are?

- **Program Committee:** Who are they relative to Board and Program Chairs? How do they receive the personalized shortlists?

- **Site visit support:** Remote site visits are the new normal. Structured note-taking linked to proposal records would help. Scheduling integration (Calendly API/MCP to Dynamics) to automate coordinating 20+ visits in a 4-week window. Booked visits should show up on the proposal record and PD dashboard.

- **SoCal program:** Different workflows, different staff. When do we extend the tools? What's different about their process?

- **Power Automate and our apps:** Power Automate is good at plumbing inside the Microsoft ecosystem -- moving files, updating statuses, triggering on Dynamics events, simple document assembly. Our apps handle the thinking -- AI analysis, interactive drafting, reviewer discovery. They work together: Power Automate can trigger our APIs on status changes, and our apps can kick off Power Automate flows when outputs are ready. Draw the line at whether it needs AI or a custom UI (ours) vs. pure data/file operations (Power Automate).

- **Diligent:** Board portal software used to prepare and distribute materials to Board members. Someone else on staff manages it. We need to learn what format it expects so our outputs (writeups, recommendation spreadsheets) can drop in cleanly.

- **Decline communication:** Likely an automated-but-personalized system. AI drafts a decline note based on the proposal and decline reason, PD or admin reviews and approves, sent via Dynamics email on the CRM record. Doesn't need to be high-touch at that stage, just respectful.

---

*Add to this document whenever ideas come up. No idea is too small or too speculative.*
