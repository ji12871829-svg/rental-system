"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const env_1 = require("./config/env");
const errorHandler_1 = require("./middleware/errorHandler");
const rateLimiter_1 = require("./middleware/rateLimiter");
const audit_1 = __importDefault(require("./routes/audit"));
const auth_1 = __importDefault(require("./routes/auth"));
const expenses_1 = __importDefault(require("./routes/expenses"));
const receipts_1 = __importDefault(require("./routes/receipts"));
const rent_1 = __importDefault(require("./routes/rent"));
const reports_1 = __importDefault(require("./routes/reports"));
const settings_1 = __importDefault(require("./routes/settings"));
const sms_1 = __importDefault(require("./routes/sms"));
const tenants_1 = __importDefault(require("./routes/tenants"));
const units_1 = __importDefault(require("./routes/units"));
const users_1 = __importDefault(require("./routes/users"));
const water_1 = __importDefault(require("./routes/water"));
function createApp() {
    const app = (0, express_1.default)();
    app.use((0, cors_1.default)({
        origin: env_1.env.corsOrigin.split(',').map((o) => o.trim()),
        credentials: false,
        allowedHeaders: ['Content-Type', 'Authorization'],
    }));
    app.use(express_1.default.json({ limit: '1mb' }));
    app.use(rateLimiter_1.globalLimiter);
    app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
    app.use('/api/auth', auth_1.default);
    app.use('/api/users', users_1.default);
    app.use('/api/settings', settings_1.default);
    app.use('/api/units', units_1.default);
    app.use('/api/tenants', tenants_1.default);
    app.use('/api/rent', rent_1.default);
    app.use('/api/water', water_1.default);
    app.use('/api/expenses', expenses_1.default);
    app.use('/api/receipts', receipts_1.default);
    app.use('/api/sms', sms_1.default);
    app.use('/api/reports', reports_1.default);
    app.use('/api/audit', audit_1.default);
    // Unknown API routes → 404 in the standard error shape.
    app.use('/api', (_req, res) => {
        res.status(404).json({ error: 'NOT_FOUND', message: 'API route not found.', details: {} });
    });
    app.use(errorHandler_1.errorHandler);
    return app;
}
//# sourceMappingURL=app.js.map