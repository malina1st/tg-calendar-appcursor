// Поддержка Telegram WebApp (если открыто внутри Telegram)
const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (tg) {
  tg.ready();
  tg.expand();
}

// ============= НАСТРОЙКИ =============
const STORAGE_KEY = "tg_calendar_events_v1";

// Настройки Supabase (общий сервер для всех)
const SUPABASE_URL = "https://goctusklfhuygbpobqts.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_GZ8V9A3uRlGx7s6sfvy3Vw_dPdsILiW";
const EVENTS_ENDPOINT = `${SUPABASE_URL}/rest/v1/events`;

// Разрешённые пользователи Telegram (по user.id из WebApp)
// Сюда нужно вписать числовые ID 18 пользователей, например:
// const ALLOWED_TELEGRAM_USER_IDS = [123456789, 987654321, ...];
const ALLOWED_TELEGRAM_USER_IDS = [
  231645712, // Дмитрий
  343074507, // Рита
  404517792, // Лейла
  280705269, // Сабина
  857772788, // Михаил
  495188991, // Сергей
];

function getTelegramUserId() {
  if (!tg) return null;
  // 1) Пробуем готовый объект (некоторые клиенты отдают его)
  const unsafe = tg.initDataUnsafe || {};
  let user = unsafe.user;
  if (!user && tg.initData) {
    // 2) Парсим сырую строку initData (формат: query_id=...&user=%7B%22id%22%3A123...%7D)
    try {
      const params = new URLSearchParams(tg.initData);
      const userStr = params.get("user");
      if (userStr) user = JSON.parse(decodeURIComponent(userStr));
    } catch (e) {
      // игнорируем ошибки парсинга
    }
  }
  if (!user || (user.id !== undefined && user.id === null)) return null;
  const id = typeof user.id === "number" ? user.id : parseInt(String(user.id), 10);
  return Number.isNaN(id) ? null : id;
}

function isTelegramUserAllowed() {
  if (!tg) {
    return true;
  }

  const userId = getTelegramUserId();
  if (userId === null) {
    return false;
  }

  if (ALLOWED_TELEGRAM_USER_IDS.length === 0) {
    return false;
  }

  return ALLOWED_TELEGRAM_USER_IDS.includes(userId);
}

// Заголовки для Supabase: ключ sb_publishable_ передаём только в apikey, JWT (eyJ) — в apikey и Authorization
function getSupabaseHeaders(extra = {}) {
  const key = SUPABASE_ANON_KEY;
  const isJwt = key.startsWith("eyJ");
  const headers = {
    apikey: key,
    ...extra,
  };
  if (isJwt) {
    headers.Authorization = `Bearer ${key}`;
  }
  return headers;
}

// ============= ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =============
function loadEvents() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    console.error("Ошибка загрузки событий", e);
    return [];
  }
}

function saveEvents(events) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch (e) {
    console.error("Ошибка сохранения событий", e);
  }
}

function formatDate(date) {
  // Используем локальное время, чтобы не было сдвига дня из‑за часового пояса
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`; // YYYY-MM-DD
}

function formatDateHuman(date) {
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function getUpcomingEvents(events, limit = 10) {
  const todayStr = formatDate(new Date());

  const normalized = events
    .map((e) => {
      const startDate = e.startDate || (e.dates && e.dates[0]);
      if (!startDate) return null;
      return { ...e, startDate };
    })
    .filter(Boolean)
    .filter((e) => e.startDate >= todayStr);

  normalized.sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
  return normalized.slice(0, limit);
}

function buildDatesRange(startDateStr, endDateStr) {
  const dates = [];
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return [startDateStr];
  }

  let current = start;
  while (current <= end) {
    dates.push(formatDate(current));
    current = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
  }
  return dates;
}

// Загрузить все события с сервера Supabase. При ошибке возвращает null (не перезаписывать локальные данные).
async function fetchEventsFromServer() {
  try {
    const res = await fetch(`${EVENTS_ENDPOINT}?select=*`, {
      headers: getSupabaseHeaders(),
    });

    if (!res.ok) {
      console.error("Ошибка ответа сервера", await res.text());
      return null;
    }

    const rows = await res.json();
    return rows.map((row) => {
      const startDate = row.date;
      const endDate = row.end_date || row.date;
      return {
        id: row.id,
        startDate,
        endDate,
        startTime: row.start_time || "",
        endTime: row.end_time || "",
        dates: buildDatesRange(startDate, endDate),
        title: row.title,
        note: row.note || "",
        location: row.location_url || "",
      };
    });
  } catch (e) {
    console.error("Ошибка загрузки с сервера", e);
    return null;
  }
}

// Сохранить новое событие на сервере Supabase
async function saveEventToServer(event) {
  try {
    const body = {
      date: event.startDate,
      end_date: event.endDate,
      start_time: event.startTime || null,
      end_time: event.endTime || null,
      title: event.title,
      note: event.note || null,
      location_url: event.location || null,
    };

    const res = await fetch(EVENTS_ENDPOINT, {
      method: "POST",
      headers: getSupabaseHeaders({
        "Content-Type": "application/json",
        Prefer: "return=representation",
      }),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error("Ошибка сохранения на сервере", await res.text());
      return null;
    }

    const [row] = await res.json();
    const startDate = row.date;
    const endDate = row.end_date || row.date;
    return {
      id: row.id,
      startDate,
      endDate,
      startTime: row.start_time || "",
      endTime: row.end_time || "",
      dates: buildDatesRange(startDate, endDate),
      title: row.title,
      note: row.note || "",
    };
  } catch (e) {
    console.error("Ошибка сети при сохранении", e);
    return null;
  }
}

// Обновить событие на сервере Supabase
async function updateEventOnServer(id, updates) {
  try {
    const res = await fetch(`${EVENTS_ENDPOINT}?id=eq.${id}`, {
      method: "PATCH",
      headers: getSupabaseHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(updates),
    });

    if (!res.ok) {
      console.error("Ошибка обновления на сервере", await res.text());
    }
  } catch (e) {
    console.error("Ошибка сети при обновлении", e);
  }
}

// Удалить событие на сервере Supabase
async function deleteEventFromServer(id) {
  try {
    const res = await fetch(`${EVENTS_ENDPOINT}?id=eq.${id}`, {
      method: "DELETE",
      headers: getSupabaseHeaders(),
    });

    if (!res.ok) {
      console.error("Ошибка удаления на сервере", await res.text());
    }
  } catch (e) {
    console.error("Ошибка сети при удалении", e);
  }
}

// ============= СОСТОЯНИЕ =============
const state = {
  year: new Date().getFullYear(),
  selectedDate: null, // по умолчанию дата не выбрана
  expandedMonth: null, // 0..11 — развёрнутый месяц на весь экран; null — вид года
  events: loadEvents(), // [{ id, startDate, endDate, dates:[YYYY-MM-DD], title, note, startTime, endTime }]
};

// ============= РЕНДЕР КАЛЕНДАРЯ ГОДА =============
const MONTH_NAMES = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

// Особые дни рождения (месяцы: 0 - январь, 11 - декабрь)
const BIRTHDAYS = [
  { name: "Дмитрия", day: 19, month: 4, year: 1987 },
  { name: "Риты", day: 15, month: 4, year: 1992 },
  { name: "Сергея", day: 26, month: 4, year: 1992 },
  { name: "Екатерины", day: 26, month: 2, year: 1993 },
  { name: "Сабины", day: 26, month: 2, year: 1992 },
  { name: "Станислава", day: 22, month: 0, year: 1987 },
  { name: "Полины", day: 30, month: 11, year: 1992 },
  { name: "Елены", day: 12, month: 0, year: 1991 },
  { name: "Никиты", day: 19, month: 7, year: 1991 },
  { name: "Карины", day: 28, month: 6, year: 1994 },
  { name: "Рустика", day: 31, month: 0, year: 1991 },
  { name: "Лейлы", day: 28, month: 0, year: 1996 },
  { name: "Михаила", day: 18, month: 5, year: 1991 },
  { name: "Валентины", day: 10, month: 0, year: 1989 },
  { name: "Марины", day: 25, month: 3, year: 1995 },
  { name: "Кости", day: 9, month: 6, year: 1991 },
  { name: "Даши", day: 26, month: 5, year: 1995 },
  { name: "Андрея", day: 10, month: 11, year: 1990 },
];

const WEEKDAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function renderYearCalendar() {
  const container = document.getElementById("calendar-year");
  const yearLabel = document.getElementById("current-year");
  container.innerHTML = "";
  yearLabel.innerHTML = `Год: <span class="current-year-number">${state.year}</span>`;

  // Карта "дата -> информация о диапазоне события"
  const eventsRangeByDate = {};
  state.events.forEach((e) => {
    const startDate = e.startDate || (e.dates && e.dates[0]);
    const endDate = e.endDate || startDate;
    if (!startDate) return;

    const rangeDates = buildDatesRange(startDate, endDate);

    if (rangeDates.length === 1) {
      const d = rangeDates[0];
      if (!eventsRangeByDate[d]) {
        eventsRangeByDate[d] = { single: true };
      } else {
        eventsRangeByDate[d].single = true;
      }
    } else {
      rangeDates.forEach((d, idx) => {
        if (!eventsRangeByDate[d]) {
          eventsRangeByDate[d] = { single: false, start: false, middle: false, end: false };
        }
        if (idx === 0) {
          eventsRangeByDate[d].start = true;
        } else if (idx === rangeDates.length - 1) {
          eventsRangeByDate[d].end = true;
        } else {
          eventsRangeByDate[d].middle = true;
        }
      });
    }
  });

  const todayStr = formatDate(new Date());

  // Режим развёрнутого месяца: тап вне месяца / вне блока событий / вне шапки — возврат к году
  const appEl = document.querySelector(".app");
  const appMain = document.querySelector(".app-main");
  const existingBackdrop = document.getElementById("month-expanded-backdrop");
  if (existingBackdrop) existingBackdrop.remove();

  if (state.expandedMonth !== null) {
    const backdrop = document.createElement("div");
    backdrop.id = "month-expanded-backdrop";
    backdrop.className = "month-expanded-backdrop";
    backdrop.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.expandedMonth = null;
      const app = document.querySelector(".app");
      if (app) app.classList.add("month-just-closed");
      const clearJustClosed = () => {
        app && app.classList.remove("month-just-closed");
        document.removeEventListener("click", clearJustClosed);
        document.removeEventListener("touchstart", clearJustClosed, { capture: true });
      };
      document.addEventListener("click", clearJustClosed, { once: true });
      document.addEventListener("touchstart", clearJustClosed, { once: true, capture: true });
      renderYearCalendar();
      renderSidePanel();
    });
    document.body.appendChild(backdrop);

    const wrap = document.createElement("div");
    wrap.className = "month-expanded-wrap";
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) {
        e.preventDefault();
        e.stopPropagation();
        state.expandedMonth = null;
        const app = document.querySelector(".app");
        if (app) app.classList.add("month-just-closed");
        const clearJustClosed = () => {
          app && app.classList.remove("month-just-closed");
          document.removeEventListener("click", clearJustClosed);
          document.removeEventListener("touchstart", clearJustClosed, { capture: true });
        };
        document.addEventListener("click", clearJustClosed, { once: true });
        document.addEventListener("touchstart", clearJustClosed, { once: true, capture: true });
        renderYearCalendar();
        renderSidePanel();
      }
    });
    const card = buildMonthCard(state.expandedMonth, eventsRangeByDate, todayStr, true);
    card.classList.add("month-card-expanded");
    card.addEventListener("click", (e) => e.stopPropagation());
    wrap.appendChild(card);
    container.appendChild(wrap);
    container.classList.add("calendar-year-expanded");
    if (appMain) appMain.classList.add("month-expanded");
    if (appEl) appEl.classList.add("month-expanded");
    return;
  }
  container.classList.remove("calendar-year-expanded");
  if (appMain) appMain.classList.remove("month-expanded");
  if (appEl) appEl.classList.remove("month-expanded");

  for (let month = 0; month < 12; month++) {
    const card = buildMonthCard(month, eventsRangeByDate, todayStr, false);
    card.addEventListener("click", (e) => {
      if (e.target.closest(".day-cell")) return;
      state.expandedMonth = month;
      renderYearCalendar();
      renderSidePanel();
    });
    container.appendChild(card);
  }
}

function buildMonthCard(month, eventsRangeByDate, todayStr, isExpanded) {
  const card = document.createElement("div");
  card.className = "month-card";

  const title = document.createElement("div");
  title.className = "month-title";
  const titleText = document.createElement("span");
  titleText.textContent = MONTH_NAMES[month];
  title.appendChild(titleText);
  card.appendChild(title);

  const weekdaysRow = document.createElement("div");
  weekdaysRow.className = "weekdays";
  WEEKDAY_SHORT.forEach((w) => {
    const el = document.createElement("div");
    el.className = "weekday";
    el.textContent = w;
    weekdaysRow.appendChild(el);
  });
  card.appendChild(weekdaysRow);

  const daysGrid = document.createElement("div");
  daysGrid.className = "days-grid";

  const firstDay = new Date(state.year, month, 1);
  const firstWeekday = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(state.year, month + 1, 0).getDate();

  for (let i = 0; i < firstWeekday; i++) {
    const empty = document.createElement("div");
    empty.className = "day-cell empty";
    daysGrid.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateObj = new Date(state.year, month, day);
    const dateStr = formatDate(dateObj);

    const cell = document.createElement("div");
    cell.className = "day-cell";
    cell.textContent = day;
    cell.dataset.date = dateStr;

    if (dateStr === todayStr) cell.classList.add("day-today");
    if (state.selectedDate && dateStr === state.selectedDate) cell.classList.add("day-selected");

    const isBirthdayDate = BIRTHDAYS.some(
      (b) => dateObj.getMonth() === b.month && dateObj.getDate() === b.day
    );
    if (isBirthdayDate) cell.classList.add("day-birthday");

    const rangeInfo = eventsRangeByDate[dateStr];
    if (rangeInfo) {
      if (rangeInfo.single && !rangeInfo.start && !rangeInfo.middle && !rangeInfo.end) {
        cell.classList.add("day-range-single");
      } else if (rangeInfo.start && !rangeInfo.middle && !rangeInfo.end) {
        cell.classList.add("day-range-start");
      } else if (rangeInfo.middle && !rangeInfo.start && !rangeInfo.end) {
        cell.classList.add("day-range-middle");
      } else if (rangeInfo.end && !rangeInfo.start && !rangeInfo.middle) {
        cell.classList.add("day-range-end");
      } else {
        cell.classList.add("day-range-single");
      }
    }

    cell.addEventListener("click", (e) => {
      const clickedDate = e.currentTarget.dataset.date;
      if (!clickedDate) return;
      state.selectedDate = clickedDate;
      renderYearCalendar();
      renderSidePanel();
      openEventModal();
    });

    daysGrid.appendChild(cell);
  }

  card.appendChild(daysGrid);
  return card;
}

// События, попадающие в заданный месяц (год + месяц 0..11)
function getEventsForMonth(events, year, month) {
  const monthStart = formatDate(new Date(year, month, 1));
  const monthEnd = formatDate(new Date(year, month + 1, 0));
  return events.filter((e) => {
    const start = e.startDate || (e.dates && e.dates[0]);
    const end = e.endDate || start;
    if (!start) return false;
    return !(end < monthStart || start > monthEnd);
  }).sort((a, b) => {
    const d1 = a.startDate || (a.dates && a.dates[0]);
    const d2 = b.startDate || (b.dates && b.dates[0]);
    return (d1 || "").localeCompare(d2 || "");
  });
}

// ============= РЕНДЕР ПРАВОЙ ПАНЕЛИ =============
function renderSidePanel() {
  const titleEl = document.getElementById("side-panel-title");
  const upcomingList = document.getElementById("upcoming-events");
  if (!upcomingList) return;

  const isExpandedMonth = state.expandedMonth !== null;
  if (titleEl) {
    titleEl.textContent = isExpandedMonth ? "События этого месяца" : "Ближайшие события";
  }

  const list = isExpandedMonth
    ? getEventsForMonth(state.events, state.year, state.expandedMonth)
    : getUpcomingEvents(state.events, 3);

  upcomingList.innerHTML = "";
  if (list.length === 0) {
    const li = document.createElement("li");
    li.className = "event-empty";
    li.textContent = isExpandedMonth ? "В этом месяце нет событий." : "Ближайших событий нет.";
    upcomingList.appendChild(li);
  } else {
    list.forEach((e) => {
      const li = document.createElement("li");
      li.className = "event-item";

      const header = document.createElement("div");
      header.className = "event-item-header";

      const title = document.createElement("div");
      title.className = "event-item-title";
      title.textContent = e.title;

      const dateLabel = document.createElement("div");
      dateLabel.className = "event-item-date";

      const startDate = e.startDate || (e.dates && e.dates[0]);
      const endDate = e.endDate || startDate;
      const sameDay = startDate === endDate;

      const startDateObj = new Date(startDate);
      const endDateObj = new Date(endDate);

      const startDateText = formatDateHuman(startDateObj);
      const endDateText = formatDateHuman(endDateObj);

      let text = "";
      if (sameDay) {
        text = startDateText;
      } else {
        text = `с ${startDateText} до ${endDateText}`;
      }

      if (e.startTime || e.endTime) {
        const timePart = `${e.startTime || ""}${e.endTime ? `–${e.endTime}` : ""}`;
        text = sameDay ? `${startDateText}, ${timePart}` : `${text}, ${timePart}`;
      }

      dateLabel.textContent = text;

      header.appendChild(title);
      if (isExpandedMonth) {
        const actions = document.createElement("div");
        actions.className = "event-item-actions";
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "event-item-button event-item-button-pen";
        editBtn.textContent = "✏";
        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "event-item-button event-item-button-delete";
        deleteBtn.textContent = "✕";

        editBtn.addEventListener("click", () => {
          const form = document.getElementById("event-form");
          const titleInput = document.getElementById("event-title");
          const noteInput = document.getElementById("event-note");
          const locationInput = document.getElementById("event-location");
          const startDateInput = document.getElementById("event-start-date");
          const startTimeInput = document.getElementById("event-start-time");
          const endDateInput = document.getElementById("event-end-date");
          const endTimeInput = document.getElementById("event-end-time");
          const titleLabel = document.getElementById("event-modal-title");
          state.selectedDate = startDate;
          openEventModal();
          if (form && titleInput && noteInput && locationInput && startDateInput && startTimeInput && endDateInput && endTimeInput) {
            form.classList.remove("hidden");
            form.dataset.mode = "edit";
            form.dataset.eventId = e.id;
            titleInput.value = e.title;
            noteInput.value = e.note || "";
            locationInput.value = e.location || "";
            startDateInput.value = startDate;
            startTimeInput.value = e.startTime || "";
            endDateInput.value = endDate;
            endTimeInput.value = e.endTime || "";
          }
          if (titleLabel) titleLabel.textContent = "Редактирование события";
        });

        deleteBtn.addEventListener("click", () => {
          if (!window.confirm("Удалить это событие?")) return;
          const idx = state.events.findIndex((ev) => ev.id === e.id);
          if (idx !== -1) {
            state.events = state.events.filter((ev) => ev.id !== e.id);
            saveEvents(state.events);
            renderYearCalendar();
            renderSidePanel();
          }
          deleteEventFromServer(e.id);
        });

        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);
        header.appendChild(actions);
      } else {
        header.appendChild(dateLabel);
      }
      li.appendChild(header);
      if (isExpandedMonth) li.appendChild(dateLabel);

      if (e.note) {
        const note = document.createElement("div");
        note.className = "event-item-note";
        note.textContent = e.note;
        li.appendChild(note);
      }

      if (e.location) {
        const loc = document.createElement("a");
        loc.href = e.location;
        loc.target = "_blank";
        loc.rel = "noopener noreferrer";
        loc.className = "event-item-location";
        loc.textContent = "Открыть в навигаторе";
        li.appendChild(loc);
      }

      upcomingList.appendChild(li);
    });
  }
}

// ============= ОБРАБОТКА ФОРМЫ =============
function setupForm() {
  const form = document.getElementById("event-form");
  const titleInput = document.getElementById("event-title");
  const noteInput = document.getElementById("event-note");
  const locationInput = document.getElementById("event-location");
  const startDateInput = document.getElementById("event-start-date");
  const startTimeInput = document.getElementById("event-start-time");
  const endDateInput = document.getElementById("event-end-date");
  const endTimeInput = document.getElementById("event-end-time");
  const cancelButton = document.getElementById("event-cancel-button");
  const openFormButton = document.getElementById("event-open-form-button");
  const closeButton = document.getElementById("event-close-button");

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const title = titleInput.value.trim();
    const note = noteInput.value.trim();
    const location = (locationInput?.value || "").trim();
    const mode = form.dataset.mode || "create";
    const editingId = form.dataset.eventId || null;

    const startDateRaw = (startDateInput?.value || "").trim();
    const startDate = startDateRaw || state.selectedDate;
    const startTime = (startTimeInput?.value || "").trim();
    const endDateRaw = (endDateInput?.value || "").trim();
    const endTime = (endTimeInput?.value || "").trim();

    if (!title || !startDate) return;

    let endDate = endDateRaw || startDate;
    if (endDate < startDate) {
      // если по ошибке выбрали дату конца раньше начала — меняем местами
      const tmp = endDate;
      endDate = startDate;
    }

    const datesRange = buildDatesRange(startDate, endDate);

    if (mode === "edit" && editingId) {
      const idx = state.events.findIndex((e) => e.id === editingId);
      if (idx === -1) return;

      const updatedEvent = {
        ...state.events[idx],
        startDate,
        endDate,
        startTime,
        endTime,
        dates: datesRange,
        title,
        note,
        location,
      };

      state.events[idx] = updatedEvent;
      saveEvents(state.events);

      updateEventOnServer(editingId, {
        date: startDate,
        end_date: endDate,
        start_time: startTime || null,
        end_time: endTime || null,
        title,
        note: note || null,
        location_url: location || null,
      });
    } else {
      const newEvent = {
        id: Date.now().toString(),
        startDate,
        endDate,
        startTime,
        endTime,
        dates: datesRange,
        title,
        note,
        location,
      };

      state.events.push(newEvent);
      saveEvents(state.events);

      // Отправляем событие на сервер (асинхронно)
      saveEventToServer(newEvent).then((saved) => {
        if (saved) {
          const idx = state.events.findIndex((e) => e.id === newEvent.id);
          if (idx !== -1) {
            state.events[idx] = {
              ...state.events[idx],
              id: saved.id,
            };
            saveEvents(state.events);
            renderYearCalendar();
            renderSidePanel();
          }
        }
      });
    }

    titleInput.value = "";
    noteInput.value = "";
    if (locationInput) locationInput.value = "";
    if (startDateInput) startDateInput.value = "";
    if (startTimeInput) startTimeInput.value = "";
    if (endDateInput) endDateInput.value = "";
    if (endTimeInput) endTimeInput.value = "";

    // сбрасываем режим формы
    form.dataset.mode = "create";
    form.dataset.eventId = "";

    renderYearCalendar();
    renderSidePanel();

    if (tg) {
      tg.HapticFeedback.notificationOccurred("success");
    }

    closeEventModal();
  });

  if (cancelButton) {
    cancelButton.addEventListener("click", () => {
      closeEventModal();
    });
  }

  if (openFormButton) {
    openFormButton.addEventListener("click", () => {
      if (form) {
        form.classList.remove("hidden");
      }
    });
  }

  if (closeButton) {
    closeButton.addEventListener("click", () => {
      closeEventModal();
    });
  }
}

function openEventModal() {
  const modal = document.getElementById("event-modal");
  const dateLabel = document.getElementById("event-modal-date");
  const titleLabel = document.getElementById("event-modal-title");
  const modalEventsList = document.getElementById("modal-events-for-date");
  const titleInput = document.getElementById("event-title");
  const noteInput = document.getElementById("event-note");
  const locationInput = document.getElementById("event-location");
  const startDateInput = document.getElementById("event-start-date");
  const startTimeInput = document.getElementById("event-start-time");
  const endDateInput = document.getElementById("event-end-date");
  const endTimeInput = document.getElementById("event-end-time");

  if (!modal || !state.selectedDate) return;

  const dateObj = new Date(state.selectedDate);
  if (dateLabel) {
    dateLabel.textContent = formatDateHuman(dateObj);
  }

  // Особые дни рождения из списка BIRTHDAYS (на одну дату может быть несколько человек)
  const birthdaysOnDate = BIRTHDAYS.filter(
    (b) => dateObj.getMonth() === b.month && dateObj.getDate() === b.day
  );

  if (titleLabel) {
    if (birthdaysOnDate.length > 0) {
      titleLabel.innerHTML = birthdaysOnDate
        .map((b) => {
          const age = dateObj.getFullYear() - b.year;
          return `День рождения ${b.name} 🍰<br><span class="birthday-age-note">(исполняется ${age} лет)</span>`;
        })
        .join('<br>');
    } else {
      titleLabel.textContent = "События выбранной даты";
    }
  }

  // Заполняем список событий для выбранной даты в модальном окне
  if (modalEventsList) {
    modalEventsList.innerHTML = "";
    const eventsForDate = state.events.filter(
      (e) => e.dates && e.dates.includes(state.selectedDate)
    );

    if (eventsForDate.length === 0) {
      const li = document.createElement("li");
      li.className = "event-empty";
      li.textContent = "На эту дату пока нет событий.";
      modalEventsList.appendChild(li);
    } else {
      eventsForDate.forEach((e) => {
        const li = document.createElement("li");
        li.className = "event-item";

        const header = document.createElement("div");
        header.className = "event-item-header";

        const title = document.createElement("div");
        title.className = "event-item-title";
        title.textContent = e.title;

        const actions = document.createElement("div");
        actions.className = "event-item-actions";

        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "event-item-button event-item-button-pen";
        editBtn.textContent = "✏"; // значок карандаша

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "event-item-button event-item-button-delete";
        deleteBtn.textContent = "✕";

        editBtn.addEventListener("click", () => {
        // заполняем форму в модальном окне и переводим её в режим редактирования
        const form = document.getElementById("event-form");
        const titleInput = document.getElementById("event-title");
        const noteInput = document.getElementById("event-note");
        const startDateInput = document.getElementById("event-start-date");
        const startTimeInput = document.getElementById("event-start-time");
        const endDateInput = document.getElementById("event-end-date");
        const endTimeInput = document.getElementById("event-end-time");
        const titleLabel = document.getElementById("event-modal-title");

        const startDate = e.startDate || (e.dates && e.dates[0]);
        const endDate = e.endDate || startDate;

        state.selectedDate = startDate;

        if (form && titleInput && noteInput && locationInput && startDateInput && startTimeInput && endDateInput && endTimeInput) {
          form.classList.remove("hidden");
          form.dataset.mode = "edit";
          form.dataset.eventId = e.id;

          titleInput.value = e.title;
          noteInput.value = e.note || "";
          locationInput.value = e.location || "";
          startDateInput.value = startDate;
          startTimeInput.value = e.startTime || "";
          endDateInput.value = endDate;
          endTimeInput.value = e.endTime || "";
        }

        if (titleLabel) {
          titleLabel.textContent = "Редактирование события";
        }
        });

        deleteBtn.addEventListener("click", () => {
          const confirmed = window.confirm("Удалить это событие?");
          if (!confirmed) return;

          const idx = state.events.findIndex((ev) => ev.id === e.id);
          if (idx !== -1) {
            state.events = state.events.filter((ev) => ev.id !== e.id);
            saveEvents(state.events);
            renderYearCalendar();
            renderSidePanel();
          }

          deleteEventFromServer(e.id);
          openEventModal();
        });

        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);

        header.appendChild(title);
        header.appendChild(actions);
        li.appendChild(header);

        const dateLabelEl = document.createElement("div");
        dateLabelEl.className = "event-item-date";

        const startDate = e.startDate || (e.dates && e.dates[0]);
        const endDate = e.endDate || startDate;
        const sameDay = startDate === endDate;

        const startDateObj = new Date(startDate);
        const endDateObj = new Date(endDate);

        const startDateText = formatDateHuman(startDateObj);
        const endDateText = formatDateHuman(endDateObj);

        let text = "";
        if (sameDay) {
          text = startDateText;
        } else {
          text = `с ${startDateText} до ${endDateText}`;
        }

        if (e.startTime || e.endTime) {
          const timePart = `${e.startTime || ""}${e.endTime ? `–${e.endTime}` : ""}`;
          text = sameDay ? `${startDateText}, ${timePart}` : `${text}, ${timePart}`;
        }

        dateLabelEl.textContent = text;
        li.appendChild(dateLabelEl);

        if (e.note) {
          const note = document.createElement("div");
          note.className = "event-item-note";
          note.textContent = e.note;
          li.appendChild(note);
        }

        if (e.location) {
          const loc = document.createElement("a");
          loc.href = e.location;
          loc.target = "_blank";
          loc.rel = "noopener noreferrer";
          loc.className = "event-item-location";
          loc.textContent = "Открыть в навигаторе";
          li.appendChild(loc);
        }

        modalEventsList.appendChild(li);
      });
    }
  }

  if (titleInput) titleInput.value = "";
  if (noteInput) noteInput.value = "";
  if (startDateInput) startDateInput.value = state.selectedDate;
  if (startTimeInput) startTimeInput.value = "12:00";
  if (endDateInput) endDateInput.value = state.selectedDate;
  if (endTimeInput) endTimeInput.value = "12:00";

  // По умолчанию форма скрыта, пока не нажали "+"
  const form = document.getElementById("event-form");
  if (form) form.classList.add("hidden");

  modal.classList.remove("hidden");
}

function closeEventModal() {
  const modal = document.getElementById("event-modal");
  if (!modal) return;
  modal.classList.add("hidden");

  state.selectedDate = null;
  renderYearCalendar();
  renderSidePanel();
}

function changeYear(delta) {
  state.year += delta;
  renderYearCalendar();
  renderSidePanel();
}

// ============= ИНИЦИАЛИЗАЦИЯ =============
document.addEventListener("DOMContentLoaded", async () => {
  // Ограничение доступа по Telegram user.id
  if (!isTelegramUserAllowed()) {
    const appRoot = document.querySelector(".app");
    if (appRoot) {
      const uid = getTelegramUserId();
      const line1 = "У вас нет доступа к этому календарю.";
      const line2 = uid !== null
        ? "Ваш ID в Telegram: " + uid
        : "ID не получен (откройте календарь из бота в Telegram).";
      const line3 = "Напишите этот номер администратору — он добавит вас в список.";
      appRoot.innerHTML =
        "<div style=\"padding:20px; text-align:center; color:#e5e7eb; max-width:320px; margin:0 auto;\">" +
        "<p style=\"font-size:1rem; margin-bottom:16px;\">" + line1 + "</p>" +
        "<p style=\"font-size:1.1rem; margin-bottom:16px; font-weight:bold; word-break:break-all;\">" + line2 + "</p>" +
        "<p style=\"font-size:0.95rem; color:#9ca3af;\">" + line3 + "</p>" +
        "</div>";
    }
    return;
  }

  setupForm();

  // Закрытие модального окна по тапу вне окна (по затемнённому фону)
  const modalOverlay = document.getElementById("event-modal");
  if (modalOverlay) {
    modalOverlay.addEventListener("click", (e) => {
      if (e.target === modalOverlay) {
        closeEventModal();
      }
    });
  }

  // Клик по году для смены года
  const yearLabel = document.getElementById("current-year");
  const yearPickerModal = document.getElementById("year-picker-modal");
  const yearPickerValue = document.getElementById("year-picker-value");
  const yearPickerInc = document.getElementById("year-picker-inc");
  const yearPickerDec = document.getElementById("year-picker-dec");
  const yearPickerOk = document.getElementById("year-picker-ok");

  function openYearPicker() {
    if (!yearPickerModal || !yearPickerValue) return;
    yearPickerValue.textContent = String(state.year);
    yearPickerModal.classList.remove("hidden");
  }

  function closeYearPicker(apply) {
    if (!yearPickerModal || !yearPickerValue) return;
    if (apply) {
      const y = parseInt(yearPickerValue.textContent, 10);
      if (!Number.isNaN(y) && y >= 1900 && y <= 2100) {
        state.year = y;
        renderYearCalendar();
        renderSidePanel();
      }
    }
    yearPickerModal.classList.add("hidden");
  }

  if (yearLabel) {
    yearLabel.addEventListener("click", (e) => {
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        target.classList.contains("current-year-number")
      ) {
        openYearPicker();
      }
    });
  }

  if (yearPickerInc && yearPickerValue) {
    yearPickerInc.addEventListener("click", () => {
      let y = parseInt(yearPickerValue.textContent, 10) || state.year;
      if (y < 2100) {
        y += 1;
        yearPickerValue.textContent = String(y);
      }
    });
  }

  if (yearPickerDec && yearPickerValue) {
    yearPickerDec.addEventListener("click", () => {
      let y = parseInt(yearPickerValue.textContent, 10) || state.year;
      if (y > 1900) {
        y -= 1;
        yearPickerValue.textContent = String(y);
      }
    });
  }

  if (yearPickerOk) {
    yearPickerOk.addEventListener("click", () => closeYearPicker(true));
  }

  if (yearPickerModal) {
    yearPickerModal.addEventListener("click", (e) => {
      if (e.target === yearPickerModal) {
        closeYearPicker(false);
      }
    });
  }

  // Показываем события из localStorage
  state.events = loadEvents();
  renderYearCalendar();
  renderSidePanel();

  // Синхронизация с сервером: при успешном ответе Supabase берём данные с сервера (один источник правды для всех устройств)
  const serverEvents = await fetchEventsFromServer();
  if (serverEvents !== null) {
    state.events = serverEvents;
    saveEvents(state.events);
    renderYearCalendar();
    renderSidePanel();
  }
});