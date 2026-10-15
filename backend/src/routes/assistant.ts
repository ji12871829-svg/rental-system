import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { validateBody, validateParams } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { getAssistantConfig, transcribeAudio } from '../services/assistantProvider';
import { chatWithAssistant, type ReminderDraft } from '../services/assistantChat';
import { createThread, listThreads, getThread, appendMessage, deleteThread } from '../services/assistantThreads';
import { getBriefing } from '../services/assistantBriefing';
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
  threadId: z.number().int().positive().optional(),
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
  const body = req.body as { message: string; history: { role: 'user' | 'assistant'; content: string }[]; threadId?: number };
  const settings = await getSettings();
  const userId = req.user!.userId;
  let threadId = body.threadId;
  let prior: { role: 'user' | 'assistant'; content: string }[] = [];
  if (threadId !== undefined) {
    const existing = await getThread(userId, threadId);
    if (!existing) {
      res.status(404).json({ error: 'THREAD_NOT_FOUND', message: 'Thread not found.', details: {} });
      return;
    }
    prior = existing.messages.slice(-20).map((m) => ({ role: m.role, content: m.content }));
  } else {
    threadId = (await createThread(userId, body.message.slice(0, 40))).id;
  }
  const out = await chatWithAssistant({ message: body.message, history: body.history, year: settings.reporting_year, thread: { id: threadId, prior } });
  const drafts: ReminderDraft[] = out.drafts;
  await appendMessage(threadId, { role: 'user', content: body.message });
  await appendMessage(threadId, { role: 'assistant', content: out.reply, toolCalls: out.toolCalls, drafts });
  res.json({ data: { reply: out.reply, drafts, toolCalls: out.toolCalls, threadId } });
}));

const threadTitleSchema = z.object({
  title: z.string().trim().max(120).optional(),
});

const threadParamsSchema = z.object({ id: z.coerce.number().int().positive() });

router.get('/briefing', asyncHandler(async (_req, res) => {
  const settings = await getSettings();
  res.json({ data: await getBriefing(settings.reporting_year) });
}));

router.get('/threads', asyncHandler(async (req, res) => {
  res.json({ data: await listThreads(req.user!.userId) });
}));

router.post('/threads', validateBody(threadTitleSchema), asyncHandler(async (req, res) => {
  const body = req.body as { title?: string };
  const created = await createThread(req.user!.userId, body.title ?? 'New chat');
  res.status(201).json({ data: { id: created.id } });
}));

router.get('/threads/:id/messages', validateParams(threadParamsSchema), asyncHandler(async (req, res) => {
  const thread = await getThread(req.user!.userId, Number(req.params.id));
  if (!thread) {
    res.status(404).json({ error: 'THREAD_NOT_FOUND', message: 'Thread not found.', details: {} });
    return;
  }
  res.json({ data: thread });
}));

router.delete('/threads/:id', validateParams(threadParamsSchema), asyncHandler(async (req, res) => {
  try {
    await deleteThread(req.user!.userId, Number(req.params.id));
  } catch {
    res.status(404).json({ error: 'THREAD_NOT_FOUND', message: 'Thread not found.', details: {} });
    return;
  }
  res.status(204).end();
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
