import type { ConnectorDto, HealthDto, SessionDto } from "./api";

export const joinMeta = (...parts: Array<string | null | undefined>): string =>
  parts.filter((part): part is string => Boolean(part && part.trim())).join(" / ");

const normalizeRepoPath = (repoPath: string): string =>
  repoPath.replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase();

const isNestedRepoPath = (repoPath: string, parentRepoPath: string): boolean => {
  const normalizedRepoPath = normalizeRepoPath(repoPath);
  const normalizedParentRepoPath = normalizeRepoPath(parentRepoPath);

  return normalizedRepoPath.startsWith(`${normalizedParentRepoPath}/`);
};

export const connectorSummary = (connector: ConnectorDto): string =>
  joinMeta(connector.platform, connector.codexVersion ?? "Codex no detectado");

export const visibleConnectorProjects = (
  connector: ConnectorDto,
): ConnectorDto["projects"] => {
  const sortedProjects = [...connector.projects].sort((left, right) =>
    left.repoPath.length - right.repoPath.length || left.repoPath.localeCompare(right.repoPath),
  );

  return sortedProjects.filter(
    (project, index) =>
      !sortedProjects
        .slice(0, index)
        .some((candidate) => isNestedRepoPath(project.repoPath, candidate.repoPath)),
  );
};

export const launchProjects = (connectors: ConnectorDto[]): ConnectorDto["projects"] =>
  connectors
    .filter((connector) => connector.appServerReady)
    .flatMap((connector) => visibleConnectorProjects(connector));

export const sessionSummary = (session: SessionDto): string =>
  `${joinMeta(session.connector.machineName, session.project.name)} / auto-turnos ${session.autoContinueTurns}/${session.autoContinueMaxTurns}`;

export const healthBadgeTone = (
  value: HealthDto["status"] | HealthDto["services"][keyof HealthDto["services"]]
): "" | "warning" | "danger" => {
  if (value === "error" || value === "degraded") {
    return "danger";
  }

  if (value === "disabled") {
    return "warning";
  }

  return "";
};
