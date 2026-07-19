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
      "const openSampleProject = useAppStore((state) => state.openSampleProject)",
    );
  });

  it("loads the sample manifest once on mount via host bridge", () => {
    const src = source();

    expect(src).toContain("bridge.project");
    expect(src).toContain("getSampleManifest()");
    expect(src).toContain("setSamples(entries)");
    expect(src).toContain("if (!cancelled)");
    expect(src).toContain("cancelled = true");
    expect(src).toContain(".catch(");
  });

  it("does not reference window.electronAPI directly", () => {
    const src = source();

    expect(src).not.toContain("window.electronAPI");
  });

  it("guards open-or-create and open-sample actions against rapid re-entry", () => {
    const src = source();

    expect(src).toContain("const busyRef = useRef(false)");
    expect(src).toContain("if (busyRef.current) return");
    expect(src).toContain("busyRef.current = true");
  });

  it("renders two onboarding actions: the merged open-or-create card and the sample card", () => {
    const src = source();

    expect(src).toContain('t("onboarding.action.openOrCreate")');
    expect(src).toContain('t("onboarding.desc.openOrCreate")');
    expect(src).toContain(
      't("onboarding.action.openSample", { name: sample.displayName })',
    );
    expect(src).toContain("samples.map(");
    expect(src).toContain("grid-cols-2");
    expect(src).not.toContain("createNewProject");
    expect(src).not.toContain('onboarding.action.createNew');
    expect(src).not.toContain('onboarding.action.openExisting');
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
    expect(src).toContain("copyFailed: \"onboarding.error.copyFailed\"");
    expect(src).toContain("openFailed: \"onboarding.error.openFailed\"");
    expect(src).toContain("sampleNotFound: \"onboarding.error.sampleNotFound\"");
  });

  it("catches unexpected rejections in both actions so failures are visible (not silent)", () => {
    const src = source();

    expect(src).toContain('toast.error(t("onboarding.error.unexpected"))');
    expect(src.match(/catch \{/g)?.length).toBeGreaterThanOrEqual(2);
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
