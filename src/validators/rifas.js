// src/validators/rifas.js — Fase 1.4 — Schemas zod para rifas/participantes
const { z } = require('zod');

const rifaSchema = z.object({
  nombre: z.string().min(3).max(120),
  valor_boleta: z.coerce.number().int().min(1000),
  producto: z.string().min(2).max(120),
  descripcion: z.string().max(500).optional().default(''),
  fecha_sorteo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tipo_rifa: z.enum(['aleatoria', 'loteria', 'tapazo', 'ruleta']).default('aleatoria'),
  modalidad_boleta: z.enum(['BOLETAS_NORMAL','CUATRO_OPORTUNIDADES','CHANCE_CON_SIMBOLO','CHANCE_3_GANADORES','CHANCE_INDIVIDUAL','OPORTUNIDADES_4D']).default('BOLETAS_NORMAL'),
  n_oportunidades: z.coerce.number().int().optional(),
  cifras: z.coerce.number().int().optional(),
  estado: z.enum(['borrador','activa','cerrada','sorteada']).default('borrador'),
});

const participanteSchema = z.object({
  nombre: z.string().min(2).max(120),
  cedula: z.string().max(20).optional().default(''),
  telefono: z.string().max(20).optional().default(''),
  estado_pago: z.enum(['pagado','pendiente']).optional().default('pendiente'),
});

module.exports = { rifaSchema, participanteSchema };
