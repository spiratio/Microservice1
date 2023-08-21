import winston, { format } from "winston";
import { LoggerOptions } from "./types";
import util from "util";

const messageFormat = format.combine(
  format.timestamp(),
  format.printf(({ timestamp, level, message }) => {
    return `${timestamp} [${level.toUpperCase()}]: ${message}`;
  })
);

const defaultTransports = [new winston.transports.Console(), new winston.transports.File({ filename: "server.log" })];

const LOG_LEVELS = {
  ERROR: "error",
  WARN: "warn",
  INFO: "info",
  VERBOSE: "verbose",
  DEBUG: "debug",
  SILLY: "silly",
};

export class Logger {
  private logger: winston.Logger;

  constructor(options: LoggerOptions = {}) {
    this.logger = this.setupLogger(options);
  }

  private setupLogger(options: LoggerOptions): winston.Logger {
    const { level = LOG_LEVELS.INFO, format: customFormat, transports: customTransports } = options;

    const logger = winston.createLogger({
      level,
      format: customFormat || messageFormat,
      transports: customTransports || defaultTransports,
    });

    return logger;
  }

  public info(message: string): void {
    this.logger.info(message);
  }

  public warn(message: string): void {
    this.logger.warn(message);
  }

  public error(message: string, error?: Error): void {
    if (error) {
      const errorMessage = error.stack || util.inspect(error);
      this.logger.error(`${message}\n${errorMessage}`);
    } else {
      this.logger.error(message);
    }
  }
}
