import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createMockHostBridge } from "../../test/host-bridge";
import { renderWithProviders } from "../../test/render";
import { UnsupportedFileCard } from "./UnsupportedFileCard";

const openFileExternal = vi.fn(async () => {});

function renderCard(overrides: { openFileExternalCapability?: boolean; projectRoot?: string } = {}) {
  const bridge = createMockHostBridge({
    capabilities: { openFileExternal: overrides.openFileExternalCapability ?? false },
    project: { openFileExternal } as never,
  });
  renderWithProviders(<UnsupportedFileCard filePath="docs/schema.bin" />, {
    bridge,
    projectRoot: overrides.projectRoot ?? "/data/proj",
  });
  return { openFileExternal };
}

describe("UnsupportedFileCard", () => {
  it("gates the open-externally button on the openFileExternal capability", () => {
    renderCard({ openFileExternalCapability: false });
    expect(screen.queryByRole("button", { name: "用默认应用打开" })).not.toBeInTheDocument();
  });

  it("opens the file via the project host api with an absolute path", async () => {
    const user = userEvent.setup();
    const { openFileExternal } = renderCard({ openFileExternalCapability: true });

    await user.click(screen.getByRole("button", { name: "用默认应用打开" }));

    expect(openFileExternal).toHaveBeenCalledWith("/data/proj/docs/schema.bin");
  });

  it("normalizes separators when joining projectRoot with the relative path", async () => {
    const user = userEvent.setup();
    const { openFileExternal } = renderCard({
      openFileExternalCapability: true,
      projectRoot: "/data/proj/",
    });

    await user.click(screen.getByRole("button", { name: "用默认应用打开" }));

    expect(openFileExternal).toHaveBeenCalledWith("/data/proj/docs/schema.bin");
  });
});
