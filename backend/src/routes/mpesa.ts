import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { parseC2bCallback, parseStkCallback } from '../services/mpesaProvider';
import { markStkFailure, processMpesaPayment, processPaybillPayment } from '../services/mpesaService';

const router = Router();

router.post('/c2b/validate', (_req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted.' });
});

router.post('/c2b/confirm', asyncHandler(async (req, res) => {
  try {
    const payment = parseC2bCallback(req.body);
    const result = await processPaybillPayment(payment);
    res.json({ ResultCode: 0, ResultDesc: result.status === 'UNMATCHED' ? 'Accepted for manual review.' : 'Accepted.' });
  } catch (error) {
    console.error('[mpesa] C2B callback failed:', (error as Error).message);
    res.status(400).json({ ResultCode: 1, ResultDesc: 'Invalid callback.' });
  }
}));

router.post('/stk/callback', asyncHandler(async (req, res) => {
  try {
    const callback = parseStkCallback(req.body);
    if (!callback.payment) {
      await markStkFailure(callback.checkoutRequestId, callback.resultDescription, req.body);
      res.json({ ResultCode: 0, ResultDesc: 'Accepted.' });
      return;
    }
    const result = await processMpesaPayment(callback.payment, 'STK');
    res.json({ ResultCode: 0, ResultDesc: result.status === 'UNMATCHED' ? 'Accepted for manual review.' : 'Accepted.' });
  } catch (error) {
    console.error('[mpesa] STK callback failed:', (error as Error).message);
    res.status(400).json({ ResultCode: 1, ResultDesc: 'Invalid callback.' });
  }
}));

export default router;