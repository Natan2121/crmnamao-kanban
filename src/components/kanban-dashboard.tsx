"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from "react";
import {
  ControlledBoard,
  moveCard,
  type Card,
  type Column,
  type OnDragEndNotification,
} from "@caldwell619/react-kanban";

import { KanbanAgenda } from "@/components/kanban-agenda";
import { ScheduleDialog } from "@/components/schedule-dialog";
import { getTaskTypeLabel } from "@/lib/schedule";
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

interface SchedulePatch {
  scheduledAt: string | null;
  taskType: string | null;
  scheduleUpdatedAt: string | null;
  scheduleUpdatedBy: string | null;
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

function updateCardSchedule(
  board: BoardState,
  cardId: string,
  schedule: SchedulePatch,
) {
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
                    ...schedule,
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

function formatClock(isoDate: string | null | undefined) {
  if (!isoDate) {
    return "Aguardando";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoDate));
}

function formatScheduleDateTime(isoDate: string | null | undefined) {
  if (!isoDate) {
    return "Sem agenda";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoDate));
}

function buildContactMeta(record: KanbanCardData) {
  return record.contactPhone ?? record.contactEmail ?? record.inboxName ?? "Sem contato";
}

function getResponsibleLabel(record: KanbanCardData) {
  return record.assigneeName ?? record.teamName ?? "Sem responsavel";
}

function getStatusBadgeClasses(unreadCount: number) {
  if (unreadCount > 0) {
    return "border-[#fed7aa] bg-[#fff4e8] text-[#b54708]";
  }

  return "border-[#dce4ec] bg-[#f5f7fa] text-[#475467]";
}

function getStatusLabel(record: KanbanCardData) {
  if (record.unreadCount > 0) {
    return `${record.unreadCount} novas`;
  }

  return record.conversationStatus;
}

function formatSchedulePill(record: KanbanCardData) {
  if (!record.scheduledAt) {
    return "Sem agenda";
  }

  return `${getTaskTypeLabel(record.taskType)} ${formatClock(record.scheduledAt)}`;
}

function sumColumnValue(cards: BoardCard[]) {
  return cards.reduce((total, card) => total + (card.record.price ?? 0), 0);
}

function getUrgencyTone(record: KanbanCardData) {
  const bucket = getScheduleBucket(record.scheduledAt);

  if (record.priority === "urgent" || bucket === "overdue") {
    return {
      badge: "border-[#fecdca] bg-[#fff1eb] text-[#b42318]",
      label: "Urgente",
    };
  }

  if (
    record.priority === "high" ||
    record.unreadCount > 0 ||
    bucket === "today"
  ) {
    return {
      badge: "border-[#fedf89] bg-[#fffaeb] text-[#b54708]",
      label: "Alta",
    };
  }

  if (record.priority === "medium" || bucket === "upcoming") {
    return {
      badge: "border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]",
      label: "Media",
    };
  }

  return {
    badge: "border-[#d0d5dd] bg-[#f8fafc] text-[#475467]",
    label: "Baixa",
  };
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

function getScheduleBucket(isoDate: string | null | undefined) {
  if (!isoDate) {
    return "unscheduled";
  }

  const timestamp = new Date(isoDate).getTime();
  if (Number.isNaN(timestamp)) {
    return "unscheduled";
  }

  const now = Date.now();
  if (timestamp < now) {
    return "overdue";
  }

  const tomorrow = new Date();
  tomorrow.setHours(24, 0, 0, 0);

  if (timestamp < tomorrow.getTime()) {
    return "today";
  }

  return "upcoming";
}

function getScheduleTone(isoDate: string | null | undefined) {
  const bucket = getScheduleBucket(isoDate);

  if (bucket === "overdue") {
    return {
      badge: "border-[#fecdca] bg-[#fff6ed] text-[#b54708]",
    };
  }

  if (bucket === "today") {
    return {
      badge: "border-[#fedf89] bg-[#fffaeb] text-[#b54708]",
    };
  }

  if (bucket === "upcoming") {
    return {
      badge: "border-[#d6dfff] bg-[#f5f7ff] text-[#3538cd]",
    };
  }

  return {
    badge: "border-[#d0d5dd] bg-[#f8fafc] text-[#475467]",
  };
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

function SummaryItem({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article
      className="inline-flex min-w-0 items-center gap-1 rounded-full border border-[#d7dde4] bg-white px-2 py-[3px] text-[#344054]"
      title={detail}
    >
      <p className="truncate text-[7px] font-bold uppercase tracking-[0.12em] text-[#98a2b3]">
        {label}
      </p>
      <p className="shrink-0 text-[11px] font-bold leading-none text-[#101828]">
        {value}
      </p>
    </article>
  );
}

function LoadingBoard() {
  return (
    <div className="grid min-w-max grid-flow-col gap-4 overflow-x-auto pb-2">
      {Array.from({ length: 5 }).map((_, columnIndex) => (
        <div
          key={columnIndex}
          className="flex h-[610px] w-[324px] flex-col rounded-[18px] border border-[#d7dde4] bg-[#eef1f4] p-1.5"
        >
          <div className="h-[46px] animate-pulse rounded-[14px] bg-white" />
          <div className="mt-1.5 flex flex-col gap-1.5">
            {Array.from({ length: 5 }).map((__, cardIndex) => (
              <div
                key={cardIndex}
                className="h-[126px] animate-pulse rounded-[12px] border border-[#d7dde4] bg-white"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
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
  const [scheduleDialogCard, setScheduleDialogCard] =
    useState<KanbanCardData | null>(null);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const loadBoard = useCallback(
    async (pipelineId?: number | null, force = false) => {
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
        const data = (await response.json()) as BoardResponse & {
          error?: string;
        };

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
    },
    [],
  );

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
    async (event: ChangeEvent<HTMLSelectElement>) => {
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

  const handleOpenSchedule = useCallback((card: KanbanCardData) => {
    setScheduleDialogCard(card);
    setScheduleError(null);
  }, []);

  const handleCloseSchedule = useCallback(() => {
    if (isSavingSchedule) {
      return;
    }

    setScheduleDialogCard(null);
    setScheduleError(null);
  }, [isSavingSchedule]);

  const saveSchedule = useCallback(
    async (
      card: KanbanCardData,
      nextSchedule: {
        scheduledAt: string | null;
        taskType: string | null;
      },
    ) => {
      setIsSavingSchedule(true);
      setScheduleError(null);

      try {
        const response = await fetch("/api/board/schedule", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-kanban-app-key": appKey,
          },
          body: JSON.stringify({
            conversationId: card.id,
            scheduledAt: nextSchedule.scheduledAt,
            taskType: nextSchedule.taskType,
            updatedBy: agentName,
          }),
        });
        const result = (await response.json()) as {
          error?: string;
          schedule?: SchedulePatch;
        };

        if (!response.ok || !result.schedule) {
          throw new Error(result.error ?? "Falha ao salvar a agenda.");
        }

        setBoard((currentBoard) =>
          updateCardSchedule(currentBoard, String(card.id), result.schedule!),
        );
        setScheduleDialogCard(null);
      } catch (saveError) {
        setScheduleError(
          saveError instanceof Error
            ? saveError.message
            : "Falha ao salvar a agenda.",
        );
      } finally {
        setIsSavingSchedule(false);
      }
    },
    [agentName, appKey],
  );

  const selectedPipeline = useMemo(
    () =>
      payload?.pipelines.find((pipeline) => pipeline.id === selectedPipelineId) ??
      null,
    [payload, selectedPipelineId],
  );

  const dominantChannel =
    payload?.metrics.channelBreakdown[0]?.label ?? "Sem canal dominante";

  const syncedAtLabel = formatClock(payload?.fetchedAt);

  const boardCards = useMemo(
    () => board.columns.flatMap((column) => column.cards.map((card) => card.record)),
    [board],
  );

  const scheduledCards = useMemo(
    () =>
      [...boardCards]
        .filter((card) => Boolean(card.scheduledAt))
        .sort((left, right) => {
          const leftTime = new Date(left.scheduledAt ?? "").getTime();
          const rightTime = new Date(right.scheduledAt ?? "").getTime();
          return leftTime - rightTime;
        }),
    [boardCards],
  );

  const overdueCards = useMemo(
    () =>
      scheduledCards.filter(
        (card) => getScheduleBucket(card.scheduledAt) === "overdue",
      ),
    [scheduledCards],
  );
  const todayCards = useMemo(
    () =>
      scheduledCards.filter(
        (card) => getScheduleBucket(card.scheduledAt) === "today",
      ),
    [scheduledCards],
  );
  const upcomingCards = useMemo(
    () =>
      scheduledCards.filter(
        (card) => getScheduleBucket(card.scheduledAt) === "upcoming",
      ),
    [scheduledCards],
  );
  const unscheduledCards = useMemo(
    () =>
      [...boardCards]
        .filter((card) => !card.scheduledAt)
        .sort((left, right) => right.lastActivityAt - left.lastActivityAt),
    [boardCards],
  );

  const agendaDays = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    return Array.from({ length: 7 }, (_, offset) => {
      const day = new Date(start);
      day.setDate(start.getDate() + offset);
      const dayStart = day.getTime();
      const dayEnd = dayStart + 86_400_000;

      return {
        key: day.toISOString().slice(0, 10),
        label: new Intl.DateTimeFormat("pt-BR", {
          day: "2-digit",
          month: "short",
        }).format(day),
        caption:
          offset === 0
            ? "Hoje"
            : new Intl.DateTimeFormat("pt-BR", { weekday: "short" }).format(day),
        items: scheduledCards.filter((card) => {
          const timestamp = new Date(card.scheduledAt ?? "").getTime();
          return timestamp >= dayStart && timestamp < dayEnd;
        }),
      };
    });
  }, [scheduledCards]);

  const agendaSummaries = useMemo(
    () => [
      {
        label: "Agendados",
        value: String(scheduledCards.length),
        detail:
          scheduledCards.length > 0
            ? `${upcomingCards.length} proximos compromissos`
            : "Nenhum card programado",
        tone: "accent" as const,
      },
      {
        label: "Atrasados",
        value: String(overdueCards.length),
        detail: overdueCards.length
          ? "Cards pedindo acao imediata"
          : "Nada vencido no momento",
        tone: overdueCards.length ? ("danger" as const) : ("neutral" as const),
      },
      {
        label: "Hoje",
        value: String(todayCards.length),
        detail: todayCards.length
          ? "Compromissos ainda para hoje"
          : "Agenda do dia zerada",
        tone: "neutral" as const,
      },
      {
        label: "Sem agenda",
        value: String(unscheduledCards.length),
        detail: "Cards sem proximo passo definido",
        tone: unscheduledCards.length ? ("danger" as const) : ("neutral" as const),
      },
    ],
    [
      overdueCards.length,
      scheduledCards.length,
      todayCards.length,
      upcomingCards.length,
      unscheduledCards.length,
    ],
  );

  return (
    <>
      <main className="min-h-screen bg-[linear-gradient(180deg,_#eef2f6_0%,_#f7f9fb_100%)] text-[#344054]">
        <div className="mx-auto flex max-w-[1840px] flex-col gap-1 px-2 py-1 md:px-2.5">
        <header className="rounded-[14px] border border-[#d7dde4] bg-white px-2 py-1.5 shadow-[0_8px_18px_rgba(15,23,42,0.05)]">
          <div className="flex flex-col gap-1 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1">
                <h1 className="text-[16px] font-bold leading-none text-[#101828]">
                  Dashboard executivo de negocios
                </h1>
                {selectedPipeline ? (
                  <span className="rounded-full border border-[#d0d5dd] bg-[#f8fafc] px-1.5 py-0.5 text-[8px] font-bold text-[#344054]">
                    {selectedPipeline.name}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-1 sm:flex-row sm:items-center">
              <label className="min-w-[176px]">
                <span className="sr-only">Funil ativo</span>
                <select
                  aria-label="Funil ativo"
                  className="h-6.5 w-full rounded-[9px] border border-[#d0d5dd] bg-white px-2 text-[10px] text-[#344054] outline-none transition focus:border-[#98a2b3]"
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
                className="h-6.5 rounded-[9px] border border-[#d0d5dd] bg-[#f8fafc] px-2 text-[9px] font-bold text-[#344054] transition hover:bg-[#eef2f6] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isLoading}
                onClick={() => void loadBoard(selectedPipelineId, true)}
                type="button"
              >
                {isLoading ? "Atualizando..." : "Atualizar quadro"}
              </button>
            </div>
          </div>

          <div className="mt-1 flex flex-wrap gap-1">
            <SummaryItem
              label="Cards"
              value={String(payload?.metrics.totalCards ?? 0)}
              detail={
                selectedPipeline
                  ? `${selectedPipeline.stageCount} etapas ativas`
                  : "Sem funil carregado"
              }
            />
            <SummaryItem
              label="Nao lidas"
              value={String(payload?.metrics.unreadCards ?? 0)}
              detail="Mensagens ainda sem retorno"
            />
            <SummaryItem
              label="Canal"
              value={dominantChannel}
              detail={`${payload?.metrics.channelBreakdown.length ?? 0} canais em uso`}
            />
            <SummaryItem
              label="Sync"
              value={syncedAtLabel}
              detail={agentName ? `Operador ${agentName}` : "Sem contexto do Chatwoot"}
            />
          </div>
        </header>

        {error ? (
          <section className="rounded-[18px] border border-[#fecdca] bg-[#fff6ed] px-4 py-3 text-[13px] text-[#b54708]">
            {error}
          </section>
        ) : null}

        <section className="rounded-[24px] border border-[#d7dde4] bg-[#f8fafc] p-1.5 shadow-[0_16px_40px_rgba(15,23,42,0.06)]">
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
                  const preview =
                    card.record.description &&
                    card.record.description !== "Sem mensagem recente"
                      ? card.record.description
                      : null;
                  const price = formatMoney(card.record.price);
                  const contactMeta = buildContactMeta(card.record);
                  const responsibleLabel = getResponsibleLabel(card.record);
                  const scheduleTone = getScheduleTone(card.record.scheduledAt);
                  const urgencyTone = getUrgencyTone(card.record);
                  const isMoving = movingCardId === card.id;
                  const statusLabel = getStatusLabel(card.record);
                  const showPrice =
                    card.record.price !== null && card.record.price > 0;
                  const scheduleLabel = formatSchedulePill(card.record);
                  const previewText = preview ?? "Sem mensagem recente";
                  const scheduleTitle = card.record.scheduledAt
                    ? `${getTaskTypeLabel(card.record.taskType)} / ${formatScheduleDateTime(
                        card.record.scheduledAt,
                      )}`
                    : "Sem agenda";

                  return (
                    <article
                      className={`group flex h-[124px] w-full flex-col overflow-hidden rounded-[12px] border border-[#d7dde4] bg-white px-2 py-1.5 text-[#344054] shadow-[0_8px_18px_rgba(15,23,42,0.05)] transition ${options.dragging ? "opacity-95" : ""} ${isMoving ? "ring-2 ring-[#cdd5df]" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1">
                          <span
                            className={`inline-flex max-w-[82px] items-center rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.08em] ${getStatusBadgeClasses(card.record.unreadCount)}`}
                            title={card.record.conversationStatus}
                          >
                            <span className="truncate">{statusLabel}</span>
                          </span>
                          <span
                            className={`inline-flex max-w-[68px] items-center rounded-full border px-1.5 py-0.5 text-[8px] font-bold ${urgencyTone.badge}`}
                            title={`Nivel de urgencia ${urgencyTone.label}`}
                          >
                            <span className="truncate">{urgencyTone.label}</span>
                          </span>
                        </div>

                        <div className="flex items-center gap-0.5">
                          <span className="text-[9px] font-semibold text-[#98a2b3]">
                            {formatElapsedTime(card.record.lastActivityAt)}
                          </span>
                          <button
                            aria-label={
                              card.record.scheduledAt
                                ? "Editar agenda do card"
                                : "Agendar compromisso do card"
                            }
                            className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-[6px] border border-[#d0d5dd] bg-[#f8fafc] text-[#98a2b3] transition hover:bg-[#eef2f6] hover:text-[#101828]"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              handleOpenSchedule(card.record);
                            }}
                            title={
                              card.record.scheduledAt
                                ? "Editar agenda"
                                : "Agendar compromisso"
                            }
                            type="button"
                          >
                            <CalendarIcon />
                          </button>
                          <a
                            aria-label="Abrir conversa completa"
                            className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border border-[#d0d5dd] bg-[#f8fafc] text-[#98a2b3] transition hover:bg-[#eef2f6] hover:text-[#101828]"
                            href={card.record.openUrl}
                            rel="noreferrer"
                            target="_blank"
                            title="Abrir conversa completa"
                          >
                            <ArrowIcon />
                          </a>
                        </div>
                      </div>

                      <div className="mt-1 min-w-0 flex-1">
                        <h2
                          className="line-clamp-2 min-h-[23px] text-[11px] font-bold leading-[1.04] text-[#101828]"
                          title={card.record.title}
                        >
                          {card.record.title}
                        </h2>

                        <div className="mt-1 flex items-center gap-1 text-[7.5px] leading-none">
                          <span
                            className="truncate font-semibold text-[#475467]"
                            title={responsibleLabel}
                          >
                            {responsibleLabel}
                          </span>
                          <span className="text-[#cbd5e1]">/</span>
                          <span
                            className="truncate text-[#667085]"
                            title={card.record.channelLabel}
                          >
                            {card.record.channelLabel}
                          </span>
                        </div>

                        <p
                          className="mt-1 h-[10px] truncate text-[7.5px] text-[#667085]"
                          title={contactMeta}
                        >
                          {contactMeta}
                        </p>
                        <p
                          className={`mt-1 line-clamp-1 min-h-[9px] text-[7.5px] leading-[1.08] ${
                            preview ? "text-[#475467]" : "text-[#98a2b3]"
                          }`}
                          title={previewText}
                        >
                          {previewText}
                        </p>
                      </div>

                      <div className="mt-auto flex items-center justify-between gap-1.5 pt-0.5">
                        <span
                          className={`inline-flex min-w-0 max-w-[70%] items-center gap-1 rounded-full border px-1.5 py-0.5 text-[8px] font-semibold ${scheduleTone.badge}`}
                          title={scheduleTitle}
                        >
                          <CalendarIcon />
                          <span className="truncate">{scheduleLabel}</span>
                        </span>

                        {showPrice && price ? (
                          <span className="inline-flex shrink-0 items-center rounded-full bg-[#eef2ff] px-1.5 py-0.5 text-[8px] font-semibold text-[#4338ca]">
                            {price}
                          </span>
                        ) : null}
                      </div>
                    </article>
                  );
                }}
                renderColumnHeader={(column) => {
                  const typedColumn = column as BoardColumn;
                  const totalValue = sumColumnValue(typedColumn.cards);

                  return (
                    <header className="mb-1.5 rounded-[14px] border border-[#d7dde4] bg-white px-2 py-1.5 text-[#101828] shadow-[0_6px_16px_rgba(15,23,42,0.05)]">
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex min-w-0 flex-1 items-center gap-1.5">
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: typedColumn.color }}
                          />
                          <h3 className="truncate text-[12px] font-bold leading-none tracking-[-0.01em]">
                            {typedColumn.title}
                          </h3>
                        </div>
                        <span className="rounded-full bg-[#f2f4f7] px-1.25 py-0.5 text-[9px] font-bold text-[#475467]">
                          {typedColumn.cards.length}
                        </span>
                      </div>

                      <div className="mt-1 flex items-center justify-between gap-2 text-[8px] leading-none text-[#667085]">
                        <span>{typedColumn.cards.length} leads</span>
                        <span>{formatMoney(totalValue) ?? "R$ 0"}</span>
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

        <KanbanAgenda
          days={agendaDays}
          onScheduleCard={handleOpenSchedule}
          savingConversationId={
            isSavingSchedule ? scheduleDialogCard?.id ?? null : null
          }
          summaries={agendaSummaries}
          unscheduledCards={unscheduledCards}
        />
        </div>
      </main>

      <ScheduleDialog
        agentName={agentName}
        card={scheduleDialogCard}
        error={scheduleError}
        isOpen={Boolean(scheduleDialogCard)}
        isSaving={isSavingSchedule}
        key={
          scheduleDialogCard
            ? `${scheduleDialogCard.id}:${scheduleDialogCard.scheduledAt ?? "none"}:${scheduleDialogCard.taskType ?? "none"}`
            : "schedule-empty"
        }
        onClear={async () => {
          if (!scheduleDialogCard) {
            return;
          }

          await saveSchedule(scheduleDialogCard, {
            scheduledAt: null,
            taskType: null,
          });
        }}
        onClose={handleCloseSchedule}
        onSave={async ({ scheduledAt, taskType }) => {
          if (!scheduleDialogCard) {
            return;
          }

          await saveSchedule(scheduleDialogCard, {
            scheduledAt,
            taskType,
          });
        }}
      />
    </>
  );
}
