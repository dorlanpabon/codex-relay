import { createHash } from "node:crypto";
import path from "node:path";

import type { ConnectorProject, RelayPlatform } from "@codex-relay/contracts";

export const detectPlatform = (): RelayPlatform => {
  if (process.platform === "win32") {
    return process.env.WSL_DISTRO_NAME ? "wsl" : "windows";
  }

  if (process.platform === "darwin") {
    return "macos";
  }

  return "linux";
};

export const discoverProjects = (projectInput?: string): ConnectorProject[] => {
  const rawProjects = projectInput
    ? projectInput
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [process.env.INIT_CWD ?? process.cwd()];

  return rawProjects.map((repoPath) => ({
    id: createHash("sha1").update(repoPath).digest("hex").slice(0, 12),
    name: path.basename(repoPath) || repoPath,
    repoPath
  }));
};
