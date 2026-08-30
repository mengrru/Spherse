import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockHostBridge } from "../../test/host-bridge";
import { renderWithProviders } from "../../test/render";
import { useAppStore } from "../../stores/app-store";
import { OnboardingPage } from "./OnboardingPage";

let openProject: ReturnType<typeof vi.fn>;
let openSampleProject: ReturnType<typeof vi.fn>;

beforeEach(() => {
  openProject = vi.fn();
  openSampleProject = vi.fn();
  useAppStore.setState({
    openProject,
    openSampleProject,
  } as never);
});

function renderOnboarding() {
  renderWithProviders(<OnboardingPage />, {
    bridge: createMockHostBridge({
      project: { getSampleManifest: vi.fn(async () => [{ id: "s1", displayName: "Example", dirName: "example" }]) } as never,
    }),
  });
}

describe("OnboardingPage re-entry guard", () => {
  it("guards open-or-create against rapid re-entry while busy", async () => {
    let release!: (value: string | null) => void;
    openProject.mockImplementation(
      () => new Promise((resolve) => (release = resolve)),
    );
    const user = userEvent.setup();
    renderOnboarding();

    const card = screen.getByRole("button", { name: /打开或创建项目/ });
    await user.click(card);
    await user.click(card);
    await user.click(card);
    expect(openProject).toHaveBeenCalledTimes(1);

    release("p-new");
    await user.click(card);
    expect(openProject).toHaveBeenCalledTimes(2);
  });

  it("guards open-sample against re-entry while another action is busy", async () => {
    let release!: (value: string | null) => void;
    openProject.mockImplementation(
      () => new Promise((resolve) => (release = resolve)),
    );
    openSampleProject.mockResolvedValue({ projectId: null, error: "sampleNotFound" });
    const user = userEvent.setup();
    renderOnboarding();

    await user.click(screen.getByRole("button", { name: /打开或创建项目/ }));
    const sampleCard = await screen.findByRole("button", { name: /Example/ });
    await user.click(sampleCard);
    expect(openSampleProject).not.toHaveBeenCalled();

    release(null);
    await user.click(sampleCard);
    expect(openSampleProject).toHaveBeenCalledTimes(1);
  });

  it("recovers the guard after a failed open", async () => {
    openProject.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    renderOnboarding();

    const card = screen.getByRole("button", { name: /打开或创建项目/ });
    await user.click(card);
    await vi.waitFor(() => expect(openProject).toHaveBeenCalledTimes(1));

    await user.click(card);
    expect(openProject).toHaveBeenCalledTimes(2);
  });
});
