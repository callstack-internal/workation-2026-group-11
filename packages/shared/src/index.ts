/**
 * Shared API contract between the server and the Chrome extension.
 * Keeping request/response shapes here guarantees both apps stay in sync.
 */

export const API_ROUTES = {
  health: "/api/health",
  messages: "/api/messages",
} as const;

export interface HealthResponse {
  status: "ok";
  uptimeSeconds: number;
  timestamp: string;
}

export interface Message {
  id: string;
  text: string;
  createdAt: string;
}

export interface CreateMessageRequest {
  text: string;
}

export interface MessagesResponse {
  messages: Message[];
}

export interface ApiError {
  error: string;
}
