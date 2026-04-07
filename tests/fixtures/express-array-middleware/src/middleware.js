function authenticate(_req, _res, next) {
  return next();
}

function audit(_req, _res, next) {
  return next();
}

function authorize(_role) {
  return (_req, _res, next) => next();
}

module.exports = {
  authenticate,
  audit,
  authorize,
};
