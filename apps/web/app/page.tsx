import { DesktopControls } from "../components/desktop-controls";
import Link from "next/link";

import { TaskForm } from "../components/task-form";
import { getConnectors, getDesktopStatus, getHealth, getSessions } from "../lib/api";
import {
  connectorSummary,
  healthBadgeTone,
  launchProjects,
  sessionSummary,
  visibleConnectorProjects,
} from "../lib/presentation";

export default async function DashboardPage() {
  const [health, connectors, sessions, desktopStatus] = await Promise.all([
    getHealth(),
    getConnectors(),
    getSessions(),
    getDesktopStatus(),
  ]);
  const projects = launchProjects(connectors);
  const hasReadyConnector = connectors.some((connector) => connector.appServerReady);

  return (
    <main>
      <section className="hero">
        <span className="pill">Codex Relay</span>
        <h1>Controla tus sesiones locales sin quedarte pegado al teclado.</h1>
        <p>
          El conector vive en Windows o WSL, el API retransmite eventos y el panel
          te deja lanzar tareas, revisar aprobaciones y reanudar sesiones.
        </p>
      </section>

      <section className="grid">
        <div className="stack">
          <div className="card">
            <div className="row">
              <h2>Estado del stack</h2>
              <span className={`pill ${healthBadgeTone(health.status)}`}>
                {health.status}
              </span>
            </div>
            <div className="list">
              <div className="list-item">
                <div className="row">
                  <strong>API</strong>
                  <span className={`pill ${healthBadgeTone(health.services.api)}`}>
                    {health.services.api}
                  </span>
                </div>
                <div className="meta">
                  {health.stats.connectors} conectores / {health.stats.sessions} sesiones
                </div>
              </div>
              <div className="list-item">
                <div className="row">
                  <strong>Postgres</strong>
                  <span className={`pill ${healthBadgeTone(health.services.database)}`}>
                    {health.services.database}
                  </span>
                </div>
              </div>
              <div className="list-item">
                <div className="row">
                  <strong>Redis</strong>
                  <span className={`pill ${healthBadgeTone(health.services.redis)}`}>
                    {health.services.redis}
                  </span>
                </div>
              </div>
              <div className="list-item">
                <div className="row">
                  <strong>Telegram</strong>
                  <span className={`pill ${healthBadgeTone(health.services.telegram)}`}>
                    {health.services.telegram}
                  </span>
                </div>
                <div className="meta">
                  Ultima revision {new Date(health.timestamp).toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <h2>Nuevo trabajo</h2>
            <p className="meta">
              Lanza una tarea sobre un proyecto emparejado y deja que la politica
              safe auto-continue empuje el flujo.
            </p>
            {hasReadyConnector ? (
              <TaskForm projects={projects} />
            ) : (
              <div className="pill warning">
                No hay conectores listos. Configura `CODEX_COMMAND` y reinicia el
                conector para habilitar tareas nuevas.
              </div>
            )}
          </div>

          <div className="card">
            <div className="row">
              <h2>Sesiones recientes</h2>
              <span className="meta">{sessions.length} registradas</span>
            </div>
            <div className="list">
              {sessions.map((session) => (
                <Link key={session.id} href={`/sessions/${session.id}`} className="list-item">
                  <div className="row">
                    <strong>{session.project.name}</strong>
                    <span
                      className={`pill ${
                        session.status === "failed"
                          ? "danger"
                          : session.status === "waiting_for_approval"
                            ? "warning"
                            : ""
                      }`}
                    >
                      {session.status}
                    </span>
                  </div>
                  <div className="meta">{sessionSummary(session)}</div>
                  <div>{session.latestSummary || "Sin eventos aun"}</div>
                </Link>
              ))}
              {!sessions.length ? (
                <div className="list-item">
                  <strong>No hay sesiones aun.</strong>
                  <div className="meta">
                    Empareja un conector y crea la primera tarea desde este panel o
                    desde Telegram.
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="stack">
          <DesktopControls status={desktopStatus} />

          <div className="card">
            <div className="row">
              <h2>Conectores</h2>
              <span className="meta">{connectors.length} activos</span>
            </div>
            <div className="list">
              {connectors.map((connector) => (
                <div key={connector.id} className="list-item">
                  <div className="row">
                    <strong>{connector.machineName}</strong>
                    <span
                      className={`pill ${connector.appServerReady ? "" : "warning"}`}
                    >
                      {connector.status}
                    </span>
                  </div>
                  <div className="meta">{connectorSummary(connector)}</div>
                  <pre>{visibleConnectorProjects(connector).map((project) => project.repoPath).join("\n")}</pre>
                </div>
              ))}
              {!connectors.length ? (
                <div className="list-item">
                  <strong>Sin conectores emparejados.</strong>
                  <div className="meta">
                    Arranca `pnpm --filter @codex-relay/connector dev` para que el
                    conector se auto-paree contra la API.
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
