"use client";

import { useState, useTransition } from "react";

import { sendCommand } from "../lib/api";

type ActionPayload = {
  sessionId: string;
  command: "continue" | "pause" | "abort" | "resume_thread";
  threadId?: string;
};

export function SessionActions({
  sessionId,
  threadId,
}: {
  sessionId: string;
  threadId: string | null | undefined;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (payload: ActionPayload) => {
    startTransition(async () => {
      await sendCommand(payload);
      setMessage(`Comando enviado: ${payload.command}`);
    });
  };

  return (
    <div className="stack">
      <div className="button-row">
        <button disabled={isPending} onClick={() => run({ sessionId, command: "continue" })}>
          Continuar
        </button>
        <button
          className="secondary"
          disabled={isPending}
          onClick={() => run({ sessionId, command: "pause" })}
        >
          Pausar
        </button>
        <button
          className="danger"
          disabled={isPending}
          onClick={() => run({ sessionId, command: "abort" })}
        >
          Abortar
        </button>
        {threadId ? (
          <button
            className="secondary"
            disabled={isPending}
            onClick={() => run({ sessionId, command: "resume_thread", threadId })}
          >
            Rehidratar
          </button>
        ) : null}
      </div>
      {message ? <div className="meta">{message}</div> : null}
    </div>
  );
}
