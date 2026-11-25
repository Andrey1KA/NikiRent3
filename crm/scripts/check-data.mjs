import { readFileSync } from "node:fs";
import XLSX from "xlsx";
import {
  allDates,
  analyze,
  chatNames,
  countType,
  isAck,
  isQuestion,
  isReport,
  isTask,
  messagesOf,
  parseCsv,
  parseExport,
  parseInstruction,
  parseWorkbook,
} from "../lib/chats.mjs";

const bundle = parseExport(JSON.parse(readFileSync(new URL("../public/data/chats.json", import.meta.url), "utf8")));

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: ${actual} !== ${expected}`);
}

function signature(findings) {
  return findings.map((item) => `${item.type}|${item.employee}|${item.time}`).join(",");
}

function day(chat, date, criteria = { noReport: true, noAnswer: true, silent: true }) {
  return analyze(messagesOf(bundle, chat, date), criteria);
}

assertEqual(isAck("Приняла"), true, "приняла");
assertEqual(isAck("Ок, сделаю"), true, "ок сделаю");
assertEqual(isAck("В работе"), true, "в работе");
assertEqual(isReport("Приняла"), false, "приняла не отчёт");
assertEqual(isReport("Ок, сделаю"), false, "ок не отчёт");
assertEqual(isReport("Готово, фото в альбоме, уборка в 12:10, замечаний нет."), true, "отчёт Кати");
assertEqual(isReport("Завтра 4 заезда: ЛП 10, ЛП 20, Ленина 108 и ВЛКСМ 56."), true, "ответ Ольги");
assertEqual(isQuestion("Что уже сделали?"), true, "вопрос Игорю");
assertEqual(isTask("Марина, подготовь сводку по жалобам за неделю и пришли до 15:00."), true, "поручение Марине");
assertEqual(isTask("Игорь, гость в ЛП 10 написал, что нет горячей воды. Что уже сделали?"), false, "вопрос не поручение");

const care22 = day("Отдел заботы", "2026-11-22");
assertEqual(care22.messages, 10, "заботы 22 сообщения");
assertEqual(care22.closed, 2, "заботы 22 закрыто");
assertEqual(countType(care22.findings, "no-report"), 2, "заботы 22 без отчёта");
assertEqual(countType(care22.findings, "no-answer"), 1, "заботы 22 без ответа");
assertEqual(countType(care22.findings, "silent"), 1, "заботы 22 я не ответила");
assertEqual(
  signature(care22.findings),
  "no-report|Марина|09:10,no-answer|Игорь|09:40,silent|Ольга|11:05,no-report|Марина|17:05",
  "заботы 22 состав",
);
if (care22.findings.some((item) => item.employee === "Катя")) throw new Error("Катя не должна попасть в сводку 22 ноября");
assertEqual(care22.findings[0].note.includes("подтверждение"), true, "Марина только подтвердила");
assertEqual(care22.findings[0].link.includes("care-22-01"), true, "ссылка на поручение");
assertEqual(care22.findings[1].note, "Ответа нет.", "Игорь без ответа");

const care21 = day("Отдел заботы", "2026-11-21");
assertEqual(signature(care21.findings), "silent|Марина|14:15", "заботы 21");
assertEqual(care21.closed, 2, "заботы 21 закрыто");

const maids22 = day("Горничные", "2026-11-22");
assertEqual(signature(maids22.findings), "no-report|Света|08:30,silent|Дима|18:10", "горничные 22");
assertEqual(maids22.closed, 2, "горничные 22 закрыто");

const maids21 = day("Горничные", "2026-11-21");
assertEqual(maids21.findings.length, 0, "горничные 21 пусто");
assertEqual(maids21.closed, 1, "горничные 21 закрыто");

const rent = day("Аренда", "2026-11-20");
assertEqual(signature(rent.findings), "no-answer|Павел|15:00,silent|Павел|16:40", "аренда");
assertEqual(rent.closed, 1, "аренда закрыто");

const reportsOff = day("Отдел заботы", "2026-11-22", { noReport: false, noAnswer: true, silent: true });
assertEqual(reportsOff.findings.length, 2, "без критерия отчёта");
assertEqual(countType(reportsOff.findings, "no-report"), 0, "отчёты выключены");

const parsed = parseInstruction(
  "Проверь чат «Отдел заботы» за 22 ноября. Найди все мои поручения, по которым сотрудники не отчитались, вопросы без ответа и сообщения сотрудников, на которые я сама не ответила.",
  chatNames(bundle),
  allDates(bundle),
);
assertEqual(parsed.chat, "Отдел заботы", "поручение чат");
assertEqual(parsed.date, "2026-11-22", "поручение дата");
assertEqual(parsed.criteria.noReport && parsed.criteria.noAnswer && parsed.criteria.silent, true, "поручение критерии");

const onlyTasks = parseInstruction("Проверь чат Горничные за 21.11.2026, только поручения без отчёта", chatNames(bundle), allDates(bundle));
assertEqual(onlyTasks.chat, "Горничные", "горничные из текста");
assertEqual(onlyTasks.date, "2026-11-21", "21.11 из текста");
assertEqual(onlyTasks.criteria.noReport, true, "только поручения");
assertEqual(onlyTasks.criteria.noAnswer, false, "вопросы не просили");
assertEqual(onlyTasks.criteria.silent, false, "свои ответы не просили");

const rows = [["чат", "дата", "время", "автор", "роль", "текст", "ссылка", "id"]];
for (const chat of bundle.chats) {
  for (const msg of chat.messages) {
    rows.push([chat.name, msg.date, msg.time, msg.author, msg.role === "manager" ? "руководитель" : "сотрудник", msg.text, msg.link, msg.id]);
  }
}
const sheet = XLSX.utils.aoa_to_sheet(rows);
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, sheet, "Сообщения");
const fromXlsx = parseWorkbook(XLSX, XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
const fromCsv = parseCsv(XLSX, csv);
assertEqual(
  signature(analyze(messagesOf(fromXlsx, "Отдел заботы", "2026-11-22"), { noReport: true, noAnswer: true, silent: true }).findings),
  signature(care22.findings),
  "xlsx",
);
assertEqual(
  signature(analyze(messagesOf(fromCsv, "Отдел заботы", "2026-11-22"), { noReport: true, noAnswer: true, silent: true }).findings),
  signature(care22.findings),
  "csv",
);

console.log("ok");
