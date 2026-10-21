# Seguridad

## Modelo de amenazas

El Pi va a estar expuesto a internet (control remoto desde otro PC). Las amenazas que importan:

1. Alguien descubre el panel y fuerza credenciales (brute force).
2. Alguien intercepta tráfico (sin TLS) y roba sesión o contraseña de OBS.
3. Alguien llega directamente al puerto de obs-websocket y controla OBS sin pasar por el backend.
4. Secretos (JWT secret, contraseña de OBS, hash de admin) acaban en el repo o en logs.
5. Una dependencia npm con vulnerabilidad conocida.

## Controles implementados

- **Nunca expongas el puerto de obs-websocket (4455) a internet.** El backend es el único punto de entrada; se conecta a OBS por `localhost`. El `Caddyfile` de `deploy/caddy/` solo publica el puerto del backend/frontend.
- **Secretos fuera del repo.** Todo secreto vive en `.env` (gitignored) o en `/etc/cdj-pi/*.env` fuera del repo en producción. Solo se commitean `.env.example` con placeholders.
- **TLS obligatorio en producción.** `Caddyfile` obtiene certificados automáticamente (Let's Encrypt) si usas un dominio; si solo accedes en LAN/VPN, usa un certificado local (mkcert) — nunca sirvas el panel por HTTP plano fuera de `localhost`.
- **Recomendado: WireGuard/Tailscale en vez de abrir el puerto a internet.** Expone el panel solo dentro de tu VPN personal; reduce la superficie de ataque a "estás en mi VPN" en vez de "cualquiera en internet puede intentarlo". Documentado en `docs/RPI_SETUP.md`.
- **Autenticación propia, separada de OBS.** Usuario admin con contraseña hasheada (bcrypt, cost 12) en variable de entorno — nunca en texto plano, nunca en el repo. JWT de acceso de vida corta (15 min) + refresh token en cookie `httpOnly`, `secure`, `sameSite=strict`.
- **Rate limiting** en `/auth/login` (5 intentos / 10 min por IP) y límite general en el resto de la API.
- **Helmet** con CSP estricta, `X-Frame-Options`, `X-Content-Type-Options`, HSTS.
- **CORS cerrado** a un único origin configurado (`CORS_ORIGIN`), nunca `*`.
- **WebSocket autenticado**: el gateway exige el mismo JWT antes de aceptar la conexión y de reenviar eventos de OBS o stats del sistema.
- **systemd hardened** (`deploy/systemd/cdj-backend.service`): `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, `CapabilityBoundingSet` vacío, usuario dedicado sin privilegios, `ReadWritePaths` reducido al mínimo.
- **Firewall**: `ufw` solo permite 443/tcp entrante (y el puerto WireGuard si lo usas); todo lo demás denegado por defecto. Ver `docs/RPI_SETUP.md`.
- **Logging de auditoría** (`winston`) de logins fallidos y acciones de control (quién arrancó/paró el stream, cambió de escena), sin loguear contraseñas ni tokens.

## Checklist antes de exponer el Pi a internet

- [ ] `backend/.env` tiene un `JWT_SECRET` y `JWT_REFRESH_SECRET` generados con `openssl rand -base64 48`, distintos entre sí.
- [ ] `ADMIN_PASSWORD_HASH` generado con bcrypt (ver `backend/.env.example`), nunca la contraseña en claro.
- [ ] `OBS_WS_PASSWORD` configurada en OBS y en `.env`, distinta de la contraseña de admin del panel.
- [ ] El puerto 4455 (obs-websocket) **no** aparece en ninguna regla de `ufw allow` ni en el `Caddyfile`.
- [ ] TLS activo (dominio propio + Let's Encrypt, o VPN).
- [ ] `npm audit` sin vulnerabilidades altas/críticas en `backend/` y `frontend/` antes de desplegar.
- [ ] Backups/rotación de `JWT_SECRET` planificada si sospechas compromiso.

## Reportar un problema de seguridad

Si encuentras una vulnerabilidad, no abras un issue público: contacta antes al mantenedor del repo.
