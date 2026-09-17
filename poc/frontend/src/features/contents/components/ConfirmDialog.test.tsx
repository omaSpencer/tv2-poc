import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog accessibility contract', () => {
  it('labels the modal, traps Tab, supports Escape and restores focus', () => {
    const opener = document.createElement('button');
    opener.textContent = 'Megnyitás';
    document.body.append(opener);
    opener.focus();
    const onCancel = vi.fn();
    const view = render(
      <ConfirmDialog title="Veszélyes művelet" confirmLabel="Megerősítés" onConfirm={vi.fn()} onCancel={onCancel}>
        <p>Biztosan folytatod?</p>
      </ConfirmDialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Veszélyes művelet' });
    const cancel = screen.getByRole('button', { name: 'Mégse' });
    const confirm = screen.getByRole('button', { name: 'Megerősítés' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(cancel);
    confirm.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
