import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SearchFileField } from "./SearchFileField";
import { renderWithProviders } from "../../test/render";

const fileTreeResult = { data: [] as string[] };

vi.mock("../../lib/use-connection", () => ({
  useApiClient: () => ({}),
}));

vi.mock("../../queries/content", () => ({
  useProjectFileTree: () => fileTreeResult,
}));

function settleDebounce(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 250));
}

describe("SearchFileField", () => {
  beforeEach(() => {
    fileTreeResult.data = [];
  });

  it("shows suggestions once the file tree arrives after typing", async () => {
    const onSelect = vi.fn();
    const view = renderWithProviders(
      <SearchFileField placeholder="搜索" onSelect={onSelect} />,
    );

    fireEvent.change(screen.getByPlaceholderText("搜索"), { target: { value: "characters" } });
    await settleDebounce();
    expect(screen.queryByText("world/characters.md")).toBeNull();

    fileTreeResult.data = ["AGENTS.md", "world/characters.md"];
    view.rerender(<SearchFileField placeholder="搜索" onSelect={onSelect} />);

    expect(await screen.findByText("world/characters.md")).toBeVisible();
  });

  it("selects a suggestion and clears the field", async () => {
    const onSelect = vi.fn();
    fileTreeResult.data = ["world/characters.md"];
    renderWithProviders(<SearchFileField placeholder="搜索" onSelect={onSelect} />);

    const input = screen.getByPlaceholderText("搜索");
    fireEvent.change(input, { target: { value: "characters" } });
    const suggestion = await screen.findByText("world/characters.md");
    fireEvent.mouseDown(suggestion);

    expect(onSelect).toHaveBeenCalledWith("world/characters.md");
    expect(input).toHaveValue("");
  });
});
