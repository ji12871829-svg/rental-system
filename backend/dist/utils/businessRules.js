"use strict";
// Pure business rules — no I/O, unit-testable.
// Rents, water rates and currency are passed IN (they come from the DB);
// nothing is hard-coded here.
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentStatus = paymentStatus;
exports.balanceDue = balanceDue;
exports.computeWaterBill = computeWaterBill;
exports.waterCollectionRate = waterCollectionRate;
exports.waterSurplusDeficit = waterSurplusDeficit;
exports.rentCollectionRate = rentCollectionRate;
exports.receiptPrefixFor = receiptPrefixFor;
exports.formatReceiptNumber = formatReceiptNumber;
exports.rentReceiptMessage = rentReceiptMessage;
exports.waterReceiptMessage = waterReceiptMessage;
exports.combinedReceiptMessage = combinedReceiptMessage;
const money_1 = require("./money");
// --- Rent / water payment status -------------------------------------------
// expected = amount billed (monthly rent or water bill) for the period
// paid     = SUM of payments against that period
function paymentStatus(expected, paid) {
    if (paid <= 0)
        return 'UNPAID';
    if (paid < expected)
        return 'PARTIAL';
    if (paid === expected)
        return 'PAID';
    return 'OVERPAID';
}
function balanceDue(expected, paid) {
    return (0, money_1.round2)(expected - paid);
}
function computeWaterBill(previousReading, currentReading, waterRate) {
    if (!Number.isFinite(currentReading) || currentReading < 0) {
        return { ok: false, error: 'Current meter reading must be a non-negative number.' };
    }
    if (waterRate < 0) {
        return { ok: false, error: 'Water rate cannot be negative.' };
    }
    const firstReading = previousReading === null || previousReading === undefined;
    const prev = firstReading ? 0 : previousReading;
    if (currentReading < prev) {
        return {
            ok: false,
            error: 'Current meter reading cannot be lower than previous reading.',
        };
    }
    const consumption = (0, money_1.round2)(currentReading - prev);
    return {
        ok: true,
        previousReading: (0, money_1.round2)(prev),
        currentReading: (0, money_1.round2)(currentReading),
        consumption,
        waterRate: (0, money_1.round2)(waterRate),
        waterBill: (0, money_1.round2)(consumption * waterRate),
        firstReading,
    };
}
// --- Water financial performance -------------------------------------------
function waterCollectionRate(collected, billed) {
    if (billed <= 0)
        return 0;
    return (0, money_1.round2)((collected / billed) * 100);
}
// Positive → SURPLUS, negative → DEFICIT
function waterSurplusDeficit(collected, supplyCost) {
    return (0, money_1.round2)(collected - supplyCost);
}
function rentCollectionRate(collected, expected) {
    if (expected <= 0)
        return 0;
    return (0, money_1.round2)((collected / expected) * 100);
}
function receiptPrefixFor(type) {
    if (type === 'WATER')
        return 'WC';
    if (type === 'COMBINED')
        return 'RWC';
    return 'RC';
}
function formatReceiptNumber(prefix, year, seq) {
    return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
}
// --- SMS message templates (spec §34) --------------------------------------
function rentReceiptMessage(opts) {
    const { tenantName, unitNumber, monthName, year, rentPaid, balance, receiptNumber, currency } = opts;
    if (balance > 0) {
        return `RENT RECEIPT: Dear ${tenantName}, ${currency} ${rentPaid} received for Unit ${unitNumber}, ${monthName} ${year} rent. Outstanding balance: ${currency} ${balance}. Receipt: ${receiptNumber}. Thank you.`;
    }
    return `RENT RECEIPT: Dear ${tenantName}, ${currency} ${rentPaid} received for Unit ${unitNumber}, ${monthName} ${year} rent. Balance: ${currency} 0. Receipt: ${receiptNumber}. Thank you.`;
}
function waterReceiptMessage(opts) {
    const { tenantName, unitNumber, monthName, year, waterPaid, balance, receiptNumber, currency } = opts;
    return `WATER RECEIPT: Dear ${tenantName}, ${currency} ${waterPaid} received for Unit ${unitNumber} water, ${monthName} ${year}. Outstanding balance: ${currency} ${balance}. Receipt: ${receiptNumber}. Thank you.`;
}
function combinedReceiptMessage(opts) {
    const { tenantName, unitNumber, monthName, year, rentPaid, waterPaid, totalPaid, balance, receiptNumber, currency } = opts;
    if (waterPaid > 0) {
        return `PAYMENT RECEIPT: Dear ${tenantName}, ${currency} ${totalPaid} received for Unit ${unitNumber} for ${monthName} ${year} (Rent ${currency} ${rentPaid} + Water ${currency} ${waterPaid}). Outstanding balance: ${currency} ${balance}. Receipt: ${receiptNumber}. Thank you.`;
    }
    return `PAYMENT RECEIPT: Dear ${tenantName}, ${currency} ${totalPaid} received for Unit ${unitNumber} for ${monthName} ${year} rent. Outstanding balance: ${currency} ${balance}. Receipt: ${receiptNumber}. Thank you.`;
}
//# sourceMappingURL=businessRules.js.map