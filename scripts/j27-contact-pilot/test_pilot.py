import hashlib
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from uuid import UUID

import pilot


class Study(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.pdf = Path(tmp.name)/'fixture.pdf'
        self.pdf.write_bytes(b'proposal bytes')
        self.hash = hashlib.sha256(self.pdf.read_bytes()).hexdigest()
        self.db = pilot.connect(Path(tmp.name)/'study.sqlite')
        self.addCleanup(self.db.close)
        self.ids = [str(UUID(int=i)) for i in range(1,23)]
        self.rows = [dict(request_id=k,request_number=i,cycle='J27',program='Research',opportunity='001024',
                          test=(i==0),original_submitted_at='2026-12-01T12:00:00Z') for i,k in enumerate(self.ids)]
        pilot.enroll(self.db,self.rows[::-1]+[self.rows[2]])

    def freeze(self, count=1):
        for i,key in enumerate(self.ids[1:21]):
            frame=dict(requestId=key,analysisResult=dict(reviewerSuggestions=[dict(name='Test Person')]*count if i==0 else []))
            if i==1:
                frame=dict(requestId=key,failure='first analysis timed out')
            pilot.manifest(self.db,key,self.pdf)
            pilot.freeze(self.db,frame,self.hash)

        starts=pilot.starting_template(self.db)
        for r in starts:
            before={k:[] for k in pilot.HOLDS}
            before.update(contact=['review'],relationship=['coauthor'],crm=['address conflict'])
            r.update(candidate_key='test:'+r['slot'],before=before,roster_evidence_sha256='1'*64)
        pilot.starting_state(self.db,starts)

    def decisions(self):
        for operator in ('A','B'):
            form=pilot.form(self.db,operator,'A','B')
            for r in form:
                before=r['before']
                after=deepcopy(before)
                r.update(before=before,after_reload=after,active_seconds=120,notes='no supported mailbox',outcome='held')
                if r['arm']=='staff_confirmed':
                    after['contact']=[]
                    r['staff_receipt']=dict(requestId=r['slot'].split('/')[0],candidateKey=r['candidate_key'],
                        email='test@example.org',evidenceUrl='https://example.org/person',attestedAt='2026-12-01',actorProfileId=operator)
                    r.update(outcome='ready',email='test@example.org',evidence_url='https://example.org/person',
                             reloaded_email='test@example.org',reloaded_evidence_url='https://example.org/person',active_seconds=60)
            pilot.decision(self.db,form)
            pilot.decision(self.db,form)

    def judgments(self):
        items=pilot.blind(self.db)
        for r in items:
            self.assertNotIn('arm',r)
            r.update(adjudicator='C',eligible=True,current_source='directory',checked_on='2026-12-01',
                     person_id='person',evidence_sha256='b'*64,verdict='correct' if r['proposed_email'] else 'no_clearance')
        return items

    def test_cohort_and_freeze(self):
        self.assertEqual(list(pilot.records(self.db,'proposal')),self.ids[1:21])
        with self.assertRaises(ValueError):
            pilot.enroll(self.db,self.rows[3:])
        self.freeze(2)
        self.freeze(2)
        self.assertEqual(len(pilot.records(self.db,'slot')),2)
        with self.assertRaises(ValueError):
            self.freeze(0)
        self.assertFalse(pilot.report(self.db)['measurement_complete'])

    def test_empty(self):
        self.freeze(0)
        report=pilot.report(self.db)
        self.assertFalse(report['measurement_complete'])
        self.assertIsNone(report['net_correct_gain_percentage_points'])
        self.assertEqual(len(report['failed_find']),1)

    def test_paired_report(self):
        self.freeze()
        self.decisions()
        items=self.judgments()
        with self.assertRaises(ValueError):
            pilot.judge(self.db,[dict(items[0],adjudicator=' A ')])
        with self.assertRaises(ValueError):
            pilot.judge(self.db,[dict(items[0],proposed_email='changed')])
        pilot.judge(self.db,items)
        report=pilot.report(self.db)
        self.assertTrue(report['measurement_complete'])
        self.assertFalse(report['pause_for_review'])
        self.assertEqual(report['correct_contact_pairs']['staff_confirmed_only'],1)
        self.assertEqual(report['active_time_reduction_pct'],50)
        self.assertEqual(report['hold_changes'][0]['category'],'contact')

    def test_wrong_contact_and_hold_release(self):
        self.freeze()
        self.decisions()
        items=self.judgments()
        next(x for x in items if x['proposed_email'])['verdict']='wrong'
        pilot.judge(self.db,items)
        self.assertTrue(pilot.report(self.db)['pause_for_review'])
        self.assertEqual(pilot.report(self.db)['correct_contact_pairs']['neither'],1)

    def test_cannot_credit_automatic_or_stale_save(self):
        self.freeze()
        r=pilot.form(self.db,'B','A','B')[0]
        after=deepcopy(r['before'])
        after['contact']=[]
        r.update(outcome='ready',email='person@example.org',reloaded_email='person@example.org',
                 evidence_url='https://example.org/team',reloaded_evidence_url='https://example.org/team',
                 after_reload=after,active_seconds=12)
        with self.assertRaisesRegex(ValueError,'receipt'):
            pilot.decision(self.db,[r])
        r['staff_receipt']=dict(requestId=self.ids[2],candidateKey=r['candidate_key'],
               email=r['email'],evidenceUrl=r['evidence_url'],actorProfileId='B',attestedAt='2026-12-01')
        with self.assertRaisesRegex(ValueError,'receipt'):
            pilot.decision(self.db,[r])
        r['staff_receipt']['requestId']=self.ids[1]
        r['reloaded_email']='other@example.org'
        with self.assertRaisesRegex(ValueError,'readback'):
            pilot.decision(self.db,[r])
        self.assertFalse(pilot.records(self.db,'decision'))

    def test_unknown_holds_and_unsafe_changes(self):
        self.freeze()
        r=pilot.form(self.db,'B','A','B')[0]
        before=r['before']
        after=deepcopy(before)
        after['crm']=[]
        r.update(outcome='held',before=before,after_reload=after,notes='held',active_seconds=3)
        pilot.decision(self.db,[r])
        self.assertIn('crm',pilot.report(self.db)['safety_review'][0])
        r=pilot.form(self.db,'A','A','B')[0]
        r.update(outcome='failed',notes='unavailable',active_seconds=5)
        pilot.decision(self.db,[r])
        self.assertTrue(pilot.report(self.db)['unknown_hold_readbacks'])
        self.assertTrue(pilot.report(self.db)['pause_for_review'])


if __name__=='__main__':
    unittest.main()
