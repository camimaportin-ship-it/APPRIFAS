// tests/actions.test.js — Tests unitarios para src/utils/actions.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { moverACarpeta, clonarRifa, eliminarRifa } from '../frontend/src/utils/actions.js';

describe('moverACarpeta', () => {
  let mockApi, mockToast, mockRouter, mockPrompt;

  beforeEach(() => {
    mockApi = vi.fn().mockResolvedValue({});
    mockToast = vi.fn();
    mockRouter = vi.fn();
    mockPrompt = vi.fn();
    vi.stubGlobal('prompt', mockPrompt);
  });

  it('no hace nada si prompt es cancelado', () => {
    mockPrompt.mockReturnValue(null);
    moverACarpeta(1, 'carpeta', { api: mockApi, toast: mockToast, router: mockRouter });
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('llama API con categoría al confirmar', () => {
    mockPrompt.mockReturnValue('Nueva Carpeta');
    moverACarpeta(1, 'actual', { api: mockApi, toast: mockToast, router: mockRouter });
    expect(mockApi).toHaveBeenCalledWith('/rifas/1/categoria', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoria: 'Nueva Carpeta' })
    });
  });

  it('muestra toast y llama router al éxito', async () => {
    mockPrompt.mockReturnValue('Carpeta');
    moverACarpeta(1, '', { api: mockApi, toast: mockToast, router: mockRouter });
    await vi.waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith('Movido a "Carpeta"');
      expect(mockRouter).toHaveBeenCalled();
    });
  });

  it('muestra toast de error si falla la API', async () => {
    mockPrompt.mockReturnValue('Carpeta');
    mockApi.mockRejectedValue(new Error('Error de red'));
    moverACarpeta(1, '', { api: mockApi, toast: mockToast, router: mockRouter });
    await vi.waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith('Error de red', 'error');
    });
  });
});

describe('clonarRifa', () => {
  let mockApi, mockToast, mockConfirm;

  beforeEach(() => {
    mockApi = vi.fn().mockResolvedValue({ id: 99 });
    mockToast = vi.fn();
    mockConfirm = vi.fn();
    vi.stubGlobal('confirm', mockConfirm);
  });

  it('no hace nada si confirm es cancelado', async () => {
    mockConfirm.mockReturnValue(false);
    await clonarRifa(1, { api: mockApi, toast: mockToast });
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('llama API y muestra toast al confirmar', async () => {
    mockConfirm.mockReturnValue(true);
    await clonarRifa(1, { api: mockApi, toast: mockToast });
    expect(mockApi).toHaveBeenCalledWith('/rifas/1/clonar', { method: 'POST' });
    expect(mockToast).toHaveBeenCalledWith('Rifa clonada como borrador');
  });

  it('muestra toast de error si falla', async () => {
    mockConfirm.mockReturnValue(true);
    mockApi.mockRejectedValue(new Error('Error'));
    await clonarRifa(1, { api: mockApi, toast: mockToast });
    expect(mockToast).toHaveBeenCalledWith('Error', 'error');
  });
});

describe('eliminarRifa', () => {
  let mockApi, mockToast, mockConfirm;

  beforeEach(() => {
    mockApi = vi.fn().mockResolvedValue({});
    mockToast = vi.fn();
    mockConfirm = vi.fn();
    vi.stubGlobal('confirm', mockConfirm);
  });

  it('no hace nada si confirm es cancelado', async () => {
    mockConfirm.mockReturnValue(false);
    await eliminarRifa(1, 'Mi Rifa', { api: mockApi, toast: mockToast });
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('llama API DELETE al confirmar', async () => {
    mockConfirm.mockReturnValue(true);
    await eliminarRifa(1, 'Mi Rifa', { api: mockApi, toast: mockToast });
    expect(mockApi).toHaveBeenCalledWith('/rifas/1', { method: 'DELETE' });
  });

  it('muestra toast de éxito', async () => {
    mockConfirm.mockReturnValue(true);
    await eliminarRifa(1, 'Mi Rifa', { api: mockApi, toast: mockToast });
    expect(mockToast).toHaveBeenCalledWith('Rifa movida a la papelera');
  });

  it('usa nombre de state.rifaActual si no se provee nombre', async () => {
    mockConfirm.mockReturnValue(true);
    const state = { rifaActual: { nombre: 'Rifa del State' } };
    await eliminarRifa(1, null, { api: mockApi, toast: mockToast, state });
    expect(mockConfirm).toHaveBeenCalledWith(expect.stringContaining('Rifa del State'));
  });

  it('muestra toast de error si falla', async () => {
    mockConfirm.mockReturnValue(true);
    mockApi.mockRejectedValue(new Error('Fail'));
    await eliminarRifa(1, 'X', { api: mockApi, toast: mockToast });
    expect(mockToast).toHaveBeenCalledWith('Fail', 'error');
  });
});
