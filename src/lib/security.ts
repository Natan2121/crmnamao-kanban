import { timingSafeEqual } from "node:crypto";

import { getServerEnv } from "@/lib/env";

function secureCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function assertAppAccess(request: Request) {
  const { APP_ACCESS_KEY } = getServerEnv();
  const providedKey =
    request.headers.get("x-kanban-app-key") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  if (!providedKey || !secureCompare(providedKey, APP_ACCESS_KEY)) {
    throw new Error("Nao autorizado.");
  }
}
