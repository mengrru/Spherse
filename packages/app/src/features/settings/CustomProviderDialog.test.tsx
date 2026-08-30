import { screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render";
import { CustomProviderDialog } from "./CustomProviderDialog";
import type { CustomProviderDef } from "@spherse/core";

function renderDialog(props: { open: boolean; initial?: CustomProviderDef } = { open: true }) {
  const onClose = vi.fn();
  const onSubmit = vi.fn();
  renderWithProviders(
    <CustomProviderDialog open={props.open} onClose={onClose} onSubmit={onSubmit} initial={props.initial} />,
  );
  return { onClose, onSubmit };
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("名称"), "My Provider");
  await user.type(screen.getByLabelText("Base URL"), "https://api.example/v1");
  await user.type(screen.getByLabelText("模型 ID"), "m1, m2\nm3\n\nm1");
}

describe("CustomProviderDialog", () => {
  it("switches the title between add and edit modes", () => {
    renderDialog();
    expect(screen.getByText("添加自定义供应商")).toBeInTheDocument();
  });

  it("shows edit title and prefills fields from initial when open", async () => {
    renderDialog({
      open: true,
      initial: {
        id: "custom-x",
        name: "Existing",
        baseUrl: "https://existing.example",
        models: ["m1", "m2"],
        keyless: false,
        contextWindow: 128000,
        maxTokens: 8192,
      },
    });
    expect(screen.getByText("编辑自定义供应商")).toBeInTheDocument();
    expect(screen.getByLabelText("名称")).toHaveValue("Existing");
    expect(screen.getByLabelText("Base URL")).toHaveValue("https://existing.example");
    expect(screen.getByLabelText("模型 ID")).toHaveValue("m1\nm2");
    expect(screen.getByLabelText("上下文长度")).toHaveValue(128000);
    expect(screen.getByLabelText("最大输出长度")).toHaveValue(8192);
  });

  it("disables Save while required fields are empty and shows errors", async () => {
    const user = userEvent.setup();
    renderDialog();

    const save = screen.getByRole("button", { name: "保存" });
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText("名称"), "X");
    expect(screen.getByText("请输入 Base URL")).toBeInTheDocument();
    expect(screen.getByText("请至少填写一个模型 ID")).toBeInTheDocument();
    expect(save).toBeDisabled();
  });

  it("rejects a non-http baseUrl", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText("名称"), "X");
    await user.type(screen.getByLabelText("Base URL"), "ftp://api.example");
    await user.type(screen.getByLabelText("模型 ID"), "m1");
    expect(screen.getByText("Base URL 必须是合法的 http(s) 地址")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  it("rejects non-positive-integer limits while empty means default", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText("名称"), "X");
    await user.type(screen.getByLabelText("Base URL"), "https://api.example");
    await user.type(screen.getByLabelText("模型 ID"), "m1");
    await user.type(screen.getByLabelText("上下文长度"), "-5");
    expect(screen.getByText("请输入正整数")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();

    await user.clear(screen.getByLabelText("上下文长度"));
    await waitFor(() => expect(screen.queryByText("请输入正整数")).not.toBeInTheDocument());
  });

  it("parses model ids (split on comma/newline, trim, drop empties, dedupe) and submits the def", async () => {
    const user = userEvent.setup();
    const { onSubmit, onClose } = renderDialog();

    await fillValidForm(user);
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(onSubmit).toHaveBeenCalledWith({
      id: "",
      name: "My Provider",
      baseUrl: "https://api.example/v1",
      models: ["m1", "m2", "m3"],
      keyless: false,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("preserves initial.id in edit mode and applies the keyless switch", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog({
      open: true,
      initial: { id: "custom-x", name: "Existing", baseUrl: "https://existing.example", models: ["m1"], keyless: false },
    });

    await user.click(screen.getByRole("switch"));
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(onSubmit).toHaveBeenCalledWith({
      id: "custom-x",
      name: "Existing",
      baseUrl: "https://existing.example",
      models: ["m1"],
      keyless: true,
    });
  });
});
