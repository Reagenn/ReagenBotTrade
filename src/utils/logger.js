const pino = require("pino");
const path = require("path");

// Audit logging is part of the trading system, not an afterthought:
// every signal, order, retry, and breaker event should be durable so the
// strategy can be reviewed after volatile market sessions.
const logger = pino(
  {
    level: process.env.LOG_LEVEL || "info",
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.destination({
    dest: path.resolve(__dirname, "../../data/trading-agent.log"),
    mkdir: true,
    sync: false,
  }),
);

module.exports = logger;
