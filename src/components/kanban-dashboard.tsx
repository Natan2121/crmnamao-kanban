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
    columns: payload.columns.map(column => ({
      id: column.id,
      title: column.title,
      color: column.color,
      stageName: column.title,
      cards: column.cards.map(card => ({
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
      column =>
        ({
          ...column,
          cards: column.cards.map(card =>
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

function StatPill({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="min-w-[150px] rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold leading-none text-slate-950">
        {value}
      </p>
      <p className="mt-1 text-xs text-slate-600">{detail}</p>
    </article>
  );
}

function LoadingBoard() {
  return (
    <div className="grid min-w-max grid-flow-col gap-4 overflow-x-auto pb-3">
      {Array.from({ length: 4 }).map((_, columnIndex) => (
        <div
          key={columnIndex}
          className="flex h-[520px] w-[280px] flex-col gap-3 rounded-[24px] border border-slate-200 bg-white p-3"
        >
          <div className="h-5 w-40 animate-pulse rounded-full bg-slate-200" />
          {Array.from({ length: 4 }).map((__, cardIndex) => (
            <div
              key={cardIndex}
              className="h-28 animate-pulse rounded-[18px] bg-slate-100"
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
        column => column.id === destination.toColumnId,
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
      payload?.pipelines.find(pipeline => pipeline.id === selectedPipelineId) ?? null,
    [payload, selectedPipelineId],
  );

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <div className="mx-auto flex max-w-[1880px] flex-col gap-4 px-4 py-4 md:px-5">
        <header className="sticky top-0 z-20 rounded-[28px] border border-slate-200 bg-white/95 p-4 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                CRMnaMao
              </p>
              <h1 className="mt-1 font-[family:var(--font-display)] text-3xl leading-none text-slate-950">
                Kanban
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                Quadro principal conectado as conversas do Chatwoot.
              </p>
            </div>

            <div className="flex flex-col gap-3 md:flex-row md:items-end">
              <label className="flex min-w-[240px] flex-col gap-1.5 text-sm text-slate-600">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Funil
                </span>
                <select
                  className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-900 outline-none transition focus:border-sky-400"
                  onChange={handlePipelineChange}
                  value={selectedPipelineId ?? undefined}
                >
                  {payload?.pipelines.map(pipeline => (
                    <option key={pipeline.id} value={pipeline.id}>
                      {pipeline.name}
                      {pipeline.isMain ? " (principal)" : ""}
                    </option>
                  ))}
                </select>
              </label>

              <button
                className="h-11 rounded-2xl border border-slate-950 bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isLoading}
                onClick={() => void loadBoard(selectedPipelineId, true)}
                type="button"
              >
                {isLoading ? "Atualizando..." : "Atualizar"}
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <StatPill
              label="Cards"
              value={String(payload?.metrics.totalCards ?? 0)}
              detail={
                selectedPipeline
                  ? `${selectedPipeline.stageCount} etapas em ${selectedPipeline.name}`
                  : "Sem funil carregado"
              }
            />
            <StatPill
              label="Nao lidas"
              value={String(payload?.metrics.unreadCards ?? 0)}
              detail="Conversas pendentes"
            />
            <StatPill
              label="Canal"
              value={payload?.metrics.channelBreakdown[0]?.label ?? "Sem dado"}
              detail="Canal dominante"
            />
            <StatPill
              label="Ultima sync"
              value={
                payload?.fetchedAt
                  ? new Date(payload.fetchedAt).toLocaleTimeString("pt-BR")
                  : "--:--"
              }
              detail={agentName ?? "Operacao automatica"}
            />
          </div>
        </header>

        {error ? (
          <section className="rounded-[24px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-800 shadow-sm">
            {error}
          </section>
        ) : null}

        <section className="rounded-[28px] border border-slate-200 bg-white p-3 shadow-sm md:p-4">
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
                      className={`kanban-card group flex min-h-[146px] flex-col gap-3 rounded-[20px] border border-slate-200 bg-white p-3 shadow-sm transition ${options.dragging ? "opacity-90" : ""} ${isMoving ? "ring-2 ring-sky-300" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-sm font-semibold text-white">
                            {initialBadge(card.record.title)}
                          </div>
                          <div className="min-w-0">
                            <h2 className="truncate text-sm font-semibold text-slate-950">
                              {card.record.title}
                            </h2>
                            <p className="truncate text-[11px] uppercase tracking-[0.16em] text-slate-500">
                              {card.record.channelLabel} / {card.record.inboxName}
                            </p>
                          </div>
                        </div>

                        {card.record.unreadCount > 0 ? (
                          <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-900">
                            {card.record.unreadCount}
                          </span>
                        ) : null}
                      </div>

                      {card.record.highlights.length ? (
                        <div className="grid gap-1.5">
                          {card.record.highlights.slice(0, 4).map(highlight => (
                            <div
                              key={`${card.id}-${highlight.label}`}
                              className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-2.5 py-2"
                            >
                              <span className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                                {highlight.label}
                              </span>
                              <span className="truncate text-xs font-medium text-slate-800">
                                {highlight.value}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                          {card.record.conversationStatus}
                        </span>
                        {card.record.assigneeName ? (
                          <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-medium text-sky-800">
                            {card.record.assigneeName}
                          </span>
                        ) : null}
                        {price ? (
                          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-medium text-emerald-800">
                            {price}
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-auto flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                        <div>
                          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-slate-400">
                            Atividade
                          </p>
                          <p className="mt-1 text-sm text-slate-700">
                            {formatRelativeTime(card.record.lastActivityAt)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[11px] text-slate-500">
                            Lead {card.record.leadId ?? card.record.id}
                          </p>
                        </div>
                        <a
                          className="rounded-full border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-800 transition hover:border-slate-950 hover:bg-slate-950 hover:text-white"
                          href={card.record.openUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Abrir
                        </a>
                      </div>
                    </article>
                  );
                }}
                renderColumnHeader={column => {
                  const typedColumn = column as BoardColumn;

                  return (
                    <header className="mb-3 flex items-center justify-between gap-3 rounded-[20px] border border-slate-200 bg-slate-50 px-3 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={{ backgroundColor: typedColumn.color }}
                        />
                        <div className="min-w-0">
                          <h3 className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700">
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
