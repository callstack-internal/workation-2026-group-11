import type { Message } from "@workation/shared";
import { createMessage, getHealth, getMessages } from "../api";

const statusEl = document.getElementById("status") as HTMLSpanElement;
const formEl = document.getElementById("message-form") as HTMLFormElement;
const inputEl = document.getElementById("message-input") as HTMLInputElement;
const listEl = document.getElementById("messages") as HTMLUListElement;

function renderMessages(messages: Message[]): void {
  listEl.replaceChildren();
  for (const message of messages) {
    const li = document.createElement("li");
    li.textContent = message.text;

    const time = document.createElement("time");
    time.dateTime = message.createdAt;
    time.textContent = new Date(message.createdAt).toLocaleString();
    li.appendChild(time);

    listEl.appendChild(li);
  }
}

async function refreshHealth(): Promise<void> {
  try {
    await getHealth();
    statusEl.dataset.state = "ok";
    statusEl.textContent = "connected";
  } catch {
    statusEl.dataset.state = "error";
    statusEl.textContent = "offline";
  }
}

async function refreshMessages(): Promise<void> {
  try {
    const { messages } = await getMessages();
    renderMessages(messages);
  } catch {
    // Leave the list as-is; the status badge already reflects connectivity.
  }
}

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;

  try {
    await createMessage(text);
    inputEl.value = "";
    await refreshMessages();
  } catch {
    statusEl.dataset.state = "error";
    statusEl.textContent = "send failed";
  }
});

void refreshHealth();
void refreshMessages();
