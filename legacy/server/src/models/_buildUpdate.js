// _buildUpdate.js — shared UPDATE builder for models. Column names come only
// from the model's own allowlist (never user input); values are parameterized.
// Returns null when there is nothing to update so callers can no-op.
// Tables without an `updated_at` column (e.g. maintenance_requests) pass
// { withTimestamp: false }.
function buildUpdate(table, id, fields, { withTimestamp = true } = {}) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return null;
  const setSql = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const timestamp = withTimestamp ? ', updated_at = NOW()' : '';
  const params = keys.map((k) => fields[k]);
  params.push(id);
  return {
    text: `UPDATE ${table} SET ${setSql}${timestamp} WHERE id = $${params.length} RETURNING *`,
    values: params,
  };
}

module.exports = { buildUpdate };
