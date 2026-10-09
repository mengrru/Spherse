import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render";
import { Header, type HeaderEditing } from "./Header";

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    filePath: "notes/a.md",
    isHtml: false,
    htmlView: "preview" as const,
    findable: true,
    onClose: vi.fn(),
    onHtmlViewChange: vi.fn(),
    onRefresh: vi.fn(),
    onFindToggle: vi.fn(),
    ...overrides,
  };
}

function editing(overrides: Partial<HeaderEditing> = {}): HeaderEditing {
  return {
    isDirty: false,
    isEditing: false,
    isEditable: true,
    saving: false,
    onEnter: vi.fn(),
    onCancel: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };
}

describe("content-browser Header", () => {
  it("omits back, split, unsplit and edit controls when not provided", () => {
    renderWithProviders(<Header {...baseProps()} />, { locale: "en" });
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Split" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Return to main window" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("renders back, split and edit controls when provided", async () => {
    const onSplit = vi.fn();
    renderWithProviders(
      <Header {...baseProps({ onBack: vi.fn(), onSplit, editing: editing() })} />,
      { locale: "en" },
    );
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Split" }));
    expect(onSplit).toHaveBeenCalled();
  });

  it("places split before all text buttons for html files", () => {
    renderWithProviders(
      <Header {...baseProps({ isHtml: true, onSplit: vi.fn(), editing: editing() })} />,
      { locale: "en" },
    );
    const split = screen.getByRole("button", { name: "Split" });
    for (const name of ["Preview", "Source", "Edit"]) {
      const other = screen.getByRole("button", { name });
      expect(split.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("renders unsplit in the split button slot when provided", async () => {
    const onUnsplit = vi.fn();
    renderWithProviders(<Header {...baseProps({ onUnsplit })} />, { locale: "en" });
    expect(screen.queryByRole("button", { name: "Split" })).toBeNull();
    const unsplit = screen.getByRole("button", { name: "Return to main window" });
    const find = screen.getByRole("button", { name: "Find" });
    const close = screen.getByRole("button", { name: "Close" });
    expect(unsplit.compareDocumentPosition(find) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(unsplit.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(unsplit);
    expect(onUnsplit).toHaveBeenCalled();
  });

  it("hides split and close while editing", () => {
    renderWithProviders(
      <Header {...baseProps({ onSplit: vi.fn(), editing: editing({ isEditing: true, isDirty: true }) })} />,
      { locale: "en" },
    );
    expect(screen.queryByRole("button", { name: "Split" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});
