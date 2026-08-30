import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render";
import { AdvancedSettings } from "./AdvancedSettings";

function paramFieldRoot(name: RegExp): HTMLElement {
  const label = Array.from(document.querySelectorAll("label")).find((l) => name.test(l.textContent ?? ""));
  if (!label) throw new Error(`label ${name} not found`);
  return label.parentElement!;
}

function paramField(name: RegExp): HTMLElement {
  return within(paramFieldRoot(name)).getByRole("spinbutton");
}

function renderAdvanced(sampling?: { temperature?: number; topP?: number }) {
  const onSetSampling = vi.fn();
  renderWithProviders(
    <AdvancedSettings sampling={sampling} onSetSampling={onSetSampling} />,
  );
  return { onSetSampling };
}

describe("AdvancedSettings", () => {
  it("is collapsed by default and expands via the trigger", async () => {
    const user = userEvent.setup();
    renderAdvanced();

    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /高级设置/ }));
    expect(paramField(/Temperature/)).toBeInTheDocument();
    expect(paramField(/Top P/)).toBeInTheDocument();
  });

  it("commits a value on blur, not on every keystroke", async () => {
    const user = userEvent.setup();
    const { onSetSampling } = renderAdvanced({ temperature: 0.5 });

    await user.click(screen.getByRole("button", { name: /高级设置/ }));
    const temperature = paramField(/Temperature/);
    await user.clear(temperature);
    await user.type(temperature, "0.7");
    expect(onSetSampling).not.toHaveBeenCalled();

    await user.tab();
    expect(onSetSampling).toHaveBeenCalledWith({ temperature: 0.7 });
  });

  it("ignores an unchanged value on blur", async () => {
    const user = userEvent.setup();
    const { onSetSampling } = renderAdvanced({ temperature: 0.5 });

    await user.click(screen.getByRole("button", { name: /高级设置/ }));
    await user.click(paramField(/Temperature/));
    await user.tab();
    expect(onSetSampling).not.toHaveBeenCalled();
  });

  it("resets a field via onSet(undefined)", async () => {
    const user = userEvent.setup();
    const { onSetSampling } = renderAdvanced({ temperature: 0.5, topP: 0.9 });

    await user.click(screen.getByRole("button", { name: /高级设置/ }));
    await user.click(within(paramFieldRoot(/Temperature/)).getByRole("button", { name: "恢复默认" }));
    expect(onSetSampling).toHaveBeenCalledWith({ temperature: undefined });
  });

  it("constrains topP to 0–1 while temperature has no max", async () => {
    const user = userEvent.setup();
    renderAdvanced();

    await user.click(screen.getByRole("button", { name: /高级设置/ }));
    expect(paramField(/Temperature/)).not.toHaveAttribute("max");
    expect(paramField(/Top P/)).toHaveAttribute("max", "1");
  });
});
