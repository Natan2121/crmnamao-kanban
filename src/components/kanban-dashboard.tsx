"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ControlledBoard,
  type Card,
  type Column,
  type OnDragEndNotification,
} from "@caldwell619/react-kanban";

import {
  BoardResponse,
  KanbanCardData,
  KanbanCardDetail,
} from "@/lib/types";

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
  stageId: number | null;
  stageKind: KanbanCardData["stageKind"];
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
      stageId: column.stageId,
      stageKind: column.stageKind,
      cards: column.cards.map((card) => ({
        id: String(card.id),
        title: card.title,
        description: card.description,
        record: card,
      })),
    })),
  };
}

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "R$ 0";
  }

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

function moveCardBetweenColumns(
  board: BoardState,
  cardId: string,
  destinationColumnId: string,
  destinationPosition = 0,
) {
  const sourceColumnIndex = board.columns.findIndex((column) =>
    column.cards.some((card) => card.id === cardId),
  );
  const destinationColumnIndex = board.columns.findIndex(
    (column) => column.id === destinationColumnId,
  );

  if (sourceColumnIndex === -1 || destinationColumnIndex === -1) {
    return board;
  }

  const sourceColumn = board.columns[sourceColumnIndex];
  const destinationColumn = board.columns[destinationColumnIndex];
  const cardIndex = sourceColumn.cards.findIndex((card) => card.id === cardId);

  if (cardIndex === -1) {
    return board;
  }

  const sourceCards = [...sourceColumn.cards];
  const destinationCards =
    sourceColumnIndex === destinationColumnIndex
      ? sourceCards
      : [...destinationColumn.cards];
  const [card] = sourceCards.splice(cardIndex, 1);

  const updatedCard: BoardCard = {
    ...card,
    record: {
      ...card.record,
      stageName: destinationColumn.stageName,
      stageId: destinationColumn.stageId,
      stageKind: destinationColumn.stageKind,
      stageColor: destinationColumn.color,
    },
  };

  const boundedPosition = Math.max(
    0,
    Math.min(destinationPosition, destinationCards.length),
  );
  destinationCards.splice(boundedPosition, 0, updatedCard);

  return {
    columns: board.columns.map((column, index) => {
      if (index === sourceColumnIndex && index === destinationColumnIndex) {
        return {
          ...column,
          cards: destinationCards,
        } satisfies BoardColumn;
      }

      if (index === sourceColumnIndex) {
        return {
          ...column,
          cards: sourceCards,
        } satisfies BoardColumn;
      }

      if (index === destinationColumnIndex) {
        return {
          ...column,
          cards: destinationCards,
        } satisfies BoardColumn;
      }

      return column;
    }),
  } satisfies BoardState;
}

function summarizeBoard(board: BoardState) {
  return board.columns.reduce(
    (summary, column) => {
      const columnValue = column.cards.reduce(
        (sum, card) => sum + (card.record.price ?? 0),
        0,
      );

      summary.totalCards += column.cards.length;
      summary.totalValue += columnValue;

      if (column.stageKind === "won") {
        summary.wonCards += column.cards.length;
        summary.wonValue += columnValue;
      }

      if (column.stageKind === "lost") {
        summary.lostCards += column.cards.length;
        summary.lostValue += columnValue;
      }

      return summary;
    },
    {
      totalCards: 0,
      totalValue: 0,
      wonCards: 0,
      wonValue: 0,
      lostCards: 0,
      lostValue: 0,
    },
  );
}

function columnValue(column: BoardColumn) {
  return column.cards.reduce((sum, card) => sum + (card.record.price ?? 0), 0);
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

function DetailLoadingState() {
  return (
    <div className="grid gap-4">
      {Array.from({ length: 3 }).map((_, sectionIndex) => (
        <section
          key={sectionIndex}
          className="rounded-[24px] border border-slate-200 bg-slate-50 p-4"
        >
          <div className="mb-4 h-4 w-28 animate-pulse rounded-full bg-slate-200" />
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((__, fieldIndex) => (
              <div
                key={fieldIndex}
                className="rounded-[18px] bg-white p-3 shadow-sm"
              >
                <div className="h-3 w-24 animate-pulse rounded-full bg-slate-200" />
                <div className="mt-3 h-4 w-32 animate-pulse rounded-full bg-slate-200" />
              </div>
            ))}
          </div>
        </section>
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

function findCardRecord(board: BoardState, cardId: number | null) {
  if (cardId === null) {
    return null;
  }

  for (const column of board.columns) {
    const match = column.cards.find((card) => card.record.id === cardId);
    if (match) {
      return match.record;
    }
  }

  return null;
}

function resolveDrawerTitle(card: KanbanCardData, detail: KanbanCardDetail | null) {
  return (
    detail?.companyNames[0] ??
    detail?.contactNames[0] ??
    detail?.leadName ??
    card.title
  );
}

export function KanbanDashboard() {
  const [payload, setPayload] = useState<BoardResponse | null>(null);
  const [board, setBoard] = useState<BoardState>({ columns: [] });
  const [selectedPipelineId, setSelectedPipelineId] = useState<number | null>(
    null,
  );
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);
  const [detailCache, setDetailCache] = useState<Record<number, KanbanCardDetail>>(
    {},
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [movingCardId, setMovingCardId] = useState<string | null>(null);
  const [appKey, setAppKey] = useState("");

  const selectedCard = useMemo(
    () => findCardRecord(board, selectedCardId),
    [board, selectedCardId],
  );
  const boardSummary = useMemo(() => summarizeBoard(board), [board]);
  const selectedDetail = selectedCard ? detailCache[selectedCard.id] ?? null : null;
  const wonColumn = useMemo(
    () => board.columns.find((column) => column.stageKind === "won") ?? null,
    [board],
  );
  const lostColumn = useMemo(
    () => board.columns.find((column) => column.stageKind === "lost") ?? null,
    [board],
  );
  const hasCompanySection =
    selectedDetail?.sections.some((section) =>
      section.title.toLowerCase().includes("empresa"),
    ) ?? false;

  const loadBoard = useCallback(async (pipelineId?: number | null, force = false) => {
    const activeKey = resolveAppKey();
    setAppKey(activeKey);
    setSelectedCardId(null);
    setDetailError(null);

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
    setAppKey(resolveAppKey());
  }, []);

  const openCardSummary = useCallback(
    async (card: KanbanCardData) => {
      const activeKey = appKey || resolveAppKey();
      setSelectedCardId(card.id);
      setDetailError(null);

      if (!activeKey) {
        setDetailError("Falta o appKey no hash da URL do dashboard app.");
        return;
      }

      if (detailCache[card.id]) {
        return;
      }

      setIsDetailLoading(true);

      try {
        const response = await fetch(`/api/board/card?conversationId=${card.id}`, {
          cache: "no-store",
          headers: {
            "x-kanban-app-key": activeKey,
          },
        });
        const data = (await response.json()) as KanbanCardDetail & {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(data.error ?? "Nao foi possivel carregar o resumo.");
        }

        setDetailCache((current) => ({
          ...current,
          [card.id]: data,
        }));
      } catch (loadError) {
        setDetailError(
          loadError instanceof Error
            ? loadError.message
            : "Nao foi possivel carregar o resumo.",
        );
      } finally {
        setIsDetailLoading(false);
      }
    },
    [appKey, detailCache],
  );

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
      const nextBoard = moveCardBetweenColumns(
        board,
        card.id,
        destinationColumn.id,
        destination.toPosition,
      );

      setBoard(nextBoard);
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

  const moveSelectedCardToOutcome = useCallback(
    async (outcome: "won" | "lost") => {
      if (!selectedCard || !selectedPipelineId) {
        return;
      }

      const destinationColumn = outcome === "won" ? wonColumn : lostColumn;
      if (!destinationColumn) {
        setError(
          outcome === "won"
            ? "Este funil nao possui etapa de venda ganha."
            : "Este funil nao possui etapa de venda perdida.",
        );
        return;
      }

      const previousBoard = board;
      const nextBoard = moveCardBetweenColumns(
        board,
        String(selectedCard.id),
        destinationColumn.id,
        0,
      );

      setBoard(nextBoard);
      setMovingCardId(String(selectedCard.id));
      setError(null);

      try {
        const response = await fetch("/api/board/move", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-kanban-app-key": appKey,
          },
          body: JSON.stringify({
            conversationId: selectedCard.id,
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
    [appKey, board, lostColumn, selectedCard, selectedPipelineId, wonColumn],
  );

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <div className="mx-auto flex max-w-[1880px] flex-col gap-4 px-4 py-4 md:px-5">
        <header className="sticky top-3 z-20 rounded-[22px] border border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                CRMnaMao
              </p>
              <h1 className="mt-1 font-[family:var(--font-display)] text-2xl leading-none text-slate-950">
                Funis
              </h1>
            </div>

            <label className="flex min-w-[220px] flex-col gap-1 text-sm text-slate-600 md:max-w-[360px]">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Funil
              </span>
              <select
                className="h-10 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-900 outline-none transition focus:border-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isLoading || !payload?.pipelines.length}
                onChange={handlePipelineChange}
                value={selectedPipelineId ?? undefined}
              >
                {payload?.pipelines.map((pipeline) => (
                  <option key={pipeline.id} value={pipeline.id}>
                    {pipeline.name}
                    {pipeline.isMain ? " (principal)" : ""}
                    {` • ${formatMoney(pipeline.totalValue)}`}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            <div className="rounded-full bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700">
              Funil: <span className="font-semibold text-slate-950">{formatMoney(boardSummary.totalValue)}</span> <span className="text-slate-500">({boardSummary.totalCards} cards)</span>
            </div>
            <div className="rounded-full bg-emerald-100 px-3 py-2 text-xs font-medium text-emerald-900">
              Ganha: <span className="font-semibold">{formatMoney(boardSummary.wonValue)}</span> <span className="text-emerald-800/80">({boardSummary.wonCards})</span>
            </div>
            <div className="rounded-full bg-rose-100 px-3 py-2 text-xs font-medium text-rose-900">
              Perdida: <span className="font-semibold">{formatMoney(boardSummary.lostValue)}</span> <span className="text-rose-800/80">({boardSummary.lostCards})</span>
            </div>
            <div className="rounded-full bg-sky-100 px-3 py-2 text-xs font-medium text-sky-900">
              Geral: <span className="font-semibold">{formatMoney(payload?.metrics.overallValue)}</span> <span className="text-sky-800/80">({payload?.metrics.overallCards ?? 0} cards)</span>
            </div>
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
                  const price = formatMoney(card.record.price ?? 0);
                  const isMoving = movingCardId === card.id;
                  const isSelected = selectedCardId === card.record.id;

                  return (
                    <article
                      aria-label={`Abrir resumo de ${card.record.title}`}
                      aria-pressed={isSelected}
                      className={`kanban-card group flex min-h-[146px] cursor-pointer flex-col gap-3 rounded-[20px] border border-slate-200 bg-white p-3 text-left shadow-sm transition ${options.dragging ? "opacity-90" : ""} ${isMoving ? "ring-2 ring-sky-300" : ""} ${isSelected ? "border-slate-950 ring-1 ring-slate-950/10" : "hover:border-slate-300 hover:shadow-md"}`}
                      onClick={() => {
                        if (!options.dragging) {
                          void openCardSummary(card.record);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (options.dragging) {
                          return;
                        }

                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          void openCardSummary(card.record);
                        }
                      }}
                      role="button"
                      tabIndex={0}
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
                          {card.record.highlights.slice(0, 4).map((highlight) => (
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
                        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-medium text-emerald-800">
                          Valor {price}
                        </span>
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
                          onClick={(event) => {
                            event.stopPropagation();
                          }}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Abrir
                        </a>
                      </div>
                    </article>
                  );
                }}
                renderColumnHeader={(column) => {
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
                          <p className="text-xs font-semibold text-slate-900">
                            {formatMoney(columnValue(typedColumn))}
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

      {selectedCard ? (
        <div className="fixed inset-0 z-40 flex justify-end">
          <button
            aria-label="Fechar resumo"
            className="flex-1 bg-slate-950/20 backdrop-blur-[1px]"
            onClick={() => {
              setSelectedCardId(null);
              setDetailError(null);
            }}
            type="button"
          />
          <aside className="relative flex h-full w-full max-w-[460px] flex-col border-l border-slate-200 bg-white shadow-2xl">
            <header className="border-b border-slate-200 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                    Resumo
                  </p>
                  <h2 className="mt-2 text-xl font-semibold text-slate-950">
                    {resolveDrawerTitle(selectedCard, selectedDetail)}
                  </h2>
                  {selectedDetail?.leadName &&
                  selectedDetail.leadName !== resolveDrawerTitle(selectedCard, selectedDetail) ? (
                    <p className="mt-1 text-sm text-slate-600">
                      {selectedDetail.leadName}
                    </p>
                  ) : null}
                </div>

                <button
                  aria-label="Fechar resumo"
                  className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-950 hover:bg-slate-950 hover:text-white"
                  onClick={() => {
                    setSelectedCardId(null);
                    setDetailError(null);
                  }}
                  type="button"
                >
                  Fechar
                </button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-700">
                  {selectedCard.stageName}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-700">
                  {selectedCard.pipelineName}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-700">
                  {selectedCard.channelLabel}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-700">
                  {selectedCard.conversationStatus}
                </span>
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-semibold text-emerald-800">
                  Valor {formatMoney(selectedCard.price ?? 0)}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!wonColumn || movingCardId === String(selectedCard.id) || selectedCard.stageKind === "won"}
                  onClick={() => {
                    void moveSelectedCardToOutcome("won");
                  }}
                  type="button"
                >
                  Venda ganha
                </button>
                <button
                  className="rounded-full bg-rose-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!lostColumn || movingCardId === String(selectedCard.id) || selectedCard.stageKind === "lost"}
                  onClick={() => {
                    void moveSelectedCardToOutcome("lost");
                  }}
                  type="button"
                >
                  Venda perdida
                </button>
                <a
                  className="inline-flex rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-800 transition hover:border-slate-950 hover:bg-slate-950 hover:text-white"
                  href={selectedCard.openUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Abrir conversa completa
                </a>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {detailError ? (
                <section className="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  {detailError}
                </section>
              ) : null}

              {isDetailLoading && !selectedDetail ? (
                <DetailLoadingState />
              ) : selectedDetail ? (
                <div className="grid gap-4">
                  {!hasCompanySection ? (
                    <section className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                      Nenhuma empresa vinculada no Kommo para este card. O resumo
                      abaixo foi montado com lead e contato.
                    </section>
                  ) : null}

                  {selectedDetail.sections.map((section) => (
                    <section
                      key={section.id}
                      className="rounded-[24px] border border-slate-200 bg-slate-50 p-4"
                    >
                      <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        {section.title}
                      </h3>
                      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                        {section.fields.map((field) => (
                          <div
                            key={`${section.id}-${field.label}-${field.value}`}
                            className="rounded-[18px] bg-white p-3 shadow-sm"
                          >
                            <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                              {field.label}
                            </dt>
                            <dd className="mt-2 text-sm font-medium text-slate-900">
                              {field.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  ))}
                </div>
              ) : (
                <section className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  Clique em um card para carregar o resumo.
                </section>
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </main>
  );
}
