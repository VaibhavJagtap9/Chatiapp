import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { corsUrl, environment, port } from "./config";
import authRoutes from "./routes/user.routes";
import chatRoutes from "./routes/chat.routes";
import messageRoutes from "./routes/message.routes";
import "./database"; // initialize database
import {
  ApiError,
  ErrorType,
  InternalError,
  RateLimitError,
} from "./core/ApiError";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import { Server as SocketServer } from "socket.io";
import { initSocketIo } from "./socket";
import path from "path";
import { RateLimitRequestHandler, rateLimit } from "express-rate-limit";
import requestIp from "request-ip";

const app = express();
const httpServer = createServer(app);

// ✅ Root Route - visible on browser
app.get("/", (req: Request, res: Response) => {
  res.send("🚀 WELCOME TO RABBIT API! Backend is running successfully.");
});

// Middleware to get client IP
app.use(requestIp.mw());

// Rate limiter
const limiter: RateLimitRequestHandler = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => requestIp.getClientIp(req) || "",
  handler: (req: Request, res: Response, next: NextFunction, options) => {
    next(
      new RateLimitError(
        `You exceeded the request limit. Allowed ${options.max} requests per ${
          options.windowMs / 60000
        } minute.`
      )
    );
  },
});

app.use(limiter);

// App middlewares
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(
  cors({
    origin: corsUrl,
    credentials: true,
    optionsSuccessStatus: 200,
  })
);
app.use(morgan("dev"));
app.use(cookieParser());

// Health check
app.get("/health", (req, res) => {
  res.send("✅ Server is healthy and running");
});

// Routes
app.use("/auth", authRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/messages", messageRoutes);

// Serve public images
app.use("/public", express.static(path.join(__dirname, "..", "public")));

// Socket.io setup
const io = new SocketServer(httpServer, {
  pingTimeout: 60000,
  cors: {
    origin: corsUrl,
    credentials: true,
  },
});

initSocketIo(io);
app.set("io", io);

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof ApiError) {
    ApiError.handle(err, res);
    if (err.type === ErrorType.INTERNAL) {
      console.error(
        `500 - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}\n${err.stack}`
      );
    }
  } else {
    console.error(
      `500 - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}\n${err.stack}`
    );
    if (environment === "development") return res.status(500).send(err.stack);
    ApiError.handle(new InternalError(), res);
  }
});

// ✅ Start server (only for local / Render — not needed for Vercel serverless)
httpServer.listen(port, () => {
  console.log(`⚙️ Server running on port ${port}`);
});

export default httpServer;
