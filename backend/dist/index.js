"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const env_1 = require("./config/env");
const db_1 = require("./config/db");
const app = (0, app_1.createApp)();
async function main() {
    try {
        await db_1.pool.query('SELECT 1');
        app.listen(env_1.env.port, () => {
            // eslint-disable-next-line no-console
            console.log(`RPMS API listening on http://localhost:${env_1.env.port} (${env_1.env.nodeEnv})`);
        });
    }
    catch (err) {
        // eslint-disable-next-line no-console
        console.error('Could not connect to PostgreSQL:', err.message);
        process.exit(1);
    }
}
main();
//# sourceMappingURL=index.js.map