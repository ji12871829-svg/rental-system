"use strict";
// Money helpers. PostgreSQL returns NUMERIC as strings — always normalize
// through n() before arithmetic so results are JS numbers rounded to cents.
Object.defineProperty(exports, "__esModule", { value: true });
exports.n = n;
exports.round2 = round2;
exports.formatMoney = formatMoney;
function n(value) {
    if (value === null || value === undefined || value === '')
        return 0;
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) ? num : 0;
}
function round2(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}
function formatMoney(value, currency = 'KSh') {
    return `${currency} ${value.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
//# sourceMappingURL=money.js.map