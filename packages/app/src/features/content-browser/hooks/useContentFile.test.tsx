import { QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@spherse/i18n/react";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { CONTENT_ERROR_CODES } from "@spherse/contracts";
import { ApiError, type ApiClient } from "../../../lib/api";
import { createTestQueryClient } from "../../../test/render";
import { useContentFile } from "./useContentFile";

function setup(readContent: ApiClient["readContent"]) {
  const client = { readContent } as unknown as ApiClient;
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nProvider locale="en">
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </I18nProvider>
  );
  return renderHook(() => useContentFile("p1", client, "a.md"), { wrapper });
}

describe("useContentFile", () => {
  it("returns file content", async () => {
    const { result } = setup(vi.fn().mockResolvedValue({ path: "a.md", content: "hi", binary: false }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.content).toBe("hi");
    expect(result.current.notFound).toBe(false);
  });

  it("flags notFound only for the file-not-found error code", async () => {
    const { result } = setup(vi.fn().mockRejectedValue(new ApiError("Not found", 404, CONTENT_ERROR_CODES.FILE_NOT_FOUND)));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notFound).toBe(true);
    expect(result.current.error).toBe("File not found");
  });

  it("maps access denied to a localized message", async () => {
    const { result } = setup(vi.fn().mockRejectedValue(new ApiError("Access denied", 403)));
    await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 3000 });
    expect(result.current.error).toBe("You don't have access to this file");
  });

  it("does not flag notFound for project-level 404s", async () => {
    const { result } = setup(vi.fn().mockRejectedValue(new ApiError("Unknown project", 404)));
    await waitFor(() => expect(result.current.loading).toBe(false), { timeout: 3000 });
    expect(result.current.notFound).toBe(false);
    expect(result.current.error).toBe("Project is temporarily unavailable. Please refresh later");
  });

  it("does not flag notFound for server or network errors", async () => {
    const server = setup(vi.fn().mockRejectedValue(new ApiError("boom", 500)));
    await waitFor(() => expect(server.result.current.loading).toBe(false), { timeout: 3000 });
    expect(server.result.current.notFound).toBe(false);
    expect(server.result.current.error).toBe("Failed to load file");

    const network = setup(vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await waitFor(() => expect(network.result.current.loading).toBe(false), { timeout: 3000 });
    expect(network.result.current.notFound).toBe(false);
    expect(network.result.current.error).toBe("Unable to reach the service. Please refresh later");
  });
});
