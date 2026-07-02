import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));

function source(): string {
  return readFileSync(join(currentDir, "OnboardingPage.tsx"), "utf8");
}

describe("OnboardingPage structure", () => {
  it("self-navigates and pulls actions from the store (feature-root autonomy)", () => {
    const src = source();

    expect(src).toContain("const navigate = useNavigate()");
    expect(src).toContain(
      "const openProject = useAppStore((state) => state.openProject)",
    );
    expect(src).toContain(
      "const createNewProject = useAppStore((state) => state.createNewProject)",
    );
    expect(src).toContain(
      "const openSampleProject = useAppStore((state) => state.openSampleProject)",
    );
  });

  it("loads the sample manifest once on mount", () => {
    const src = source();

    expect(src).toContain(
      "window.electronAPI.getSampleManifest()",
    );
    expect(src).toContain("setSamples(entries)");
    expect(src).toContain("if (!cancelled)");
    expect(src).toContain("cancelled = true");
    expect(src).toContain(".catch(");
  });

  it("guards create-new and open-sample actions against rapid re-entry", () => {
    const src = source();

    expect(src).toContain("const busyRef = useRef(false)");
    expect(src).toContain("if (busyRef.current) return");
    expect(src).toContain("busyRef.current = true");
  });

  it("renders the three onboarding actions, mapping over samples for the sample card", () => {
    const src = source();

    expect(src).toContain('t("onboarding.action.openExisting")');
    expect(src).toContain('t("onboarding.action.createNew")');
    expect(src).toContain(
      't("onboarding.action.openSample", { name: sample.displayName })',
    );
    expect(src).toContain("samples.map(");
  });

  it("attaches a tooltip only to the sample card", () => {
    const src = source();

    expect(src).toContain(
      'tooltip={t("onboarding.tooltip.openSample")}',
    );
    expect(src).toContain("tooltip?: string");
    expect(src).toContain("import { Tooltip, TooltipTrigger, TooltipContent }");
    expect(src).toContain("if (!tooltip) return card");
  });

  it("navigates to the opened project on success", () => {
    const src = source();

    expect(src).toContain(
      'navigate(`/project/${projectId}`)',
    );
  });

  it("surfaces errors via sonner toast keyed off the error code", () => {
    const src = source();

    expect(src).toContain("import { toast } from \"sonner\"");
    expect(src).toContain("toast.error(t(key))");
    expect(src).toContain("dirExistsNotEmpty: \"onboarding.error.dirExistsNotEmpty\"");
    expect(src).toContain("createFailed: \"onboarding.error.createFailed\"");
    expect(src).toContain("copyFailed: \"onboarding.error.copyFailed\"");
    expect(src).toContain("sampleNotFound: \"onboarding.error.sampleNotFound\"");
  });

  it("uses only shadcn semantic tokens and logical properties (no hardcoded colors / dark: / physical dirs)", () => {
    const src = source();

    expect(src).toContain("bg-background");
    expect(src).toContain("bg-card");
    expect(src).toContain("bg-accent");
    expect(src).toContain("text-foreground");
    expect(src).toContain("text-muted-foreground");
    expect(src).toContain("border-border");
    expect(src).toContain("text-start");

    expect(src).not.toMatch(/text-\[#|bg-\[#/);
    expect(src).not.toContain("dark:");
    expect(src).not.toMatch(/\b(ml-|mr-|pl-|pr-|text-left|text-right)\b/);
  });
});
