const express = require('express');
const router = express.Router();
const {
  registerUser,
  loginUser,
  verifyLoginOtp,
  resendLoginOtp,
  getMe,
  forgotPassword,
  validateResetToken,
  resetPassword,
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const {
  loginLimiter,
  registerLimiter,
  otpVerifyLimiter,
  otpSendLimiter,
  passwordResetLimiter,
} = require('../middleware/rateLimiters');

router.post('/register', registerLimiter, registerUser);
router.post('/login', loginLimiter, loginUser);
router.post('/verify-otp', otpVerifyLimiter, verifyLoginOtp);
router.post('/resend-otp', otpSendLimiter, resendLoginOtp);
router.get('/me', protect, getMe);
router.post('/forgot-password', passwordResetLimiter, forgotPassword);
router.get('/reset-password/:token/validate', otpVerifyLimiter, validateResetToken);
router.post('/reset-password/:token', otpVerifyLimiter, resetPassword);

module.exports = router;