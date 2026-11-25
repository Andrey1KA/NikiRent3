const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTH_INDEX = Object.fromEntries(MONTHS.map((name, index) => [name, String(index + 1).padStart(2, "0")]));

const LABELS = {
  "no-report": "Нет отчёта по поручению",
  "no-answer": "Мне не ответили",
  silent: "Я не ответила сотруднику",
};

const HEADER = {
  чат: "chat",
  дата: "date",
  время: "time",
  автор: "author",
  роль: "role",
  текст: "text",
  ссылка: "link",
  id: "id",
  chat: "chat",
  date: "date",
  time: "time",
  author: "author",
  role: "role",
  text: "text",
  link: "link",
};

const REQUIRED = ["chat", "date", "time", "author", "role", "text"];

export function fold(value) {
  return String(value ?? "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

export function formatDate(iso) {
  if (!iso) return "";
  const [year, month, day] = iso.split("-");
  const name = MONTHS[Number(month) - 1];
  if (!name) return iso;
  return `${Number(day)} ${name} ${year}`;
}

export function isAck(text) {
  const source = fold(text).replace(/[!.,…]+/g, " ").replace(/\s+/g, " ").trim();
  if (!source || source.length > 40) return false;
  return /^(ок|ok|окей|принял[аи]?|понял[аи]?|сделаю|сделаем|хорошо|ага|увидел[аи]?|принято|беру в работу|в работе|скоро|ясно|плюс)( (ок|сделаю|сделаем|понял[аи]?|принял[аи]?|хорошо))?$/.test(source);
}

export function isReport(text) {
  if (isAck(text)) return false;
  const source = fold(text);
  if (/(готово|сделал[аи]|отправил[аи]|выложил[аи]|выполнил[аи]|закрыл[аи]|написал[аи]|получил[аи]|передал[аи]|забрал[аи]|альбом|почт|замечан|график)/.test(source)) {
    return true;
  }
  return !source.includes("?") && /\d/.test(source);
}

export function isQuestion(text) {
  const source = fold(text);
  if (source.includes("?")) return true;
  return /^(когда|где|куда|сколько|почему|зачем|кто|что|как|можно|подскаж)/.test(source);
}

export function isTask(text) {
  return /(подготов|пришл|отправ|проверь|проверьте|напиш|позвони|созвон|вылож|собери|соберите|организ|оформи|свяжись|отпиш|забер|закрой|закройте|поруча)/.test(fold(text));
}

export function replyKind(text) {
  if (isAck(text)) return "подтверждение";
  if (isReport(text)) return "отчёт";
  if (isQuestion(text)) return "вопрос";
  return "реплика";
}

function looksLikeAnswer(text) {
  const source = fold(text);
  return /^(да|нет|можно|нельзя|подтвержда|конечно|ок\b|не надо|не нужно)/.test(source) || /(^| )да[, ]/.test(source);
}

const NOT_NAMES = new Set(["да", "нет", "ок", "хорошо", "можно", "нельзя"]);

export function addressee(text, names) {
  const lead = String(text || "").match(/^([А-ЯЁ][а-яё]{1,})[,:]/);
  if (lead && !NOT_NAMES.has(fold(lead[1]))) {
    return names.find((name) => fold(name) === fold(lead[1])) || lead[1];
  }
  let found = null;
  let pos = Infinity;
  for (const name of names) {
    const match = new RegExp(`(^|[^А-Яа-яЁё])${escapeReg(name)}([^А-Яа-яЁё]|$)`, "i").exec(text);
    if (match && match.index < pos) {
      pos = match.index;
      found = name;
    }
  }
  return found;
}

export function chatNames(bundle) {
  return bundle.chats.map((chat) => chat.name);
}

export function allDates(bundle) {
  return [...new Set(bundle.chats.flatMap((chat) => chat.messages.map((item) => item.date)))].sort();
}

export function datesOf(bundle, chatName) {
  const chat = bundle.chats.find((item) => item.name === chatName);
  if (!chat) return [];
  return [...new Set(chat.messages.map((item) => item.date))].sort();
}

export function messagesOf(bundle, chatName, date) {
  const chat = bundle.chats.find((item) => item.name === chatName);
  if (!chat) return [];
  return chat.messages.filter((item) => item.date === date);
}

export function parseInstruction(text, chats, dates) {
  const source = String(text || "").trim();
  if (!source) return { error: "Напишите, какой чат и за какой день проверить." };
  const quoted = [...source.matchAll(/«([^»]+)»|"([^"]+)"/g)].map((match) => (match[1] || match[2]).trim());
  let chat = null;
  for (const part of quoted) {
    const hit = chats.find((name) => name.toLowerCase() === part.toLowerCase());
    if (hit) {
      chat = hit;
      break;
    }
  }
  if (!chat) {
    chat = [...chats].sort((a, b) => b.length - a.length).find((name) => source.toLowerCase().includes(name.toLowerCase())) || null;
  }
  if (!chat) return { error: "В поручении не вижу чат из загруженных." };
  const date = matchDate(source, dates);
  if (!date) return { error: "В поручении не вижу дату." };
  return { chat, date, criteria: criteriaFrom(source) };
}

export function analyze(messages, criteria) {
  const sorted = [...messages].sort((a, b) => a.time.localeCompare(b.time) || String(a.id).localeCompare(String(b.id)));
  const names = [...new Set(sorted.filter((item) => item.role !== "manager").map((item) => item.author))];
  const findings = [];
  let closed = 0;
  let current = null;
  const pending = [];

  for (const msg of sorted) {
    if (msg.role === "manager") {
      closed += finish(current, criteria, findings);
      closed += closeStaffQuestions(msg, names, pending);
      const kind = isTask(msg.text) ? "task" : isQuestion(msg.text) ? "question" : null;
      current = { msg, who: addressee(msg.text, names), kind, replies: [] };
      continue;
    }
    if (current?.kind && (!current.who || current.who === msg.author)) current.replies.push(msg);
    if (isQuestion(msg.text) && !isReport(msg.text)) pending.push({ msg, author: msg.author });
  }
  closed += finish(current, criteria, findings);
  if (criteria.silent) {
    for (const item of pending) findings.push(staffFinding(item));
  }
  findings.sort((a, b) => a.time.localeCompare(b.time) || a.employee.localeCompare(b.employee, "ru"));
  return { findings, closed, messages: sorted.length };
}

export function countType(findings, type) {
  return findings.filter((item) => item.type === type).length;
}

export function parseExport(data) {
  if (!data || !Array.isArray(data.chats)) throw new Error("В файле нужен список чатов");
  const chats = data.chats.map((chat) => {
    if (!chat?.name || !String(chat.name).trim()) throw new Error("У чата нет названия");
    if (!Array.isArray(chat.messages)) throw new Error(`В чате «${chat.name}» нет сообщений`);
    return {
      name: String(chat.name).trim(),
      messages: chat.messages.map((msg, index) => normalizeMessage({ ...msg, chat: chat.name }, index, true)),
    };
  });
  if (!chats.length) throw new Error("В файле нет чатов");
  assertUnique(chats);
  return { chats };
}

export function parseWorkbook(XLSX, buffer) {
  let workbook;
  try {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    workbook = XLSX.read(bytes, { type: "array", cellDates: false });
  } catch {
    throw new Error("Файл не похож на таблицу Excel");
  }
  const sheetName = workbook.SheetNames.find((name) => fold(name).includes("сообщ")) || workbook.SheetNames[0];
  if (!sheetName) throw new Error("В книге нет листов");
  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: "" });
  return rowsToBundle(matrix);
}

export function parseCsv(XLSX, text) {
  let workbook;
  try {
    workbook = XLSX.read(String(text), { type: "string", cellDates: false });
  } catch {
    throw new Error("Файл не похож на CSV");
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
  return rowsToBundle(matrix);
}

function criteriaFrom(text) {
  const source = fold(text);
  const noReport = /поручен|не отчит|без отчета/.test(source);
  const noAnswer = /без ответа|мне не ответил|вопрос/.test(source);
  const silent = /не ответила|сам[аи] не ответил|я не ответил/.test(source);
  if (!noReport && !noAnswer && !silent) return { noReport: true, noAnswer: true, silent: true };
  return { noReport, noAnswer, silent };
}

function matchDate(text, dates) {
  const available = dates || [];
  const word = text.match(/(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+(\d{4}))?/i);
  let day;
  let month;
  let year;
  if (word) {
    day = word[1].padStart(2, "0");
    month = MONTH_INDEX[fold(word[2])];
    year = word[3] || "";
  } else {
    const numeric = text.match(/(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/);
    if (!numeric) return "";
    day = numeric[1].padStart(2, "0");
    month = numeric[2].padStart(2, "0");
    year = numeric[3] || "";
    if (year.length === 2) year = `20${year}`;
  }
  if (year) return `${year}-${month}-${day}`;
  const hits = available.filter((iso) => iso.slice(5) === `${month}-${day}`);
  if (hits.length) return hits[hits.length - 1];
  const years = [...new Set(available.map((iso) => iso.slice(0, 4)))];
  return `${years.length === 1 ? years[0] : "2026"}-${month}-${day}`;
}

function finish(item, criteria, findings) {
  if (!item?.kind) return 0;
  const hasReport = item.replies.some((msg) => isReport(msg.text));
  const hasAnswer = item.replies.some((msg) => !isAck(msg.text) && !(isQuestion(msg.text) && !isReport(msg.text)));
  if (item.kind === "task" && hasReport) return 1;
  if (item.kind === "question" && hasAnswer) return 1;
  const hasAck = item.replies.some((msg) => isAck(msg.text));
  if (item.kind === "task" && criteria.noReport) findings.push(caseFinding(item, "no-report", hasAck));
  if (item.kind === "question" && criteria.noAnswer) findings.push(caseFinding(item, "no-answer", hasAck));
  return 0;
}

function closeStaffQuestions(msg, names, pending) {
  const who = addressee(msg.text, names);
  const latest = pending[pending.length - 1];
  let closed = 0;
  for (let index = pending.length - 1; index >= 0; index -= 1) {
    const item = pending[index];
    const addressed = who ? who === item.author : item === latest;
    if (!addressed) continue;
    const freshTopic = (isTask(msg.text) || isQuestion(msg.text)) && !looksLikeAnswer(msg.text);
    if (freshTopic) continue;
    pending.splice(index, 1);
    closed += 1;
  }
  return closed;
}

function caseFinding(item, type, hasAck) {
  const note = type === "no-report"
    ? (hasAck ? "Есть только подтверждение, результата нет." : "После поручения отчёта нет.")
    : (hasAck ? "Есть только подтверждение, ответа по существу нет." : "Ответа нет.");
  return {
    id: `${type}:${item.msg.id}`,
    type,
    label: LABELS[type],
    note,
    chat: item.msg.chat,
    date: item.msg.date,
    time: item.msg.time,
    employee: item.who || "Чат",
    text: item.msg.text,
    link: item.msg.link || "",
    replies: item.replies.map(mapReply),
  };
}

function staffFinding(item) {
  return {
    id: `silent:${item.msg.id}`,
    type: "silent",
    label: LABELS.silent,
    note: "После вопроса сотрудника вашего ответа нет.",
    chat: item.msg.chat,
    date: item.msg.date,
    time: item.msg.time,
    employee: item.author,
    text: item.msg.text,
    link: item.msg.link || "",
    replies: [],
  };
}

function mapReply(msg) {
  return { id: msg.id, time: msg.time, author: msg.author, text: msg.text, kind: replyKind(msg.text) };
}

function rowsToBundle(matrix) {
  const headerIndex = matrix.findIndex((row) => row.some((cell) => HEADER[fold(cell)]));
  if (headerIndex < 0) throw new Error("В таблице нужны колонки: чат, дата, время, автор, роль, текст, ссылка");
  const columns = matrix[headerIndex].map((cell) => HEADER[fold(cell)] || "");
  for (const key of REQUIRED) {
    if (!columns.includes(key)) throw new Error("В таблице нужны колонки: чат, дата, время, автор, роль, текст, ссылка");
  }
  const grouped = new Map();
  const chats = [];
  matrix.slice(headerIndex + 1).forEach((row, index) => {
    if (!row.some((cell) => String(cell ?? "").trim())) return;
    const pick = (key) => row[columns.indexOf(key)];
    const chatName = String(pick("chat") ?? "").trim();
    if (!chatName) throw new Error(`Строка ${headerIndex + index + 2}: нет чата`);
    const message = normalizeMessage({
      id: pick("id"),
      chat: chatName,
      date: pick("date"),
      time: pick("time"),
      author: pick("author"),
      role: pick("role"),
      text: pick("text"),
      link: pick("link"),
    }, index, false);
    if (!grouped.has(chatName)) {
      const chat = { name: chatName, messages: [] };
      grouped.set(chatName, chat);
      chats.push(chat);
    }
    grouped.get(chatName).messages.push(message);
  });
  if (!chats.length) throw new Error("В файле нет сообщений");
  assertUnique(chats);
  return { chats };
}

function normalizeMessage(msg, index, loose) {
  const author = String(msg.author ?? "").trim();
  const text = String(msg.text ?? "").trim();
  if (!author) throw new Error(`Строка ${index + 2}: нет автора`);
  if (!text) throw new Error(`Строка ${index + 2}: нет текста`);
  const date = asDate(msg.date);
  const time = asTime(msg.time);
  return {
    id: String(msg.id ?? "").trim() || `${fold(msg.chat)}-${date}-${time}-${index + 1}`,
    chat: String(msg.chat ?? "").trim(),
    date,
    time,
    author,
    role: normalizeRole(msg.role, author, loose),
    text,
    link: String(msg.link ?? "").trim(),
  };
}

function normalizeRole(role, author, loose) {
  const value = fold(role);
  if (["manager", "руководитель", "вы", "я"].includes(value)) return "manager";
  if (["staff", "сотрудник"].includes(value)) return "staff";
  if (loose && fold(author) === "руководитель") return "manager";
  throw new Error(`Не понял роль «${role || "пусто"}» у ${author || "сообщения"}`);
}

function asDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  if (typeof value === "number" && value > 20000 && value < 80000) {
    const utc = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    return utc.toISOString().slice(0, 10);
  }
  const source = String(value ?? "").trim();
  const iso = source.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ru = source.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (ru) return `${ru[3]}-${ru[2].padStart(2, "0")}-${ru[1].padStart(2, "0")}`;
  throw new Error(`Не понял дату «${source || "пусто"}»`);
}

function asTime(value) {
  if (typeof value === "number" && value >= 0 && value < 1) {
    const total = Math.round(value * 24 * 60);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }
  const match = String(value ?? "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) throw new Error(`Не понял время «${value || "пусто"}»`);
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function assertUnique(chats) {
  const seen = new Set();
  for (const chat of chats) {
    for (const msg of chat.messages) {
      if (seen.has(msg.id)) throw new Error(`Повторяется id сообщения «${msg.id}»`);
      seen.add(msg.id);
    }
  }
}

function escapeReg(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
