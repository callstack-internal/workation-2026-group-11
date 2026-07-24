// A tiny in-page event bus between the two Calendar content scripts.
//
// `calendar.ts` (data) knows when an event opens and fetches its cost;
// `content.ts` (UI) renders it. Both run in the same content-script isolated
// world, so a CustomEvent on `window` is the simplest way to bridge them.

import type { EventCostResponse } from "@workation/shared";

const COST_EVENT = "callcost:cost";

export type CostDetail =
  | { status: "loading"; eventId: string }
  | { status: "ok"; eventId: string; result: EventCostResponse }
  | { status: "error"; eventId: string; message: string };

export function emitCost(detail: CostDetail): void {
  window.dispatchEvent(new CustomEvent<CostDetail>(COST_EVENT, { detail }));
}

export function onCost(handler: (detail: CostDetail) => void): void {
  window.addEventListener(COST_EVENT, (event) => {
    handler((event as CustomEvent<CostDetail>).detail);
  });
}
