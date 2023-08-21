import winston from "winston";

export interface IReservationProcessor {
  sendDataAndAvailability(key: string, data: any): Promise<void>;
  initialize(): Promise<void>;
  processReservation(reservationData: IReservationData): Promise<void>;
}

export interface LoggerOptions {
  level?: string;
  format?: winston.Logform.Format;
  transports?: winston.transport[];
}

export interface PackageInfo {
  name: string;
  version: string;
  description: string;
  author: string;
}

export interface IReservationData {
  reservation_id: string;
  user_id: string;
  restaurant_id: string;
  date: string;
  time: string;
  party_size: number;
  guest_type: "Regular Guest" | "VIP Guest" | "Loyalty Program Member";
  preferences?: string;

  loyalty_program?: boolean;
  special_requests?: string;
  children?: {
    count: number;
    ages: number[];
  };
  additional_services?: string[];
  confirmation_method?: string;
  payment_method?: string;
  contact_info?: {
    phone?: string;
    email?: string;
  };
  recommendation_request?: string;
}

export enum ReservationStatus {
  SUCCESS = "SUCCESS",
  NO_TABLE_AVAILABLE = "NO_TABLE_AVAILABLE",
  ERROR = "ERROR",
}

export interface ReservationResponse {
  reservation_id: string;
  status: ReservationStatus;
  message?: string;
}

export const GUEST_STATUS = {
  Regular: "Regular Guest",
  VIP: "VIP Guest",
  Loyalty: "Loyalty Program Member",
} as const;

export type GuestStatus = keyof typeof GUEST_STATUS;
