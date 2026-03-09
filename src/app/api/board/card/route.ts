import { NextRequest, NextResponse } from "next/server";

import { fetchConversation } from "@/lib/chatwoot-api";
import {
  buildFallbackCardSummary,
  getKommoCardSummary,
  mergeCardSummaries,
} from "@/lib/kommo-card-summaries";
import { assertAppAccess } from "@/lib/security";

export const dynamic = "force-dynamic";

function asLeadId(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

export async function GET(request: NextRequest) {
  try {
    assertAppAccess(request);

    const conversationIdParam = request.nextUrl.searchParams.get("conversationId");
    const conversationId = Number(conversationIdParam);

    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      return NextResponse.json(
        { error: "conversationId invalido." },
        { status: 400 },
      );
    }

    const conversation = await fetchConversation(conversationId);
    const leadId = asLeadId(conversation.custom_attributes?.kommo_lead_id);
    const mergedSummary = mergeCardSummaries(
      getKommoCardSummary(leadId),
      buildFallbackCardSummary(conversation),
    );

    if (!mergedSummary) {
      return NextResponse.json(
        { error: "Nao foi possivel montar o resumo do card." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      conversationId,
      ...mergedSummary,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha ao montar o resumo do card.";

    return NextResponse.json(
      { error: message },
      { status: message === "Nao autorizado." ? 401 : 500 },
    );
  }
}
