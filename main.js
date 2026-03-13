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

const WEEKDAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function renderYearCalendar() {
  const container = document.getElementById("calendar-year");
  const yearLabel = document.getElementById("current-year");
  container.innerHTML = "";
  yearLabel.textContent = `Год: ${state.year}`;

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

  for (let month = 0; month < 12; month++) {
    const card = document.createElement("div");
    card.className = "month-card";

    const title = document.createElement("div");
    title.className = "month-title";

    const titleText = document.createElement("span");
    titleText.textContent = MONTH_NAMES[month];

    // Сначала добавляем название месяца слева
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
    const firstWeekday = (firstDay.getDay() + 6) % 7; // Пн=0 ... Вс=6
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

      if (dateStr === todayStr) {
        cell.classList.add("day-today");
      }

      if (state.selectedDate && dateStr === state.selectedDate) {
        cell.classList.add("day-selected");
      }

      // Особая дата: день рождения Дмитрия — 19 мая (подсвечиваем фиолетовым цветом числа)
      if (dateObj.getMonth() === 4 && dateObj.getDate() === 19) {
        cell.classList.add("day-birthday");
      }

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
          // если что-то наложилось странно, рисуем как одиночный
          cell.classList.add("day-range-single");
        }
      }

      cell.addEventListener("click", () => {
        state.selectedDate = dateStr;
        renderYearCalendar();
        renderSidePanel();
        openEventModal();
      });

      daysGrid.appendChild(cell);
    }

    card.appendChild(daysGrid);

    card.addEventListener("click", (e) => {
      // По клику на месяц просто используем клик по дате (у нас уже есть).
      // Для версии 1 оставим детальный полноэкранный месяц на будущее.
    });

    container.appendChild(card);
  }
}

// ============= РЕНДЕР ПРАВОЙ ПАНЕЛИ (БЛИЖАЙШИЕ СОБЫТИЯ) =============
function renderSidePanel() {
  const upcomingList = document.getElementById("upcoming-events");

  const upcoming = getUpcomingEvents(state.events, 3);
  upcomingList.innerHTML = "";
  if (upcoming.length === 0) {
    const li = document.createElement("li");
    li.className = "event-empty";
    li.textContent = "Ближайших событий нет.";
    upcomingList.appendChild(li);
  } else {
    upcoming.forEach((e) => {
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
      header.appendChild(dateLabel);
      li.appendChild(header);

      if (e.note) {
        const note = document.createElement("div");
        note.className = "event-item-note";
        note.textContent = e.note;
        li.appendChild(note);
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
  const startDateInput = document.getElementById("event-start-date");
  const startTimeInput = document.getElementById("event-start-time");
  const endDateInput = document.getElementById("event-end-date");
  const endTimeInput = document.getElementById("event-end-time");

  if (!modal || !state.selectedDate) return;

  const dateObj = new Date(state.selectedDate);
  if (dateLabel) {
    dateLabel.textContent = formatDateHuman(dateObj);
  }

  // Если выбрана дата 19 мая — показываем фиксированную подпись с возрастом (от 19.05.1987)
  const isDmitryBirthday =
    dateObj.getMonth() === 4 && dateObj.getDate() === 19;
  const dmitryAge = isDmitryBirthday ? dateObj.getFullYear() - 1987 : null;

  if (titleLabel) {
    if (isDmitryBirthday && dmitryAge !== null) {
      titleLabel.innerHTML = `День рождения Дмитрия<br><span class="birthday-age-note">(исполняется ${dmitryAge} лет)</span>`;
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

        if (form && titleInput && noteInput && startDateInput && startTimeInput && endDateInput && endTimeInput) {
          form.classList.remove("hidden");
          form.dataset.mode = "edit";
          form.dataset.eventId = e.id;

          titleInput.value = e.title;
          noteInput.value = e.note || "";
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

// ============= ИНИЦИАЛИЗАЦИЯ =============
document.addEventListener("DOMContentLoaded", async () => {
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