import Link from "next/link";

import { SessionActions } from "../../../components/session-actions";
import { getSession, sendCommand } from "../../../lib/api";
import { joinMeta } from "../../../lib/presentation";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession(id);

  return (
    <main>
      <section className="hero">
        <span className="pill">{session.status}</span>
        <h1>{session.project.name}</h1>
        <p>
          {joinMeta(
            session.connector.machineName,
            session.connector.platform,
            session.project.repoPath,
          )}
        </p>
        <Link href="/" className="meta">
          {"<- Volver al dashboard"}
        </Link>
      </section>

      <section className="grid">
        <div className="stack">
          <div className="card">
            <h2>Control</h2>
            <SessionActions sessionId={session.id} threadId={session.threadId} />
          </div>

          <div className="card">
            <h2>Prompt</h2>
            <pre>{session.prompt}</pre>
          </div>

          <div className="card">
            <div className="row">
              <h2>Timeline</h2>
              <span className="meta">
                auto-turnos {session.autoContinueTurns}/{session.autoContinueMaxTurns}
              </span>
            </div>
            <div className="timeline">
              {session.events.map((event) => (
                <div key={event.id} className="list-item">
                  <div className="row">
                    <strong>{event.type}</strong>
                    <span
                      className={`pill ${
                        event.severity === "error"
                          ? "danger"
                          : event.severity === "warning"
                            ? "warning"
                            : ""
                      }`}
                    >
                      {event.severity}
                    </span>
                  </div>
                  <div>{event.summary}</div>
                  <div className="meta">{new Date(event.createdAt).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <h2>Aprobaciones</h2>
            <div className="list">
              {session.approvals.map((approval) => (
                <div key={approval.id} className="list-item">
                  <div className="row">
                    <strong>{approval.kind}</strong>
                    <span
                      className={`pill ${
                        approval.status === "pending" ? "warning" : ""
                      }`}
                    >
                      {approval.status}
                    </span>
                  </div>
                  <div>{approval.message}</div>
                  <div className="button-row">
                    {approval.status === "pending"
                      ? approval.options.map((option) => (
                          <form
                            key={option}
                            action={async () => {
                              "use server";
                              await sendCommand({
                                sessionId: session.id,
                                command: "approve_once",
                                approvalId: approval.id,
                                decision: option,
                              });
                            }}
                          >
                            <button type="submit">{option}</button>
                          </form>
                        ))
                      : null}
                  </div>
                </div>
              ))}
              {!session.approvals.length ? (
                <div className="list-item">
                  <strong>No hay aprobaciones pendientes.</strong>
                </div>
              ) : null}
            </div>
          </div>

          <div className="card">
            <h2>Contexto</h2>
            <div className="meta">Thread ID: {session.threadId || "sin asignar"}</div>
            <div className="meta">Ultimo resumen: {session.latestSummary || "sin datos"}</div>
          </div>
        </div>
      </section>
    </main>
  );
}
