# Contributing

## Requisitos

- Node.js 22
- pnpm 10
- Docker Desktop si vas a levantar Postgres y Redis locales
- Windows es la plataforma principal para el companion de Codex Desktop

## Setup rapido

```bash
pnpm install
pnpm infra:up
pnpm prisma:push
pnpm prisma:generate
```

Si prefieres levantar todo el stack local de una vez:

```bash
pnpm local:up
```

## Validacion antes de abrir PR

```bash
pnpm check
```

Ese comando ejecuta `build`, `test` y `typecheck` en todo el monorepo. Es el mismo chequeo que corre GitHub Actions.

## Workspaces

- `apps/api`: API NestJS, WebSocket de conectores, BullMQ, Prisma
- `apps/web`: dashboard Next.js
- `apps/connector`: daemon local y companion de Codex Desktop
- `packages/contracts`: contratos y tipos compartidos
- `packages/telegram`: helpers del bot y callbacks

## Cambios esperados

- Mantener diffs pequenos y focalizados
- Agregar o ajustar tests cuando cambie comportamiento
- No subir secretos ni `.env.local`
- Si tocas el companion de Windows, probar `pnpm local:status` y revisar `GET /health`

## Ramas

- Usa ramas con prefijo `codex/`
- Abre PR contra `main`
