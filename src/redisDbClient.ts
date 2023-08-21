import { Logger } from "./logger";
import { LoggerOptions } from "./types";
import winston from "winston";
import Redis, { Redis as RedisClient } from "ioredis";

export class RedisDbClient {
  private redisClient: RedisClient;
  private logger: Logger;
  private isConnected: boolean = false;
  private isConnecting: boolean = false;

  constructor(REDIS_URL: string) {
    const loggerOptions: LoggerOptions = {
      level: "debug",
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
          return `${timestamp} [${level.toUpperCase()}]: ${message}`;
        })
      ),
    };

    this.logger = new Logger(loggerOptions);
    this.redisClient = new Redis(REDIS_URL);
  }

  public async connect(): Promise<void> {
    if (this.isConnected) {
      this.logInfo("Already connected");
      return;
    }

    if (this.isConnecting) {
      this.logInfo("Already connecting...");
      return;
    }

    try {
      this.isConnecting = true;
      await this.redisClient.connect();
      this.isConnected = true;
      this.logInfo("Connected");
    } catch (error) {
      this.logError(`Failed to connect: ${error.message}`);
    } finally {
      this.isConnecting = false;
    }
  }

  public async disconnect(): Promise<void> {
    if (!this.isConnected) {
      this.logInfo("Already disconnected");
      return;
    }

    try {
      await this.redisClient.disconnect();
      this.isConnected = false;
      this.logInfo("Disconnected");
    } catch (error) {
      this.logError(`Failed to disconnect: ${error.message}`);
    }
  }

  public async getReservation(key: string): Promise<any | null> {
    try {
      const serialized = await this.redisClient.get(key);
      if (serialized) {
        return JSON.parse(serialized);
      }
      return null;
    } catch (error) {
      this.logError(`Error getting reservation: ${error}`);
      return null;
    }
  }

  public async setReservation(key: string, data: any): Promise<void> {
    const serialized = JSON.stringify(data);
    await this.redisClient.set(key, serialized);
  }

  public async publish(channel: string, message: string): Promise<void> {
    await this.redisClient.publish(channel, message);
  }

  public subscribe(channel: string): void {
    try {
      this.redisClient.subscribe(channel);
    } catch (error) {
      this.logError(`Error subscribing to channel ${channel}: ${error.message}`);
    }
  }

  public on(event: string, listener: (channel: string, message: string) => void): void {
    try {
      this.redisClient.on(event, listener);
    } catch (error) {
      this.logError(`Error setting up event listener for ${event}: ${error.message}`);
    }
  }

  private logInfo(message: string): void {
    this.logger.info(`[Redis] ${message}`);
  }

  private logError(message: string): void {
    this.logger.error(`[Redis] ${message}`);
  }
}
