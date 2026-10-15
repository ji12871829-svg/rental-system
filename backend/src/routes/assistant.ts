import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { getAssistantConfig, transcribeAudio } from '../services/assistantProvider';
import { chatWithAssistant, type ReminderDraft } from '../services/assistantChat';
import { getSettings } from '../services/settingsService';

const router = Router();
router.use(requireAuth);

const historyItemSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(2000),
});

const chatSchema = z.object({
  message: z.string().trim().min(1, 'Ask something first.').max(2000),
  history: z.array(historyItemSchema).max(10).optional().default([]),
});

router.get('/config', asyncHandler(async (_req, res) => {
  res.json({ data: getAssistantConfig() });
}));

router.post('/chat', validateBody(chatSchema), asyncHandler(async (req, res) => {
  if (!getAssistantConfig().enabled) {
    res.status(503).json({
      error: 'ASSISTANT_DISABLED',
      message: 'GROQ_API_KEY is not set — the assistant is disabled. Add the key to enable it.',
      details: {},
    });
    return;
  }
  const body = req.body as { message: string; history: { role: 'user' | 'assistant'; content: string }[] };
  const settings = await getSettings();
  const out = await chatWithAssistant({ message: body.message, history: body.history, year: settings.reporting_year });
  const drafts: ReminderDraft[] = out.drafts;
  res.json({ data: { reply: out.reply, drafts, toolCalls: out.toolCalls } });
}));

const transcribeSchema = z.object({
  audioBase64: z.string().min(1, 'Record something first.').max(3_500_000),
  mimeType: z.string().regex(/^audio\//, 'Only audio recordings can be transcribed.'),
});

router.post('/transcribe', validateBody(transcribeSchema), asyncHandler(async (req, res) => {
  if (!getAssistantConfig().enabled) {
    res.status(503).json({
      error: 'ASSISTANT_DISABLED',
      message: 'GROQ_API_KEY is not set — the assistant is disabled. Add the key to enable it.',
      details: {},
    });
    return;
  }
  const body = req.body as { audioBase64: string; mimeType: string };
  try {
    const text = await transcribeAudio(body.audioBase64, body.mimeType);
    res.json({ data: { text } });
  } catch (err) {
    res.status(502).json({
      error: 'TRANSCRIPTION_FAILED',
      message: (err as Error).message,
      details: {},
    });
  }
}));

export default router;
