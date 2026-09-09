// Unit tests for the lease + maintenance status state machines
// (utils/transitions.js). These maps are the single source of truth used by
// both controllers — tests here protect the invariants in
// ARCHITECTURE-ESSENTIALS.md rule 6 (leases) and rule 7 (maintenance).
const { LEASE_TRANSITIONS, MAINTENANCE_TRANSITIONS, isTransitionAllowed } =
  require('../../server/src/utils/transitions');

describe('isleTransitionAllowed — leases', () => {
  it('allows active → expired and active → terminated', () => {
    expect(isTransitionAllowed(LEASE_TRANSITIONS, 'active', 'expired')).toBe(true);
    expect(isTransitionAllowed(LEASE_TRANSITIONS, 'active', 'terminated')).toBe(true);
  });

  it('rejects terminal → anything', () => {
    expect(isTransitionAllowed(LEASE_TRANSITIONS, 'expired', 'active')).toBe(false);
    expect(isTransitionAllowed(LEASE_TRANSITIONS, 'expired', 'terminated')).toBe(false);
    expect(isTransitionAllowed(LEASE_TRANSITIONS, 'terminated', 'active')).toBe(false);
    expect(isTransitionAllowed(LEASE_TRANSITIONS, 'terminated', 'expired')).toBe(false);
  });

  it('rejects no-op status changes', () => {
    expect(isTransitionAllowed(LEASE_TRANSITIONS, 'active', 'active')).toBe(false);
  });

  it('rejects unknown states', () => {
    expect(isTransitionAllowed(LEASE_TRANSITIONS, 'bogus', 'active')).toBe(false);
    expect(isTransitionAllowed(LEASE_TRANSITIONS, 'active', 'bogus')).toBe(false);
  });
});

describe('isTransitionAllowed — maintenance', () => {
  it('allows open → in_progress and open → cancelled', () => {
    expect(isTransitionAllowed(MAINTENANCE_TRANSITIONS, 'open', 'in_progress')).toBe(true);
    expect(isTransitionAllowed(MAINTENANCE_TRANSITIONS, 'open', 'cancelled')).toBe(true);
  });

  it('allows in_progress → resolved and in_progress → cancelled', () => {
    expect(isTransitionAllowed(MAINTENANCE_TRANSITIONS, 'in_progress', 'resolved')).toBe(true);
    expect(isTransitionAllowed(MAINTENANCE_TRANSITIONS, 'in_progress', 'cancelled')).toBe(true);
  });

  it('rejects skipping in_progress (open → resolved straight)', () => {
    // Rule: open → in_progress → resolved. No leapfrogging.
    expect(isTransitionAllowed(MAINTENANCE_TRANSITIONS, 'open', 'resolved')).toBe(false);
  });

  it('rejects reopening resolved/cancelled requests', () => {
    expect(isTransitionAllowed(MAINTENANCE_TRANSITIONS, 'resolved', 'open')).toBe(false);
    expect(isTransitionAllowed(MAINTENANCE_TRANSITIONS, 'resolved', 'in_progress')).toBe(false);
    expect(isTransitionAllowed(MAINTENANCE_TRANSITIONS, 'cancelled', 'open')).toBe(false);
    expect(isTransitionAllowed(MAINTENANCE_TRANSITIONS, 'cancelled', 'in_progress')).toBe(false);
  });

  it('rejects no-op and unknown status changes', () => {
    expect(isTransitionAllowed(MAINTENANCE_TRANSITIONS, 'open', 'open')).toBe(false);
    expect(isTransitionAllowed(MAINTENANCE_TRANSITIONS, 'open', 'bogus')).toBe(false);
  });
});