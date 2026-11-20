import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RosterEditor } from '../../shared/components/admin/ExpertiseRosterSection';
const id = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const initial = { id, etag: 'W/"1"', name: 'Linked person', role_type: 'Consultant', is_active: true, lead_pd_eligible: false, dataverse_user_id: null, dataverse_contact_id: contactId, preferred_email: null };
beforeEach(() => { fetch.mockReset(); fetch.mockResolvedValue({ ok: true, json: async () => ({ contact: { contactId, name: 'Linked Contact', available: true }, member: initial }) }); });
test('category change and deactivation preserve Contact; picker uses Admin API', async () => {
  const onSaved = jest.fn(); render(<RosterEditor initial={initial} users={[]} onSaved={onSaved} onCancel={() => {}} />);
  await screen.findByText('Linked Contact');
  expect(fetch.mock.calls[0][0]).toContain('/api/admin/expertise-roster?contactId=');
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Research Program Staff' } });
  fireEvent.click(screen.getByLabelText('Active roster member'));
  fireEvent.click(screen.getByRole('button', { name: 'Save person' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  const payload = JSON.parse(fetch.mock.calls.find(c => c[1]?.method === 'PATCH')[1].body);
  expect(payload).toMatchObject({ role_type: 'Research Program Staff', dataverse_contact_id: contactId, is_active: false, lead_pd_eligible: false });
});
test('failed creation retains mutation key for retry and never reports success early', async () => {
  const onSaved = jest.fn(); fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Binding unavailable. Retry.' }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ member: initial }) });
  render(<RosterEditor initial={{ ...initial, id: undefined, mutation_id: id, dataverse_contact_id: null }} users={[]} onSaved={onSaved} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Save person' })); await screen.findByRole('alert'); expect(onSaved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save person' })); await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(fetch.mock.calls.map(c => JSON.parse(c[1].body).mutation_id)).toEqual([id,id]);
});

test('lost update response can reload persisted fields and ETag before retry', async () => {
  const onSaved=jest.fn();
  fetch.mockResolvedValueOnce({ok:false,json:async()=>({error:'Save outcome unknown'})})
    .mockResolvedValueOnce({ok:true,json:async()=>({member:{...initial,dataverse_contact_id:null,etag:'W/"2"',name:'Saved name'}})})
    .mockResolvedValueOnce({ok:true,json:async()=>({member:initial})});
  render(<RosterEditor initial={{...initial,dataverse_contact_id:null}} users={[]} onSaved={onSaved} onCancel={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Save person'}));
  fireEvent.click(await screen.findByRole('button',{name:'Reload saved version (discard these edits)'}));
  await waitFor(()=>expect(screen.getByLabelText('Name')).toHaveValue('Saved name'));
  fireEvent.click(screen.getByRole('button',{name:'Save person'}));await waitFor(()=>expect(onSaved).toHaveBeenCalled());
  const writes=fetch.mock.calls.filter(c=>c[1]?.method==='PATCH');expect(JSON.parse(writes[1][1].body).etag).toBe('W/"2"');
});
