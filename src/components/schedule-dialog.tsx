"use client";

import { useState } from "react";

import {
  TASK_TYPE_OPTIONS,
  fromDatetimeLocalValue,
  getTaskTypeLabel,
  toDatetimeLocalValue,
} from "@/lib/schedule";
import { KanbanCardData } from "@/lib/types";

interface ScheduleDialogProps {
  card: KanbanCardData | null;
  isOpen: boolean;
  isSaving: boolean;
  agentName: string | null;
  error: string | null;
  onClose: () => void;
  onSave: (payload: { scheduledAt: string; taskType: string }) => Promise<void>;
  onClear: () => Promise<void>;
}

function buildOwnerLabel(card: KanbanCardData) {
  return card.assigneeName ?? card.teamName ?? "Sem responsavel";
}

function formatUpdatedLabel(card: KanbanCardData) {
  if (!card.scheduleUpdatedAt) {
    return "Sem historico de atualizacao.";
  }

  const timestamp = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(card.scheduleUpdatedAt));

  return card.scheduleUpdatedBy
    ? `Ultima atualizacao por ${card.scheduleUpdatedBy} em ${timestamp}`
    : `Ultima atualizacao em ${timestamp}`;
}

export function ScheduleDialog({
  card,
  isOpen,
  isSaving,
  agentName,
  error,
  onClose,
  onSave,
  onClear,
}: ScheduleDialogProps) {
  const [taskType, setTaskType] = useState(card?.taskType ?? "follow_up");
  const [scheduledAt, setScheduledAt] = useState(
    toDatetimeLocalValue(card?.scheduledAt),
  );
  const [localError, setLocalError] = useState<string | null>(null);

  if (!isOpen || !card) {
    return null;
  }

  const visibleError = localError ?? error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.45)] px-4 py-6">
      <div className="w-full max-w-[560px] rounded-[28px] border border-[#d7dde4] bg-white p-5 shadow-[0_30px_80px_rgba(15,23,42,0.28)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#98a2b3]">
              Programar agenda
            </p>
            <h2 className="mt-1 text-[24px] font-bold text-[#101828]">
              {card.title}
            </h2>
            <p className="mt-2 text-[13px] leading-5 text-[#667085]">
              {card.stageName} • {buildOwnerLabel(card)}
            </p>
          </div>

          <button
            className="h-10 w-10 rounded-full border border-[#d0d5dd] bg-[#f8fafc] text-[20px] leading-none text-[#667085] transition hover:bg-[#eef2f6]"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-[12px] text-[#667085]">
            <span className="font-bold uppercase tracking-[0.14em]">Tipo</span>
            <select
              className="h-11 rounded-[14px] border border-[#d0d5dd] bg-white px-3 text-[14px] text-[#344054] outline-none transition focus:border-[#98a2b3]"
              onChange={(event) => setTaskType(event.target.value)}
              value={taskType}
            >
              {TASK_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[12px] text-[#667085]">
            <span className="font-bold uppercase tracking-[0.14em]">
              Data e hora
            </span>
            <input
              className="h-11 rounded-[14px] border border-[#d0d5dd] bg-white px-3 text-[14px] text-[#344054] outline-none transition focus:border-[#98a2b3]"
              onChange={(event) => setScheduledAt(event.target.value)}
              type="datetime-local"
              value={scheduledAt}
            />
          </label>
        </div>

        <div className="mt-4 rounded-[18px] border border-[#d7dde4] bg-[#f8fafc] px-4 py-3 text-[13px] text-[#667085]">
          <p className="font-semibold text-[#344054]">
            {card.scheduledAt
              ? `${getTaskTypeLabel(card.taskType)} agendado para ${new Intl.DateTimeFormat(
                  "pt-BR",
                  {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  },
                ).format(new Date(card.scheduledAt))}`
              : "Este card ainda nao tem agenda definida."}
          </p>
          <p className="mt-1">{formatUpdatedLabel(card)}</p>
          {agentName ? <p className="mt-1">Operador atual: {agentName}</p> : null}
        </div>

        {visibleError ? (
          <div className="mt-4 rounded-[18px] border border-[#fecdca] bg-[#fff6ed] px-4 py-3 text-[13px] text-[#b54708]">
            {visibleError}
          </div>
        ) : null}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <button
            className="h-11 rounded-[14px] border border-[#fda29b] bg-white px-4 text-[13px] font-bold text-[#b42318] transition hover:bg-[#fff5f4] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSaving || (!card.scheduledAt && !scheduledAt)}
            onClick={() => {
              setLocalError(null);
              void onClear();
            }}
            type="button"
          >
            Limpar agenda
          </button>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              className="h-11 rounded-[14px] border border-[#d0d5dd] bg-white px-4 text-[13px] font-bold text-[#344054] transition hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSaving}
              onClick={onClose}
              type="button"
            >
              Cancelar
            </button>
            <button
              className="h-11 rounded-[14px] bg-[#101828] px-4 text-[13px] font-bold text-white transition hover:bg-[#1d2939] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSaving}
              onClick={() => {
                const nextScheduledAt = fromDatetimeLocalValue(scheduledAt);

                if (!nextScheduledAt) {
                  setLocalError("Escolha uma data e hora para salvar a agenda.");
                  return;
                }

                setLocalError(null);
                void onSave({
                  scheduledAt: nextScheduledAt,
                  taskType,
                });
              }}
              type="button"
            >
              {isSaving ? "Salvando..." : "Salvar agenda"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
