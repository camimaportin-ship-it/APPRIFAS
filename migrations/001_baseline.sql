-- 001_baseline.sql — Fase 2.1 — Snapshot del schema a v2.1.1 (referencia para umzug futuro)
-- Las migraciones reales viven en backend/db.js ensureSchema; este archivo documenta el baseline
-- para migrar a umzug/knex en Fase 2 sin perder historia.

-- Tablas: empresa, config, usuarios, rifas, numeros, participantes, ganadores, historial,
-- plantillas_whatsapp, envios_whatsapp, boletas_chance, logs, sorteos_auditoria,
-- push_subscriptions, notificaciones, sesiones, captcha_tokens
-- Ver backend/db.js ensureSchema para DDL exacto.
