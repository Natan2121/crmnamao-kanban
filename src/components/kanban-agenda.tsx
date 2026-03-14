"use client";

import { KanbanCardData } from "@/lib/types";
import { getTaskTypeLabel } from "@/lib/schedule";

interface AgendaSummaryItem {
  label: string;
  value: string;
  detail: string;
  tone?: "neutral" | "danger" | "accent";
}

interface AgendaDay {
  key: string;
  label: string;
  caption: string;
  items: KanbanCardData[];
}

interface KanbanAgendaProps {
  summaries: AgendaSummaryItem[];
  days: AgendaDay[];
  unscheduledCards: KanbanCardData[];
  onScheduleCard: (card: KanbanCardData) => void;
  savingConversationId?: number | null;
}

function formatTime(isoDate: string | null) {
  if (!isoDate) {
    return "--:--";
  }

  const date = new Date(isoDate);

  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function buildOwnerLabel(card: KanbanCardData) {
  return card.assigneeName ?? card.teamName ?? "Sem responsavel";
}

function summaryToneClass(tone: AgendaSummaryItem["tone"]) {
  if (tone === "danger") {
    return "border-[#fecdca] bg-[#fff6ed]";
  }

  if (tone === "accent") {
    return "border-[#d6dfff] bg-[#f5f7ff]";
  }

  return "border-[#d7dde4] bg-white";
}

export function KanbanAgenda({
  summaries,
  days,
  unscheduledCards,
  onScheduleCard,
  savingConversationId = null,
}: KanbanAgendaProps) {
  return (
    <section className="rounded-[28px] border border-[#d7dde4] bg-white p-4 shadow-[0_16px_40px_rgba(15,23,42,0.06)]">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#98a2b3]">
            Agenda operacional
          </p>
          <h2 className="mt-1 text-[24px] font-bold text-[#101828]">
            Calendario de tarefas, follow-ups e reunioes
          </h2>
          <p className="mt-1 max-w-3xl text-[13px] leading-5 text-[#667085]">
            Recorte dos proximos 7 dias para programar retorno, reuniao e acao
            comercial sem sair do board.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-4">
        {summaries.map((item) => (
          <article
            key={item.label}
            className={`rounded-[18px] border px-3.5 py-3 text-[#344054] ${summaryToneClass(item.tone)}`}
          >
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#98a2b3]">
              {item.label}
            </p>
            <p className="mt-1 text-[22px] font-bold leading-none text-[#101828]">
              {item.value}
            </p>
            <p className="mt-1 text-[12px] text-[#667085]">{item.detail}</p>
          </article>
        ))}
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.9fr)]">
        <div className="overflow-x-auto pb-2">
          <div className="grid min-w-[980px] grid-cols-7 gap-3">
            {days.map((day) => (
              <article
                key={day.key}
                className="rounded-[22px] border border-[#d7dde4] bg-[#f8fafc] p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#98a2b3]">
                      {day.caption}
                    </p>
                    <h3 className="mt-1 text-[16px] font-bold text-[#101828]">
                      {day.label}
                    </h3>
                  </div>
                  <span className="rounded-full bg-white px-2.5 py-1 text-[12px] font-bold text-[#475467]">
                    {day.items.length}
                  </span>
                </div>

                <div className="mt-3 flex min-h-[188px] flex-col gap-2">
                  {day.items.length ? (
                    day.items.slice(0, 4).map((card) => (
                      <button
                        key={card.id}
                        className="rounded-[16px] border border-[#d7dde4] bg-white px-3 py-2 text-left transition hover:border-[#b8c1cc] hover:bg-[#fcfcfd] disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={savingConversationId === card.id}
                        onClick={() => onScheduleCard(card)}
                        type="button"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[12px] font-bold text-[#101828]">
                            {card.title}
                          </span>
                          <span className="shrink-0 text-[11px] font-semibold text-[#475467]">
                            {formatTime(card.scheduledAt)}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-[11px] text-[#667085]">
                          {getTaskTypeLabel(card.taskType)} • {buildOwnerLabel(card)}
                        </p>
                        <p className="mt-1 truncate text-[11px] text-[#98a2b3]">
                          {card.stageName}
                        </p>
                      </button>
                    ))
                  ) : (
                    <div className="flex min-h-[188px] items-center justify-center rounded-[16px] border border-dashed border-[#d7dde4] bg-white px-3 text-center text-[12px] text-[#98a2b3]">
                      Sem agenda para este dia.
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>

        <aside className="rounded-[22px] border border-[#d7dde4] bg-[#f8fafc] p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#98a2b3]">
                Backlog sem agenda
              </p>
              <h3 className="mt-1 text-[18px] font-bold text-[#101828]">
                Cards sem proximo passo
              </h3>
            </div>
            <span className="rounded-full bg-white px-2.5 py-1 text-[12px] font-bold text-[#475467]">
              {unscheduledCards.length}
            </span>
          </div>

          <div className="mt-3 flex flex-col gap-2">
            {unscheduledCards.length ? (
              unscheduledCards.slice(0, 6).map((card) => (
                <button
                  key={card.id}
                  className="rounded-[16px] border border-[#d7dde4] bg-white px-3 py-2 text-left transition hover:border-[#b8c1cc] hover:bg-[#fcfcfd] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={savingConversationId === card.id}
                  onClick={() => onScheduleCard(card)}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12px] font-bold text-[#101828]">
                      {card.title}
                    </span>
                    <span className="shrink-0 text-[11px] font-semibold text-[#98a2b3]">
                      Agendar
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[11px] text-[#667085]">
                    {buildOwnerLabel(card)} • {card.stageName}
                  </p>
                </button>
              ))
            ) : (
              <div className="rounded-[16px] border border-dashed border-[#d7dde4] bg-white px-3 py-5 text-center text-[12px] text-[#98a2b3]">
                Todos os cards do recorte atual ja tem agenda.
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
