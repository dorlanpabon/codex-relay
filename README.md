# Codex Relay

Codex Relay es un monorepo open-core para controlar sesiones locales de Codex desde un SaaS ligero y canales remotos como Telegram.

Guia para contribuir: `CONTRIBUTING.md`

## Workspace

- `apps/api`: NestJS + Prisma + BullMQ + WebSocket `/connectors`
- `apps/web`: dashboard Next.js para onboarding y control manual
- `apps/connector`: daemon local que empareja la maquina, abre un WebSocket saliente y conversa con `codex app-server`
- `packages/contracts`: contratos Zod y tipos compartidos
- `packages/telegram`: helpers para mensajes, parseo de callbacks y teclados inline

## Flujo v1

1. El conector se auto-empareja con `POST /pair`.
2. El conector abre `WS /connectors` y publica `connector.hello`.
3. El panel o Telegram crea una tarea con `POST /tasks`, o controla Codex Desktop con `POST /connectors/desktop/commands`.
4. La API persiste la sesion, encola `task.start` y la reenvia al conector.
5. El conector lanza `codex app-server` por `stdio`, envia eventos y approvals a la API.
6. La politica `safe auto-continue` relanza `continue` cuando la sesion termina un turno sin bloqueos.
7. Si `TELEGRAM_BOT_TOKEN` esta configurado, el API corre un bot con polling, envia approvals por BullMQ y acepta acciones remotas de sesiones y de Codex Desktop.

## Setup

```bash
pnpm install
pnpm infra:up
pnpm prisma:push
pnpm prisma:generate
pnpm check
pnpm --filter @codex-relay/api dev
pnpm --filter @codex-relay/web dev
pnpm --filter @codex-relay/connector dev
```

Comandos operativos:

- `pnpm infra:up`: levanta Postgres y Redis
- `pnpm infra:down`: baja la infraestructura local
- `pnpm local:up`: para procesos viejos, aplica Prisma, compila y levanta API, panel y conector; el conector se abre minimizado para no perder la sesion interactiva de Windows
- `pnpm local:down`: detiene API, panel y conector; tambien baja Postgres y Redis
- `pnpm local:status`: muestra PIDs, logs y el resumen de `doctor`
- `pnpm prisma:push`: aplica el esquema Prisma sobre la base local
- `pnpm check`: corre `build`, `test` y `typecheck` en todo el monorepo como lo hace GitHub Actions
- `pnpm doctor`: consulta `GET /health` y resume API, Postgres, Redis, Telegram, conectores y sesiones

## CI

- El repo publica una accion en `.github/workflows/ci.yml`
- Se ejecuta en cada `push` a `main` y en cada `pull_request`
- Valida `pnpm install --frozen-lockfile` y luego `pnpm check`

Logs locales:

- Los procesos de `local:up` escriben en `.codex-relay-runtime/logs`

## Variables principales

- `apps/api/.env.example`
- `apps/web/.env.example`
- `apps/connector/.env.example`

Variables utiles del API:

- `TELEGRAM_BOT_TOKEN`: habilita el bot
- `TELEGRAM_API_ID` y `TELEGRAM_API_HASH`: credenciales de cuenta Telegram para automatizar BotFather
- `TELEGRAM_CREATOR_PHONE`: numero de la cuenta que creara el bot
- `TELEGRAM_CREATOR_SESSION`: sesion MTProto persistida para no pedir OTP en cada corrida
- `WEB_BASE_URL`: link que se envia al pulsar `Abrir panel`
- `TELEGRAM_POLL_INTERVAL_MS`: intervalo corto de polling al Bot API

Variables utiles del conector:

- `STATE_FILE_PATH`: ruta opcional del archivo local donde el conector persiste `connectorId`, `pairingToken` y `websocketUrl`
- Si no lo defines, el conector usa `%LOCALAPPDATA%\\CodexRelay\\connector-state.json` en Windows o `~/.codex-relay/CodexRelay/connector-state.json` como fallback
- `DESKTOP_AUTOMATION_ENABLED`: habilita el companion para Codex Desktop en Windows
- `DESKTOP_LOGS_ROOT`: ruta manual a `%LOCALAPPDATA%\\Packages\\OpenAI.Codex_2p2nqsd0c76g0\\LocalCache\\Local\\Codex\\Logs`
- `DESKTOP_POLL_INTERVAL_MS`: frecuencia de lectura de logs
- `DESKTOP_AUTOPILOT_MAX_TURNS`: limite por defecto de auto-continue del companion
- `DESKTOP_WINDOW_TITLE`: titulo de ventana usado como fallback si no encuentra el PID principal
- `DESKTOP_CONTINUE_MODE`: `hybrid` intenta `continue` sin restaurar la ventana y solo usa foco visible si hace falta; `focus` evita ese fallback; `restore` mantiene el comportamiento agresivo

## Telegram

1. Si ya tienes token, configuralo en `apps/api/.env` o `apps/api/.env.local`.
2. Si aun no existe el bot, ejecuta `pnpm telegram:create-bot -- --phone 573001234567 --request-code`.
3. Cuando llegue el OTP, ejecuta `pnpm telegram:create-bot -- --code 12345`.
4. Si la cuenta tiene 2FA, ejecuta `pnpm telegram:create-bot -- --code 12345 --password TU_CLAVE`.
5. El bootstrap entonces:

- crea el bot via `@BotFather`
- intenta registrar `/run`, `/sessions`, `/continue`, `/pause` y `/abort`
- guarda `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` y `TELEGRAM_CREATOR_SESSION` en `apps/api/.env.local`

6. Arranca el API y envia `/start` al bot para enlazar el chat con `DEFAULT_USER_ID`.
7. Usa estos comandos:

- `/run "D:\xampp\htdocs\open_source" implementa el siguiente paso`
- `/sessions`
- `/continue <sessionId>`
- `/pause <sessionId>`
- `/abort <sessionId>`
- `/desktop_status`
- `/desktop_continue [connectorId] [conversationId]`
- `/desktop_auto_on [maxTurnos]`
- `/desktop_auto_off`

El bot tambien envia:

- aprobaciones con botones inline
- alertas cuando `safe auto-continue` se detiene por error repetido, limite o pregunta explicita
- alertas por conversacion cuando Codex Desktop queda esperando aprobacion remota
- notificaciones por conversacion cada vez que Autopilot envia `continue`
- link directo al panel para una sesion

## Observabilidad

- `GET /health`: estado del API, Postgres, Redis y Telegram, mas contadores basicos
- El dashboard muestra ese estado en la parte superior
- `pnpm doctor` sirve como chequeo rapido desde terminal

Notas:

- Telegram no permite crear el bot solo con el numero; el script necesita `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` y la OTP de esa cuenta.
- Para terminales no interactivas, el bootstrap guarda `phoneCodeHash` y sesion pendiente en `apps/api/.env.local` y continua en la segunda ejecucion.
- No deje el numero del usuario en archivos versionados; puedes pasarlo por CLI o dejarlo en `apps/api/.env.local`.

## Estado actual

- Hay pairing, contratos, dashboard base, WebSocket de conectores, esquema Prisma, politica de auto-continue y bot de Telegram funcional.
- El conector ya carga `.env/.env.local`, persiste su identidad local y re-parea si el token WebSocket queda invalido.
- Cuando el conector vuelve tras una caida o reinicio, la API le rehidrata sesiones `running`, `paused` y `waiting_for_approval` que ya tenian `threadId`.
- La vista de sesion expone un boton `Rehidratar` para forzar manualmente esa restauracion cuando el `threadId` ya existe.
- El conector intenta usar `codex app-server`; si `codex.exe` no es ejecutable en Windows, reporta `appServerReady=false` y queda visible desde el panel.
- El dashboard solo ofrece proyectos de conectores con `appServerReady=true`; si no hay ninguno listo, bloquea tareas nuevas con un aviso claro.
- El dashboard tambien expone una tarjeta `Codex Desktop` con estado, `Autopilot` y una lista de conversaciones detectadas para continuar un thread especifico.
- La API expone `GET /connectors/desktop/status` y `POST /connectors/desktop/commands` para el companion de Windows.
- El companion ya rastrea multiples conversaciones de Codex Desktop, marca cuales quedaron esperando aprobacion y solo envia `continue` automatico cuando el thread terminado sigue siendo el thread activo visible.
- El connector hub ya no pierde el estado `connected` por cierres de sockets viejos durante reconnects.
- En Windows, `pnpm build` reutiliza el Prisma Client existente si `query_engine-windows.dll.node` esta bloqueado por un proceso del API ya corriendo.
- En esta maquina, el companion detecta logs reales de Codex Desktop y ya puede enviar `continue` usando foco Win32 + teclado simulado. Por defecto primero intenta continuar sin restaurar la ventana; si Windows bloquea el foco o la inyeccion de teclado, cae al fallback visible y deja el detalle exacto en `note`.
- No hay billing, multi-tenant duro ni canal de WhatsApp en esta version.
