import { afterAll, beforeAll, describe, expect, it } from "vitest";
import net from "node:net";
import http from "node:http";
import { createMultiProjectServer, type MultiProjectServer } from "../index.js";

const TOKEN = "secret-token-123";

let server: MultiProjectServer;
let baseUrl: string;
let serverPort: number;

function fetchWithHost(path: string, host: string): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: serverPort, path, headers: { Host: host } },
      (res) => resolve(res),
    );
    req.on("error", reject);
    req.end();
  });
}

function rawRequest(raw: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(serverPort, "127.0.0.1", () => {
      sock.write(raw);
    });
    let data = "";
    sock.on("data", (chunk) => { data += chunk.toString(); });
    sock.on("end", () => resolve(data));
    sock.on("error", reject);
    setTimeout(() => { sock.destroy(); resolve(data); }, 2000);
  });
}

beforeAll(async () => {
  server = await createMultiProjectServer({ auth: { accessToken: TOKEN } });
  const address = server.fastify.server.address() as { port: number };
  serverPort = address.port;
  baseUrl = `http://localhost:${address.port}`;
});

afterAll(async () => {
  await server.fastify.close();
});

describe("host validation", () => {
  it("allows localhost Host", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
  });

  it("rejects foreign Host header", async () => {
    const res = await fetchWithHost("/health", "evil.example.com");
    expect(res.statusCode).toBe(403);
    res.resume();
  });

  it("rejects missing Host header (by node http parser)", async () => {
    const raw = await rawRequest("GET /health HTTP/1.1\r\nConnection: close\r\n\r\n");
    expect(raw).toMatch(/(400|403)/);
  });

  it("rejects unparseable Host header", async () => {
    const res = await fetchWithHost("/health", "http://[::1");
    expect(res.statusCode).toBe(403);
    res.resume();
  });

  it("allows dynamically registered host", async () => {
    server.addAllowedHosts(["abc.trycloudflare.com"]);
    try {
      const res = await fetchWithHost("/health", "abc.trycloudflare.com:443");
      expect(res.statusCode).toBe(200);
      res.resume();
    } finally {
      server.removeAllowedHosts(["abc.trycloudflare.com"]);
    }
  });

  it("rejects host after dynamic removal", async () => {
    server.addAllowedHosts(["x.example.com"]);
    server.removeAllowedHosts(["x.example.com"]);
    const res = await fetchWithHost("/health", "x.example.com");
    expect(res.statusCode).toBe(403);
    res.resume();
  });
});

describe("auth-gated CORS", () => {
  const ORIGIN = "https://pwa.example.com";

  it("does not set ACAO without valid token", async () => {
    const res = await fetch(`${baseUrl}/api/connection/info`, { headers: { Origin: ORIGIN } });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("does not set ACAO with wrong token", async () => {
    const res = await fetch(`${baseUrl}/api/connection/info`, {
      headers: { Origin: ORIGIN, Authorization: "Bearer wrong" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("reflects Origin with valid bearer token", async () => {
    const res = await fetch(`${baseUrl}/api/connection/info`, {
      headers: { Origin: ORIGIN, Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("vary")).toContain("Origin");
  });

  it("reflects Origin with valid query token", async () => {
    const res = await fetch(`${baseUrl}/api/connection/info?token=${encodeURIComponent(TOKEN)}`, {
      headers: { Origin: ORIGIN },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("reflects Origin with valid preview path token", async () => {
    const res = await fetch(`${baseUrl}/api/projects/p1/preview/__auth/${TOKEN}/index.html`, {
      headers: { Origin: ORIGIN },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("answers preflight with 204 even without token", async () => {
    const res = await fetch(`${baseUrl}/api/connection/info`, {
      method: "OPTIONS",
      headers: {
        Origin: ORIGIN,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("access-control-allow-headers")).toBe("authorization,content-type");
  });

  it("answers preflight on unregistered route without 404", async () => {
    const res = await fetch(`${baseUrl}/api/nope`, {
      method: "OPTIONS",
      headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("does not set ACAO on unauthenticated api request regardless of Origin", async () => {
    const res = await fetch(`${baseUrl}/api/projects`, { headers: { Origin: ORIGIN } });
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
