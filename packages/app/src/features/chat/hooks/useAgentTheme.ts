import { useState, useEffect } from "react";
import type { ApiClient } from "../../../lib/api";

function scopeCss(css: string): string {
  const SCOPE = "[data-chat-root]";
  const lines = css.split("\n");
  const result: string[] = [];
  let inBlock = 0;
  let buffer = "";

  for (const line of lines) {
    for (const ch of line) {
      if (ch === "{") {
        inBlock++;
      } else if (ch === "}") {
        inBlock--;
      }
    }

    buffer += line + "\n";

    if (inBlock === 0 && buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith("@")) {
        result.push(trimmed);
      } else if (trimmed.startsWith("--") || /^[a-z-]+\s*:/.test(trimmed)) {
        result.push(`${SCOPE} { ${trimmed} }`);
      } else {
        const scoped = trimmed.replace(
          /^([^@{}/]+?)(\s*\{)/gm,
          (_, selectors, brace) => {
            const prefixed = selectors
              .split(",")
              .map((s: string) => `${SCOPE} ${s.trim()}`)
              .join(", ");
            return `${prefixed}${brace}`;
          },
        );
        result.push(scoped);
      }
      buffer = "";
    }
  }

  if (buffer.trim()) {
    result.push(`${SCOPE} { ${buffer.trim()} }`);
  }

  return result.join("\n\n");
}

export function useAgentTheme(client: ApiClient | undefined, agentId: string | undefined) {
  const [scopedCss, setScopedCss] = useState<string | null>(null);

  useEffect(() => {
    if (!client || !agentId) return;

    let cancelled = false;
    client.getAgentTheme(agentId).then((css) => {
      if (cancelled) return;
      if (css.trim()) {
        setScopedCss(scopeCss(css));
      } else {
        setScopedCss(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [client, agentId]);

  return scopedCss;
}
