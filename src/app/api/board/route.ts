import { NextRequest, NextResponse } from "next/server";

import { buildBoardResponse } from "@/lib/board";
import { assertAppAccess } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    assertAppAccess(request);
    const pipelineId = request.nextUrl.searchParams.get("pipelineId");
    const refresh = request.nextUrl.searchParams.get("refresh") === "1";
    const board = await buildBoardResponse(
      pipelineId ? Number(pipelineId) : null,
      refresh,
    );

    return NextResponse.json(board);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha ao montar o kanban.";

    return NextResponse.json(
      { error: message },
      { status: message === "Nao autorizado." ? 401 : 500 },
    );
  }
}
