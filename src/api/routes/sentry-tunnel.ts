import type { FastifyInstance } from "fastify";

/**
 * Sentry Tunnel - proxies frontend Sentry requests through the backend
 * This bypasses ad blockers and CORS issues
 *
 * @see https://docs.sentry.io/platforms/javascript/troubleshooting/#using-the-tunnel-option
 */
export async function sentryTunnelRoutes(server: FastifyInstance) {
  server.post(
    "/sentry-tunnel",
    {
      config: {
        // Skip auth for Sentry tunnel
        skipAuth: true,
      },
      schema: {
        hide: true, // Hide from OpenAPI docs
      },
    },
    async (request, reply) => {
      try {
        const envelope = request.body as string;

        // Parse the envelope header to get the DSN
        const pieces = envelope.split("\n");
        const header = JSON.parse(pieces[0]) as { dsn?: string };

        if (!header.dsn) {
          return reply.status(400).send({ error: "Missing DSN in envelope" });
        }

        // Extract the project ID and host from the DSN
        const dsn = new URL(header.dsn);
        const projectId = dsn.pathname.replace("/", "");

        // Forward to Sentry's envelope endpoint
        const sentryUrl = `https://${dsn.host}/api/${projectId}/envelope/`;

        const response = await fetch(sentryUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-sentry-envelope",
          },
          body: envelope,
        });

        return reply.status(response.status).send(await response.text());
      } catch (error) {
        server.log.error("Sentry tunnel error:", error);
        return reply.status(500).send({ error: "Tunnel error" });
      }
    }
  );
}
