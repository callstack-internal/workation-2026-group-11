import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import {
  API_ROUTES,
  type CreateMessageRequest,
  type HealthResponse,
  type Message,
  type MessagesResponse,
} from "@workation/shared";
import { computeEventCost } from "./eventCost.js";

const PORT = Number(process.env.PORT ?? 3000);
const startedAt = Date.now();

// In-memory store. Swap for a real database when needed.
const messages: Message[] = [];

const app = express();

// Allow the Chrome extension (and local dev tools) to call the API.
app.use(cors());
app.use(express.json());

app.get(API_ROUTES.health, (_req, res) => {
  const body: HealthResponse = {
    status: "ok",
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  };
  res.json(body);
});

app.get(API_ROUTES.messages, (_req, res) => {
  const body: MessagesResponse = { messages };
  res.json(body);
});

app.post(API_ROUTES.messages, (req, res) => {
  const { text } = req.body as CreateMessageRequest;

  if (typeof text !== "string" || text.trim().length === 0) {
    res.status(400).json({ error: "`text` is required" });
    return;
  }

  const message: Message = {
    id: randomUUID(),
    text: text.trim(),
    createdAt: new Date().toISOString(),
  };
  messages.unshift(message);
  res.status(201).json(message);
});

app.post(API_ROUTES.eventCost, (req, res) => {
  const { status, body } = computeEventCost(req.body);
  res.status(status).json(body);
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
