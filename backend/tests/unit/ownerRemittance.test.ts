// Owner remittance template composers — the property-owner communication
// templates (monthly remittance summary SMS/WhatsApp, expense notice, and
// the full financial statement email).
import {
  composeOwnerRemittanceEmail,
  ownerExpenseNoticeSms,
  ownerRemittanceSms,
  ownerRemittanceWhatsapp,
  type OwnerRemittanceFigures,
} from '../../src/services/ownerRemittanceService';

const figures: OwnerRemittanceFigures = {
  ownerName: 'Mr. Kamau',
  ownerEmail: 'owner@example.com',
  ownerPhone: '+254706719042',
  propertyName: 'Olbano Plaza',
  monthName: 'September',
  year: 2026,
  currency: 'KSh',
  totalCollected: 85000,
  rentCollected: 80000,
  waterCollected: 5000,
  expectedRent: 90000,
  waterBilled: 5200,
  occupancyPercent: 87.5,
  managementFeePercent: 10,
  managementFee: 8500,
  expensesTotal: 4200,
  expensesTop: [{ category: 'REPAIRS', amount: 4200 }],
  netPayable: 72300,
  businessName: 'Olbano Property Management',
};

describe('ownerRemittanceSms', () => {
  it('states collected, fee and net disbursement', () => {
    const msg = ownerRemittanceSms(figures);
    expect(msg).toContain('Dear Mr. Kamau, your September 2026 remittance statement for Olbano Plaza is ready.');
    expect(msg).toContain('Total Collected: KSh 85000.');
    expect(msg).toContain('Management Fee: KSh 8500.');
    expect(msg).toContain('Net Disbursed to Bank: KSh 72300.');
  });

  it('omits the fee line when no fee arrangement is configured', () => {
    const msg = ownerRemittanceSms({ ...figures, managementFeePercent: null, managementFee: 0, netPayable: 80800 });
    expect(msg).not.toContain('Management Fee');
    expect(msg).toContain('Net Disbursed to Bank: KSh 80800.');
  });

  it('stays within the two-segment GSM-7 budget', () => {
    const msg = ownerRemittanceSms({ ...figures, ownerName: 'A Very Long Property Owner Name Indeed' });
    expect(msg.length).toBeLessThanOrEqual(2 * 153);
  });
});

describe('ownerExpenseNoticeSms', () => {
  it('names the expense type, amount and property', () => {
    const msg = ownerExpenseNoticeSms(figures, 'PLUMBING', 6200);
    expect(msg).toBe('Hi Mr. Kamau, emergency maintenance (PLUMBING) cost KSh 6200 was deducted from Olbano Plaza collections this month. Statement sent to email.');
  });
});

describe('ownerRemittanceWhatsapp', () => {
  it('renders the visual report with emoji lines and payout note', () => {
    const msg = ownerRemittanceWhatsapp(figures);
    expect(msg).toContain('Hello Mr. Kamau 👋');
    expect(msg).toContain('Total Rent Collected: KSh 85000');
    expect(msg).toContain('Management Fee (10%): KSh 8500');
    expect(msg).toContain('Expenses/Maintenance: KSh 4200');
    expect(msg).toContain('Net Payout: KSh 72300');
    expect(msg).toContain('A PDF statement has been sent to your email.');
    expect(msg).toContain('Thank you for partnering with us!');
  });

  it('drops the fee and expense lines honestly when there are none', () => {
    const msg = ownerRemittanceWhatsapp({ ...figures, managementFeePercent: null, managementFee: 0, expensesTotal: 0, netPayable: 85000 });
    expect(msg).not.toContain('Management Fee');
    expect(msg).not.toContain('Expenses/Maintenance');
    expect(msg).toContain('Net Payout: KSh 85000');
  });
});

describe('composeOwnerRemittanceEmail', () => {
  const email = composeOwnerRemittanceEmail(figures, '2026-09-30');

  it('uses the formal subject with month and property', () => {
    expect(email.subject).toBe('Monthly Financial Statement & Remittance Report - September - Olbano Plaza');
  });

  it('shows the four summary lines and period end', () => {
    expect(email.html).toContain('Gross Rent Collected:');
    expect(email.html).toContain('87.5%');
    expect(email.html).toContain('Management Fee Deduction');
    expect(email.html).toContain('Approved Repairs &amp; Maintenance:');
    expect(email.html).toContain('Net Remittance Disbursed:');
    expect(email.html).toContain('period ending <strong>2026-09-30</strong>');
    expect(email.text).toContain('Gross Rent Collected: KSh 85000 (Occupancy: 87.5%)');
    expect(email.text).toContain('Net Remittance Disbursed: KSh 72300');
  });

  it('lists the expense breakdown and the PDF promise', () => {
    expect(email.text).toContain('REPAIRS: KSh 4200');
    expect(email.text).toContain('detailed itemized PDF attached');
  });

  it('omits the fee row when no fee arrangement exists', () => {
    const noFee = composeOwnerRemittanceEmail(
      { ...figures, managementFeePercent: null, managementFee: 0, netPayable: 80800 },
      '2026-09-30',
    );
    expect(noFee.text).not.toContain('Management Fee Deduction');
    expect(noFee.text).toContain('Net Remittance Disbursed: KSh 80800');
  });
});
