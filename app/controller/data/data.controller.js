"use strict";

const data = function (req, res) {
  // store return path in case of login
  req.session.returnTo = req.originalUrl;

  res.render('data', {
    title: 'MicroDraw::Data',
    loginMethods : req.appConfig.loginMethods || [],
    params: JSON.stringify(req.query),
    loggedUser: JSON.stringify(req.user || null)
  });
};

module.exports = {
  data
};
