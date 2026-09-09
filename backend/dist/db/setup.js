"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// `npm run db:setup` — idempotent. Applies the schema, seeds the 24 units and
// sample data, creates the default users (password hashed at runtime), then
// backfills receipts + SMS notifications for seeded payments.
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const db_1 = require("../config/db");
const receiptService_1 = require("../services/receiptService");
const smsService_1 = require("../services/smsService");
const SCHEMA_SQL = path_1.default.resolve(__dirname, '../../../database/schema.sql');
const SEED_SQL = path_1.default.resolve(__dirname, '../../../database/seed.sql');
async function applyFile(file) {
    const sql = fs_1.default.readFileSync(file, 'utf8');
    // eslint-disable-next-line no-console
    console.log(`Applying ${path_1.default.relative(process.cwd(), file)} …`);
    await db_1.pool.query(sql);
}
async function seedUsers() {
    const users = [
        { name: 'System Administrator', email: 'admin@rpms.local', password: 'Admin@2026!', role: 'ADMIN' },
        { name: 'Property Manager', email: 'manager@rpms.local', password: 'Manager@2026!', role: 'PROPERTY_MANAGER' },
        { name: 'Front Desk Staff', email: 'staff@rpms.local', password: 'Staff@2026!', role: 'STAFF' },
    ];
    for (const u of users) {
        const existing = await db_1.pool.query('SELECT id FROM users WHERE email = $1', [u.email]);
        if (existing.rowCount === 0) {
            const hash = await bcryptjs_1.default.hash(u.password, 12);
            await db_1.pool.query(`INSERT INTO users (name, email, phone, password_hash, role, status)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE')`, [u.name, u.email, null, hash, u.role]);
            // eslint-disable-next-line no-console
            console.log(`  created user ${u.email} (${u.role})`);
        }
    }
}
async function main() {
    await applyFile(SCHEMA_SQL);
    await applyFile(SEED_SQL);
    await seedUsers();
    const receipts = await (0, receiptService_1.backfillReceipts)();
    const sms = await (0, smsService_1.backfillSms)();
    // eslint-disable-next-line no-console
    console.log(`Backfilled ${receipts} receipts and ${sms} SMS notifications.`);
    // eslint-disable-next-line no-console
    console.log('Database setup complete.');
    await db_1.pool.end();
}
main().catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error('Database setup failed:', err);
    await db_1.pool.end();
    process.exit(1);
});
//# sourceMappingURL=setup.js.map