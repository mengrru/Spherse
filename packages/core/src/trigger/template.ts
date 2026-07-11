function localDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function localTime(): string {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${min}`;
}

const TIME_VARS: Record<string, () => string> = {
  date: localDate,
  time: localTime,
  datetime: () => `${localDate()} ${localTime()}`,
  weekday: () =>
    new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(new Date()),
};

export interface TemplateContext {
  agentName: string;
  payload: string;
}

export function resolveTemplateVars(message: string, ctx: TemplateContext): string {
  return message.replace(/{{(\w+)}}/g, (_match, key: string) => {
    if (key === "agent_name") return ctx.agentName;
    if (key === "payload") return ctx.payload;
    const fn = TIME_VARS[key];
    return fn ? fn() : `{{${key}}}`;
  });
}
