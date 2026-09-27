// Jest TestEnvironment: give each parallel worker its own database.
//
// Parallel integration runs were flaky because every worker shared one
// `rpms_test` database: suites write payments against the same seeded
// tenants, receipt sequences are global, and one suite's cleanup
// (`DELETE FROM users` in selfSignup) deletes rows another worker is
// mid-login on. --runInBand never saw this because one worker = no
// contention.
//
// Fix: subclass jest's default node environment. setup() runs once per
// worker process *before* any suite module (and therefore before
// src/config/db.ts is imported) and:
//   1. picks a unique worker id (JEST_WORKER_ID; 'ib' fallback for a plain
//      in-band run, so --runInBand keeps working),
//   2. drops any leftover database of the same name (crashed prior run),
//   3. clones the template database built by globalSetup (schema +
//      migrations + fixtures) via CREATE DATABASE ... TEMPLATE — a local
//      file copy, a few hundred ms per worker,
//   4. points DATABASE_URL at the clone so the pool every module builds
//      later in this process connects to it.
// teardown() drops the clone. Suite code needs no edits.
import NodeEnvironment from 'jest-environment-node';
import type { EnvironmentContext, JestEnvironmentConfig } from '@jest/environment';
import { Client } from 'pg';

const ADMIN_URL = 'postgres://rms_user:rms_password@localhost:5432/rpms';
const TEMPLATE_DB = 'rpms_test_template';

export default class WorkerDbEnvironment extends NodeEnvironment {
  private workerDb: string;

  constructor(config: JestEnvironmentConfig, context: EnvironmentContext) {
    super(config, context);
    const workerId = process.env.JEST_WORKER_ID ?? 'ib';
    this.workerDb = `rpms_test_w${workerId}`;
  }

  override async setup(): Promise<void> {
    await super.setup();

    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${this.workerDb} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${this.workerDb} TEMPLATE ${TEMPLATE_DB} OWNER rms_user`);
    } finally {
      await admin.end();
    }

    // Point this worker at its clone. CRITICAL: this must land on the VM
    // sandbox's process.env (`this.global.process.env`), not the parent's.
    // Jest snapshots env for each test file when the environment object is
    // created; setup-env.ts (a setupFile, run per file) writes its default
    // DATABASE_URL unless TEST_DATABASE_URL is already set — so BOTH are
    // pinned inside the sandbox, and setup-env's rewrite then keeps the
    // worker's URL (it copies TEST_DATABASE_URL verbatim).
    const workerUrl = `postgres://rms_user:rms_password@localhost:5432/${this.workerDb}`;
    const sandboxEnv = this.global?.process?.env;
    if (sandboxEnv) {
      sandboxEnv.DATABASE_URL = workerUrl;
      sandboxEnv.TEST_DATABASE_URL = workerUrl;
    }
    process.env.DATABASE_URL = workerUrl;
    process.env.TEST_DATABASE_URL = workerUrl;
  }

  override async teardown(): Promise<void> {
    // Close this worker's pool first — dropping under it would otherwise
    // surface as idle-client errors from db.ts's error handler.
    try {
      const { pool } = (await import('../../src/config/db')) as typeof import('../../src/config/db');
      await pool.end().catch(() => undefined);
    } catch {
      // The pool may not exist in a worker that never imported it.
    }
    await super.teardown();

    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${this.workerDb} WITH (FORCE)`);
    } catch {
      // Teardown must never mask test results; the next run drops leftovers.
    } finally {
      await admin.end();
    }
  }
}
