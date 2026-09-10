// Runs before every test worker loads modules: point the app at the isolated
// test database so integration tests never touch dev data.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-not-for-production';
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