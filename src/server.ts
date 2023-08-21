import express, { Express, Request, Response } from "express";
import readline from "readline";
import { Logger } from "./logger";
import fs from "fs";
import { IReservationData, IReservationProcessor, LoggerOptions, PackageInfo, ReservationResponse } from "./types";
import { ReservationProcessor } from "./reservationProcessor";
import { generateUUID } from "./helpers";
import { PATHS } from "./paths";
import winston from "winston";
import { RedisDbClient } from "./redisDbClient";
import util from "util";

export class Server {
  private app: Express;
  private port: number;
  private serverInstance: any;
  private logger: Logger;
  private portEnv: number;
  private packageJsonPathEnv: string;
  private readonly defaultPackageJsonPath: string = "./package.json";
  private reservationProcessor: IReservationProcessor;
  private consoleInterface: readline.Interface;
  private redisClient: RedisDbClient;
  private ListenerClient: RedisDbClient;
  private availableData: { [key: string]: boolean } = {};
  private readonly REDIS_URL = process.env.REDIS_URL || "";

  constructor(port: number = 3000) {
    this.reservationProcessor = new ReservationProcessor();
    this.app = express();
    this.app.use(express.json());

    this.port = port;
    this.portEnv = process.env.PORT_SERVER ? parseInt(process.env.PORT_SERVER) : port;
    this.packageJsonPathEnv = process.env.PACKAGE_JSON_PATH || this.defaultPackageJsonPath;

    this.consoleInterface = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

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
    this.redisClient = new RedisDbClient(this.REDIS_URL);

    this.setupRoutes();
    this.setupRedisListenerClient();
    this.setupConsoleCommands();
  }

  private setupRedisListenerClient(): void {
    this.ListenerClient = new RedisDbClient(this.REDIS_URL);
    this.ListenerClient.subscribe("dataAvailable");
    this.ListenerClient.on("message", (channel, message) => {
      if (channel === "dataAvailable") {
        this.handleDataAvailable(message);
      }
    });
  }

  private setupConsoleCommands(): void {
    this.consoleInterface.on("line", input => {
      if (input === "stop") {
        this.logInfo("Stopping server...");
        this.stopServer();
        this.consoleInterface.close();
      }
    });
  }

  private setupRoutes(): void {
    this.app.post(PATHS.API_RESERVATIONS, async (req: Request, res: Response) => {
      await this.reservationProcessor.initialize();

      const reservationId = generateUUID();
      const reservationData: IReservationData = {
        ...req.body,
        reservation_id: reservationId,
      };

      const isValid = this.isValidReservationData(reservationData);

      if (!isValid.valid) {
        this.logError("Invalid reservation data received");
        return res.status(400).json({ error: "Invalid reservation data" });
      }

      try {
        await this.reservationProcessor.processReservation(reservationData);
        this.logInfo("Reservation processing started");
        this.logInfo(`Received a reservation request: ${reservationData.reservation_id}`);
        const reservation = await this.fetchDataWithDelay(reservationId, 2000);

        res.status(200).json({ message: `Reservation received. Status: ${reservation.status}` });
      } catch (error) {
        this.logError(`Failed to start reservation processing: ${error.message}`);
        res.status(500).json({ error: "Failed to start reservation processing" });
      }
    });

    this.app.get(PATHS.STATUS, (req: Request, res: Response) => {
      this.logInfo("Status requested");
      res.status(200).send("Server is running");
    });

    this.app.get(PATHS.INFO, async (req: Request, res: Response) => {
      this.logInfo("Info requested");

      try {
        const info = await this.getPackageInfo();
        res.status(200).json(info);
      } catch (error) {
        this.logError(`Error reading package.json ${error.message}`);
        res.status(500).send(`An error occurred while processing the request: ${error.message}`);
      }
    });
  }

  private async handleDataAvailable(key: string): Promise<void> {
    this.availableData[key] = true;
    this.logInfo(`Data available for key: ${key}`);
  }

  public async getReservationObjectByKey(key: string): Promise<ReservationResponse | null> {
    if (this.availableData[key]) {
      return await this.redisClient.getReservation(key);
    } else {
      this.logInfo(`Data for key ${key} is not available yet`);
      return null;
    }
  }

  async fetchDataWithDelay(key: string, delayMs: number): Promise<ReservationResponse | null> {
    for (let i = 0; i < 10; i++) {
      const reservation = await this.getReservationObjectByKey(key);
      if (reservation) {
        this.logInfo(`Received data: ${reservation.reservation_id}`);
        this.availableData[key] = false;
        return reservation;
      } else {
        this.logInfo("Data not available yet. Waiting...");
        await this.sleep(delayMs);
      }
    }

    this.availableData[key] = false;
    return null;
  }

  sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  public startServer(): void {
    this.serverInstance = this.app.listen(this.portEnv, () => {
      this.logInfo(`Server is running on port ${this.portEnv}`);
    });
  }

  public async stopServer(): Promise<void> {
    if (this.serverInstance) {
      try {
        const closeAsync = util.promisify(this.serverInstance.close.bind(this.serverInstance));
        await closeAsync();
        this.logInfo("Server stopped");
        this.consoleInterface.close();
      } catch (error) {
        this.logError(`Error during server stop: ${error.message}`);
      }
    }
  }

  private async getPackageInfo(): Promise<PackageInfo> {
    try {
      const data = await fs.promises.readFile(this.packageJsonPathEnv, "utf8");
      return JSON.parse(data);
    } catch (error) {
      this.logError(`Error reading package.json: ${error.message}`);
      throw new Error(`An error occurred while reading package.json: ${error.message}`);
    }
  }

  private isValidReservationData(message: any): { valid: boolean; error?: string } {
    this.logInfo(`Validating reservation data: ${message.user_id}`);

    if (typeof message !== "object" || message === null) {
      const errorMessage = "Invalid reservation data: not an object or null.";
      this.logWarn(errorMessage);
      return { valid: false, error: errorMessage };
    }

    const validGuestTypes = ["Regular Guest", "VIP Guest", "Loyalty Program Member"];

    if (
      typeof message.user_id !== "string" ||
      typeof message.restaurant_id !== "string" ||
      typeof message.date !== "string" ||
      typeof message.time !== "string" ||
      typeof message.party_size !== "number" ||
      !validGuestTypes.includes(message.guest_type)
    ) {
      const errorMessage = "Invalid reservation data: missing or incorrect fields.";
      this.logWarn(errorMessage);
      return { valid: false, error: errorMessage };
    }

    if (message.children) {
      if (typeof message.children.count !== "number" || !Array.isArray(message.children.ages)) {
        const errorMessage = "Invalid reservation data: children field has incorrect format.";
        this.logWarn(errorMessage);
        return { valid: false, error: errorMessage };
      }
    }

    if (message.contact_info) {
      if (!(typeof message.contact_info.phone === "string" || typeof message.contact_info.email === "string")) {
        const errorMessage = "Invalid reservation data: contact_info field has incorrect format.";
        this.logWarn(errorMessage);
        return { valid: false, error: errorMessage };
      }
    }

    this.logInfo("Reservation data is valid.");
    return { valid: true };
  }

  private logInfo(message: string): void {
    this.logger.info(`[Server] ${message}`);
  }

  private logError(message: string): void {
    this.logger.error(`[Server] ${message}`);
  }

  private logWarn(message: string): void {
    this.logger.warn(`[Server] ${message}`);
  }
}
