import yaml from "js-yaml";
import { ALL_TOOL_IDS } from "./tool-registry";

export interface AgentFormData {
  name: string;
  tools: string[];
  context: string[];
  systemPrompt: string;
}

export interface ParsedAgent {
  formData: AgentFormData;
  extraFrontmatter: Record<string, unknown>;
}

export function parseAgentMarkdown(raw: string): ParsedAgent {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return {
      formData: {
        name: "",
        tools: [...ALL_TOOL_IDS],
        context: [],
        systemPrompt: raw.trim(),
      },
      extraFrontmatter: {},
    };
  }

  const frontmatterRaw = match[1];
  const body = raw.slice(match[0].length).trim();
  const frontmatter = yaml.load(frontmatterRaw) as Record<string, unknown>;

  const { name, tools, context, ...extra } = frontmatter;

  return {
    formData: {
      name: typeof name === "string" ? name : "",
      tools: Array.isArray(tools)
        ? tools.filter((t): t is string => typeof t === "string")
        : [...ALL_TOOL_IDS],
      context: Array.isArray(context)
        ? context.filter((c): c is string => typeof c === "string")
        : [],
      systemPrompt: body,
    },
    extraFrontmatter: extra,
  };
}

export function buildAgentMarkdown(
  formData: AgentFormData,
  extraFrontmatter: Record<string, unknown>,
  _isCreate: boolean,
): string {
  const frontmatter: Record<string, unknown> = {
    ...extraFrontmatter,
    name: formData.name,
    tools: formData.tools,
  };
  if (formData.context.length > 0) {
    frontmatter.context = formData.context;
  }

  const cleaned = Object.fromEntries(
    Object.entries(frontmatter).filter(([, v]) => v !== undefined),
  );
  const yamlStr = yaml
    .dump(cleaned, { lineWidth: -1, quotingType: '"' })
    .trim();
  return `---\n${yamlStr}\n---\n\n${formData.systemPrompt}\n`;
}
