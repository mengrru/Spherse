import React from "react";
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { I18nProvider, useI18n } from "../react.js";

describe("useI18n", () => {
  it("returns default locale when no provider", () => {
    const { result } = renderHook(() => useI18n());
    expect(result.current.locale).toBe("zh-CN");
    expect(result.current.t("app.loading")).toBe("加载中...");
  });

  it("returns provided locale", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <I18nProvider locale="en">{children}</I18nProvider>
    );
    const { result } = renderHook(() => useI18n(), { wrapper });
    expect(result.current.locale).toBe("en");
    expect(result.current.t("app.loading")).toBe("Loading...");
  });
});
