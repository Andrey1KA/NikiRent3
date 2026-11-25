"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BarController, BarElement, CategoryScale, Chart, Legend, LinearScale, Tooltip } from "chart.js";
import * as XLSX from "xlsx";
import {
  allDates,
  analyze,
  chatNames,
  countType,
  datesOf,
  formatDate,
  messagesOf,
  parseCsv,
  parseExport,
  parseInstruction,
  parseWorkbook,
} from "../lib/chats.mjs";

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);
Chart.defaults.font.family = '"Segoe UI", "Segoe UI Emoji", sans-serif';

const PALETTE = ["#0e6b62", "#c45c26"];
const AXIS = {
  ticks: { color: "#6d645b" },
  grid: { color: "#efe7dc" },
  border: { display: false },
};
const DEFAULT_INSTRUCTION = "Проверь чат «Отдел заботы» за 22 ноября. Найди все мои поручения, по которым сотрудники не отчитались, вопросы без ответа и сообщения сотрудников, на которые я сама не ответила.";
const TYPES = [
  ["Нет отчёта", "no-report", "noReport"],
  ["Мне не ответили", "no-answer", "noAnswer"],
  ["Я не ответила", "silent", "silent"],
];

export default function Dashboard() {
  const [bundle, setBundle] = useState({ chats: [] });
  const [chat, setChat] = useState("");
  const [date, setDate] = useState("");
  const [compareDate, setCompareDate] = useState("");
  const [criteria, setCriteria] = useState({ noReport: true, noAnswer: true, silent: true });
  const [instruction, setInstruction] = useState(DEFAULT_INSTRUCTION);
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState(null);
  const typeRef = useRef(null);
  const compareRef = useRef(null);
  const typeChart = useRef(null);
  const compareChart = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function loadDefault() {
      try {
        const response = await fetch("/data/chats.json");
        if (!response.ok) throw new Error("Не удалось открыть демо-переписки");
        const next = parseExport(await response.json());
        if (cancelled) return;
        acceptBundle(next, DEFAULT_INSTRUCTION, setBundle, setChat, setDate, setCompareDate, setCriteria, setNotice, false);
      } catch (error) {
        if (!cancelled) setLoadError(error.message || "Не удалось открыть переписки");
      } finally {
        if (!cancelled) setReady(true);
      }
    }
    loadDefault();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => {
    typeChart.current?.destroy();
    typeChart.current = null;
    compareChart.current?.destroy();
    compareChart.current = null;
  }, []);

  const dates = useMemo(() => {
    const list = datesOf(bundle, chat);
    return date && !list.includes(date) ? [...list, date].sort() : list;
  }, [bundle, chat, date]);
  const dayMessages = useMemo(() => messagesOf(bundle, chat, date), [bundle, chat, date]);
  const compareMessages = useMemo(() => messagesOf(bundle, chat, compareDate), [bundle, chat, compareDate]);
  const day = useMemo(() => analyze(dayMessages, criteria), [dayMessages, criteria]);
  const compared = useMemo(() => analyze(compareMessages, criteria), [compareMessages, criteria]);
  const visible = day.findings.filter((row) => filter === "all" || row.type === filter);
  const selected = visible.find((row) => row.id === selectedId) || visible[0] || null;

  useEffect(() => {
    if (!selected || selected.id === selectedId) return;
    setSelectedId(selected.id);
  }, [selected, selectedId]);

  const typeSeries = useMemo(() => seriesFor(day.findings, criteria), [day.findings, criteria]);
  const compareSeries = useMemo(() => {
    const labels = typeSeries.map((item) => item.label);
    if (!labels.length || !compareDate || compareDate === date) {
      return labels.length ? oneSeries(labels, typeSeries.map((item) => item.value), formatDate(date)) : null;
    }
    const other = seriesFor(compared.findings, criteria);
    return {
      labels,
      datasets: [
        bar(formatDate(date), typeSeries.map((item) => item.value), PALETTE[0]),
        bar(formatDate(compareDate), other.map((item) => item.value), PALETTE[1]),
      ],
    };
  }, [typeSeries, compared.findings, criteria, compareDate, date]);

  useEffect(() => {
    drawChart(typeRef, typeChart, typeSeries.length ? {
      labels: typeSeries.map((item) => item.label),
      datasets: [bar(formatDate(date), typeSeries.map((item) => item.value), PALETTE[0])],
    } : null, false);
  }, [typeSeries, date]);

  useEffect(() => {
    drawChart(compareRef, compareChart, compareSeries, Boolean(compareSeries?.datasets?.length > 1));
  }, [compareSeries]);

  function chooseChat(nextChat) {
    setChat(nextChat);
    const nextDates = datesOf(bundle, nextChat);
    const nextDate = nextDates.includes(date) ? date : nextDates[nextDates.length - 1] || "";
    setDate(nextDate);
    setCompareDate(otherDate(nextDates, nextDate, compareDate));
  }

  function chooseDate(nextDate) {
    setDate(nextDate);
    if (nextDate !== compareDate) return;
    const other = [...dates].reverse().find((item) => item !== nextDate);
    if (other) setCompareDate(other);
  }

  function runInstruction() {
    const parsed = parseInstruction(instruction, chatNames(bundle), allDates(bundle));
    if (parsed.error) {
      setNotice({ tone: "error", text: parsed.error });
      return;
    }
    setChat(parsed.chat);
    setDate(parsed.date);
    setCriteria(parsed.criteria);
    setFilter("all");
    setCompareDate(otherDate(datesOf(bundle, parsed.chat), parsed.date, ""));
    setNotice({ tone: "ok", text: `Проверяю «${parsed.chat}» за ${formatDate(parsed.date)}.` });
  }

  async function onFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const name = file.name.toLowerCase();
      let next;
      if (name.endsWith(".json")) next = parseExport(JSON.parse(await file.text()));
      else if (name.endsWith(".csv")) next = parseCsv(XLSX, await file.text());
      else next = parseWorkbook(XLSX, await file.arrayBuffer());
      acceptBundle(next, instruction, setBundle, setChat, setDate, setCompareDate, setCriteria, setNotice, true);
      setLoadError("");
      setFilter("all");
    } catch (error) {
      setNotice({ tone: "error", text: error.message || "Не удалось прочитать файл" });
    }
  }

  const shown = (key) => (ready && criteria[key] ? String(countType(day.findings, typeByKey(key))) : "—");

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <p className="eyebrow">NikiRent</p>
          <h1>Контроль переписок</h1>
          <p className="lede">Демо-чаты вместо живого MAX. «Принял» и «ок» не считаются отчётом о выполнении.</p>
          {loadError ? <p className="message error">{loadError}</p> : null}
        </div>
        <div className="upload">
          <label className="button" htmlFor="file">Загрузить файл</label>
          <input
            id="file"
            className="file-input"
            type="file"
            accept=".json,.xlsx,.xls,.csv,application/json,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={onFileChange}
          />
          <p className="hint">json, csv или xlsx. Колонки: чат, дата, время, автор, роль, текст, ссылка.</p>
          {notice ? <p className={`message ${notice.tone}`} role="status">{notice.text}</p> : null}
        </div>
      </header>

      <section className="panel" aria-labelledby="request-title">
        <div className="panel-head">
          <div>
            <h2 id="request-title">Проверка</h2>
            <p className="hint">Кнопка читает поручение и выставляет чат, дату и критерии. Списки ниже можно поменять отдельно.</p>
          </div>
        </div>
        <div className="prompt-row">
          <label className="month-label prompt" htmlFor="instruction">
            Поручение
            <textarea id="instruction" value={instruction} onChange={(event) => setInstruction(event.target.value)} />
          </label>
          <button className="button" type="button" onClick={runInstruction}>Проверить</button>
        </div>
        <div className="filters">
          <label className="month-label" htmlFor="chat">
            Чат
            <select id="chat" value={chat} onChange={(event) => chooseChat(event.target.value)}>
              {bundle.chats.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
            </select>
          </label>
          <label className="month-label" htmlFor="date">
            Дата
            <select id="date" value={date} onChange={(event) => chooseDate(event.target.value)}>
              {dates.map((item) => <option key={item} value={item}>{formatDate(item)}</option>)}
            </select>
          </label>
          <label className="month-label" htmlFor="compare">
            Сравнить с
            <select id="compare" value={compareDate} onChange={(event) => setCompareDate(event.target.value)}>
              {dates.map((item) => <option key={item} value={item}>{formatDate(item)}</option>)}
            </select>
          </label>
        </div>
        <div className="checks">
          <label className="check">
            <input type="checkbox" checked={criteria.noReport} onChange={(event) => setCriteria({ ...criteria, noReport: event.target.checked })} />
            Нет отчёта по поручению
          </label>
          <label className="check">
            <input type="checkbox" checked={criteria.noAnswer} onChange={(event) => setCriteria({ ...criteria, noAnswer: event.target.checked })} />
            Мне не ответили
          </label>
          <label className="check">
            <input type="checkbox" checked={criteria.silent} onChange={(event) => setCriteria({ ...criteria, silent: event.target.checked })} />
            Я не ответила сотруднику
          </label>
        </div>
      </section>

      <section className="panel" aria-labelledby="summary-title">
        <div className="panel-head">
          <div>
            <h2 id="summary-title">{chat || "Чат"}{date ? `, ${formatDate(date)}` : ""}</h2>
            <p className="hint">Смена чата и даты меняет сводку и оба графика. Вторая дата нужна для сравнения.</p>
          </div>
        </div>
        <div className="kpis">
          <Kpi label="Требуют внимания" value={ready ? String(day.findings.length) : "—"} alert />
          <Kpi label="Нет отчёта" value={shown("noReport")} alert />
          <Kpi label="Мне не ответили" value={shown("noAnswer")} alert />
          <Kpi label="Я не ответила" value={shown("silent")} alert />
          <Kpi label="Закрыто" value={ready ? String(day.closed) : "—"} accent />
          <Kpi label="Сообщений" value={ready ? String(day.messages) : "—"} />
        </div>
        <div className="charts">
          <div className="chart-box">
            <p className="hint">Что требует внимания {date ? formatDate(date) : ""}</p>
            <div className="chart-wrap">
              <canvas ref={typeRef} aria-label="Замечания выбранного дня" />
            </div>
          </div>
          <div className="chart-box">
            <p className="hint">{compareDate && compareDate !== date ? `Две даты: ${formatDate(date)} и ${formatDate(compareDate)}` : "Вторая дата совпадает с первой"}</p>
            <div className="chart-wrap">
              <canvas ref={compareRef} aria-label="Сравнение двух дат" />
            </div>
          </div>
        </div>
      </section>

      <section className="panel" aria-labelledby="findings-title">
        <div className="panel-head">
          <div>
            <h2 id="findings-title">Сообщения</h2>
            <p className="hint">Ссылка ведёт к сообщению. В демо это адрес-заготовка, в вашей выгрузке — ссылка MAX.</p>
          </div>
          <label className="month-label" htmlFor="filter">
            Показать
            <select id="filter" value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="all">Все</option>
              <option value="no-report">Нет отчёта по поручению</option>
              <option value="no-answer">Мне не ответили</option>
              <option value="silent">Я не ответила сотруднику</option>
            </select>
          </label>
        </div>
        <div className="split">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Сотрудник</th>
                  <th>Суть</th>
                  <th>Сообщение</th>
                  <th>Ссылка</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr
                    key={row.id}
                    className={row.id === selected?.id ? "clickable selected" : "clickable"}
                    onClick={() => setSelectedId(row.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") setSelectedId(row.id);
                    }}
                    tabIndex={0}
                    role="button"
                    aria-pressed={row.id === selected?.id}
                  >
                    <td>{row.employee}</td>
                    <td>
                      <TypePill type={row.type} label={row.label} />
                      <p className="hint">{row.note}</p>
                    </td>
                    <td>
                      {excerpt(row.text)}
                      <p className="hint">{row.time}</p>
                    </td>
                    <td>
                      {row.link ? (
                        <a href={row.link} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>открыть</a>
                      ) : "нет ссылки"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ready && visible.length === 0 ? (
              <p className="empty">
                {day.messages === 0
                  ? "В этом чате за выбранный день сообщений нет."
                  : "По выбранным критериям внимания ничего не требует."}
              </p>
            ) : null}
          </div>
          {selected ? <FindingCard row={selected} /> : <p className="empty">Выберите сообщение в таблице.</p>}
        </div>
      </section>
    </div>
  );
}

function FindingCard({ row }) {
  return (
    <div>
      <h3>{row.employee}</h3>
      <TypePill type={row.type} label={row.label} />
      <p className="quote">{row.text}</p>
      <dl className="money-list">
        <dt>Чат</dt>
        <dd>{row.chat}</dd>
        <dt>Дата</dt>
        <dd>{formatDate(row.date)}</dd>
        <dt>Время</dt>
        <dd>{row.time}</dd>
      </dl>
      <p className="hint">{row.note}</p>
      {row.link ? (
        <p><a className="msg-link" href={row.link} target="_blank" rel="noreferrer">Открыть сообщение</a></p>
      ) : <p className="empty">В этом сообщении ссылки нет.</p>}
      {row.replies.length > 0 ? (
        <ul className="warnings">
          {row.replies.map((reply) => (
            <li key={reply.id}>
              <ReplyPill kind={reply.kind} />
              {reply.time} {reply.author}: {reply.text}
            </li>
          ))}
        </ul>
      ) : <p className="empty">Дальше в этот день подходящего ответа нет.</p>}
    </div>
  );
}

function TypePill({ type, label }) {
  const tone = type === "silent" ? "pill danger" : "pill warn";
  return <span className={tone}>{label}</span>;
}

function ReplyPill({ kind }) {
  const tone = kind === "отчёт" ? "pill ok" : kind === "подтверждение" ? "pill warn" : "pill muted";
  return <span className={tone}>{kind}</span>;
}

function Kpi({ label, value, accent = false, alert = false }) {
  const tone = alert ? "kpi alert" : accent ? "kpi accent" : "kpi";
  return (
    <div className={tone}>
      <p className="total">{value}</p>
      <p className="hint">{label}</p>
    </div>
  );
}

function seriesFor(findings, criteria) {
  return TYPES
    .filter(([, , key]) => criteria[key])
    .map(([label, type]) => ({ label, value: countType(findings, type) }));
}

function oneSeries(labels, values, label) {
  return { labels, datasets: [bar(label, values, PALETTE[0])] };
}

function bar(label, data, color) {
  return { label, data, backgroundColor: color, borderRadius: 6, maxBarThickness: 36 };
}

function typeByKey(key) {
  return TYPES.find((item) => item[2] === key)?.[1] || "";
}

function excerpt(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > 90 ? `${clean.slice(0, 87)}…` : clean;
}

function otherDate(dates, current, prefer) {
  if (prefer && prefer !== current && dates.includes(prefer)) return prefer;
  return [...dates].reverse().find((item) => item < current) || dates.find((item) => item !== current) || current;
}

function acceptBundle(next, instructionText, setBundle, setChat, setDate, setCompareDate, setCriteria, setNotice, uploaded) {
  setBundle(next);
  const parsed = parseInstruction(instructionText, chatNames(next), allDates(next));
  if (parsed.error) {
    const first = next.chats[0];
    const list = datesOf(next, first?.name);
    const nextDate = list[list.length - 1] || "";
    setChat(first?.name || "");
    setDate(nextDate);
    setCompareDate(otherDate(list, nextDate, ""));
    setNotice({ tone: "error", text: parsed.error });
    return;
  }
  setChat(parsed.chat);
  setDate(parsed.date);
  setCriteria(parsed.criteria);
  setCompareDate(otherDate(datesOf(next, parsed.chat), parsed.date, ""));
  const check = `Проверяю «${parsed.chat}» за ${formatDate(parsed.date)}.`;
  const total = next.chats.reduce((sum, item) => sum + item.messages.length, 0);
  setNotice({
    tone: "ok",
    text: uploaded ? `Файл прочитан: ${next.chats.length} чатов, ${total} сообщений. ${check}` : check,
  });
}

function drawChart(ref, slot, config, legend) {
  const canvas = ref.current;
  if (!canvas || !config) {
    slot.current?.destroy();
    slot.current = null;
    return;
  }
  const options = {
    animation: false,
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: legend, labels: { color: "#6d645b", boxWidth: 12 } },
      tooltip: {
        callbacks: {
          label(item) {
            const prefix = item.dataset.label ? `${item.dataset.label}: ` : "";
            return ` ${prefix}${item.parsed.y}`;
          },
        },
      },
    },
    scales: {
      x: { ...AXIS, ticks: { ...AXIS.ticks, color: "#1e1a16", font: { size: 11 } }, grid: { display: false } },
      y: { ...AXIS, beginAtZero: true, ticks: { ...AXIS.ticks, precision: 0 } },
    },
  };
  if (slot.current) {
    slot.current.data.labels = config.labels;
    slot.current.data.datasets = config.datasets;
    slot.current.options = options;
    slot.current.update("none");
    return;
  }
  slot.current = new Chart(canvas, { type: "bar", data: config, options });
}
