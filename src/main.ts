// Combined entry point: runs API server + BullMQ workers in one process.
// Used for staging to reduce cost (single DO service instead of two).
import "./api/server.js";
import "./workers/index.js";
