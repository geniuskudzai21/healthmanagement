const authService = require('../services/auth.service');
const { setAuthCookie, clearAuthCookie } = require('../utils/cookies');

exports.login = async (req, res, next) => {
  try {
    const { token, user } = await authService.login(req.valid.email, req.valid.password, res.locals.ctx);
    setAuthCookie(res, token);
    res.json({ user });
  } catch (err) {
    next(err);
  }
};

exports.logout = (req, res) => {
  clearAuthCookie(res);
  res.status(204).send();
};

exports.me = async (req, res, next) => {
  try {
    res.json(await authService.me(req.user.id));
  } catch (err) {
    next(err);
  }
};

exports.changePassword = async (req, res, next) => {
  try {
    const { token, user } = await authService.changePassword(
      req.user.id,
      req.valid.current_password,
      req.valid.new_password,
      res.locals.ctx
    );
    setAuthCookie(res, token);
    res.json({ user, message: 'Password updated. Other sessions have been signed out.' });
  } catch (err) {
    next(err);
  }
};
