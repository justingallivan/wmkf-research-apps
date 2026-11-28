/** @jest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react';
import { ApplicantAnswers, IntakeFindings, KeywordsCard } from '../../shared/components/workbench/IntakeFields';

const present = {
  status: 'present',
  methodology: 'Radar on rovers.', personnel: null, rationale: 'Would locate old ice.',
  fitAssessment: 'Fit', fitRationale: 'Instrument development serves the question.', riskFlags: null,
  scientificQuestion: 'Where does old ice survive?', aiUse: null,
  fieldKeywords: JSON.stringify({ schema: 'wmkf-keywords/1', primary: { term: 'Glaciology', id: 'row-id-1' }, runner_up: null, secondary: [], objects: [], other: [] }),
  methodsKeywords: null,
};

test('intake findings show text, the fit check, empty fields and no flags', () => {
  render(<IntakeFindings intake={present} />);
  expect(screen.getByText('Radar on rovers.')).toBeInTheDocument();
  expect(screen.getByText('Would locate old ice.')).toBeInTheDocument();
  expect(screen.getByText('Fit')).toBeInTheDocument();
  expect(screen.getByText('Instrument development serves the question.')).toBeInTheDocument();
  expect(screen.getAllByText('Not yet generated.')).toHaveLength(1);
  expect(screen.getByText('None generated yet.')).toBeInTheDocument();
});

test('an unavailable read says it could not load, never that nothing was generated', () => {
  render(<><IntakeFindings intake={{ status: 'unavailable' }} /><KeywordsCard intake={{ status: 'unavailable' }} /></>);
  expect(screen.getAllByText('Couldn’t load the intake fields for this request.')).toHaveLength(2);
  expect(screen.queryByText('Not yet generated.')).toBeNull();
});

test('keywords render terms without ids; missing methods are not yet generated', () => {
  const { container } = render(<KeywordsCard intake={present} />);
  expect(screen.getByText('Glaciology')).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/row-id-1/);
  expect(screen.getByText('Not yet generated.')).toBeInTheDocument();
});

test('unreadable keywords say so', () => {
  render(<KeywordsCard intake={{ ...present, fieldKeywords: '{broken' }} />);
  expect(screen.getByText('Couldn’t read the field keywords.')).toBeInTheDocument();
});

test('applicant answers are folded and show blanks as not provided', () => {
  render(<ApplicantAnswers intake={present} />);
  const summary = screen.getByText('Applicant’s summary answers');
  expect(summary.closest('details')).not.toHaveAttribute('open');
  fireEvent.click(summary);
  expect(screen.getByText('Where does old ice survive?')).toBeInTheDocument();
  expect(screen.getAllByText('Not provided.').length).toBeGreaterThan(0);
});

test('nothing renders without an intake block (pre-2027 requests)', () => {
  const { container } = render(<><IntakeFindings intake={undefined} /><KeywordsCard intake={undefined} /><ApplicantAnswers intake={undefined} /></>);
  expect(container).toBeEmptyDOMElement();
});
