"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ControlledBoard,
  moveCard,
  type Card,
  type Column,
  type OnDragEndNotification,
} from "@caldwell619/react-kanban";

import { BoardResponse, KanbanCardData } from "@/lib/types";

interface DashboardAppPayload {
  event?: string;
  data?: {
    currentAgent?: {
      id?: number;
      name?: string;
      email?: string;
    };
  };
}

interface BoardCard extends Card {
  id: string;
  title: string;
  description: string;
  record: KanbanCardData;
}

interface BoardColumn extends Column<BoardCard> {
  id: string;
  color: string;
  stageName: string;
}

interface BoardState {
  columns: BoardColumn[];
}

function buildBoardState(payload: BoardResponse): BoardState {
  return {
    columns: payload.columns.map((column) => ({
      id: column.id,
      title: column.title,
      color: column.color,
      stageName: column.title,
      cards: column.cards.map((card) => ({
        id: String(card.id),
        title: card.title,
        description: card.description,
        record: card,
      })),
    })),
  };
}

function updateCardStage(board: BoardState, cardId: string, stageName: string) {
  return {
    columns: board.columns.map(
      (column) =>
        ({
          ...column,
          cards: column.cards.map((card) =>
            card.id === cardId
              ? {
                  ...card,
                  record: {
                    ...card.record,
                    stageName,
                  },
                }
              : card,
          ),
        }) satisfies BoardColumn,
    ),
  } satisfies BoardState;
}

function formatMoney(value: number | null) {
  if (value === null) {
    return null;
  }

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

function formatRelativeTime(unixSeconds: number) {
  const deltaSeconds = unixSeconds - Math.floor(Date.now() / 1000);
  const formatter = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

  if (Math.abs(deltaSeconds) < 60) {
    return formatter.format(deltaSeconds, "second");
  }

  const deltaMinutes = Math.round(deltaSeconds / 60);
  if (Math.abs(deltaMinutes) < 60) {
    return formatter.format(deltaMinutes, "minute");
  }

  const deltaHours = Math.round(deltaMinutes / 60);
  if (Math.abs(deltaHours) < 24) {
    return formatter.format(deltaHours, "hour");
  }

  const deltaDays = Math.round(deltaHours / 24);
  return formatter.format(deltaDays, "day");
}

function initialBadge(name: string) {
  const clean = name.trim();
  return clean ? clean.charAt(0).toUpperCase() : "?";
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="rounded-[22px] border border-white/60 bg-white/80 p-4 shadow-[0_18px_45px_rgba(15,23,42,0.08)] backdrop-blur">
      <p className="text-xs font-medium uppercase tracking-[0.24em] text-slate-500">
        {label}
      </p>
      <p className="mt-3 text-3xl font-semibold text-slate-950">{value}</p>
      <p className="mt-2 text-sm text-slate-600">{detail}</p>
    </article>
  );
}

function LoadingBoard() {
  return (
    <div className="grid min-w-max grid-flow-col gap-4 overflow-x-auto pb-3">
      {Array.from({ length: 5 }).map((_, columnIndex) => (
        <div
          key={columnIndex}
          className="flex h-[620px] w-[320px] flex-col gap-3 rounded-[28px] border border-white/60 bg-white/70 p-4 backdrop-blur"
        >
          <div className="h-5 w-40 animate-pulse rounded-full bg-slate-200" />
          {Array.from({ length: 4 }).map((__, cardIndex) => (
            <div
              key={cardIndex}
              className="h-36 animate-pulse rounded-[22px] bg-slate-100"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function resolveAppKey() {
  if (typeof window === "undefined") {
    return "";
  }

  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return hash.get("appKey") ?? "";
}

function resolveParentOrigin() {
  if (typeof window === "undefined" || !document.referrer) {
    return null;
  }

  try {
    return new URL(document.referrer).origin;
  } catch {
    return null;
  }
}

export function KanbanDashboard() {
  const [payload, setPayload] = useState<BoardResponse | null>(null);
  const [board, setBoard] = useState<BoardState>({ columns: [] });
  const [selectedPipelineId, setSelectedPipelineId] = useState<number | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [movingCardId, setMovingCardId] = useState<string | null>(null);
  const [agentName, setAgentName] = useState<string | null>(null);
  const [appKey, setAppKey] = useState("");

  const loadBoard = useCallback(async (pipelineId?: number | null, force = false) => {
    const activeKey = resolveAppKey();
    setAppKey(activeKey);

    if (!activeKey) {
      setError("Falta o appKey no hash da URL do dashboard app.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const searchParams = new URLSearchParams();
      if (pipelineId) {
        searchParams.set("pipelineId", String(pipelineId));
      }
      if (force) {
        searchParams.set("refresh", "1");
      }
      const query = searchParams.toString();
      const response = await fetch(`/api/board${query ? `?${query}` : ""}`, {
        cache: "no-store",
        headers: {
          "x-kanban-app-key": activeKey,
        },
      });
      const data = (await response.json()) as BoardResponse & { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Nao foi possivel carregar o quadro.");
      }

      setPayload(data);
      setBoard(buildBoardState(data));
      setSelectedPipelineId(data.selectedPipeline.id);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Nao foi possivel carregar o quadro.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  useEffect(() => {
    const trustedOrigin = resolveParentOrigin();

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) {
        return;
      }

      if (trustedOrigin && event.origin !== trustedOrigin) {
        return;
      }

      if (typeof event.data !== "string") {
        return;
      }

      try {
        const parsed = JSON.parse(event.data) as DashboardAppPayload;
        if (parsed.event !== "appContext") {
          return;
        }

        setAgentName(parsed.data?.currentAgent?.name ?? null);
      } catch {
        // Ignora mensagens que nao pertencem ao bridge do Chatwoot.
      }
    };

    window.addEventListener("message", handleMessage);
    window.parent?.postMessage(
      "chatwoot-dashboard-app:fetch-info",
      trustedOrigin ?? "*",
    );

    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handlePipelineChange = useCallback(
    async (event: React.ChangeEvent<HTMLSelectElement>) => {
      const nextPipelineId = Number(event.target.value);
      setSelectedPipelineId(nextPipelineId);
      await loadBoard(nextPipelineId);
    },
    [loadBoard],
  );

  const handleCardDragEnd: OnDragEndNotification<BoardCard> = useCallback(
    async (card, source, destination) => {
      if (!payload || !selectedPipelineId) {
        return;
      }

      if (!destination || !source) {
        return;
      }

      if (!destination.toColumnId || !source.fromColumnId) {
        return;
      }

      if (
        destination.toColumnId === source.fromColumnId &&
        destination.toPosition === source.fromPosition
      ) {
        return;
      }

      const destinationColumn = board.columns.find(
        (column) => column.id === destination.toColumnId,
      );

      if (!destinationColumn || destinationColumn.id === "stage:unmapped") {
        return;
      }

      const previousBoard = board;
      const movedBoard = moveCard(board, source, destination) as BoardState;
      const stagedBoard = updateCardStage(
        movedBoard,
        card.id,
        destinationColumn.stageName,
      );

      setBoard(stagedBoard);
      setMovingCardId(card.id);
      setError(null);

      try {
        const response = await fetch("/api/board/move", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-kanban-app-key": appKey,
          },
          body: JSON.stringify({
            conversationId: Number(card.id),
            pipelineId: selectedPipelineId,
            stageName: destinationColumn.stageName,
          }),
        });
        const result = (await response.json()) as { error?: string };

        if (!response.ok) {
          throw new Error(result.error ?? "Falha ao mover o card.");
        }
      } catch (moveError) {
        setBoard(previousBoard);
        setError(
          moveError instanceof Error
            ? moveError.message
            : "Falha ao mover o card.",
        );
      } finally {
        setMovingCardId(null);
      }
    },
    [appKey, board, payload, selectedPipelineId],
  );

  const selectedPipeline = useMemo(
    () =>
      payload?.pipelines.find((pipeline) => pipeline.id === selectedPipelineId) ??
      null,
    [payload, selectedPipelineId],
  );

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.95),_rgba(224,242,254,0.9)_35%,_rgba(248,250,252,1)_70%)] text-slate-950">
      <div className="mx-auto flex max-w-[1880px] flex-col gap-6 px-4 py-5 md:px-6">
        <header className="overflow-hidden rounded-[34px] border border-white/70 bg-[linear-gradient(135deg,_rgba(255,255,255,0.9),_rgba(255,247,237,0.92)_40%,_rgba(224,242,254,0.95))] p-6 shadow-[0_30px_80px_rgba(15,23,42,0.12)]">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-4xl">
              <p className="text-xs font-medium uppercase tracking-[0.32em] text-slate-500">
                CRMnaMao Kanban
              </p>
              <h1 className="mt-3 font-[family:var(--font-display)] text-4xl leading-none text-slate-950 md:text-6xl">
                Funil vivo conectado nas conversas.
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600 md:text-base">
                Cada card representa uma conversa real do Chatwoot. Ao mover de
                coluna, o app atualiza a etapa importada do Kommo sem quebrar o
                canal original.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <label className="flex min-w-[240px] flex-col gap-2 text-sm text-slate-600">
                <span className="text-xs font-medium uppercase tracking-[0.24em] text-slate-500">
                  Funil ativo
                </span>
                <select
                  className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-sm font-medium text-slate-900 shadow-sm outline-none transition focus:border-sky-400"
                  onChange={handlePipelineChange}
                  value={selectedPipelineId ?? undefined}
                >
                  {payload?.pipelines.map((pipeline) => (
                    <option key={pipeline.id} value={pipeline.id}>
                      {pipeline.name}
                      {pipeline.isMain ? " (principal)" : ""}
                    </option>
                  ))}
                </select>
              </label>

              <button
                className="rounded-2xl border border-slate-300 bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isLoading}
                onClick={() => void loadBoard(selectedPipelineId, true)}
                type="button"
              >
                {isLoading ? "Atualizando..." : "Atualizar quadro"}
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Cards"
              value={String(payload?.metrics.totalCards ?? 0)}
              detail={
                selectedPipeline
                  ? `${selectedPipeline.stageCount} etapas no funil ${selectedPipeline.name}`
                  : "Sem funil carregado"
              }
            />
            <MetricCard
              label="Nao lidas"
              value={String(payload?.metrics.unreadCards ?? 0)}
              detail="Conversas com mensagens pendentes de leitura"
            />
            <MetricCard
              label="Canais"
              value={String(payload?.metrics.channelBreakdown.length ?? 0)}
              detail={
                payload?.metrics.channelBreakdown[0]
                  ? `Canal dominante: ${payload.metrics.channelBreakdown[0].label}`
                  : "Nenhum canal mapeado"
              }
            />
            <MetricCard
              label="Operacao"
              value={agentName ?? "Autonomo"}
              detail={
                payload?.fetchedAt
                  ? `Base sincronizada ${new Date(payload.fetchedAt).toLocaleTimeString("pt-BR")}`
                  : "Aguardando dados"
              }
            />
          </div>
        </header>

        {error ? (
          <section className="rounded-[24px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-800 shadow-sm">
            {error}
          </section>
        ) : null}

        <section className="rounded-[32px] border border-white/70 bg-white/70 p-3 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur md:p-5">
          {isLoading ? (
            <LoadingBoard />
          ) : (
            <div className="kanban-shell overflow-x-auto pb-2">
              <ControlledBoard<BoardCard>
                allowAddCard={false}
                allowAddColumn={false}
                allowRemoveCard={false}
                allowRemoveColumn={false}
                allowRenameColumn={false}
                disableColumnDrag
                onCardDragEnd={handleCardDragEnd}
                renderCard={(card, options) => {
                  const price = formatMoney(card.record.price);
                  const isMoving = movingCardId === card.id;

                  return (
                    <article
                      className={`kanban-card group flex min-h-[214px] flex-col gap-4 rounded-[24px] border border-slate-200/90 bg-white p-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)] transition ${options.dragging ? "opacity-90" : ""} ${isMoving ? "ring-2 ring-sky-300" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-sm font-semibold text-white">
                            {initialBadge(card.record.title)}
                          </div>
                          <div className="min-w-0">
                            <h2 className="truncate text-base font-semibold text-slate-950">
                              {card.record.title}
                            </h2>
                            <p className="truncate text-xs uppercase tracking-[0.22em] text-slate-500">
                              {card.record.channelLabel} • {card.record.inboxName}
                            </p>
                          </div>
                        </div>

                        {card.record.unreadCount > 0 ? (
                          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">
                            {card.record.unreadCount} novas
                          </span>
                        ) : null}
                      </div>

                      <p className="line-clamp-3 text-sm leading-6 text-slate-600">
                        {card.record.description}
                      </p>

                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                          {card.record.conversationStatus}
                        </span>
                        {card.record.teamName ? (
                          <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-medium text-sky-800">
                            {card.record.teamName}
                          </span>
                        ) : null}
                        {price ? (
                          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
                            {price}
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-auto grid grid-cols-2 gap-3 text-xs text-slate-500">
                        <div>
                          <p className="font-medium uppercase tracking-[0.18em] text-slate-400">
                            Atividade
                          </p>
                          <p className="mt-1 text-sm text-slate-700">
                            {formatRelativeTime(card.record.lastActivityAt)}
                          </p>
                        </div>
                        <div>
                          <p className="font-medium uppercase tracking-[0.18em] text-slate-400">
                            Responsavel
                          </p>
                          <p className="mt-1 truncate text-sm text-slate-700">
                            {card.record.assigneeName ?? "Nao atribuido"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                        <div className="min-w-0">
                          <p className="truncate text-xs text-slate-500">
                            {card.record.contactEmail ?? card.record.contactPhone ?? "Sem email/telefone"}
                          </p>
                          <p className="text-xs text-slate-400">
                            Lead {card.record.leadId ?? card.record.id}
                          </p>
                        </div>
                        <a
                          className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-800 transition hover:border-slate-950 hover:bg-slate-950 hover:text-white"
                          href={card.record.openUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Abrir conversa
                        </a>
                      </div>
                    </article>
                  );
                }}
                renderColumnHeader={(column) => {
                  const typedColumn = column as BoardColumn;

                  return (
                    <header className="mb-3 flex items-center justify-between gap-3 rounded-[22px] border border-white/70 bg-white/80 px-4 py-4 shadow-sm">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={{ backgroundColor: typedColumn.color }}
                        />
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold uppercase tracking-[0.18em] text-slate-700">
                            {typedColumn.title}
                          </h3>
                          <p className="text-xs text-slate-500">
                            {typedColumn.cards.length} card
                            {typedColumn.cards.length === 1 ? "" : "s"}
                          </p>
                        </div>
                      </div>
                    </header>
                  );
                }}
              >
                {board}
              </ControlledBoard>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
