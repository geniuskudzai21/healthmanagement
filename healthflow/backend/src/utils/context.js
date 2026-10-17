function buildContext(req) {
  return {
    actorId: req.user ? req.user.id : null,
    ip: req.ip || req.socket.remoteAddress || null,
  };
}

module.exports = { buildContext };
