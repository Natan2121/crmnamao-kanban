import { NextResponse } from "next/server";
import { ZodError, z } from "zod";

import { fetchConversation, updateConversationCustomAttributes } from "@/lib/chatwoot-api";
import {
  DEFAULT_TASK_TYPE,
  buildScheduleAttributes,
  normalizeScheduleValue,
  normalizeTaskTypeValue,
  readScheduleFromAttributes,
} from "@/lib/schedule";
import { assertAppAccess } from "@/lib/security";

export const dynamic = "force-dynamic";

const scheduleSchema = z.object({
  conversationId: z.number().int().positive(),
  scheduledAt: z.string().trim().nullable().optional(),
  taskType: z.string().trim().nullable().optional(),
  updatedBy: z.string().trim().max(120).nullable().optional(),
});

export async function POST(request: Request) {
  try {
    assertAppAccess(request);
    const payload = scheduleSchema.parse(await request.json());
    const scheduledAt = normalizeScheduleValue(payload.scheduledAt ?? null);
    const taskType = scheduledAt
      ? (normalizeTaskTypeValue(payload.taskType ?? null) ?? DEFAULT_TASK_TYPE)
      : null;
    const updatedAt = new Date().toISOString();
    const updatedBy =
      typeof payload.updatedBy === "string" && payload.updatedBy.trim()
        ? payload.updatedBy.trim()
        : null;

    const conversation = await fetchConversation(payload.conversationId);
    const customAttributes = buildScheduleAttributes(
      conversation.custom_attributes,
      {
        scheduledAt,
        taskType,
        updatedAt,
        updatedBy,
      },
    );

    await updateConversationCustomAttributes(payload.conversationId, customAttributes);

    const updatedConversation = await fetchConversation(payload.conversationId);
    const persistedSchedule = readScheduleFromAttributes(
      updatedConversation.custom_attributes,
    );

    if (
      persistedSchedule.scheduledAt !== scheduledAt ||
      persistedSchedule.taskType !== taskType
    ) {
      return NextResponse.json(
        { error: "A agenda nao foi persistida no Chatwoot." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      conversationId: payload.conversationId,
      schedule: {
        scheduledAt,
        taskType,
        scheduleUpdatedAt: updatedAt,
        scheduleUpdatedBy: updatedBy,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha ao salvar a agenda.";
    const status =
      message === "Nao autorizado."
        ? 401
        : error instanceof ZodError
          ? 400
          : 500;

    return NextResponse.json(
      { error: message },
      { status },
    );
  }
}
