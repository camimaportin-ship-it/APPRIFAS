// tests/rifasList.test.js — Tests para src/views/rifasList.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { vistaListaRifasModular, __getState } from '../frontend/src/views/rifasList.js';

describe('vistaListaRifasModular', () => {
  let mockApi, mockContainer, mockTopbar, mockRifasContainer;

  beforeEach(() => {
    mockApi = vi.fn();
    mockContainer = { innerHTML: '' };
    mockTopbar = { innerHTML: '' };
    mockRifasContainer = { innerHTML: '' };
    vi.stubGlobal('document', {
      getElementById: vi.fn((id) => {
        if (id === 'view-container') return mockContainer;
        if (id === 'topbar-actions') return mockTopbar;
        if (id === 'rifas-container') return mockRifasContainer;
        return null;
      })
    });
  });

  it('muestra empty-state si no hay rifas', async () => {
    mockApi.mockResolvedValueOnce([]);
    mockApi.mockResolvedValueOnce([]);
    await vistaListaRifasModular(mockApi);
    expect(mockContainer.innerHTML).toContain('Aún no tienes rifas');
  });

  it('muestra toolbar con filtros si hay rifas', async () => {
    mockApi.mockResolvedValueOnce([{ id: 1, nombre: 'Rifa Test', estado: 'activa', tipo_rifa: 'BOLETAS_NORMAL', producto: 'Test', valor_boleta: 10000, fecha_sorteo: '2026-12-31', porcentaje: 50, vendidos: 50, cantidad_max_participantes: 100, recaudado: 500000 }]);
    mockApi.mockResolvedValueOnce([]);
    await vistaListaRifasModular(mockApi);
    expect(mockContainer.innerHTML).toContain('rifas-toolbar');
    expect(mockRifasContainer.innerHTML).toContain('Rifa Test');
  });

  it('muestra badge de estado', async () => {
    mockApi.mockResolvedValueOnce([{ id: 1, nombre: 'X', estado: 'activa', tipo_rifa: 'BOLETAS_NORMAL', producto: 'P', valor_boleta: 1000, fecha_sorteo: '2026-01-01', porcentaje: 0, vendidos: 0, cantidad_max_participantes: 10, recaudado: 0 }]);
    mockApi.mockResolvedValueOnce([]);
    await vistaListaRifasModular(mockApi);
    expect(mockRifasContainer.innerHTML).toContain('badge-activa');
  });

  it('muestra grid por defecto', async () => {
    mockApi.mockResolvedValueOnce([{ id: 1, nombre: 'X', estado: 'borrador', tipo_rifa: 'BOLETAS_NORMAL', producto: 'P', valor_boleta: 1000, fecha_sorteo: '2026-01-01', porcentaje: 0, vendidos: 0, cantidad_max_participantes: 10, recaudado: 0 }]);
    mockApi.mockResolvedValueOnce([]);
    await vistaListaRifasModular(mockApi);
    expect(mockRifasContainer.innerHTML).toContain('rifas-grid');
  });
});

describe('__getState', () => {
  it('devuelve estado inicial', () => {
    const state = __getState();
    expect(state.vista).toBe('grid');
    expect(state.filtro.estado).toBe('');
    expect(state.filtro.tipo).toBe('');
    expect(state.filtro.busqueda).toBe('');
  });
});
