"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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

function pluralize(value: number, singular: string, plural: string) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function formatStageDuration(unixSeconds: number) {
  const now = Math.floor(Date.now() / 1000);
  const elapsedSeconds = Math.max(0, now - unixSeconds);
  const minute = 60;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;

  if (elapsedSeconds < day) {
    const hours = Math.floor(elapsedSeconds / hour);
    const minutes = Math.floor((elapsedSeconds % hour) / minute);
    return `${hours}h ${minutes}min`;
  }

  if (elapsedSeconds < week) {
    const days = Math.floor(elapsedSeconds / day);
    const hours = Math.floor((elapsedSeconds % day) / hour);
    return `${pluralize(days, "dia", "dias")} ${hours}h`;
  }

  if (elapsedSeconds < month) {
    const weeks = Math.floor(elapsedSeconds / week);
    const days = Math.floor((elapsedSeconds % week) / day);
    return `${pluralize(weeks, "semana", "semanas")} ${pluralize(days, "dia", "dias")}`;
  }

  const months = Math.floor(elapsedSeconds / month);
  const days = Math.floor((elapsedSeconds % month) / day);
  return `${pluralize(months, "mes", "meses")} ${pluralize(days, "dia", "dias")}`;
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
      stageEnteredAt: Math.floor(Date.now() / 1000),
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

function formatShortDate(unixSeconds: number) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "short",
  }).format(new Date(unixSeconds * 1000));
}

function formatElapsedTime(unixSeconds: number) {
  const deltaSeconds = Math.max(
    0,
    Math.floor(Date.now() / 1000) - Math.floor(unixSeconds),
  );

  if (deltaSeconds < 3600) {
    return `${Math.max(1, Math.round(deltaSeconds / 60))}m`;
  }

  if (deltaSeconds < 86400) {
    return `${Math.round(deltaSeconds / 3600)}h`;
  }

  return `${Math.round(deltaSeconds / 86400)}d`;
}

function getInitials(label: string) {
  const parts = label.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const initials = parts.map((part) => part.charAt(0).toUpperCase()).join("");
  return initials || "?";
}

function buildContactMeta(record: KanbanCardData) {
  return (
    record.contactEmail ??
    record.contactPhone ??
    `${record.channelLabel} / ${record.inboxName}`
  );
}

function buildOwnerMeta(record: KanbanCardData) {
  const parts = [record.assigneeName, record.teamName].filter(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );

  return parts.join(" / ") || "Sem responsavel";
}

function getChannelTone(channelLabel: string) {
  const label = channelLabel.toLowerCase();

  if (label.includes("whatsapp")) {
    return {
      badge: "bg-[#edf2f0] text-[#475467]",
      dot: "bg-[#36d579]",
    };
  }

  if (label.includes("email")) {
    return {
      badge: "bg-[#eef2ff] text-[#475467]",
      dot: "bg-[#7c7cff]",
    };
  }

  if (label.includes("site")) {
    return {
      badge: "bg-[#edf4ff] text-[#475467]",
      dot: "bg-[#58a6ff]",
    };
  }

  return {
    badge: "bg-[#eff1f4] text-[#475467]",
    dot: "bg-[#94a3b8]",
  };
}

function getUnreadTone(unreadCount: number) {
  if (unreadCount > 0) {
    return "text-[#b54708]";
  }

  return "text-[#667085]";
}

function CalendarIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      viewBox="0 0 16 16"
    >
      <rect
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
        width="11"
        x="2.5"
        y="3.5"
      />
      <path d="M5 2.5v3M11 2.5v3M2.5 6.5h11" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      viewBox="0 0 16 16"
    >
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 5v3.2l2.2 1.3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      viewBox="0 0 16 16"
    >
      <path
        d="M5 11 11 5M6 5h5v5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-2.5 w-2.5"
      fill="none"
      viewBox="0 0 16 16"
    >
      <path
        d="M5.7 2.8c.3-.4.9-.5 1.4-.3l1.3.7c.5.2.7.8.5 1.3l-.5 1c-.1.3-.1.6.1.9.4.7 1 1.4 1.7 2 .6.6 1.3 1.1 2 1.6.3.2.6.2.9.1l1-.5c.5-.2 1.1 0 1.3.5l.7 1.3c.2.5.1 1.1-.3 1.4l-.9.8c-.5.4-1.2.6-1.8.4-1.7-.4-3.5-1.4-5.2-3.1C7 10.4 6 8.6 5.6 6.9c-.1-.6 0-1.3.4-1.8l.7-.9Z"
        fill="currentColor"
      />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-2.5 w-2.5"
      fill="none"
      viewBox="0 0 16 16"
    >
      <rect
        height="9"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.5"
        width="12"
        x="2"
        y="3.5"
      />
      <path d="m3.5 5 4.5 3 4.5-3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ChannelOverlay({ channelLabel }: { channelLabel: string }) {
  const label = channelLabel.toLowerCase();

  return (
    <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-[#d7dde4] bg-white text-[#475467] shadow-sm">
      {label.includes("email") ? <MailIcon /> : <PhoneIcon />}
    </span>
  );
}

function Avatar({
  imageSrc,
  label,
  size,
  overlay,
}: {
  imageSrc?: string | null;
  label: string;
  size: "lg" | "sm";
  overlay?: ReactNode;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const sizeClass = size === "lg" ? "h-11 w-11 text-[14px]" : "h-9 w-9 text-[11px]";

  return (
    <div
      className={`relative flex ${sizeClass} shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#d7dde4] bg-[#e7eaee] font-semibold uppercase text-[#475467]`}
    >
      {imageSrc && !imageFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={label}
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
          src={imageSrc}
        />
      ) : (
        <span>{getInitials(label)}</span>
      )}
      {overlay}
    </div>
  );
}

function LoadingBoard() {
  return (
    <div className="grid min-w-max grid-flow-col gap-4 overflow-x-auto pb-3">
      {Array.from({ length: 4 }).map((_, columnIndex) => (
        <div
          key={columnIndex}
          className="flex h-[640px] w-[338px] flex-col gap-3 rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,_rgba(250,251,253,0.98),_rgba(243,246,250,0.98))] p-3"
        >
          <div className="h-[72px] animate-pulse rounded-[22px] bg-white" />
          {Array.from({ length: 4 }).map((__, cardIndex) => (
            <div
              key={cardIndex}
              className="h-[172px] animate-pulse rounded-[20px] border border-slate-200 bg-white"
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

  useEffect(() => {
    if (isLoading || typeof window === "undefined") {
      return;
    }

    const scroller = document.querySelector<HTMLElement>(".kanban-scroll");
    if (!scroller) {
      return;
    }

    let frame = 0;

    const syncColumnHeaders = () => {
      frame = 0;
      const targetTop = scroller.getBoundingClientRect().top + 12;

      document.querySelectorAll<HTMLElement>(".react-kanban-column").forEach((column) => {
        const headerHost = column.firstElementChild as HTMLElement | null;
        if (!headerHost) {
          return;
        }

        if (!headerHost.dataset.baseOffset) {
          headerHost.dataset.baseOffset = String(headerHost.offsetTop);
        }

        const maxTranslate = Math.max(
          column.offsetHeight - headerHost.offsetHeight - 12,
          0,
        );
        const naturalTop =
          column.getBoundingClientRect().top +
          Number(headerHost.dataset.baseOffset ?? 0);
        const translateY = Math.min(
          Math.max(targetTop - naturalTop, 0),
          maxTranslate,
        );

        headerHost.style.transform = `translateY(${translateY}px)`;
      });
    };

    const requestSync = () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      frame = window.requestAnimationFrame(syncColumnHeaders);
    };

    requestSync();
    const syncTimers = [
      window.setTimeout(requestSync, 0),
      window.setTimeout(requestSync, 160),
      window.setTimeout(requestSync, 450),
    ];
    scroller.addEventListener("scroll", requestSync, { passive: true });
    window.addEventListener("resize", requestSync);

    return () => {
      scroller.removeEventListener("scroll", requestSync);
      window.removeEventListener("resize", requestSync);
      clearTimeout(syncTimers[0]);
      clearTimeout(syncTimers[1]);
      clearTimeout(syncTimers[2]);
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [board, isLoading]);

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

            <label className="flex min-w-[240px] flex-col gap-1 text-sm text-slate-600 md:max-w-[360px]">
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
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
            Funil <span className="font-semibold text-slate-900">{formatMoney(boardSummary.totalValue)}</span>
            {" | "}
            Ganha <span className="font-semibold text-emerald-700">{formatMoney(boardSummary.wonValue)}</span>
            {" | "}
            Perdida <span className="font-semibold text-rose-700">{formatMoney(boardSummary.lostValue)}</span>
            {" | "}
            Geral <span className="font-semibold text-sky-700">{formatMoney(payload?.metrics.overallValue)}</span>
          </p>
        </header>

        {error ? (
          <section className="rounded-[24px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-800 shadow-sm">
            {error}
          </section>
        ) : null}

        <section className="rounded-[28px] border border-slate-200 bg-white shadow-sm">
          {isLoading ? (
            <div className="p-3 md:p-4">
              <LoadingBoard />
            </div>
          ) : (
            <div className="kanban-scroll h-[calc(100vh-12.5rem)] min-h-[560px] overflow-auto p-3 md:h-[calc(100vh-13rem)] md:p-4">
              <div className="kanban-shell">
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
                  const contactMeta = buildContactMeta(card.record);
                  const ownerMeta = buildOwnerMeta(card.record);
                  const channelTone = getChannelTone(card.record.channelLabel);
                  const isMoving = movingCardId === card.id;
                  const isSelected = selectedCardId === card.record.id;

                  return (
                    <article
                      className={`kanban-card group flex min-h-[168px] flex-col rounded-[20px] border border-slate-200 bg-white px-4 py-3 text-left shadow-[0_10px_24px_rgba(15,23,42,0.06)] transition select-none ${options.dragging ? "cursor-grabbing opacity-95" : "cursor-grab"} ${isMoving ? "ring-2 ring-slate-300" : ""} ${isSelected ? "border-slate-950 ring-1 ring-slate-950/10" : "hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_14px_28px_rgba(15,23,42,0.10)]"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <button
                            aria-pressed={isSelected}
                            className="block max-w-full truncate text-left text-[16px] font-bold leading-tight text-slate-950 transition hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                            onClick={(event) => {
                              event.stopPropagation();
                              void openCardSummary(card.record);
                            }}
                            type="button"
                          >
                            {card.record.title}
                          </button>
                          <p className="mt-1 truncate text-[12px] text-slate-500">
                            {contactMeta}
                          </p>
                        </div>

                        <a
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
                          href={card.record.openUrl}
                          onClick={(event) => {
                            event.stopPropagation();
                          }}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <ArrowIcon />
                        </a>
                      </div>

                      <div className="mt-3 flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <Avatar
                            imageSrc={card.record.contactThumbnail}
                            label={card.record.title}
                            overlay={
                              <ChannelOverlay channelLabel={card.record.channelLabel} />
                            }
                            size="lg"
                          />
                          <div className="min-w-0">
                            <span
                              className={`inline-flex items-center gap-2 rounded-[8px] px-2.5 py-1 text-[12px] font-medium ${channelTone.badge}`}
                            >
                              <span
                                className={`h-2.5 w-2.5 rounded-full ${channelTone.dot}`}
                              />
                              {card.record.channelLabel.toLowerCase()}
                            </span>
                            <p className="mt-2 truncate text-[12px] text-slate-500">
                              {ownerMeta}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-2">
                          <Avatar label={ownerMeta} size="sm" />
                          <p className="text-[12px] font-semibold text-violet-700">
                            {price}
                          </p>
                        </div>
                      </div>

                      {card.record.highlights.length ? (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {card.record.highlights.slice(0, 2).map((highlight) => (
                            <span
                              key={`${card.id}-${highlight.label}`}
                              className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-700"
                            >
                              <span className="truncate font-medium text-slate-500">
                                {highlight.label}
                              </span>
                              <span className="truncate font-semibold text-slate-800">
                                {highlight.value}
                              </span>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-3 h-8" />
                      )}

                      <div className="mt-auto flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-[12px] text-slate-500">
                        <span
                          className={`inline-flex items-center gap-1.5 font-semibold ${getUnreadTone(card.record.unreadCount)}`}
                        >
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{
                              backgroundColor:
                                card.record.unreadCount > 0
                                  ? "#f79009"
                                  : card.record.stageColor,
                            }}
                          />
                          {card.record.unreadCount > 0
                            ? `${card.record.unreadCount} nova${card.record.unreadCount === 1 ? "" : "s"}`
                            : card.record.conversationStatus}
                        </span>

                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
                          <CalendarIcon />
                          {formatShortDate(card.record.createdAt)}
                        </span>

                        <span className="inline-flex items-center gap-1 text-slate-500">
                          <ClockIcon />
                          {formatElapsedTime(card.record.lastActivityAt)}
                        </span>
                      </div>
                    </article>
                  );
                }}
                renderColumnHeader={(column) => {
                  const typedColumn = column as BoardColumn;

                  return (
                    <header className="kanban-column-header rounded-[22px] border border-slate-200 bg-white px-5 py-4 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: typedColumn.color }}
                          />
                          <h3 className="truncate text-[18px] font-bold text-slate-950">
                            {typedColumn.title}
                          </h3>
                        </div>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[13px] font-bold text-slate-700">
                          {typedColumn.cards.length}
                        </span>
                      </div>

                      <div className="mt-2 flex items-center justify-between gap-3 text-[12px] text-slate-500">
                        <span>
                          {typedColumn.cards.length} negocio
                          {typedColumn.cards.length === 1 ? "" : "s"}
                        </span>
                        <span>{formatMoney(columnValue(typedColumn))}</span>
                      </div>
                    </header>
                  );
                }}
              >
                {board}
                </ControlledBoard>
              </div>
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
                <span className="rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-900">
                  Na etapa {formatStageDuration(selectedCard.stageEnteredAt)}
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
