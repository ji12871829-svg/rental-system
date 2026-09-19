// Runs before every test worker loads modules: point the app at the isolated
// test database so integration tests never touch dev data.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-not-for-production';
// Split signing keys — the tests exercise the real production posture with
// distinct staff/portal secrets (env.ts falls back to JWT_SECRET when these
// are unset, so CI variants without them still work).
process.env.JWT_STAFF_SECRET = 'test-staff-signing-key-0123456789abcdef';
process.env.JWT_PORTAL_SECRET = 'test-portal-signing-key-fedcba9876543210';
// Tests start from the documented "no callback token" posture: local dev
// .env (which this process loads) may carry a real MPESA_CALLBACK_TOKEN for
// gate parity with production, and without clearing it here every
// integration test hitting /api/mpesa/* would be rejected by the gate
// instead of exercising its handler. The mpesaCallbackGate suite sets its
// own token explicitly when testing the gate itself.
process.env.MPESA_CALLBACK_TOKEN = '';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://rms_user:rms_password@localhost:5432/rpms_test';

// Business-identity fallbacks: CI has no backend/.env, and brandingService
// resolves empty DB rows against these env vars — without pinning them here,
// tests would pass on machines whose .env has BUSINESS_* set and fail on CI.
// Individual tests may still override these at module scope.
process.env.BUSINESS_NAME = 'Test Property Ltd';
process.env.BUSINESS_REG_NO = 'BN-TEST-0001';
process.env.BUSINESS_PHONE = '+254700000000';
process.env.BUSINESS_EMAIL = 'info@test.example';