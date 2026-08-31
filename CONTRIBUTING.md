# Contribuir a Rifas SYC

## Instalación

```bash
git clone https://github.com/camimaportin-ship-it/APPRIFAS.git
cd APPRIFAS
cp .env.example .env   # ajusta PORT y ALLOWED_ORIGINS si necesitas
npm install
```

## Ejecutar

```bash
npm start              # http://localhost:3000
```

Usuarios por defecto: `hans4269` / `sairaosorio78` — contraseña `Rifas01234`.

## Reglas

1. **No hacer `git push` sin autorización explícita del propietario.** Trabaja en local y muestra `git diff` antes de subir.
2. Commits con prefijo `feat:`, `fix:`, `audit:` y mensaje en español.
3. No subir `data/*.db`, `.wwebjs_auth/`, `.env`, `uploads/poster-*.png` (ya en `.gitignore`).
4. Antes de un PR: `npm start` debe arrancar sin errores y `git status` debe estar limpio salvo lo intencional.

## Auditoría

Ver `AUDIT.md` para el roadmap por fases. Fase 0 es solo higiene (docs/config), sin tocar `server.js` ni `frontend/app.js`.
