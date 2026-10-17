const jwtConfig = require('../config/jwt');

function setAuthCookie(res, token) {
  res.cookie(jwtConfig.cookieName, token, jwtConfig.cookieOptions);
}

function clearAuthCookie(res) {
  const { maxAge, ...rest } = jwtConfig.cookieOptions;
  res.clearCookie(jwtConfig.cookieName, rest);
}

module.exports = { setAuthCookie, clearAuthCookie };
