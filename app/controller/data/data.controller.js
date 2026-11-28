"use strict";

const { cziServiceForScript } = require('../cziService');

const data = function (req, res) {
  // store return path in case of login
  req.session.returnTo = req.originalUrl;

  res.render('data', {
    title: 'MicroDraw::Data',
    loginMethods : req.appConfig.loginMethods || [],
    params: JSON.stringify(req.query),
    wsPort: req.app.get('wsPort') || 8080,
    cziService: cziServiceForScript(),
    user : req.user
  });
};

module.exports = {
  data
};
