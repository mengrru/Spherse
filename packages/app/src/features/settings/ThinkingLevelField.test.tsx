import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render";
import { ThinkingLevelField } from "./ThinkingLevelField";

describe("ThinkingLevelField", () => {
  it("renders the four generic levels", () => {
    renderWithProviders(<ThinkingLevelField value="low" onChange={vi.fn()} />);
    const options = screen.getByRole("combobox").querySelectorAll("option");
    expect(options).toHaveLength(4);
    expect(options[0]).toHaveValue("off");
    expect(options[3]).toHaveValue("high");
  });

  it("defaults the select value to medium when undefined", () => {
    renderWithProviders(<ThinkingLevelField value={undefined} onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveValue("medium");
  });

  it("emits the selected level through onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<ThinkingLevelField value="low" onChange={onChange} />);

    await user.selectOptions(screen.getByRole("combobox"), "high");
    expect(onChange).toHaveBeenCalledWith("high");
  });
});
