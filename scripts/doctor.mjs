const apiBaseUrl = process.env.CODEX_RELAY_API_URL ?? "http://localhost:4000";

const line = (label, value) => {
  process.stdout.write(`${label}: ${value}\n`);
};

try {
  const response = await fetch(`${apiBaseUrl}/health`, {
    headers: {
      "x-user-id": process.env.CODEX_RELAY_USER_ID ?? "local-dev-user"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const health = await response.json();
  line("API", `${health.status} @ ${apiBaseUrl}`);
  line("Database", health.services.database);
  line("Redis", health.services.redis);
  line("Telegram", health.services.telegram);
  line("Connectors", String(health.stats.connectors));
  line("Sessions", String(health.stats.sessions));
} catch (error) {
  line("API", `unreachable (${error instanceof Error ? error.message : String(error)})`);
  process.exitCode = 1;
}
