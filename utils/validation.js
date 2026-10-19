const ApiError = require('./ApiError');

function isObjectId(value) {
  return typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);
}

function validateBody(body, allowedFields) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length === 0) {
    throw new ApiError(400, 'A non-empty JSON object is required');
  }
  if (Object.keys(body).some(key => !allowedFields.includes(key))) {
    throw new ApiError(400, `Only ${allowedFields.join(', ')} are allowed`);
  }
}

module.exports = { isObjectId, validateBody };
