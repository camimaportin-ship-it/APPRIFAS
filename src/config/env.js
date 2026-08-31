// src/config/env.js — Validación centralizada de entorno (zod) — Fase 1.1
// Si falta una variable crítica, la app falla rápido con mensaje claro (fail-fast).
require('dotenv').config();
const { z } = require('zod');

const schema = z.object({
  PORT: z.coerce.number().int().min(1024).max(65535).default(3000),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001,http://localhost:3002'),
  ADMIN_SEED_USER: z.string().min(3).default('hans4269'),
  ADMIN_SEED_PASS: z.string().min(6).default('Rifas01234'),
  ADMIN_SEED_USER_2: z.string().min(3).default('sairaosorio78'),
  ADMIN_SEED_PASS_2: z.string().min(6).default('Rifas01234'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

let env;
try {
  env = schema.parse(process.env);
} catch (e) {
  console.error('[ENV] Variables de entorno inválidas:');
  console.error(e.errors || e.message);
  console.error('Revisa .env.example');
  process.exit(1);
}

// Lista de orígenes permitidos para CORS
env.allowedOriginsList = env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);

module.exports = env;
