import * as amqp from "amqplib";
import { Logger } from "./logger";
import { IReservationData, LoggerOptions } from "./types";
import winston from "winston";

export class RabbitMQConnection {
  private connection: amqp.Connection | null = null;
  private channel: amqp.Channel | null = null;
  private logger: Logger;
  port = process.env.PORT_RABBITMQ;
  user = process.env.RABBITMQ_USER;
  pass = process.env.RABBITMQ_PASS;
  amqpUrl = `amqp://${this.user}:${this.pass}@localhost:${this.port}`;
  private static instance: RabbitMQConnection | null = null;
  private isReconnecting: boolean = false;

  constructor() {
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
  }

  async connect(): Promise<{ success: boolean; error?: string }> {
    try {
      this.connection = await amqp.connect(this.amqpUrl);
      this.channel = await this.connection.createChannel();
      this.logInfo("Connected to RabbitMQ");
      return { success: true };
    } catch (error) {
      return this.handleErrorAndReturnFailure("Error connecting to RabbitMQ", error);
    }
  }

  public async sendMessage(
    queueName: string,
    message: IReservationData
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.connection) {
      return this.handleErrorAndReturnFailure("No active connection.", new Error("No active connection."));
    }

    if (this.channel === null) {
      return this.handleErrorAndReturnFailure("No active channel.", new Error("No active channel."));
    }

    try {
      await this.channel.assertQueue(queueName, { durable: true });
      this.sendToQueue(queueName, message);
      this.logInfo("Message sent successfully");
      return { success: true };
    } catch (error) {
      return this.handleErrorAndReturnFailure("Error sending message", error);
    }
  }

  public async subscribeToQueueWithReconnect(
    queueName: string,
    callback: (message: amqp.Message | null) => void
  ): Promise<void> {
    this.isReconnecting = true;
    while (this.isReconnecting) {
      try {
        await this.ensureConnectionAndChannel();

        await this.setupChannel(queueName, callback);

        await this.waitFor(5000);
      } catch (error) {
        this.logError(`Error: ${error}`);
      }
    }
  }
  public stopReconnecting(): void {
    this.isReconnecting = false;
  }

  public static getInstance(): RabbitMQConnection {
    if (!this.instance) {
      this.instance = new RabbitMQConnection();
    }
    return this.instance;
  }

  public async sendToQueue(queueName: string, message: IReservationData): Promise<void> {
    try {
      await this.channel?.sendToQueue(queueName, Buffer.from(JSON.stringify(message)), {
        persistent: true,
      });

      this.logInfo(`Message sent: ${message.reservation_id}`);
    } catch (error) {
      this.logError(`Error sending message to queue: ${message.reservation_id}`);
    }
  }

  public getChannel(): amqp.Channel | null {
    return this.channel !== null ? this.channel : null;
  }

  public async closeConnection(): Promise<{
    success: boolean;
    error?: string;
  }> {
    if (this.connection) {
      try {
        await this.connection.close();
        this.logInfo("Connection to RabbitMQ closed successfully");
        return { success: true };
      } catch (error) {
        return this.handleErrorAndReturnFailure("Error closing connection", error);
      }
    } else {
      return this.handleErrorAndReturnFailure("No active connection.", new Error("No active connection."));
    }
  }

  private async ensureConnectionAndChannel(): Promise<void> {
    if (!this.connection || !this.channel) {
      await this.connect();
    }
  }

  private async setupChannel(queueName: string, callback: (message: amqp.Message | null) => void): Promise<void> {
    await this.ensureConnectionAndChannel();

    this.channel.assertQueue(queueName, { durable: true });
    this.channel.consume(queueName, callback, { noAck: true });
  }

  private async waitFor(milliseconds: number): Promise<void> {
    return new Promise<void>(resolve => {
      setTimeout(() => {
        resolve();
      }, milliseconds);
    });
  }

  private handleErrorAndReturnFailure(message: string, error: Error): { success: boolean; error: string } {
    const errorMessage = `${message}: ${error.message}`;
    this.logError(errorMessage);
    return { success: false, error: errorMessage };
  }

  private logInfo(message: string): void {
    this.logger.info(`[RabbitMQ] ${message}`);
  }

  private logError(message: string): void {
    this.logger.error(`[RabbitMQ] ${message}`);
  }
}
