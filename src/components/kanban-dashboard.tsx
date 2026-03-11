"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
  ConversationPriorityValue,
  ConversationStatusValue,
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

interface DetailDraftField {
  sectionTitle: string;
  label: string;
  value: string;
}

interface DetailDraft {
  conversationId: number;
  title: string;
  pipelineId: number;
  stageName: string;
  status: ConversationStatusValue;
  price: string;
  responsibleKey: string;
  priority: ConversationPriorityValue;
  fields: DetailDraftField[];
}

const STATUS_OPTIONS: Array<{
  value: ConversationStatusValue;
  label: string;
}> = [
  { value: "open", label: "Aberta" },
  { value: "pending", label: "Pendente" },
  { value: "resolved", label: "Resolvida" },
  { value: "snoozed", label: "Adiada" },
];

const PRIORITY_OPTIONS: Array<{
  value: ConversationPriorityValue;
  label: string;
}> = [
  { value: "none", label: "Normal" },
  { value: "low", label: "Baixa" },
  { value: "medium", label: "Media" },
  { value: "high", label: "Alta" },
  { value: "urgent", label: "Critica" },
];

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

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
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

  return parts.join(" / ") || null;
}

function buildResponsibleLabel(record: KanbanCardData) {
  return buildOwnerMeta(record) ?? "Sem responsavel";
}

function buildCardSignal(record: KanbanCardData) {
  const primaryHighlight = record.highlights[0];
  if (primaryHighlight) {
    return `${primaryHighlight.label}: ${primaryHighlight.value}`;
  }

  return buildContactMeta(record);
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

function getPriorityTone(priority: string | null | undefined) {
  switch (priority) {
    case "urgent":
      return {
        label: "Critica",
        text: "text-rose-600",
        dot: "bg-rose-400",
      };
    case "high":
      return {
        label: "Alta",
        text: "text-amber-600",
        dot: "bg-amber-400",
      };
    case "medium":
      return {
        label: "Media",
        text: "text-sky-600",
        dot: "bg-sky-400",
      };
    case "low":
      return {
        label: "Baixa",
        text: "text-emerald-600",
        dot: "bg-emerald-400",
      };
    default:
      return {
        label: "Normal",
        text: "text-slate-500",
        dot: "bg-slate-300",
      };
  }
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
    <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-[#d7dde4] bg-white text-[#475467] shadow-sm">
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
  const sizeClass =
    size === "lg" ? "h-[34px] w-[34px] text-[11px]" : "h-[28px] w-[28px] text-[9px]";

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
    <div className="grid min-w-max grid-flow-col gap-3 overflow-x-auto pb-2">
      {Array.from({ length: 4 }).map((_, columnIndex) => (
        <div
          key={columnIndex}
          className="flex h-[560px] w-[320px] flex-col gap-1.5 rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,_rgba(250,251,253,0.98),_rgba(243,246,250,0.98))] p-2"
        >
          <div className="h-[44px] animate-pulse rounded-[16px] bg-white" />
          {Array.from({ length: 4 }).map((__, cardIndex) => (
            <div
              key={cardIndex}
              className="h-[114px] animate-pulse rounded-[18px] border border-slate-200 bg-white"
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

function canStartBoardPan(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  if (
    target.closest(".kanban-card") ||
    target.closest(".kanban-column-header") ||
    target.closest("button, a, input, select, textarea, label, [role='button']")
  ) {
    return false;
  }

  return Boolean(target.closest(".kanban-scroll"));
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

function normalizeLookup(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function isPipelineField(label: string) {
  return normalizeLookup(label) === "funil";
}

function isStageField(label: string) {
  return normalizeLookup(label) === "etapa";
}

function isStatusField(label: string) {
  return normalizeLookup(label) === "status";
}

function isChannelField(label: string) {
  return normalizeLookup(label) === "canal";
}

function isPriceField(label: string) {
  const normalized = normalizeLookup(label);
  return normalized === "preco" || normalized === "valor";
}

function isLeadNameField(sectionTitle: string, label: string) {
  return (
    normalizeLookup(sectionTitle).includes("lead") &&
    normalizeLookup(label) === "nome do lead"
  );
}

function buildDetailDraft(
  card: KanbanCardData,
  detail: KanbanCardDetail,
  pipelineId: number,
): DetailDraft {
  return {
    conversationId: card.id,
    title: card.title,
    pipelineId,
    stageName: card.stageName,
    status: (card.conversationStatusValue as ConversationStatusValue) ?? "open",
    price: detail.quickEdit.price,
    responsibleKey: detail.quickEdit.responsibleKey,
    priority: detail.quickEdit.priority,
    fields: detail.sections.flatMap((section) =>
      section.fields.map((field) => ({
        sectionTitle: section.title,
        label: field.label,
        value: field.value,
      })),
    ),
  };
}

export function KanbanDashboard() {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stickyColumnsRef = useRef<
    Array<{
      headerHost: HTMLElement;
      naturalTop: number;
    }>
  >([]);
  const stickyBoardBottomRef = useRef(0);
  const boardPanRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    frameId: number | null;
    moved: boolean;
    targetScrollLeft: number;
  } | null>(null);
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
  const [isSavingDetail, setIsSavingDetail] = useState(false);
  const [detailDraft, setDetailDraft] = useState<DetailDraft | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [attachmentNote, setAttachmentNote] = useState("");
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachmentSuccess, setAttachmentSuccess] = useState<string | null>(null);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [isBoardPanning, setIsBoardPanning] = useState(false);
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
  const editablePipeline = useMemo(
    () =>
      detailDraft
        ? payload?.pipelines.find((pipeline) => pipeline.id === detailDraft.pipelineId) ??
          null
        : null,
    [detailDraft, payload],
  );
  const editableStages = editablePipeline?.statuses ?? [];
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

  useEffect(() => {
    if (!selectedCard || !selectedDetail || !selectedPipelineId) {
      setDetailDraft(null);
      setIsSavingDetail(false);
      return;
    }

    setDetailDraft((current) =>
      current?.conversationId === selectedCard.id
        ? current
        : buildDetailDraft(selectedCard, selectedDetail, selectedPipelineId),
    );
  }, [
    selectedCard,
    selectedDetail,
    selectedPipelineId,
  ]);

  useEffect(() => {
    setAttachmentFiles([]);
    setAttachmentNote("");
    setAttachmentError(null);
    setAttachmentSuccess(null);
    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = "";
    }
  }, [selectedCardId]);

  const loadBoard = useCallback(async (
    pipelineId?: number | null,
    force = false,
    preserveSelection = false,
  ) => {
    const activeKey = resolveAppKey();
    setAppKey(activeKey);

    if (!preserveSelection) {
      setSelectedCardId(null);
      setDetailError(null);
    }

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

    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }

    let frame = 0;
    let measureFrame = 0;
    let pendingScrollTop = scroller.scrollTop;
    let lastAppliedScrollTop = scroller.scrollTop;

    const syncColumnHeaders = () => {
      frame = 0;
      lastAppliedScrollTop = pendingScrollTop;
      const targetTop = pendingScrollTop + 12;
      const boardBottom = stickyBoardBottomRef.current;

      stickyColumnsRef.current.forEach(({ headerHost, naturalTop }) => {
        const maxTranslate = Math.max(
          boardBottom - headerHost.offsetHeight - 12 - naturalTop,
          0,
        );
        const translateY = Math.min(
          Math.max(targetTop - naturalTop, 0),
          maxTranslate,
        );

        headerHost.style.transform = translateY
          ? `translateY(${translateY}px)`
          : "";
      });
    };

    const requestSync = () => {
      const nextScrollTop = scroller.scrollTop;

      if (nextScrollTop === pendingScrollTop) {
        return;
      }

      pendingScrollTop = nextScrollTop;

      if (!frame && pendingScrollTop !== lastAppliedScrollTop) {
        frame = window.requestAnimationFrame(syncColumnHeaders);
      }
    };

    const measureColumnGeometry = () => {
      measureFrame = 0;
      const columns = Array.from(
        scroller.querySelectorAll<HTMLElement>(".react-kanban-column"),
      );
      const boardHost = scroller.querySelector<HTMLElement>(".react-kanban-board");
      const scrollerRect = scroller.getBoundingClientRect();
      const boardRect = boardHost?.getBoundingClientRect();
      const boardTop = boardRect
        ? boardRect.top - scrollerRect.top + scroller.scrollTop
        : 0;
      const boardHeight = Math.max(
        boardHost?.scrollHeight ?? 0,
        boardHost?.offsetHeight ?? 0,
        columns.reduce(
          (maxHeight, column) =>
            Math.max(maxHeight, column.scrollHeight, column.offsetHeight),
          0,
        ),
      );

      stickyBoardBottomRef.current = boardTop + boardHeight;
      pendingScrollTop = scroller.scrollTop;
      lastAppliedScrollTop = scroller.scrollTop;
      stickyColumnsRef.current = columns.flatMap((column) => {
        const headerHost = column.firstElementChild as HTMLElement | null;
        if (!headerHost) {
          return [];
        }

        const columnRect = column.getBoundingClientRect();

        return [
          {
            headerHost,
            naturalTop:
              columnRect.top -
              scrollerRect.top +
              scroller.scrollTop +
              headerHost.offsetTop,
          },
        ];
      });

      syncColumnHeaders();
    };

    const requestMeasure = () => {
      if (measureFrame) {
        window.cancelAnimationFrame(measureFrame);
      }
      measureFrame = window.requestAnimationFrame(measureColumnGeometry);
    };

    requestMeasure();
    const syncTimers = [
      window.setTimeout(requestMeasure, 0),
      window.setTimeout(requestMeasure, 160),
      window.setTimeout(requestMeasure, 450),
    ];
    scroller.addEventListener("scroll", requestSync, { passive: true });
    window.addEventListener("resize", requestMeasure);

    return () => {
      stickyColumnsRef.current.forEach(({ headerHost }) => {
        headerHost.style.transform = "";
      });
      scroller.removeEventListener("scroll", requestSync);
      window.removeEventListener("resize", requestMeasure);
      clearTimeout(syncTimers[0]);
      clearTimeout(syncTimers[1]);
      clearTimeout(syncTimers[2]);
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      if (measureFrame) {
        window.cancelAnimationFrame(measureFrame);
      }
      stickyColumnsRef.current = [];
      stickyBoardBottomRef.current = 0;
    };
  }, [board, isLoading]);

  const stopBoardPan = useCallback(
    (pointerId?: number) => {
      const currentPan = boardPanRef.current;
      const scroller = scrollerRef.current;

      if (!currentPan) {
        return;
      }

      if (pointerId !== undefined && currentPan.pointerId !== pointerId) {
        return;
      }

      if (currentPan.frameId) {
        window.cancelAnimationFrame(currentPan.frameId);
      }

      if (scroller && scroller.hasPointerCapture(currentPan.pointerId)) {
        scroller.releasePointerCapture(currentPan.pointerId);
      }

      boardPanRef.current = null;
      setIsBoardPanning(false);
    },
    [],
  );

  const handleBoardPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !canStartBoardPan(event.target)) {
        return;
      }

      const scroller = scrollerRef.current;
      if (!scroller) {
        return;
      }

      boardPanRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: scroller.scrollLeft,
        frameId: null,
        moved: false,
        targetScrollLeft: scroller.scrollLeft,
      };
      scroller.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [],
  );

  const handleBoardPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const currentPan = boardPanRef.current;
      const scroller = scrollerRef.current;

      if (!currentPan || !scroller || currentPan.pointerId !== event.pointerId) {
        return;
      }

      const deltaX = event.clientX - currentPan.startX;
      const deltaY = event.clientY - currentPan.startY;

      if (!currentPan.moved) {
        if (Math.abs(deltaX) < 4 && Math.abs(deltaY) < 4) {
          return;
        }

        currentPan.moved = true;
        setIsBoardPanning(true);
      }

      currentPan.targetScrollLeft = currentPan.scrollLeft - deltaX;
      if (currentPan.frameId === null) {
        currentPan.frameId = window.requestAnimationFrame(() => {
          const activePan = boardPanRef.current;
          if (!activePan || activePan.pointerId !== event.pointerId) {
            return;
          }

          scroller.scrollLeft = activePan.targetScrollLeft;
          activePan.frameId = null;
        });
      }
      event.preventDefault();
    },
    [],
  );

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

  const updateDraftField = useCallback(
    (sectionTitle: string, label: string, value: string) => {
      setDetailDraft((current) => {
        if (!current) {
          return current;
        }

        const nextFields = current.fields.map((field) =>
          field.sectionTitle === sectionTitle && field.label === label
            ? { ...field, value }
            : field,
        );

        return {
          ...current,
          title: isLeadNameField(sectionTitle, label) ? value : current.title,
          price: isPriceField(label) ? value : current.price,
          fields: nextFields,
        };
      });
    },
    [],
  );

  const handleDraftPipelineChange = useCallback(
    (pipelineId: number) => {
      setDetailDraft((current) => {
        if (!current || !payload) {
          return current;
        }

        const nextPipeline =
          payload.pipelines.find((pipeline) => pipeline.id === pipelineId) ?? null;
        const nextStatuses = nextPipeline?.statuses ?? [];
        const currentStageIsValid = nextStatuses.some(
          (stage) => stage.name === current.stageName,
        );

        return {
          ...current,
          pipelineId,
          stageName: currentStageIsValid
            ? current.stageName
            : nextStatuses[0]?.name ?? current.stageName,
        };
      });
    },
    [payload],
  );

  const resetDetailDraft = useCallback(() => {
    if (!selectedCard || !selectedDetail || !selectedPipelineId) {
      return;
    }

    setDetailDraft(buildDetailDraft(selectedCard, selectedDetail, selectedPipelineId));
    setDetailError(null);
  }, [selectedCard, selectedDetail, selectedPipelineId]);

  const resetAttachmentComposer = useCallback(() => {
    setAttachmentFiles([]);
    setAttachmentNote("");
    setAttachmentError(null);
    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = "";
    }
  }, []);

  const handleAttachmentSelection = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setAttachmentFiles(Array.from(event.target.files ?? []));
      setAttachmentError(null);
      setAttachmentSuccess(null);
    },
    [],
  );

  const handleAttachmentUpload = useCallback(async () => {
    if (!selectedCard) {
      return;
    }

    const files = attachmentFiles.filter((file) => file.size > 0);
    if (!files.length) {
      setAttachmentError("Selecione pelo menos um arquivo para anexar.");
      return;
    }

    const activeKey = appKey || resolveAppKey();
    if (!activeKey) {
      setAttachmentError("Falta o appKey no hash da URL do dashboard app.");
      return;
    }

    const formData = new FormData();
    formData.set("conversationId", String(selectedCard.id));
    formData.set("note", attachmentNote.trim());
    files.forEach((file) => {
      formData.append("attachments[]", file, file.name);
    });

    setIsUploadingAttachment(true);
    setAttachmentError(null);
    setAttachmentSuccess(null);

    try {
      const response = await fetch("/api/board/card", {
        method: "POST",
        headers: {
          "x-kanban-app-key": activeKey,
        },
        body: formData,
      });
      const result = (await response.json()) as {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        throw new Error(result.error ?? "Nao foi possivel anexar os arquivos.");
      }

      resetAttachmentComposer();
      setAttachmentSuccess(
        result.message ??
          `${files.length} arquivo${files.length === 1 ? "" : "s"} anexado${files.length === 1 ? "" : "s"} na conversa.`,
      );
    } catch (uploadError) {
      setAttachmentError(
        uploadError instanceof Error
          ? uploadError.message
          : "Nao foi possivel anexar os arquivos.",
      );
    } finally {
      setIsUploadingAttachment(false);
    }
  }, [appKey, attachmentFiles, attachmentNote, resetAttachmentComposer, selectedCard]);

  const handleSaveDetail = useCallback(async () => {
    if (!detailDraft || !selectedCard) {
      return;
    }

    const activeKey = appKey || resolveAppKey();
    if (!activeKey) {
      setDetailError("Falta o appKey no hash da URL do dashboard app.");
      return;
    }

    setIsSavingDetail(true);
    setDetailError(null);

    try {
      const response = await fetch("/api/board/card", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-kanban-app-key": activeKey,
        },
        body: JSON.stringify({
          conversationId: detailDraft.conversationId,
          title: detailDraft.title.trim() || selectedCard.title,
          pipelineId: detailDraft.pipelineId,
          stageName: detailDraft.stageName,
          status: detailDraft.status,
          responsibleKey: detailDraft.responsibleKey,
          priority: detailDraft.priority,
          price: detailDraft.price,
          fields: detailDraft.fields,
        }),
      });
      const result = (await response.json()) as {
        detail?: KanbanCardDetail;
        error?: string;
      };

      if (!response.ok || !result.detail) {
        throw new Error(result.error ?? "Nao foi possivel salvar o card.");
      }

      setDetailCache((current) => ({
        ...current,
        [detailDraft.conversationId]: result.detail!,
      }));
      setSelectedCardId(detailDraft.conversationId);
      await loadBoard(detailDraft.pipelineId, true, true);
    } catch (saveError) {
      setDetailError(
        saveError instanceof Error
          ? saveError.message
          : "Nao foi possivel salvar o card.",
      );
    } finally {
      setIsSavingDetail(false);
    }
  }, [appKey, detailDraft, loadBoard, selectedCard]);

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
      <div className="mx-auto flex max-w-[1880px] flex-col gap-2 px-3 py-2 md:px-4">
        <header className="sticky top-2 z-20 rounded-[18px] border border-slate-200 bg-white/96 px-3 py-2 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex min-w-0 items-center gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                CRMnaMao
              </p>
              <h1 className="font-[family:var(--font-display)] text-[22px] leading-none text-slate-950">
                Funis
              </h1>
            </div>

            <div className="flex flex-1 flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
              <span className="rounded-full bg-slate-50 px-2 py-1">
                Funil <span className="font-semibold text-slate-900">{formatMoney(boardSummary.totalValue)}</span>
              </span>
              <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">
                Ganha <span className="font-semibold">{formatMoney(boardSummary.wonValue)}</span>
              </span>
              <span className="rounded-full bg-rose-50 px-2 py-1 text-rose-700">
                Perdida <span className="font-semibold">{formatMoney(boardSummary.lostValue)}</span>
              </span>
              <span className="rounded-full bg-sky-50 px-2 py-1 text-sky-700">
                Geral <span className="font-semibold">{formatMoney(payload?.metrics.overallValue)}</span>
              </span>
            </div>

            <label className="ml-auto flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              <span>Funil</span>
              <select
                className="h-9 min-w-[220px] rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium normal-case tracking-normal text-slate-900 outline-none transition focus:border-sky-400 disabled:cursor-not-allowed disabled:opacity-60 md:min-w-[280px]"
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
            <div
              className={`kanban-scroll h-[calc(100vh-7.4rem)] min-h-[560px] overflow-auto p-1.5 md:h-[calc(100vh-7.9rem)] md:p-2 ${isBoardPanning ? "kanban-scroll--panning" : ""}`}
              onLostPointerCapture={(event) => {
                stopBoardPan(event.pointerId);
              }}
              onPointerCancel={(event) => {
                stopBoardPan(event.pointerId);
              }}
              onPointerDown={handleBoardPointerDown}
              onPointerMove={handleBoardPointerMove}
              onPointerUp={(event) => {
                stopBoardPan(event.pointerId);
              }}
              ref={scrollerRef}
            >
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
                  const hasPrice =
                    typeof card.record.price === "number" && card.record.price > 0;
                  const price = hasPrice ? formatMoney(card.record.price) : null;
                  const contactMeta = buildContactMeta(card.record);
                  const responsibleLabel = buildResponsibleLabel(card.record);
                  const signalText = buildCardSignal(card.record);
                  const secondaryMeta =
                    signalText && signalText !== contactMeta ? contactMeta : null;
                  const channelTone = getChannelTone(card.record.channelLabel);
                  const priorityTone = getPriorityTone(card.record.priority);
                  const isMoving = movingCardId === card.id;
                  const isSelected = selectedCardId === card.record.id;

                  return (
                    <article
                      aria-label={`Abrir resumo de ${card.record.title}`}
                      className={`kanban-card group flex h-[110px] w-full min-w-0 flex-col overflow-hidden rounded-[16px] border border-slate-200/80 bg-white/95 px-2.5 py-2 text-left shadow-[0_1px_4px_rgba(15,23,42,0.03)] transition select-none ${options.dragging ? "cursor-grabbing opacity-95" : "cursor-grab"} ${isMoving ? "ring-2 ring-slate-300" : ""} ${isSelected ? "border-slate-950 ring-1 ring-slate-950/10" : "hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_4px_10px_rgba(15,23,42,0.05)]"}`}
                      onPointerDown={(event) => {
                        event.currentTarget.dataset.pressX = String(event.clientX);
                        event.currentTarget.dataset.pressY = String(event.clientY);
                      }}
                      onPointerUp={(event) => {
                        if (options.dragging) {
                          return;
                        }

                        const pressX = Number(
                          event.currentTarget.dataset.pressX ?? event.clientX,
                        );
                        const pressY = Number(
                          event.currentTarget.dataset.pressY ?? event.clientY,
                        );
                        const movedTooFar =
                          Math.abs(event.clientX - pressX) > 6 ||
                          Math.abs(event.clientY - pressY) > 6;

                        if (!movedTooFar) {
                          void openCardSummary(card.record);
                        }
                      }}
                    >
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="min-w-0">
                          <h2 className="block max-w-full truncate text-left text-[13px] font-bold leading-tight text-slate-950 transition group-hover:text-slate-700">
                            {card.record.title}
                          </h2>
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          {price ? (
                            <span className="inline-flex items-center px-[2px] py-0.5 text-[10px] font-semibold text-slate-500">
                              {price}
                            </span>
                          ) : null}
                          <a
                            className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                            href={card.record.openUrl}
                            onPointerDown={(event) => {
                              event.stopPropagation();
                            }}
                            onPointerUp={(event) => {
                              event.stopPropagation();
                            }}
                            onClick={(event) => {
                              event.stopPropagation();
                            }}
                            rel="noreferrer"
                            target="_blank"
                          >
                            <ArrowIcon />
                          </a>
                        </div>
                      </div>

                      <div className="mt-1.5 grid grid-cols-[32px_minmax(0,1fr)] items-center gap-x-2">
                        <Avatar
                          imageSrc={card.record.contactThumbnail}
                          label={card.record.title}
                          overlay={
                            <ChannelOverlay channelLabel={card.record.channelLabel} />
                          }
                          size="lg"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-[10px] font-medium text-slate-600">
                            {signalText || contactMeta}
                          </p>
                          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[9px] text-slate-500">
                            <span className="inline-flex shrink-0 items-center gap-1 text-slate-600">
                              <span className={`h-1.5 w-1.5 rounded-full ${channelTone.dot}`} />
                              {card.record.channelLabel.toLowerCase()}
                            </span>
                            <span className="h-1 w-1 shrink-0 rounded-full bg-slate-200" />
                            <span className="truncate text-slate-500">
                              {responsibleLabel}
                            </span>
                            <span className="h-1 w-1 shrink-0 rounded-full bg-slate-200" />
                            <span
                              className={`inline-flex shrink-0 items-center gap-1 font-semibold ${priorityTone.text}`}
                            >
                              <span className={`h-1.5 w-1.5 rounded-full ${priorityTone.dot}`} />
                              {priorityTone.label}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-1 h-[14px] overflow-hidden">
                        <p className="truncate text-[9px] text-slate-400">
                          {secondaryMeta ?? ""}
                        </p>
                      </div>

                      <div className="mt-auto flex items-center justify-between gap-1 border-t border-slate-100/80 pt-1.5 text-[9px] text-slate-500">
                        <span
                          className={`inline-flex items-center gap-1 font-semibold ${getUnreadTone(card.record.unreadCount)}`}
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full"
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

                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-[6px] py-0.5 text-slate-700">
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
                    <header className="kanban-column-header rounded-[16px] border border-slate-200 bg-white px-3 py-2 shadow-sm">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: typedColumn.color }}
                          />
                          <h3 className="truncate text-[14px] font-bold text-slate-950">
                            {typedColumn.title}
                          </h3>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className="text-[10px] font-medium text-slate-400">
                            {formatMoney(columnValue(typedColumn))}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                            {typedColumn.cards.length}
                          </span>
                        </div>
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
              </div>

              {selectedDetail ? (
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <label className="grid gap-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Valor
                    </span>
                    <input
                      className="rounded-[14px] border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                      disabled={!detailDraft || isSavingDetail}
                      inputMode="decimal"
                      onChange={(event) => {
                        const value = event.target.value;
                        setDetailDraft((current) => {
                          if (!current) {
                            return current;
                          }

                          return {
                            ...current,
                            price: value,
                            fields: current.fields.map((field) =>
                              isPriceField(field.label)
                                ? {
                                    ...field,
                                    value,
                                  }
                                : field,
                            ),
                          };
                        });
                      }}
                      placeholder="Ex.: 2500"
                      type="text"
                      value={detailDraft?.price ?? selectedDetail.quickEdit.price}
                    />
                  </label>

                  <label className="grid gap-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Responsavel
                    </span>
                    <select
                      className="w-full rounded-[14px] border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                      disabled={!detailDraft || isSavingDetail}
                      onChange={(event) => {
                        setDetailDraft((current) =>
                          current
                            ? {
                                ...current,
                                responsibleKey: event.target.value,
                              }
                            : current,
                        );
                      }}
                      value={
                        detailDraft?.responsibleKey ??
                        selectedDetail.quickEdit.responsibleKey
                      }
                    >
                      {selectedDetail.quickEdit.responsibleOptions.map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="grid gap-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Criticidade
                    </span>
                    <select
                      className="w-full rounded-[14px] border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                      disabled={!detailDraft || isSavingDetail}
                      onChange={(event) => {
                        setDetailDraft((current) =>
                          current
                            ? {
                                ...current,
                                priority: event.target.value as ConversationPriorityValue,
                              }
                            : current,
                        );
                      }}
                      value={detailDraft?.priority ?? selectedDetail.quickEdit.priority}
                    >
                      {PRIORITY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}

              {selectedDetail ? (
                <div className="mt-3 grid gap-2">
                  <label className="grid gap-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Titulo do card
                    </span>
                    <input
                      className="rounded-[14px] border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                      disabled={!detailDraft || isSavingDetail}
                      onChange={(event) => {
                        setDetailDraft((current) => {
                          if (!current) {
                            return current;
                          }

                          return {
                            ...current,
                            title: event.target.value,
                            fields: current.fields.map((field) =>
                              isLeadNameField(field.sectionTitle, field.label)
                                ? {
                                    ...field,
                                    value: event.target.value,
                                  }
                                : field,
                            ),
                          };
                        });
                      }}
                      value={detailDraft?.title ?? selectedCard.title}
                    />
                  </label>
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-950 hover:bg-slate-950 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!detailDraft || isSavingDetail}
                  onClick={resetDetailDraft}
                  type="button"
                >
                  Descartar alteracoes
                </button>
                <button
                  className="rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!detailDraft || isSavingDetail}
                  onClick={() => {
                    void handleSaveDetail();
                  }}
                  type="button"
                >
                  {isSavingDetail ? "Salvando..." : "Salvar"}
                </button>
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

              <section className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Arquivos
                    </h3>
                    <p className="mt-2 max-w-xl text-sm text-slate-600">
                      Os anexos entram na conversa como nota interna do Chatwoot.
                    </p>
                  </div>

                  <input
                    ref={attachmentInputRef}
                    className="hidden"
                    multiple
                    onChange={handleAttachmentSelection}
                    type="file"
                  />
                  <button
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-950 hover:bg-slate-950 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isUploadingAttachment}
                    onClick={() => {
                      attachmentInputRef.current?.click();
                    }}
                    type="button"
                  >
                    Selecionar arquivos
                  </button>
                </div>

                <label className="mt-4 block">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Observacao do anexo
                  </span>
                  <textarea
                    className="mt-2 min-h-[88px] w-full rounded-[16px] border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    disabled={isUploadingAttachment}
                    onChange={(event) => {
                      setAttachmentNote(event.target.value);
                      setAttachmentSuccess(null);
                    }}
                    placeholder="Opcional. Se ficar vazio, o kanban envia uma nota curta de anexo."
                    value={attachmentNote}
                  />
                </label>

                {attachmentFiles.length ? (
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {attachmentFiles.map((file) => (
                      <div
                        key={`${file.name}-${file.lastModified}-${file.size}`}
                        className="rounded-[18px] bg-white px-3 py-2.5 shadow-sm"
                      >
                        <p className="truncate text-sm font-medium text-slate-900">
                          {file.name}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {formatFileSize(file.size)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-slate-500">
                    Nenhum arquivo selecionado.
                  </p>
                )}

                {attachmentError ? (
                  <p className="mt-4 rounded-[18px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {attachmentError}
                  </p>
                ) : null}

                {attachmentSuccess ? (
                  <p className="mt-4 rounded-[18px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                    {attachmentSuccess}
                  </p>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    className="rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={!attachmentFiles.length || isUploadingAttachment}
                    onClick={() => {
                      void handleAttachmentUpload();
                    }}
                    type="button"
                  >
                    {isUploadingAttachment ? "Anexando..." : "Anexar arquivos"}
                  </button>
                  <button
                    className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-950 hover:bg-slate-950 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={!attachmentFiles.length || isUploadingAttachment}
                    onClick={resetAttachmentComposer}
                    type="button"
                  >
                    Limpar selecao
                  </button>
                </div>
              </section>

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

                  {selectedDetail.sections.map((section) => {
                    const visibleFields = section.fields.filter(
                      (field) => !isPriceField(field.label),
                    );

                    if (!visibleFields.length) {
                      return null;
                    }

                    return (
                      <section
                        key={section.id}
                        className="rounded-[24px] border border-slate-200 bg-slate-50 p-4"
                      >
                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          {section.title}
                        </h3>
                        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                          {visibleFields.map((field, fieldIndex) => (
                          <div
                            key={`${section.id}-${field.label}-${field.value}-${fieldIndex}`}
                            className="rounded-[18px] bg-white p-3 shadow-sm"
                          >
                            <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                              {field.label}
                            </dt>
                            {detailDraft ? (
                              <dd className="mt-2">
                                {isPipelineField(field.label) ? (
                                  <select
                                    className="w-full rounded-[12px] border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                                    disabled={isSavingDetail}
                                    onChange={(event) => {
                                      handleDraftPipelineChange(Number(event.target.value));
                                    }}
                                    value={detailDraft.pipelineId}
                                  >
                                    {payload?.pipelines.map((pipeline) => (
                                      <option key={pipeline.id} value={pipeline.id}>
                                        {pipeline.name}
                                      </option>
                                    ))}
                                  </select>
                                ) : isStageField(field.label) ? (
                                  <select
                                    className="w-full rounded-[12px] border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                                    disabled={isSavingDetail || !editableStages.length}
                                    onChange={(event) => {
                                      setDetailDraft((current) =>
                                        current
                                          ? {
                                              ...current,
                                              stageName: event.target.value,
                                            }
                                          : current,
                                      );
                                    }}
                                    value={detailDraft.stageName}
                                  >
                                    {editableStages.map((stage) => (
                                      <option key={`${detailDraft.pipelineId}-${stage.id}`} value={stage.name}>
                                        {stage.name}
                                      </option>
                                    ))}
                                  </select>
                                ) : isStatusField(field.label) ? (
                                  <select
                                    className="w-full rounded-[12px] border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                                    disabled={isSavingDetail}
                                    onChange={(event) => {
                                      setDetailDraft((current) =>
                                        current
                                          ? {
                                              ...current,
                                              status: event.target.value as ConversationStatusValue,
                                            }
                                          : current,
                                      );
                                    }}
                                    value={detailDraft.status}
                                  >
                                    {STATUS_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                ) : isChannelField(field.label) ? (
                                  <span className="inline-flex min-h-[40px] items-center text-sm font-medium text-slate-500">
                                    {field.value}
                                  </span>
                                ) : (
                                  <input
                                    className="w-full rounded-[12px] border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                                    disabled={isSavingDetail}
                                    onChange={(event) => {
                                      updateDraftField(
                                        section.title,
                                        field.label,
                                        event.target.value,
                                      );
                                    }}
                                    type={isPriceField(field.label) ? "text" : "text"}
                                    value={
                                      detailDraft.fields.find(
                                        (draftField) =>
                                          draftField.sectionTitle === section.title &&
                                          draftField.label === field.label,
                                      )?.value ?? field.value
                                    }
                                  />
                                )}
                              </dd>
                            ) : (
                              <dd className="mt-2 text-sm font-medium text-slate-900">
                                {field.value}
                              </dd>
                            )}
                          </div>
                          ))}
                        </dl>
                      </section>
                    );
                  })}
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



