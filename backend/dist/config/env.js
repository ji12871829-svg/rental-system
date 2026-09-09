"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isProd = exports.isTest = exports.env = void 0;
// Central environment configuration. Secrets (JWT_SECRET, SMS_API_KEY, DB
// password) are read ONLY from process.env — never from source code and never
// sent to the frontend.
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
// Load backend/.env when running from the repo root or backend dir.
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../../.env') });
dotenv_1.default.config();
exports.env = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: Number(process.env.PORT) || 4000,
    databaseUrl: process.env.DATABASE_URL ||
        'postgres://rms_user:rms_password@localhost:5432/rpms',
    jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
    bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS) || 12,
    corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    smsApiKey: process.env.SMS_API_KEY || '',
    smsUsername: process.env.SMS_USERNAME || '',
    smsEnabled: process.env.SMS_ENABLED === 'true',
};
exports.isTest = exports.env.nodeEnv === 'test';
exports.isProd = exports.env.nodeEnv === 'production';
//# sourceMappingURL=env.js.map