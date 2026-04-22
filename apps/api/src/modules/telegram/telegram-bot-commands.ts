export const TELEGRAM_BOT_COMMANDS = [
  { command: "desktop_status", description: "Ver estado de Codex Desktop" },
  { command: "desktop_continue", description: "Continuar un thread Desktop" },
  { command: "desktop_inspect", description: "Ver detalle de un thread Desktop" },
  { command: "desktop_auto_on", description: "Encender autopilot Desktop" },
  { command: "desktop_auto_off", description: "Apagar autopilot Desktop" },
  { command: "run", description: "Crear una tarea Relay remota" },
  { command: "sessions", description: "Ver sesiones Relay creadas con /run" },
  { command: "continue", description: "Continuar una sesion Relay" },
  { command: "pause", description: "Pausar una sesion Relay" },
  { command: "abort", description: "Abortar una sesion Relay" },
] as const;

export const TELEGRAM_START_HELP_LINES = [
  "Codex Relay enlazado.",
  "Usa /desktop_status para ver Codex Desktop.",
  "Usa /desktop_continue 1 o /desktop_continue <proyecto> para continuar un thread.",
  "Usa /desktop_inspect 1 para ver detalle de un thread.",
  "Usa /run <ruta> <prompt> para lanzar tareas Relay por codex app-server.",
  "Usa /sessions para ver solo las sesiones Relay creadas con /run.",
] as const;
