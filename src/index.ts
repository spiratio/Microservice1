import { Server } from "./server";
import dotenv from "dotenv";
dotenv.config();

const server = new Server(3000);
server.startServer();
