import { Logger } from "./logger";
import * as amqp from "amqplib";
import { RabbitMQConnection } from "./rabbitMQClient";
import { GUEST_STATUS, IReservationData, IReservationProcessor, LoggerOptions, ReservationResponse } from "./types";
import winston from "winston";
import { RedisDbClient } from "./redisDbClient";

export class ReservationProcessor implements IReservationProcessor {
  private logger: Logger;
  private rabbitMQConnection: RabbitMQConnection;
  private rabbitMQChannel: amqp.Channel | null = null;
  private readonly regularQueueName = "regular_guest_processing_queue";
  private readonly vipQueueName = "vip_guest_processing_queue";
  private readonly loyaltyQueueName = "loyalty_member_processing_queue";
  private readonly bookingQueueName = "booking_processing_results";
  private redisClient: RedisDbClient;
  REDIS_URL = process.env.REDIS_URL;

  constructor() {
    this.rabbitMQConnection = RabbitMQConnection.getInstance();

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
    this.setupConnections();
  }

  private setupConnections() {
    this.setupRabbitMQ();
    this.redisClient = new RedisDbClient(this.REDIS_URL);
  }

  private setupRabbitMQ() {
    this.setupRabbitMQAndStartConsuming();
  }

  public async sendDataAndAvailability(key: string, data: any): Promise<void> {
    try {
      await this.redisClient.setReservation(key, data);
      await this.redisClient.publish("dataAvailable", key);
    } catch (error) {
      this.logError(`Error sending data and availability: ${error}`);
    }
    await this.redisClient.disconnect();
  }

  public async initialize(): Promise<void> {
    try {
      this.setupRabbitMQAndStartConsuming();
    } catch (error) {
      this.logError(`Error during RabbitMQ connection: ${error.message}`);
    }
  }

  private async setupRabbitMQAndStartConsuming() {
    const result = await this.rabbitMQConnection.connect();

    if (result.success && this.rabbitMQConnection.getChannel()) {
      this.rabbitMQChannel = this.rabbitMQConnection.getChannel() as amqp.Channel;
      this.logInfo("Connected to RabbitMQ and obtained channel");
      this.startConsuming();
    } else {
      this.logError(`Failed to connect to RabbitMQ: ${result.error}`);
    }
  }

  private async startConsuming() {
    try {
      this.rabbitMQConnection.subscribeToQueueWithReconnect(this.bookingQueueName, async message => {
        if (message) {
          const reservationResponse: ReservationResponse = JSON.parse(message.content.toString());
          const id = reservationResponse.reservation_id;
          await this.sendDataAndAvailability(id, reservationResponse);
        }
      });
    } catch (error) {
      this.logError(`Error: ${error}`);
    }
  }

  private processGuestReservation(queueName: string, reservationData: IReservationData) {
    try {
      this.rabbitMQConnection.sendMessage(queueName, reservationData);
      this.logInfo(`Processed reservation: ${reservationData.reservation_id}`);
    } catch (error) {
      this.logError(`Error processing reservation: ${error.message}`);
    }
  }

  public async processReservation(reservationData: IReservationData): Promise<void> {
    switch (reservationData.guest_type) {
      case GUEST_STATUS.Regular:
        this.processGuestReservation(this.regularQueueName, reservationData);
        break;
      case GUEST_STATUS.VIP:
        this.processGuestReservation(this.vipQueueName, reservationData);
        break;
      case GUEST_STATUS.Loyalty:
        this.processGuestReservation(this.loyaltyQueueName, reservationData);
        break;
      default:
        this.logWarn(`Unrecognized guest type: ${reservationData.guest_type}`);
    }
  }

  private logInfo(message: string): void {
    this.logger.info(`[ReservationProcessor] ${message}`);
  }

  private logError(message: string): void {
    this.logger.error(`[ReservationProcessor] ${message}`);
  }

  private logWarn(message: string): void {
    this.logger.warn(`[ReservationProcessor] ${message}`);
  }
}
