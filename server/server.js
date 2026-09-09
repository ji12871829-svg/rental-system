// server.js — entrypoint. Do not put route/business logic here — see app.js.
require('dotenv').config();
const app = require('./src/app');

// Number(...) || 4000: treats empty/unset/non-numeric PORT (e.g. a stray OS
// PORT=0 variable) as "use the default" rather than binding a random port.
const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`RMS server listening on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
});
