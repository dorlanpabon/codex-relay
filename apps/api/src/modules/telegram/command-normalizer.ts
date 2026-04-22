const stripBotMention = (token: string): string => token.replace(/@[\w_]+$/i, "");

const DESKTOP_HEAD_ALIASES = new Set(["/desktop"]);
const DIRECT_ALIASES = new Map<string, string>([
  ["/start", "/start"],
  ["/sessions", "/sessions"],
  ["/desktop_status", "/desktop_status"],
  ["/desktop-status", "/desktop_status"],
  ["/desktopstatus", "/desktop_status"],
  ["/desktop_continue", "/desktop_continue"],
  ["/desktop-continue", "/desktop_continue"],
  ["/desktopcontinue", "/desktop_continue"],
  ["/desktop_inspect", "/desktop_inspect"],
  ["/desktop-inspect", "/desktop_inspect"],
  ["/desktopinspect", "/desktop_inspect"],
  ["/desktop_auto_on", "/desktop_auto_on"],
  ["/desktop-auto-on", "/desktop_auto_on"],
  ["/desktopautoon", "/desktop_auto_on"],
  ["/desktop_auto_off", "/desktop_auto_off"],
  ["/desktop-auto-off", "/desktop_auto_off"],
  ["/desktopautooff", "/desktop_auto_off"],
  ["/run", "/run"],
  ["/continue", "/continue"],
  ["/pause", "/pause"],
  ["/abort", "/abort"],
]);

export const normalizeTelegramCommandInput = (text: string): string => {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return trimmed;
  }

  const parts = trimmed.split(/\s+/);
  const first = stripBotMention(parts[0]?.toLowerCase() ?? "");
  const second = parts[1]?.toLowerCase();
  const remainder = parts.slice(2);
  const direct = DIRECT_ALIASES.get(first);
  if (direct) {
    return [direct, ...parts.slice(1)].join(" ").trim();
  }

  if (DESKTOP_HEAD_ALIASES.has(first) && second === "status") {
    return ["/desktop_status", ...remainder].join(" ").trim();
  }

  if (DESKTOP_HEAD_ALIASES.has(first) && second === "continue") {
    return ["/desktop_continue", ...remainder].join(" ").trim();
  }

  if (DESKTOP_HEAD_ALIASES.has(first) && second === "inspect") {
    return ["/desktop_inspect", ...remainder].join(" ").trim();
  }

  if (DESKTOP_HEAD_ALIASES.has(first) && second === "auto_on") {
    return ["/desktop_auto_on", ...remainder].join(" ").trim();
  }

  if (DESKTOP_HEAD_ALIASES.has(first) && second === "auto_off") {
    return ["/desktop_auto_off", ...remainder].join(" ").trim();
  }

  return [first, ...parts.slice(1)].join(" ").trim();
};
