import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

const STATIC_ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeHostname(input: string): string {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `http://${input}`;
  return new URL(withScheme).hostname.replace(/^\[|\]$/g, "");
}

function isHostAllowed(hostHeader: string | undefined, dynamicHosts: Set<string>): boolean {
  if (!hostHeader) return false;
  try {
    const hostname = normalizeHostname(hostHeader);
    return STATIC_ALLOWED_HOSTS.has(hostname) || dynamicHosts.has(hostname);
  } catch {
    return false;
  }
}

export interface HostGuard {
  addAllowedHosts: (hosts: string[]) => void;
  removeAllowedHosts: (hosts: string[]) => void;
}

export function registerHostGuard(fastify: FastifyInstance): HostGuard {
  const dynamicHosts = new Set<string>();
  fastify.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isHostAllowed(req.headers.host, dynamicHosts)) {
      return reply.code(403).send({ error: "Forbidden host" });
    }
  });
  return {
    addAllowedHosts(hosts: string[]): void {
      for (const host of hosts) {
        try {
          dynamicHosts.add(normalizeHostname(host));
        } catch {
          fastify.log.warn({ host }, "ignoring invalid allowed host");
        }
      }
    },
    removeAllowedHosts(hosts: string[]): void {
      for (const host of hosts) {
        try {
          dynamicHosts.delete(normalizeHostname(host));
        } catch {
          continue;
        }
      }
    },
  };
}
