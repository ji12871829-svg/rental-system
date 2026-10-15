// The floating cube: one tap opens the copilot from any staff page, with
// the same chat (labels, mic, drafts) the /assistant page renders.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui';
import { api } from '../../lib/api';
import AssistantFab from './AssistantFab';

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  qs: () => '',
}));

const mockedGet = vi.mocked(api.get);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderFab() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <AssistantFab />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedGet.mockReset();
  mockedGet.mockResolvedValue({ data: { enabled: true, model: 'openai/gpt-oss-20b' } });
});

describe('AssistantFab (floating cube)', () => {
  it('starts closed showing only the cube button', () => {
    renderFab();
    expect(screen.getByRole('button', { name: 'Open assistant' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Assistant chat' })).not.toBeInTheDocument();
  });

  it('opens the same chat and closes via X, toggle, and Escape', async () => {
    renderFab();
    fireEvent.click(screen.getByRole('button', { name: 'Open assistant' }));
    expect(await screen.findByRole('dialog', { name: 'Assistant chat' })).toBeInTheDocument();
    // Same chat surface as the full page: input, suggestions, mic note.
    expect(screen.getByLabelText('Ask the assistant')).toBeInTheDocument();
    expect(screen.getByText('Who has not paid October rent?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close assistant chat' }));
    expect(screen.queryByRole('dialog', { name: 'Assistant chat' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open assistant' }));
    expect(await screen.findByRole('dialog', { name: 'Assistant chat' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Assistant chat' })).not.toBeInTheDocument();
  });

  it('links to the full page for long sessions', async () => {
    renderFab();
    fireEvent.click(screen.getByRole('button', { name: 'Open assistant' }));
    await screen.findByRole('dialog', { name: 'Assistant chat' });
    expect(screen.getByRole('link', { name: /Full page/ })).toHaveAttribute('href', '/assistant');
  });
});
