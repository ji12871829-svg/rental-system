// pagination.js — shared helper for all list endpoints.
// Clamp limit to [1, 100], default 20; compute offset from page.
function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

function buildPaginationResponse(data, total, page, limit) {
  return {
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

module.exports = { parsePagination, buildPaginationResponse };
