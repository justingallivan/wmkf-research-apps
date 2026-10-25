/** Browser-only rehearsal identity; never imported by the application. */
export const useSession = () => ({ status: 'authenticated', data: { user: { email: 'pc@example.org', dynamicsSystemuserId: '33333333-3333-4333-8333-333333333333' } } });
export const signOut = () => { throw new Error('No auth actions in rehearsal'); };
