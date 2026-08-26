const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler');
const User = require('../models/User');

// Verifica el token JWT y adjunta el usuario a req.user
const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');
      if (!req.user || !req.user.active) {
        res.status(401);
        throw new Error('Usuario no autorizado o inactivo');
      }
      return next();
    } catch (error) {
      res.status(401);
      throw new Error('Token invalido o expirado');
    }
  }

  res.status(401);
  throw new Error('No autorizado, falta token');
});

module.exports = { protect };
