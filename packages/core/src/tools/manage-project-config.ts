import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ProjectStore } from "../store/project.js";
import { ValidationError } from "../errors.js";

const ManageProjectConfigParams = Type.Object({
  action: Type.Union([Type.Literal("read"), Type.Literal("update_welcome_page")], {
    description:
      "`read` returns the current project-level settings. `update_welcome_page` sets or clears the welcome page shown on the project home route.",
  }),
  welcome_page_path: Type.Optional(
    Type.Union([Type.String(), Type.Null()], {
      description:
        "Required for `update_welcome_page`. Project-relative path of an HTML page or image to use as the welcome page, e.g. `index.html` or `assets/cover.png`. " +
        "Must be a user file (not inside `.spherse/`), must not contain `..`, and the extension must be one of html/htm/png/jpg/jpeg/gif/webp/svg. " +
        "Pass `null` to clear the setting and restore the default behavior (falls back to the project root `index.html` when present).",
    }),
  ),
});

export interface ManageProjectConfigDetails {
  cardType: "manage_project_config";
  action: string;
  welcomePagePath?: string | null;
  error?: boolean;
}

type ManageProjectConfigResult = {
  content: { type: "text"; text: string }[];
  details: ManageProjectConfigDetails;
};

function ok(
  action: string,
  text: string,
  extra?: Partial<ManageProjectConfigDetails>,
): ManageProjectConfigResult {
  return {
    content: [{ type: "text", text }],
    details: { cardType: "manage_project_config", action, ...extra },
  };
}

function fail(action: string, text: string): ManageProjectConfigResult {
  return {
    content: [{ type: "text", text: `Error: ${text}` }],
    details: { cardType: "manage_project_config", action, error: true },
  };
}

export function createManageProjectConfigTool(
  projectStore: ProjectStore,
): AgentTool<typeof ManageProjectConfigParams, ManageProjectConfigDetails> {
  return {
    name: "manage_project_config",
    label: "Manage Project Config",
    description:
      "Read and update project-level settings of this Spherse project. Currently manages the welcome page — the HTML page or image shown on the project home route (a project homepage, navigation entry, dashboard or overview). " +
      "The path is validated: project-relative user file, not inside `.spherse/`, no `..`, extension html/htm/png/jpg/jpeg/gif/webp/svg. " +
      "Project theme CSS is NOT managed here — write `.spherse/theme.css` directly with `write_file` / `copy_file`.",
    parameters: ManageProjectConfigParams,
    async execute(_toolCallId, params) {
      const action = params.action;
      try {
        switch (action) {
          case "read": {
            const welcomePage = projectStore.config.getWelcomePageSettings();
            return ok(action, JSON.stringify({ welcomePage }, null, 2), {
              welcomePagePath: welcomePage.path,
            });
          }
          case "update_welcome_page": {
            if (params.welcome_page_path === undefined) {
              return fail(
                action,
                "`welcome_page_path` is required for `update_welcome_page` (pass `null` to clear).",
              );
            }
            const settings = await projectStore.config.updateWelcomePageSettings(
              params.welcome_page_path,
            );
            return ok(
              action,
              settings.path === null
                ? "Welcome page setting cleared."
                : `Welcome page set to "${settings.path}".`,
              { welcomePagePath: settings.path },
            );
          }
        }
      } catch (err) {
        if (err instanceof ValidationError) {
          return fail(action, err.message);
        }
        return fail(action, (err as Error).message);
      }
    },
  };
}
