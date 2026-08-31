// src/middleware/validate.js — Wrapper zod para validar body/query/params
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const data = req[source];
    const result = schema.safeParse(data);
    if (!result.success) {
      const msg = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
      return res.status(400).json({ error: msg });
    }
    req[source] = result.data;
    next();
  };
}

module.exports = { validate };
