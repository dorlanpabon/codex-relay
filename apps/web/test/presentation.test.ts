import { describe, expect, it } from "vitest";

import {
  connectorSummary,
  healthBadgeTone,
  joinMeta,
  launchProjects,
  sessionSummary,
  visibleConnectorProjects,
} from "../lib/presentation";

describe("presentation helpers", () => {
  it("joins meta parts with ASCII separator", () => {
    expect(joinMeta("windows", undefined, "Codex 1.0")).toBe("windows / Codex 1.0");
  });

  it("builds connector summaries", () => {
    expect(
      connectorSummary({
        id: "connector-1",
        machineName: "workstation",
        platform: "windows",
        codexVersion: "1.2.3",
        appServerReady: true,
        status: "online",
        projects: []
      })
    ).toBe("windows / 1.2.3");
  });

  it("builds session summaries", () => {
    expect(
      sessionSummary({
        id: "session-1",
        status: "running",
        latestSummary: null,
        autoContinueTurns: 2,
        autoContinueMaxTurns: 5,
        updatedAt: new Date().toISOString(),
        connector: {
          machineName: "desktop"
        },
        project: {
          name: "open_source"
        }
      })
    ).toBe("desktop / open_source / auto-turnos 2/5");
  });

  it("maps disabled services to warning tone", () => {
    expect(healthBadgeTone("disabled")).toBe("warning");
    expect(healthBadgeTone("degraded")).toBe("danger");
  });

  it("hides nested repo paths inside the same connector", () => {
    const connector = {
      id: "connector-1",
      machineName: "workstation",
      platform: "windows",
      codexVersion: "1.2.3",
      appServerReady: true,
      status: "online",
      projects: [
        {
          id: "project-2",
          name: "connector",
          repoPath: "D:\\xampp\\htdocs\\open_source\\apps\\connector",
        },
        {
          id: "project-1",
          name: "open_source",
          repoPath: "D:\\xampp\\htdocs\\open_source",
        },
      ],
    };

    expect(visibleConnectorProjects(connector)).toEqual([
      {
        id: "project-1",
        name: "open_source",
        repoPath: "D:\\xampp\\htdocs\\open_source",
      },
    ]);
  });

  it("keeps root repos per connector when building launch options", () => {
    expect(
      launchProjects([
        {
          id: "connector-1",
          machineName: "desktop",
          platform: "windows",
          codexVersion: "1.2.3",
          appServerReady: true,
          status: "online",
          projects: [
            {
              id: "project-1",
              name: "open_source",
              repoPath: "D:\\xampp\\htdocs\\open_source",
            },
            {
              id: "project-2",
              name: "connector",
              repoPath: "D:\\xampp\\htdocs\\open_source\\apps\\connector",
            },
          ],
        },
        {
          id: "connector-2",
          machineName: "laptop",
          platform: "windows",
          codexVersion: "1.2.3",
          appServerReady: false,
          status: "online",
          projects: [
            {
              id: "project-3",
              name: "another_repo",
              repoPath: "D:\\workspace\\another_repo",
            },
          ],
        },
      ]),
    ).toEqual([
      {
        id: "project-1",
        name: "open_source",
        repoPath: "D:\\xampp\\htdocs\\open_source",
      },
    ]);
  });
});
