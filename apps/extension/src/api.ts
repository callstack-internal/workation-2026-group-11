import {
  API_ROUTES,
  type CreateMessageRequest,
  type HealthResponse,
  type Message,
  type MessagesResponse,
} from "@workation/shared";
import { SERVER_URL } from "./config";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>(API_ROUTES.health);
}

export function getMessages(): Promise<MessagesResponse> {
  return request<MessagesResponse>(API_ROUTES.messages);
}

export function createMessage(text: string): Promise<Message> {
  const body: CreateMessageRequest = { text };
  return request<Message>(API_ROUTES.messages, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
