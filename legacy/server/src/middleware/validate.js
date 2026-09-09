// validate.js — generic middleware factory: validates req.body against a zod
// schema. 400 for malformed JSON (handled in errorHandler), 422 for a
// well-formed body that fails the schema (see ARCHITECTURE.md §6 for the
// distinction between the two).
const { HttpError } = require('../utils/httpError');

function validate(schema) {
  return function (req, res, next) {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      // Flatten zod issues into { fieldName: "message" } for the client.
      const details = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join('.') || '_';
        if (!details[key]) details[key] = issue.message;
      }
      return next(new HttpError(422, 'VALIDATION_ERROR', 'Validation failed.', details));
    }
    // Replace with the parsed (coerced/stripped) body so controllers only
    // ever see known, typed fields — no unexpected keys reach the models.
    req.body = result.data;
    return next();
  };
}

module.exports = validate;
