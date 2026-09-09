// transitions.js — single source of truth for the two state machines that must
// never drift between controller, model and client (see AGENTS.md §2/§4).

const LEASE_TRANSITIONS = {
  active: ['expired', 'terminated'],
  expired: [],
  terminated: [],
};

const MAINTENANCE_TRANSITIONS = {
  open: ['in_progress', 'cancelled'],
  in_progress: ['resolved', 'cancelled'],
  resolved: [],
  cancelled: [],
};

function isTransitionAllowed(map, from, to) {
  if (from === to) return false; // no-op status changes rejected as invalid
  return (map[from] || []).includes(to);
}

module.exports = { LEASE_TRANSITIONS, MAINTENANCE_TRANSITIONS, isTransitionAllowed };
