import { NextResponse } from "next/server";
import { z } from "zod";

import { invalidateBoardCache } from "@/lib/board";
import { fetchConversation, updateConversationCustomAttributes } from "@/lib/chatwoot-api";
import { getPipelineById } from "@/lib/kommo-structure";
import { assertAppAccess } from "@/lib/security";

export const dynamic = "force-dynamic";

const moveSchema = z.object({
  conversationId: z.number().int().positive(),
  pipelineId: z.number().int().positive().optional(),
  stageName: z.string().trim().min(1),
});

export async function POST(request: Request) {
  try {
    assertAppAccess(request);
    const payload = moveSchema.parse(await request.json());
    const pipeline = getPipelineById(payload.pipelineId);
    const isKnownStage = pipeline.statuses.some(
      (status) => status.name === payload.stageName,
    );

    if (!isKnownStage) {
      return NextResponse.json(
        { error: "A etapa escolhida nao existe no funil selecionado." },
        { status: 422 },
      );
    }

    const conversation = await fetchConversation(payload.conversationId);
    const movedAt = new Date().toISOString();
    const customAttributes = {
      ...(conversation.custom_attributes ?? {}),
      kommo_pipeline: pipeline.name,
      kommo_stage: payload.stageName,
      kommo_stage_changed_at: movedAt,
    };

    await updateConversationCustomAttributes(
      payload.conversationId,
      customAttributes,
    );

    const updatedConversation = await fetchConversation(payload.conversationId);
    const persistedStage = updatedConversation.custom_attributes?.kommo_stage;

    if (persistedStage !== payload.stageName) {
      return NextResponse.json(
        { error: "A etapa nao foi persistida no Chatwoot." },
        { status: 502 },
      );
    }

    invalidateBoardCache();

    return NextResponse.json({
      ok: true,
      conversationId: payload.conversationId,
      pipelineId: pipeline.id,
      pipelineName: pipeline.name,
      stageName: payload.stageName,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha ao mover o card.";

    return NextResponse.json(
      { error: message },
      { status: message === "Nao autorizado." ? 401 : 500 },
    );
  }
}
