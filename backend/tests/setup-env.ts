// Runs before every test worker loads modules: point the app at the isolated
// test database so integration tests never touch dev data.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-not-for-production';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://rms_user:rms_password@localhost:5432/rpms_test';