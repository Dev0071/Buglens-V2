import { FastifyPluginAsync } from "fastify";
import { pool } from "../../db/client.js";

export const healthRoutes: FastifyPluginAsync = async (server) => {
  server.get("/health", async (_request, reply) => {
    try {
      // Check database
      await pool.query("SELECT 1");

      return reply.send({
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: "connected",
      });
    } catch (error) {
      return reply.status(503).send({
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: "Database connection failed",
      });
    }
  });

  server.get("/ready", async (_request, reply) => {
    return reply.send({
      status: "ready",
      timestamp: new Date().toISOString(),
    });
  });
};
