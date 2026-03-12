// Поддержка Telegram WebApp (если открыто внутри Telegram)
const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (tg) {
  tg.ready();
  tg.expand();
}

// ============= НАСТРОЙКИ =============
const STORAGE_KEY = "tg_calendar_events_v1";

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
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

function formatDateHuman(date) {
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function getUpcomingEvents(events, limit = 10) {
  const today = new Date();
  const todayStr = formatDate(today);
  const flat = events.flatMap((e) =>
    e.dates.map((d) => ({
      date: d,
      title: e.title,
      note: e.note || "",
    }))
  );
  const filtered = flat.filter((e) => e.date >= todayStr);
  filtered.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return filtered.slice(0, limit);
}

// ============= СОСТОЯНИЕ =============
const state = {
  year: new Date().getFullYear(),
  selectedDate: formatDate(new Date()),
  events: loadEvents(), // [{ id, dates:[YYYY-MM-DD], title, note }]
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

  const eventsByDate = {};
  state.events.forEach((e) => {
    e.dates.forEach((d) => {
      eventsByDate[d] = true;
    });
  });

  const todayStr = formatDate(new Date());

  for (let month = 0; month < 12; month++) {
    const card = document.createElement("div");
    card.className = "month-card";

    const title = document.createElement("div");
    title.className = "month-title";

    const titleText = document.createElement("span");
    titleText.textContent = MONTH_NAMES[month];

    const monthHasEvents = Object.keys(eventsByDate).some((d) => {
      const [y, m] = d.split("-");
      return Number(y) === state.year && Number(m) === month + 1;
    });

    if (monthHasEvents) {
      const badge = document.createElement("span");
      badge.className = "month-has-events";
      badge.textContent = "●";
      title.appendChild(badge);
    }

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

      if (dateStr === state.selectedDate) {
        cell.classList.add("day-selected");
      }

      if (eventsByDate[dateStr]) {
        const dot = document.createElement("div");
        dot.className = "dot";
        cell.appendChild(dot);
      }

      cell.addEventListener("click", () => {
        state.selectedDate = dateStr;
        renderYearCalendar();
        renderSidePanel();
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

// ============= РЕНДЕР ПРАВОЙ ПАНЕЛИ (ФОРМА + СПИСКИ) =============
function renderSidePanel() {
  const selectedDateLabel = document.getElementById("selected-date");
  const eventsForDateList = document.getElementById("events-for-date");
  const upcomingList = document.getElementById("upcoming-events");
  const panelTitle = document.getElementById("event-panel-title");

  const dateObj = new Date(state.selectedDate);
  selectedDateLabel.textContent = `Выбрана дата: ${formatDateHuman(dateObj)}`;
  panelTitle.textContent = "События";

  const eventsForDate = state.events.filter((e) => e.dates.includes(state.selectedDate));
  eventsForDateList.innerHTML = "";

  if (eventsForDate.length === 0) {
    const li = document.createElement("li");
    li.className = "event-empty";
    li.textContent = "На эту дату пока нет событий.";
    eventsForDateList.appendChild(li);
  } else {
    eventsForDate.forEach((e) => {
      const li = document.createElement("li");
      li.className = "event-item";

      const header = document.createElement("div");
      header.className = "event-item-header";

      const title = document.createElement("div");
      title.className = "event-item-title";
      title.textContent = e.title;

      const dateLabel = document.createElement("div");
      dateLabel.className = "event-item-date";
      dateLabel.textContent = "Выбранная дата";

      header.appendChild(title);
      header.appendChild(dateLabel);
      li.appendChild(header);

      if (e.note) {
        const note = document.createElement("div");
        note.className = "event-item-note";
        note.textContent = e.note;
        li.appendChild(note);
      }

      eventsForDateList.appendChild(li);
    });
  }

  const upcoming = getUpcomingEvents(state.events, 20);
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

      const dateObj = new Date(e.date);
      dateLabel.textContent = formatDateHuman(dateObj);

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

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const title = titleInput.value.trim();
    const note = noteInput.value.trim();

    if (!title) return;

    const newEvent = {
      id: Date.now().toString(),
      dates: [state.selectedDate],
      title,
      note,
    };

    state.events.push(newEvent);
    saveEvents(state.events);

    titleInput.value = "";
    noteInput.value = "";

    renderYearCalendar();
    renderSidePanel();

    if (tg) {
      tg.HapticFeedback.notificationOccurred("success");
    }
  });
}

// ============= ИНИЦИАЛИЗАЦИЯ =============
document.addEventListener("DOMContentLoaded", () => {
  setupForm();
  renderYearCalendar();
  renderSidePanel();
});