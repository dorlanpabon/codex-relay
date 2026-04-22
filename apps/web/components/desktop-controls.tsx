"use client";

import { useState, useTransition } from "react";

import { sendDesktopCommand, type DesktopStatusDto } from "../lib/api";

export function DesktopControls({ status }: { status: DesktopStatusDto | null }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (
    command:
      | "continue_active"
      | "continue_conversation"
      | "autopilot_on"
      | "autopilot_off",
    conversationId?: string,
  ) => {
    startTransition(async () => {
      try {
        setError(null);
        await sendDesktopCommand({
          command,
          ...(status?.connectorId ? { connectorId: status.connectorId } : {}),
          ...(conversationId ? { conversationId } : {}),
          ...(status?.maxAutoTurns ? { maxAutoTurns: status.maxAutoTurns } : {}),
        });
        window.location.reload();
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "No fue posible controlar Codex Desktop",
        );
      }
    });
  };

  if (!status) {
    return (
      <div className="card">
        <h2>Codex Desktop</h2>
        <div className="pill warning">No hay desktop companion conectado.</div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="row">
        <h2>Codex Desktop</h2>
        <span className={`pill ${status.desktopAutomationReady ? "" : "warning"}`}>
          {status.desktopAutomationReady ? "listo" : "no listo"}
        </span>
      </div>
      <div className="list">
        <div className="list-item">
          <strong>{status.connectorId}</strong>
          <div className="meta">
            Autopilot {status.autopilotEnabled ? "encendido" : "apagado"} · auto-turnos{" "}
            {status.autoContinueCount}/{status.maxAutoTurns}
          </div>
          <div>{status.note || "Sin novedades."}</div>
        </div>
      </div>
      <div className="button-row">
        <button
          type="button"
          onClick={() => submit("continue_active")}
          disabled={isPending || !status.desktopAutomationReady}
        >
          Continuar Desktop
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => submit(status.autopilotEnabled ? "autopilot_off" : "autopilot_on")}
          disabled={isPending || !status.desktopAutomationReady}
        >
          {status.autopilotEnabled ? "Apagar Autopilot" : "Encender Autopilot"}
        </button>
      </div>
      {status.activeConversationId ? (
        <div className="meta">Conversacion activa: {status.activeConversationId}</div>
      ) : null}
      {status.lastTurnCompletedAt ? (
        <div className="meta">
          Ultimo turn complete: {new Date(status.lastTurnCompletedAt).toLocaleString()}
        </div>
      ) : null}
      {status.conversations.length ? (
        <div className="list">
          {status.conversations.map((conversation) => (
            <div className="list-item" key={conversation.conversationId}>
              <div className="row">
                <strong>{conversation.conversationId}</strong>
                <span
                  className={`pill ${conversation.awaitingApproval ? "warning" : ""}`}
                >
                  {conversation.status}
                </span>
              </div>
              <div className="meta">
                {conversation.isActive ? "activa" : "en segundo plano"} · auto{" "}
                {conversation.autoContinueCount}/{status.maxAutoTurns}
              </div>
              {conversation.lastTurnCompletedAt ? (
                <div className="meta">
                  Ultimo complete:{" "}
                  {new Date(conversation.lastTurnCompletedAt).toLocaleString()}
                </div>
              ) : null}
              <div>{conversation.note || "Sin novedades."}</div>
              <div className="button-row">
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    submit("continue_conversation", conversation.conversationId)
                  }
                  disabled={isPending || !status.desktopAutomationReady}
                >
                  Continuar este thread
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {error ? <div className="pill danger">{error}</div> : null}
    </div>
  );
}
