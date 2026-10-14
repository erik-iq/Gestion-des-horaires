import {
  monthSummary,
  overtimeBalance,
  signedDuration,
  weekDates as datesForWeek,
  scheduleFor,
  absenceTypes,
  absenceLabel,
  absenceFraction,
  fullAbsence,
  anomalies,
} from "./metrics.js";
import {
  shiftMonth,
  shiftDay,
  indexCalendar,
  entryMinutes,
} from "./calendar.js";
const app = document.querySelector("#app"),
  modal = document.querySelector("#modal");
const icons = {
  moon: '<path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z"/>',
  shield:
    '<path d="m12 3 8 4v6c0 4-4 7-8 9-4-2-8-5-8-9V7l8-4Z"/><path d="m8 12 3 3 5-6"/>',
  history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  people:
    '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-17a3 3 0 0 1 0 6m2 4a5 5 0 0 1 2 4v3"/>',
  report: '<path d="M7 3h7l5 5v13H5V3h2m7 0v5h5M8 12h8m-8 4h8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5"/>',
  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
  logout: '<path d="M9 4H4v16h5m6-12 4 4-4 4M9 12h10"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  chevronLeft: '<path d="m14 6-6 6 6 6"/>',
  chevronRight: '<path d="m10 6 6 6-6 6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
};
const icon = (k) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[k] || icons.clock}</svg>`;
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const initials = (n) =>
  n
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toUpperCase();
const formatters = new Map();
const fmt = (d, options = { day: "2-digit", month: "short" }) => {
  const key = JSON.stringify(options);
  if (!formatters.has(key))
    formatters.set(key, new Intl.DateTimeFormat("fr-CH", options));
  return formatters.get(key).format(new Date(d + "T12:00:00"));
};
const decimal = (n) =>
  Number(n).toLocaleString("fr-CH", { maximumFractionDigits: 1 });
const mins = (e) => {
  const parse = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  return parse(e.end) - parse(e.start) - e.break_minutes;
};
const duration = (n) =>
  `${Math.floor(n / 60)}h${String(Math.round(n % 60)).padStart(2, "0")}`;
const labels = {
  recorded: "Heures déclarées",
  leave: "En vacances",
  unknown: "Non renseigné",
  working: "En activité",
  paused: "En pause",
  pending: "En attente",
  approved: "Approuvée",
  rejected: "Refusée",
};
const badge = (status) =>
  `<span class="badge ${status}"><i></i>${labels[status]}</span>`;
const brand = () =>
  `<div class="brand"><img class="company-logo" src="/assets/logo.png" alt="Logo IQ"><div>tempo<small>Le temps, simplement.</small></div></div>`;
let state,
  page = "dashboard",
  month = "",
  reportUser = "",
  toastTimer,
  hoursView = "calendar",
  selectedDate = "",
  calendarUser = "",
  calendarIndex = null;
let metricCache = new Map(),
  teamData = null,
  teamStart = "",
  historyData = null,
  historyOffset = 0;
async function api(url, method = "GET", data) {
  const r = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });
  const b = await r.json();
  if (!r.ok) {
    if (r.status === 401 && state) {
      state = null;
      auth(false);
    }
    throw new Error(b.error || "Une erreur est survenue.");
  }
  return b;
}
function toast(message, error = false) {
  clearTimeout(toastTimer);
  const t = document.querySelector("#toast");
  t.textContent = message;
  t.className = "show" + (error ? " error-toast" : "");
  toastTimer = setTimeout(() => (t.className = ""), 4500);
}
const person = (u, sub = "") =>
  `<div class="profile"><span class="avatar">${esc(initials(u.name))}</span><div><strong>${esc(u.name)}</strong>${sub ? `<small>${esc(sub)}</small>` : ""}</div></div>`;
function empty(message, which = "clock") {
  return `<div class="empty">${icon(which)}${message}</div>`;
}
function auth(setup) {
  app.innerHTML = `<div class="auth-layout"><section class="auth-story">${brand()}<div class="auth-copy"><div class="eyebrow">Votre quotidien, en équilibre</div><h1>Du temps pour<br>ce qui <em>compte.</em></h1><p>Vos horaires, vos congés et votre équipe réunis dans un espace clair. Moins d’administratif, plus de sérénité.</p><div class="auth-chips"><span>Suivi des heures</span><span>Gestion des vacances</span><span>Rapports mensuels</span></div></div><p class="auth-footer">Pensé pour les équipes qui aiment travailler simplement.</p></section><section class="auth-main"><div class="auth-box"><div class="eyebrow">Bienvenue sur Tempo</div><h2>${setup ? "Créons votre espace." : "Heureux de vous revoir."}</h2><p>${setup ? "Créez le premier compte administrateur. Vous pourrez ensuite inviter votre équipe en créant ses accès." : "Connectez-vous pour retrouver vos horaires et votre équipe."}</p><form id="auth-form"><div class="error" role="alert"></div>${setup ? '<label class="field">Nom complet<input name="name" autocomplete="name" required maxlength="100" placeholder="Votre prénom et nom"></label>' : ""}<label class="field">Adresse e-mail<input type="email" name="email" autocomplete="username" required maxlength="200" placeholder="vous@entreprise.ch"></label><label class="field">Mot de passe<input type="password" name="password" autocomplete="${setup ? "new-password" : "current-password"}" required ${setup ? 'minlength="10"' : ""} maxlength="128" placeholder="${setup ? "10 caractères minimum" : "Votre mot de passe"}"></label><button class="btn" type="submit">${setup ? "Créer mon espace" : "Se connecter"} ${icon("arrow")}</button></form><div class="auth-bottom">${setup ? "Le premier compte dispose des droits administrateur." : "Besoin d’un accès ou d’un nouveau mot de passe ?<br>Contactez votre administrateur."}</div></div></section></div>`;
  app.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget,
      button = f.querySelector("button");
    button.disabled = true;
    try {
      await api(
        setup ? "/api/setup" : "/api/login",
        "POST",
        Object.fromEntries(new FormData(f)),
      );
      await refresh();
    } catch (err) {
      f.querySelector(".error").textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });
}
async function refresh() {
  state = await api("/api/state");
  clockOffset = (state.server_now || Date.now()) - Date.now();
  if (state.user.role !== "admin" && ["users", "admin"].includes(page))
    page = "dashboard";
  if (!month) month = state.today.slice(0, 7);
  if (!reportUser) reportUser = String(state.user.id);
  calendarIndex = null;
  metricCache.clear();
  teamData = null;
  historyData = null;
  if (!calendarUser || !state.users.some((u) => String(u.id) === calendarUser))
    calendarUser = String(state.user.id);
  if (!selectedDate) selectedDate = state.today;
  render();
}
function navItem(key, title, k) {
  const count =
    key === "leaves" && state.user.role === "admin"
      ? state.leaves.filter((l) => l.status === "pending").length
      : 0;
  return `<button data-page="${key}" class="${page === key ? "active" : ""}" ${page === key ? 'aria-current="page"' : ""}>${icon(k)}${title}${count ? `<span class="count">${count}</span>` : ""}</button>`;
}
const pageTitles = {
  dashboard: "Vue d’ensemble",
  hours: "Mes horaires",
  leaves: "Absences",
  attendance: "Présence de l’équipe",
  reports: "Rapports mensuels",
  users: "Gestion des utilisateurs",
  admin: "Pilotage de l’équipe",
  alerts: "Alertes",
  overtime: "Solde d’heures",
  team: "Planning de l’équipe",
  history: "Historique des modifications",
};
function heading(
  title,
  subtitle,
  button = "",
  eyebrow = "Votre espace de travail",
) {
  return `<div class="heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${subtitle}</p></div>${button}</div>`;
}
function stat(label, value, unit, sub, k, highlight = false) {
  return `<div class="stat ${highlight ? "highlight" : ""}"><span class="stat-icon">${icon(k)}</span><p class="label">${label}</p><div class="value">${value}<span class="unit">${unit}</span></div><p class="sub">${sub}</p></div>`;
}
function renderContent() {
  const content = app.querySelector(".content");
  if (!content) return render();
  content.innerHTML =
    {
      dashboard,
      admin,
      alerts,
      hours,
      leaves,
      attendance,
      reports,
      users,
      overtime,
      team,
      history,
    }[page]() + footer();
}
function footer() {
  return `<footer class="footer"><span>Tempo · Votre temps, en clair.${state.desktop ? " · Données locales" : ""}</span><span>Votre espace ${state.user.role === "admin" ? "administrateur" : "collaborateur"}</span></footer>`;
}
function render() {
  app.innerHTML = `<div class="shell"><aside class="sidebar">${brand()}<div class="nav-label">Espace personnel</div><nav class="nav" aria-label="Navigation principale">${navItem("dashboard", "Vue d’ensemble", "grid")}${navItem("hours", "Mes horaires", "calendar")}${navItem("leaves", "Absences", "sun")}${navItem("attendance", "Présence", "people")}${navItem("overtime", "Solde d’heures", "clock")}${navItem("team", "Planning équipe", "people")}${navItem("reports", "Rapports mensuels", "report")}${navItem("alerts", "Alertes", "shield")}${navItem("history", "Historique", "history")}${state.user.role === "admin" ? `<div class="nav-label">Administration</div>${navItem("admin", "Pilotage équipe", "grid")}${navItem("users", "Utilisateurs", "people")}` : ""}</nav><div class="sidebar-bottom">${person(state.user, state.user.role === "admin" ? "Administrateur" : "Collaborateur")}<button class="logout" data-action="logout">${icon("logout")}Se déconnecter</button></div></aside><main class="main"><header class="topbar"><div class="breadcrumb"><button class="mobile-menu" data-action="menu" aria-label="Ouvrir le menu">${icon("menu")}</button><span>Mon espace /</span><b>${pageTitles[page]}</b></div><div class="topbar-right"><button class="refresh-button" data-action="theme" aria-label="Changer le thème" title="Mode clair / sombre">${icon(document.documentElement.dataset.theme === "dark" ? "sun" : "moon")}</button>${state.desktop && state.user.role === "admin" ? `<button class="refresh-button" data-action="quit" title="Quitter Tempo" aria-label="Quitter Tempo">${icon("logout")}</button>` : ""}<button class="refresh-button" data-action="refresh" title="Actualiser les données" aria-label="Actualiser les données">${icon("arrow")}</button><span class="date-chip">${icon("calendar")}${fmt(state.today, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span><button class="avatar account-button" data-action="account" aria-label="Mon compte : ${esc(state.user.name)}" title="Mon compte">${esc(initials(state.user.name))}</button></div></header><div class="content">${{ dashboard, hours, leaves, attendance, reports, users, overtime, team, history, admin, alerts }[page]()}${footer()}</div></main></div>`;
}
function isLocked(userId, date) {
  return (state.locks || []).some(
    (l) => l.user_id === userId && l.month === date.slice(0, 7),
  );
}
function summary(user, period) {
  const key = user.id + ":" + period;
  if (!metricCache.has(key))
    metricCache.set(
      key,
      monthSummary(
        user,
        state.entries,
        state.leaves,
        state.contracts || [],
        state.locks || [],
        period,
        state.today,
      ),
    );
  return metricCache.get(key);
}
const windowSummary = summary;
function ledger(user, until = state.today.slice(0, 7)) {
  const key = "total:" + user.id + ":" + until;
  if (!metricCache.has(key))
    metricCache.set(
      key,
      overtimeBalance(
        user,
        state.entries,
        state.leaves,
        state.contracts || [],
        state.locks || [],
        state.today,
        until,
      ),
    );
  return metricCache.get(key);
}
function personalWeek(user) {
  const dates = datesForWeek(selectedDate),
    data = calendarData();
  return `<section class="panel"><div class="calendar-head"><div><span class="eyebrow">Vue semaine</span><h2>${fmt(dates[0])} — ${fmt(dates[6])}</h2></div><div class="month-navigation"><button class="icon-button" data-action="week-prev" aria-label="Semaine précédente">${icon("chevronLeft")}</button><button class="btn secondary small" data-action="month-today">Aujourd’hui</button><button class="icon-button" data-action="week-next" aria-label="Semaine suivante">${icon("chevronRight")}</button></div></div><div class="calendar-weekdays">${dates.map((d) => `<span>${fmt(d, { weekday: "short", day: "numeric" })}</span>`).join("")}</div><div class="calendar-grid personal-week">${dates.map((date) => calendarCell({ date, inMonth: true, weekend: [0, 6].includes(new Date(date).getUTCDay()) }, data)).join("")}</div></section><div class="week-detail">${selectedDayPanel(data, user)}</div>`;
}
function dayView(user) {
  return `<div class="day-view"><section class="panel"><div class="calendar-head"><div><span class="eyebrow">Vue journée</span><h2>${fmt(selectedDate, { day: "numeric", month: "long", year: "numeric" })}</h2></div><div class="month-navigation"><button class="icon-button" data-action="day-prev" aria-label="Jour précédent">${icon("chevronLeft")}</button><button class="btn secondary small" data-action="month-today">Aujourd’hui</button><button class="icon-button" data-action="day-next" aria-label="Jour suivant">${icon("chevronRight")}</button></div></div><p class="notice">${esc(user.name)} · ${signedDuration((scheduleFor(state.contracts || [], user.id, selectedDate)?.schedule || [])[(new Date(selectedDate).getUTCDay() + 6) % 7] || 0)} prévues au contrat pour cette journée.</p></section>${selectedDayPanel(calendarData(), user)}</div>`;
}
function overtime() {
  const user = selectedCalendarUser(),
    data = summary(user, month),
    total = ledger(user, month);
  const selector =
    state.user.role === "admin"
      ? `<label for="overtime-user">Collaborateur</label><select id="overtime-user">${state.users.map((u) => `<option value="${u.id}" ${u.id === user.id ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select>`
      : "";
  return (
    heading(
      "Vos heures, à l’équilibre.",
      "Un solde transparent, calculé selon le contrat de chaque collaborateur.",
      state.user.role === "admin"
        ? `<button class="btn" data-action="contract" data-id="${user.id}">${icon("clock")}Configurer le contrat</button>`
        : "",
      "Solde d’heures",
    ) +
    monthFilter(selector) +
    `<div class="stats">${stat("Heures réalisées", duration(data.worked_minutes), "", "Dans le mois sélectionné", "clock")}${stat("Heures contractuelles", duration(data.expected_minutes), "", "Jusqu’à la date de calcul", "calendar")}${stat("Écart du mois", signedDuration(data.delta_minutes), "", data.locked ? "Mois validé" : "Provisoire", "report")}${stat("Solde cumulé", signedDuration(total.minutes), "", "Depuis le début du suivi", "clock", true)}</div><div class="notice">${data.locked ? "Ce mois est validé : ses totaux sont figés." : "Solde provisoire : " + data.missing_days + " journée(s) non renseignée(s) sont comprises dans les heures manquantes."} ${data.unconfigured_days ? data.unconfigured_days + " journée(s) n’ont pas de contrat défini. " : ""}Les absences approuvées créditent les heures prévues au contrat ; le congé sans solde réduit l’objectif ; les jours fériés ne sont pas neutralisés automatiquement.</div><section class="panel"><div class="panel-head"><div><h2>Le détail du calcul</h2><p>${esc(user.name)} · ${fmt(month + "-01", { month: "long", year: "numeric" })}</p></div>${validationControls(user)}</div><div class="table-wrap"><table><tbody><tr><td>Travail saisi</td><td>${duration(data.worked_minutes)}</td></tr><tr><td>Crédit de vacances approuvées</td><td>${duration(data.vacation_credit)}</td></tr><tr><td>Autres absences créditées</td><td>${duration(data.absence_credit || 0)}</td></tr><tr><td>Objectif retiré · congé sans solde</td><td>${duration(data.unpaid_minutes || 0)}</td></tr><tr><td>Heures prévues au contrat</td><td>−${duration(data.expected_minutes)}</td></tr><tr><td>Ajustements du solde</td><td>${signedDuration(data.adjustment_minutes)}</td></tr><tr class="report-total"><td>Écart du mois</td><td>${signedDuration(data.delta_minutes)}</td></tr></tbody></table></div></section><section class="panel bottom-panel"><div class="panel-head"><div><h2>Évolution du contrat</h2><p>Les changements s’appliquent à partir de leur date d’effet.</p></div></div><div class="table-wrap"><table><thead><tr><th>À partir du</th><th>Horaire hebdomadaire</th><th>Ajustement</th></tr></thead><tbody>${(
      state.contracts || []
    )
      .filter((c) => c.user_id === user.id)
      .map(
        (c) =>
          `<tr><td>${fmt(c.effective_from, { day: "numeric", month: "long", year: "numeric" })}</td><td>${duration(c.schedule.reduce((a, b) => a + b, 0))} / semaine</td><td>${signedDuration(c.opening_minutes)}</td></tr>`,
      )
      .join("")}</tbody></table></div></section>`
  );
}
async function loadPage() {
  const requested = page;
  try {
    if (page === "team" && !teamData) {
      if (!teamStart) teamStart = datesForWeek(state.today)[0];
      const start = teamStart;
      const data = await api("/api/team-week?start=" + start);
      if (page === requested && teamStart === start) {
        teamData = data;
        renderContent();
      }
    }
    if (page === "history" && !historyData) {
      const offset = historyOffset;
      const data = await api("/api/history?offset=" + offset);
      if (page === requested && historyOffset === offset) {
        historyData = data;
        renderContent();
      }
    }
  } catch (e) {
    toast(e.message, true);
  }
}
function team() {
  if (!teamStart) teamStart = datesForWeek(state.today)[0];
  const dates = datesForWeek(teamStart);
  return (
    heading(
      "Votre équipe, semaine après semaine.",
      "Les horaires et les absences de chacun, dans une vue partagée.",
      "",
      "Planning hebdomadaire",
    ) +
    `<div class="filters"><button class="btn secondary" data-action="team-prev">${icon("chevronLeft")}Précédente</button><strong>${fmt(dates[0])} — ${fmt(dates[6])}</strong><button class="btn secondary" data-action="team-next">Suivante${icon("chevronRight")}</button><button class="btn secondary" data-action="team-today">Cette semaine</button></div><div class="notice">Cette vue montre les horaires déclarés et les absences. Les notes personnelles et les informations du contrat restent privées.</div><section class="panel">${
      !teamData
        ? empty("Chargement de la semaine…")
        : `<div class="table-wrap"><table class="team-week"><thead><tr><th>Collaborateur</th>${dates.map((d) => `<th>${fmt(d, { weekday: "short", day: "numeric", month: "short" })}</th>`).join("")}</tr></thead><tbody>${teamData.users
            .map(
              (u) =>
                `<tr><td>${person(u)}</td>${dates
                  .map((d) => {
                    const e = teamData.entries.find(
                        (e) => e.user_id === u.id && e.date === d,
                      ),
                      ls = teamData.leaves.filter(
                        (l) => l.user_id === u.id && l.start <= d && l.end >= d,
                      );
                    return `<td class="${d === state.today ? "team-today" : ""}">${e ? `<span class="team-work"><strong>${duration(entryMinutes(e))}</strong><small>${e.start} — ${e.end}</small></span>` : !ls.length ? '<span class="team-empty">—</span>' : ""}${ls.map((l) => `<span class="team-absence ${l.status}">${esc(absenceLabel(l))}${l.status === "pending" ? " · en attente" : ""}</span>`).join("")}</td>`;
                  })
                  .join("")}</tr>`,
            )
            .join("")}</tbody></table></div>`
    }</section>`
  );
}
function auditDescription(before, after) {
  const labels = {
    name: "Nom",
    email: "E-mail",
    role: "Rôle",
    allowance: "Quota vacances (jours)",
    daily_hours: "Objectif quotidien (heures)",
    date: "Date",
    start: "Début",
    end: "Fin",
    break_minutes: "Pause (minutes)",
    note: "Note",
    days: "Durée (jours)",
    kind: "Type d’absence",
    portion: "Partie de la journée",
    absence_credit: "Autres absences créditées",
    unpaid_minutes: "Congé sans solde",
    started_at: "Début du pointage",
    paused_at: "Début de pause",
    paused_ms: "Pauses cumulées",
    finished_at: "Fin du pointage",
    status: "Statut",
    effective_from: "Date d’effet",
    schedule: "Horaire hebdomadaire",
    opening_minutes: "Ajustement",
    reason: "Motif",
    worked_minutes: "Travail",
    expected_minutes: "Contrat",
    contractual_minutes: "Objectif initial",
    vacation_credit: "Crédit vacances",
    adjustment_minutes: "Ajustement",
    delta_minutes: "Écart du mois",
    month: "Mois",
    missing_days: "Journées non renseignées",
  };
  const value = (key, v) =>
    key === "schedule"
      ? v
          .map(
            (n, i) =>
              ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"][i] +
              ": " +
              duration(n),
          )
          .join(" · ")
      : key === "paused_ms"
        ? duration(Math.floor(v / 60000))
        : ["started_at", "paused_at", "finished_at"].includes(key)
          ? v
            ? new Intl.DateTimeFormat("fr-CH", {
                dateStyle: "short",
                timeStyle: "short",
                timeZone: "Europe/Zurich",
              }).format(new Date(v))
            : "—"
          : key.endsWith("_minutes") ||
              ["vacation_credit", "absence_credit"].includes(key)
            ? signedDuration(v)
            : key === "kind"
              ? absenceTypes[v] || v
              : key === "portion"
                ? {
                    full: "Journée entière",
                    morning: "Matin",
                    afternoon: "Après-midi",
                  }[v] || v
                : key === "status"
                  ? labels[v] ||
                    {
                      active: "En cours",
                      finished: "Terminé",
                      cancelled: "Annulé",
                    }[v] ||
                    v
                  : String(v);
  const display = (name, data) =>
    data
      ? `<strong>${name}</strong><pre>${esc(
          Object.entries(data)
            .filter(([k]) => labels[k])
            .map(([k, v]) => labels[k] + ": " + value(k, v))
            .join("\n") || "État du mois conservé.",
        )}</pre>`
      : "";
  return (
    display("Avant", before) + display("Après", after) ||
    "<span>Action enregistrée, sans donnée sensible.</span>"
  );
}
function history() {
  return (
    heading(
      "Chaque modification a une trace.",
      "Retrouvez qui a modifié une journée, un contrat, un quota ou une validation.",
      "",
      "Historique",
    ) +
    `<section class="panel"><div class="panel-head"><div><h2>${state.user.role === "admin" ? "Historique de l’équipe" : "Mon historique"}</h2><p>Les mots de passe et leurs empreintes ne sont jamais enregistrés ici.</p></div></div>${!historyData ? empty("Chargement de l’historique…") : historyData.items.length ? `<div class="table-wrap"><table><thead><tr><th>Date et heure</th><th>Auteur</th><th>Collaborateur</th><th>Modification</th><th>Détail</th></tr></thead><tbody>${historyData.items.map((item) => `<tr><td>${esc(new Intl.DateTimeFormat("fr-CH", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Zurich" }).format(new Date(item.created_at)))}</td><td>${esc(item.actor || "Système")}</td><td>${esc(item.subject || "—")}</td><td class="note-cell">${esc(item.label)}</td><td><details class="audit-detail"><summary>Voir</summary>${auditDescription(item.before, item.after)}</details></td></tr>`).join("")}</tbody></table></div>` : empty("Aucune modification enregistrée pour le moment.", "history")}</section><div class="filters history-pagination"><button class="btn secondary" data-action="history-prev" ${historyOffset === 0 ? "disabled" : ""}>Précédent</button><span>Événements ${historyOffset + 1} à ${historyOffset + (historyData?.items.length || 0)}</span><button class="btn secondary" data-action="history-next" ${!historyData?.has_more ? "disabled" : ""}>Suivant</button></div>`
  );
}
function validationControls(user) {
  const lock = (state.locks || []).find(
    (l) => l.user_id === user.id && l.month === month,
  );
  if (lock)
    return `<span class="badge approved">${icon("shield")}Validé</span>${state.user.role === "admin" ? `<button class="link-button" data-action="reopen-month" data-user="${user.id}" data-month="${month}">Rouvrir</button>` : ""}`;
  return `<span class="badge pending">Provisoire</span>${state.user.role === "admin" && month < state.today.slice(0, 7) ? `<button class="link-button" data-action="validate-month" data-user="${user.id}" data-month="${month}">Valider</button>` : ""}`;
}
function validateMonth(userId, period) {
  const user = state.users.find((u) => String(u.id) === userId),
    report = summary(user, period);
  confirmation(
    "Valider le mois ?",
    `${user.name} · ${period}. Les saisies seront verrouillées. ${report.missing_days} journée(s) non renseignée(s) resteront comptées comme heures manquantes.`,
    () => api("/api/validations/" + userId + "/" + period, "POST", {}),
  );
}
function reopenMonth(userId, period) {
  dialog(
    "Rouvrir le mois",
    "Les saisies redeviendront modifiables. Le motif sera conservé dans l’historique.",
    '<label class="field">Motif<textarea name="reason" required minlength="3" maxlength="300"></textarea></label>',
    "Rouvrir",
    (b) => api("/api/validations/" + userId + "/" + period, "DELETE", b),
  );
}
async function downloadPdf() {
  const r = await fetch(
    "/api/report/pdf?month=" +
      month +
      "&user=" +
      (state.user.role === "admin" ? reportUser : state.user.id),
  );
  if (!r.ok) {
    const b = await r.json();
    throw new Error(b.error);
  }
  const blob = await r.blob(),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "Tempo-rapport-" + month + ".pdf";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Rapport PDF téléchargé.");
}
function contractDialog(id) {
  const user = state.users.find((u) => u.id === Number(id)),
    current =
      scheduleFor(state.contracts || [], user.id, state.today) ||
      (state.contracts || []).find((c) => c.user_id === user.id);
  dialog(
    "Contrat de travail",
    esc(user.name) + " · Les modifications sont datées et historisées.",
    `<div class="form-grid"><label class="field full">Date d’effet<input type="date" name="effective_from" value="${state.today}" min="2000-01-01" max="2100-12-31" required></label><div class="field full"><span>Heures prévues par journée (0 = repos)</span><div class="contract-days">${["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((day, i) => `<label>${day}<input type="number" name="day${i}" value="${(current?.schedule[i] || 0) / 60}" min="0" max="16" step="0.25" required></label>`).join("")}</div></div><label class="field full">Ajustement du solde, en heures<input type="number" name="opening_hours" value="${current?.effective_from === state.today ? current.opening_minutes / 60 : 0}" min="-10000" max="10000" step="0.25"><small>Crédit positif ou débit négatif appliqué à cette date. Laissez 0 pour un simple changement d’horaire.</small></label></div><p class="helper">Un contrat ne peut pas modifier une période déjà validée. Pour reprendre un ancien solde, renseignez-le comme ajustement à la date choisie.</p>`,
    "Enregistrer le contrat",
    (b) =>
      api("/api/contracts/" + id, "POST", {
        effective_from: b.effective_from,
        opening_hours: Number(b.opening_hours),
        schedule: Array.from({ length: 7 }, (_, i) =>
          Math.round(Number(b["day" + i]) * 60),
        ),
      }),
  );
}
function favoriteDialog() {
  dialog(
    "Créer un horaire favori",
    "Réutilisez ce créneau dans vos saisies quotidiennes ou groupées.",
    `<label class="field">Nom<input name="name" required maxlength="80" placeholder="Journée habituelle"></label><div class="form-grid"><label class="field">Arrivée<input type="time" name="start" value="08:00" required></label><label class="field">Départ<input type="time" name="end" value="17:00" required></label><label class="field full">Pause (minutes)<input type="number" name="break_minutes" min="0" max="720" value="60" required></label></div>`,
    "Enregistrer le favori",
    (b) =>
      api("/api/favorites", "POST", {
        ...b,
        break_minutes: Number(b.break_minutes),
      }),
  );
}
function saveWeekDialog() {
  dialog(
    "Créer une semaine type",
    "Choisissez les jours et les horaires de votre semaine habituelle.",
    `<label class="field">Nom<input name="name" required maxlength="80" placeholder="Semaine habituelle"></label><div class="template-days">${["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((d, i) => `<div><label><input type="checkbox" name="enabled${i}" ${i < 5 ? "checked" : ""}>${d}</label><input type="time" aria-label="Arrivée ${d}" name="start${i}" value="08:00"><input type="time" aria-label="Départ ${d}" name="end${i}" value="17:00"><input type="number" aria-label="Pause ${d}" name="pause${i}" value="60" min="0" max="720"></div>`).join("")}</div>`,
    "Enregistrer la semaine",
    (b) =>
      api("/api/week-templates", "POST", {
        name: b.name,
        pattern: Array.from({ length: 7 }, (_, i) => i)
          .filter((i) => b["enabled" + i])
          .map((i) => ({
            weekday: i + 1,
            start: b["start" + i],
            end: b["end" + i],
            break_minutes: Number(b["pause" + i]),
          })),
      }),
  );
}
function batchDialog() {
  const start = datesForWeek(selectedDate || state.today)[0];
  dialog(
    "Saisie rapide",
    "Remplissez plusieurs journées réalisées. Les dates futures sont exclues.",
    `<label class="field">Méthode<select name="method" id="batch-method"><option value="range">Même horaire sur une période</option><option value="copy">Copier une semaine renseignée</option>${(state.week_templates || []).map((t) => `<option value="template:${t.id}">Semaine type · ${esc(t.name)}</option>`).join("")}</select></label><div class="form-grid"><label class="field">Début / semaine cible<input type="date" name="start_date" value="${start}" max="${state.today}" required></label><label class="field">Fin de période<input type="date" name="end_date" value="${state.today}" max="${state.today}" required></label><label class="field full">Semaine source (pour la copie)<input type="date" name="source_date" value="${shiftDay(start, -7)}" max="${state.today}"></label><label class="field full">Horaire favori<select id="batch-favorite"><option value="">Horaire personnalisé</option>${(state.favorites || []).map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join("")}</select></label><label class="field">Arrivée<input type="time" name="start" value="08:00" required></label><label class="field">Départ<input type="time" name="end" value="17:00" required></label><label class="field full">Pause (minutes)<input type="number" name="break_minutes" value="60" min="0" max="720" required></label><div class="field full"><span>Jours concernés (pour la période)</span><div class="weekday-checks">${["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((d, i) => `<label><input type="checkbox" name="weekday${i}" ${i < 5 ? "checked" : ""}>${d}</label>`).join("")}</div></div><label class="field full">Note<textarea name="note" maxlength="500"></textarea></label></div><label class="checkbox-line"><input type="checkbox" name="replace_existing">Remplacer les journées déjà renseignées</label><p class="helper">Les mois verrouillés et les vacances approuvées sont toujours ignorés. Une semaine cible est alignée sur le lundi.</p>`,
    "Remplir les journées",
    async (b) => {
      let entries = [];
      const target = datesForWeek(b.start_date);
      if (b.method === "copy") {
        const source = datesForWeek(b.source_date);
        entries = source
          .map((d, i) => {
            const e = myEntries().find((e) => e.date === d);
            return e
              ? {
                  date: target[i],
                  start: e.start,
                  end: e.end,
                  break_minutes: e.break_minutes,
                  note: e.note,
                }
              : null;
          })
          .filter(Boolean);
      } else if (b.method.startsWith("template:")) {
        const template = state.week_templates.find(
          (t) => t.id === Number(b.method.split(":")[1]),
        );
        entries = template.pattern.map((t) => ({
          ...t,
          date: target[t.weekday - 1],
          note: b.note,
        }));
      } else {
        if (b.end_date < b.start_date)
          throw new Error("La fin doit suivre le début.");
        let count = 0;
        for (let d = b.start_date; d <= b.end_date; d = shiftDay(d, 1)) {
          if (++count > 62) throw new Error("Maximum 62 jours par saisie.");
          const i = (new Date(d).getUTCDay() + 6) % 7;
          if (b["weekday" + i])
            entries.push({
              date: d,
              start: b.start,
              end: b.end,
              break_minutes: Number(b.break_minutes),
              note: b.note,
            });
        }
      }
      const future = entries.filter((e) => e.date > state.today).length;
      entries = entries.filter((e) => e.date <= state.today);
      if (!entries.length)
        throw new Error("Aucune journée passée sélectionnée.");
      const result = await api("/api/entries/batch", "POST", {
        entries,
        replace_existing: !!b.replace_existing,
      });
      return {
        ...result,
        message:
          result.message +
          (future ? " " + future + " date(s) à venir exclue(s)." : ""),
      };
    },
  );
  modal.querySelector("#batch-favorite").onchange = (e) => {
    const f = state.favorites.find((f) => f.id === Number(e.target.value));
    if (f)
      for (const name of ["start", "end", "break_minutes"])
        modal.querySelector(`[name="${name}"]`).value = f[name];
  };
}
function quickTools() {
  return `<section class="panel bottom-panel"><div class="panel-head"><div><h2>Vos raccourcis de saisie</h2><p>Favoris et semaines types restent liés à votre compte.</p></div><div class="actions"><button class="btn secondary small" data-action="favorite">${icon("plus")}Horaire favori</button><button class="btn secondary small" data-action="save-week">${icon("plus")}Semaine type</button></div></div><div class="quick-tools">${(state.favorites || []).map((f) => `<div><span><strong>${esc(f.name)}</strong><small>${f.start} — ${f.end} · ${f.break_minutes} min de pause</small></span><button class="link-button" data-action="delete-favorite" data-id="${f.id}" aria-label="Supprimer ${esc(f.name)}">${icon("trash")}</button></div>`).join("")}${(state.week_templates || []).map((t) => `<div><span><strong>${esc(t.name)}</strong><small>${t.pattern.length} jour(s) · semaine type</small></span><button class="link-button" data-action="delete-template" data-id="${t.id}" aria-label="Supprimer ${esc(t.name)}">${icon("trash")}</button></div>`).join("")}${!state.favorites?.length && !state.week_templates?.length ? '<p class="helper">Créez votre premier favori pour remplir vos journées plus rapidement.</p>' : ""}</div></section>`;
}

function myEntries() {
  return state.entries.filter((e) => e.user_id === state.user.id);
}
function weekDates() {
  const d = new Date(state.today + "T12:00:00Z"),
    day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d);
    x.setUTCDate(x.getUTCDate() + i);
    return x.toISOString().slice(0, 10);
  });
}
let clockOffset = 0,
  adminMonth = "";
function userAlerts(user, period = state.today.slice(0, 7)) {
  return anomalies(
    user,
    state.entries,
    state.leaves,
    state.contracts || [],
    state.locks || [],
    state.today,
    period,
  ).filter(
    (a) =>
      !(
        a.type === "missing" &&
        user.id === state.user.id &&
        state.clock?.date === a.date
      ),
  );
}
function clockTime() {
  const c = state?.clock;
  if (!c) return "00:00:00";
  const end = c.paused_at ? Date.parse(c.paused_at) : Date.now() + clockOffset;
  const seconds = Math.max(
    0,
    Math.floor((end - Date.parse(c.started_at) - c.paused_ms) / 1000),
  );
  return [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  ]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}
setInterval(() => {
  const output = document.querySelector("#clock-elapsed");
  if (output) output.textContent = clockTime();
}, 1000);
function clockCard() {
  const c = state.clock,
    e = myEntries().find((e) => e.date === state.today);
  const absent = fullAbsence(state.leaves, state.user.id, state.today);
  return `<section class="panel clock-card" aria-label="Pointage du jour"><div class="clock-main"><span class="clock-symbol ${c ? "is-running" : ""}">${icon("clock")}</span><div><span class="eyebrow">${c ? (c.paused_at ? "Pause en cours" : "Journée en cours") : e ? "Journée enregistrée" : absent ? "Absence approuvée" : "Votre journée"}</span><div class="clock-value">${c ? `<output id="clock-elapsed">${clockTime()}</output>` : e ? duration(mins(e)) : "Prêt à commencer ?"}</div><p>${c ? `Début ${new Intl.DateTimeFormat("fr-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" }).format(new Date(c.started_at))} · ${fmt(c.date)} · pauses déduites` : e ? `${e.start} — ${e.end} · ${e.break_minutes} min de pause` : absent ? "Retrouvez le détail dans vos absences." : "Un clic pour démarrer. Vos pauses sont mémorisées."}</p></div></div><div class="clock-actions">${c ? `<button class="btn secondary" data-action="clock-${c.paused_at ? "resume" : "pause"}">${c.paused_at ? "Reprendre" : "Faire une pause"}</button><button class="btn" data-action="clock-stop">Terminer</button><button class="link-button" data-action="clock-cancel">Annuler le pointage</button>` : e ? `<button class="btn secondary" data-action="entry" data-id="${e.id}">Modifier</button>` : absent ? `<button class="btn secondary" data-page="leaves">Voir l’absence</button>` : `<button class="btn" data-action="clock-start">${icon("plus")}Commencer ma journée</button><button class="link-button" data-action="entry">Saisie manuelle</button>`}</div></section>`;
}
function alertRows(rows, user = state.user) {
  return rows
    .map(
      (a) =>
        `<div class="alert-row"><span class="alert-mark ${a.type}">${icon(a.type === "missing" ? "calendar" : "clock")}</span><div><strong>${esc(a.label)}</strong><small>${fmt(a.date)}${a.minutes ? ` · ${signedDuration(a.minutes)}` : ""}</small></div><button class="link-button" data-action="alert-day" data-date="${a.date}" data-user="${user.id}">Voir${icon("arrow")}</button></div>`,
    )
    .join("");
}
function unvalidatedMonths() {
  const last = shiftMonth(state.today.slice(0, 7), -1),
    rows = [];
  for (const u of state.users) {
    const first = (state.contracts || [])
      .filter((c) => c.user_id === u.id)
      .map((c) => c.effective_from.slice(0, 7))
      .sort()[0];
    if (!first) continue;
    for (let m = first; m <= last; m = shiftMonth(m, 1))
      if (!(state.locks || []).some((l) => l.user_id === u.id && l.month === m))
        rows.push({ user: u, month: m });
  }
  return rows;
}
function dashboard() {
  const own = myEntries(),
    dates = weekDates(),
    total = own
      .filter((e) => dates.includes(e.date))
      .reduce((n, e) => n + mins(e), 0);
  const balance = ledger(state.user),
    alerts = userAlerts(state.user),
    pending = state.leaves.filter((l) => l.status === "pending");
  const absent = state.attendance.filter((u) => u.status === "leave").length;
  return (
    heading(
      `Bonjour, ${esc(state.user.name.split(" ")[0])}`,
      fmt(state.today, { weekday: "long", day: "numeric", month: "long" }),
      `<button class="btn secondary" data-action="leave">${icon("plus")}Une absence</button>`,
      "L’essentiel",
    ) +
    clockCard() +
    `<div class="minimal-stats"><button data-page="hours"><span>Cette semaine</span><strong>${duration(total)}</strong><small>Heures travaillées</small></button><button data-page="overtime"><span>Solde d’heures</span><strong>${signedDuration(balance.minutes)}</strong><small>${balance.missing_days ? "Provisoire · journées à compléter" : "Selon votre contrat"}</small></button><button data-page="leaves"><span>Vacances disponibles</span><strong>${decimal(state.balance.remaining)} <em>jours</em></strong><small>Solde ${state.today.slice(0, 4)}</small></button></div>` +
    `<section class="panel home-alerts"><div class="panel-head"><div><h2>À vérifier</h2><p>${alerts.length ? alerts.length + " point(s) ce mois-ci" : "Vos journées renseignées ne présentent aucune alerte."}</p></div><button class="link-button" data-page="alerts">Tout voir${icon("arrow")}</button></div>${alerts.length ? alertRows(alerts.slice(-3).reverse()) : `<div class="all-clear">${icon("check")}Tout est à jour</div>`}</section>` +
    (state.user.role === "admin"
      ? `<section class="panel admin-glance"><div><span class="eyebrow">Votre équipe</span><h2>${state.users.length} collaborateurs</h2></div><div class="glance-values"><span><strong>${absent}</strong> absence(s) aujourd’hui</span><span><strong>${pending.length}</strong> demande(s) à traiter</span><span><strong>${unvalidatedMonths().length}</strong> mois à valider</span></div><button class="btn secondary" data-page="admin">Ouvrir le pilotage${icon("arrow")}</button></section>`
      : "")
  );
}
function alerts() {
  const rows = userAlerts(state.user, month);
  return (
    heading(
      "Les points à vérifier",
      "Des repères pour compléter vos horaires, sans bloquer vos saisies.",
      "",
      "Alertes",
    ) +
    monthFilter() +
    `<section class="panel"><div class="panel-head"><h2>${rows.length} alerte(s)</h2></div>${rows.length ? alertRows(rows.slice().reverse()) : empty("Aucune alerte pour cette période.", "check")}</section><p class="helper">Une journée prévue au contrat est signalée lorsqu’elle est passée et reste à renseigner. Repères indicatifs : moins de 30 min de pause au-delà de 6 h travaillées, ou plus de 1 h au-delà de l’objectif du jour. Les absences approuvées ajustent cet objectif ; les mois validés ne génèrent plus d’alertes.</p>`
  );
}
function admin() {
  if (state.user.role !== "admin") return dashboard();
  if (!adminMonth) adminMonth = shiftMonth(state.today.slice(0, 7), -1);
  const last = shiftDay(shiftMonth(adminMonth, 1) + "-01", -1);
  const members = state.users.map((u) => {
    const data = summary(u, adminMonth),
      balance = ledger(u),
      alerts = userAlerts(u, adminMonth);
    const leaves = state.leaves.filter(
      (l) =>
        l.user_id === u.id &&
        l.status === "approved" &&
        l.start <= last &&
        l.end >= adminMonth + "-01",
    );
    const eligible = (state.contracts || []).some(
      (c) => c.user_id === u.id && c.effective_from <= last,
    );
    return { u, data, balance, alerts, leaves, eligible };
  });
  const positive = members.reduce(
    (n, r) => n + Math.max(0, r.balance.minutes),
    0,
  );
  const pending = state.leaves.filter((l) => l.status === "pending");
  const validations = unvalidatedMonths();
  return (
    heading(
      "L’équipe, en un regard.",
      "Soldes, absences et clôtures mensuelles.",
      `<button class="btn secondary" data-page="team">${icon("calendar")}Planning équipe</button>`,
      "Pilotage administrateur",
    ) +
    `<div class="minimal-stats"><button data-page="reports"><span>Heures en crédit</span><strong>${duration(positive)}</strong><small>Cumul positif · soldes provisoires inclus</small></button><button data-page="leaves"><span>Demandes à traiter</span><strong>${pending.length}</strong><small>Tous types d’absence</small></button><button data-action="admin-pending"><span>Mois à valider</span><strong>${validations.length}</strong><small>Depuis le début des contrats</small></button></div>` +
    `<div class="filters"><label for="admin-month">Période</label><input type="month" id="admin-month" value="${adminMonth}" min="2000-01" max="${state.today.slice(0, 7)}"></div><section class="panel"><div class="panel-head"><h2>Synthèse de l’équipe</h2><span class="current-pill">${fmt(adminMonth + "-01", { month: "long", year: "numeric" })}</span></div><div class="table-wrap"><table><thead><tr><th>Collaborateur</th><th>Solde cumulé</th><th>Absences du mois</th><th>Alertes</th><th>Clôture</th><th></th></tr></thead><tbody>${members.map((r) => `<tr><td>${person(r.u)}</td><td><strong class="${r.balance.minutes < 0 ? "balance-negative" : "balance-positive"}">${signedDuration(r.balance.minutes)}</strong><small class="cell-sub">${r.balance.missing_days ? "Provisoire" : "À jour"}</small></td><td>${r.leaves.length ? [...new Set(r.leaves.map((l) => absenceTypes[l.kind || "vacation"]))].map((k) => esc(k)).join(" · ") : "—"}</td><td>${r.alerts.length ? `<span class="badge pending">${r.alerts.length} à vérifier</span>` : `<span class="muted">—</span>`}</td><td>${r.data.locked ? `<span class="badge approved">Validé</span>` : !r.eligible ? "Avant contrat" : adminMonth >= state.today.slice(0, 7) ? "En cours" : `<button class="btn small secondary" data-action="validate-month" data-user="${r.u.id}" data-month="${adminMonth}">Valider</button>`}</td><td><button class="link-button" data-action="member-report" data-user="${r.u.id}">Détail${icon("arrow")}</button></td></tr>`).join("")}</tbody></table></div></section>` +
    `<section class="panel bottom-panel" id="pending-months"><div class="panel-head"><h2>Clôtures à effectuer</h2><span class="current-pill">${validations.length}</span></div>${
      validations.length
        ? `<div class="pending-list">${validations
            .slice(0, 12)
            .map(
              (r) =>
                `<div><span><strong>${esc(r.user.name)}</strong><small>${fmt(r.month + "-01", { month: "long", year: "numeric" })}</small></span><button class="link-button" data-action="member-report" data-user="${r.user.id}" data-month="${r.month}">Examiner${icon("arrow")}</button></div>`,
            )
            .join(
              "",
            )}</div>${validations.length > 12 ? '<p class="helper">Sélectionnez un mois pour consulter les autres clôtures.</p>' : ""}`
        : empty("Tous les mois terminés sont validés.", "check")
    }</section>`
  );
}
function entryTable(rows, actions = true) {
  return `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Arrivée</th><th>Départ</th><th>Pause</th><th>Temps net</th><th>Note</th>${actions ? "<th>Actions</th>" : ""}</tr></thead><tbody>${rows.map((e) => `<tr><td><strong>${fmt(e.date, { weekday: "short", day: "numeric", month: "short" })}</strong></td><td>${e.start}</td><td>${e.end}</td><td>${e.break_minutes} min</td><td><strong>${duration(mins(e))}</strong></td><td class="note-cell">${esc(e.note) || "—"}</td>${actions && isLocked(e.user_id, e.date) ? `<td><span class="badge approved">Verrouillé</span></td>` : actions ? `<td><div class="actions"><button class="link-button" data-action="entry" data-id="${e.id}">Modifier</button><button class="btn small danger" data-action="delete-entry" data-id="${e.id}" aria-label="Supprimer la saisie du ${e.date}">${icon("trash")}</button></div></td>` : ""}</tr>`).join("")}</tbody></table></div>`;
}
function monthFilter(extra = "") {
  return `<div class="filters"><label for="month">Période</label><input id="month" type="month" value="${month}" min="2000-01" max="2100-12">${extra}</div>`;
}
function selectedCalendarUser() {
  return state.user.role === "admin"
    ? state.users.find((u) => String(u.id) === calendarUser) || state.user
    : state.user;
}
function calendarData() {
  const user = selectedCalendarUser();
  const key = month + ":" + user.id;
  if (!calendarIndex || calendarIndex.key !== key)
    calendarIndex = {
      key,
      ...indexCalendar(state.entries, state.leaves, user.id, month),
    };
  return calendarIndex;
}
function hours() {
  const user = selectedCalendarUser(),
    own = user.id === state.user.id;
  const data = calendarData(),
    rows = data.monthlyEntries;
  const selector =
    state.user.role === "admin"
      ? `<label class="calendar-person"><span>Collaborateur</span><select id="calendar-user" aria-label="Calendrier du collaborateur">${state.users.map((u) => `<option value="${u.id}" ${u.id === user.id ? "selected" : ""}>${esc(u.name)}${u.id === state.user.id ? " · moi" : ""}</option>`).join("")}</select></label>`
      : "";
  return (
    heading(
      "Votre temps, en clair.",
      "Retrouvez vos journées de travail et vos vacances dans un seul calendrier.",
      own
        ? `<button class="btn" data-action="entry">${icon("plus")}Saisir mes heures</button>`
        : "",
      "Mes horaires",
    ) +
    `<div class="hours-toolbar"><div class="view-switch" role="group" aria-label="Vue des horaires"><button data-action="hours-view" data-view="calendar" aria-pressed="${hoursView === "calendar"}" class="${hoursView === "calendar" ? "selected" : ""}">${icon("calendar")}Calendrier</button><button data-action="hours-view" data-view="list" aria-pressed="${hoursView === "list"}" class="${hoursView === "list" ? "selected" : ""}">${icon("report")}Liste</button><button data-action="hours-view" data-view="week" aria-pressed="${hoursView === "week"}" class="${hoursView === "week" ? "selected" : ""}">${icon("calendar")}Semaine</button><button data-action="hours-view" data-view="day" aria-pressed="${hoursView === "day"}" class="${hoursView === "day" ? "selected" : ""}">${icon("clock")}Jour</button></div>${selector}${own ? `<button class="btn secondary" data-action="batch">${icon("plus")}Saisie rapide</button>` : ""}<button class="btn secondary" data-action="export-calendar">${icon("download")}Exporter le mois</button></div>` +
    `<div class="stats calendar-stats">${stat("Heures travaillées", duration(data.minutes), "", "Temps net, pauses déduites", "clock")}${stat("Journées renseignées", rows.length, "jours", fmt(month + "-01", { month: "long", year: "numeric" }), "calendar")}${stat("Vacances approuvées", data.vacationDays, "jours", data.pendingDays ? data.pendingDays + " jour(s) en attente" : "Dans le mois sélectionné", "sun", true)}${stat("Écart du mois", signedDuration(summary(user, month).delta_minutes), "", summary(user, month).locked ? "Mois validé" : summary(user, month).missing_days + " jour(s) à compléter · provisoire", "clock")}</div>` +
    (hoursView === "week"
      ? personalWeek(user)
      : hoursView === "day"
        ? dayView(user)
        : hoursView === "calendar"
          ? calendarMonth(data, user)
          : monthFilter() +
            `<section class="panel"><div class="panel-head"><div><h2>Journal de travail</h2><p>${esc(user.name)} · ${fmt(month + "-01", { month: "long", year: "numeric" })}</p></div></div>${rows.length ? entryTable(rows, own) : empty("Aucune heure saisie pour ce mois.")}</section>`) +
    (own ? quickTools() : "")
  );
}
function calendarMonth(data, user) {
  return `<div class="calendar-layout"><section class="panel calendar-panel" aria-label="Calendrier mensuel"><div class="calendar-head"><div><span class="eyebrow">Votre calendrier</span><h2>${fmt(month + "-01", { month: "long", year: "numeric" })}</h2></div><div class="month-navigation"><button class="icon-button" data-action="month-prev" aria-label="Mois précédent">${icon("chevronLeft")}</button><button class="btn secondary small" data-action="month-today">Aujourd’hui</button><button class="icon-button" data-action="month-next" aria-label="Mois suivant">${icon("chevronRight")}</button><label class="month-jump"><span class="visually-hidden">Choisir le mois</span><input id="month" type="month" value="${month}" min="2000-01" max="2100-12" aria-label="Choisir le mois"></label></div></div><div class="calendar-legend"><span><i class="work"></i>Travail</span><span><i class="vacation"></i>Vacances</span><span><i class="pending"></i>En attente</span><span class="calendar-hint">Cliquez sur une journée pour la gérer</span></div><div class="calendar-weekdays">${["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((x) => `<span>${x}</span>`).join("")}</div><div class="calendar-grid">${data.dates.map((day) => calendarCell(day, data)).join("")}</div><div class="calendar-bottom"><span>${icon("check")}Vos heures et vos congés au même endroit</span><span>Double-clic : saisie rapide</span></div></section><aside class="calendar-aside">${selectedDayPanel(data, user)}${calendarUpcoming(user)}</aside></div>`;
}
function calendarCell(day, data) {
  const e = data.entriesByDate.get(day.date),
    leave = data.periodsByDate.get(day.date),
    dayAbsences = data.absencesByDate?.get(day.date) || (leave ? [leave] : []),
    active = day.date === selectedDate,
    today = day.date === state.today;
  const status = e
    ? duration(entryMinutes(e)) + " de travail"
    : leave
      ? labels[leave.status] + " — " + absenceLabel(leave)
      : "Aucune saisie";
  return `<button class="calendar-day ${day.inMonth ? "" : "outside"} ${day.weekend ? "weekend" : ""} ${active ? "selected" : ""} ${today ? "today" : ""}" data-action="select-day" data-date="${day.date}" aria-label="${esc(fmt(day.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + ", " + status)}" aria-pressed="${active}" tabindex="${active ? 0 : -1}"><span class="day-top"><span class="day-number">${Number(day.date.slice(-2))}</span>${today ? '<span class="today-label">Aujourd’hui</span>' : ""}</span>${e ? `<span class="day-event work"><strong>${duration(entryMinutes(e))}</strong><span>${e.start} – ${e.end}</span></span>` : ""}${dayAbsences.map((l) => `<span class="day-event ${l.status === "approved" ? "vacation" : "pending"}">${icon("sun")}<span>${esc(absenceLabel(l))}${l.status === "pending" ? " · en attente" : ""}</span></span>`).join("")}${!e && !leave && day.inMonth && !day.weekend && day.date <= state.today ? '<span class="day-empty">Ajouter des heures</span>' : ""}</button>`;
}
function selectedDayPanel(data, user) {
  const e = data.entriesByDate.get(selectedDate),
    leave = data.periodsByDate.get(selectedDate),
    own = user.id === state.user.id,
    future = selectedDate > state.today;
  const title = fmt(selectedDate, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  let detail = e
    ? `<div class="day-total"><strong>${duration(entryMinutes(e))}</strong><span>heures travaillées</span></div><div class="day-details"><span>Arrivée<strong>${e.start}</strong></span><span>Départ<strong>${e.end}</strong></span><span>Pause<strong>${e.break_minutes} min</strong></span></div>${e.note ? `<p class="day-note">${esc(e.note)}</p>` : ""}`
    : leave
      ? `<div class="day-illustration vacation">${icon("sun")}</div><h3>${leave.status === "approved" ? esc(absenceLabel(leave)) : "Votre demande est en cours."}</h3><p class="day-description">${fmt(leave.start)} — ${fmt(leave.end)} · ${leave.days} jour(s)</p>${badge(leave.status)}`
      : `<div class="day-illustration">${icon(future ? "calendar" : "clock")}</div><h3>${future ? "Une journée à venir." : "Une journée à renseigner."}</h3><p class="day-description">${future ? "Planifiez vos vacances pour cette date. Les heures se saisissent après la journée de travail." : "Ajoutez vos heures de travail pour compléter votre calendrier."}</p>`;
  let buttons = isLocked(user.id, selectedDate)
    ? `<p class="notice">${icon("shield")}Mois validé · saisies verrouillées</p>`
    : "";
  if (
    own &&
    !future &&
    !fullAbsence(state.leaves, user.id, selectedDate) &&
    !isLocked(user.id, selectedDate)
  )
    buttons = `<button class="btn" data-action="entry" ${e ? `data-id="${e.id}"` : ""} data-date="${selectedDate}">${icon(e ? "clock" : "plus")}${e ? "Modifier la journée" : "Saisir cette journée"}</button>${e ? `<button class="link-button delete-day" data-action="delete-entry" data-id="${e.id}">${icon("trash")}Supprimer la saisie</button>` : ""}`;
  if (own && future && !leave && !isLocked(user.id, selectedDate))
    buttons = `<button class="btn secondary" data-action="leave" data-date="${selectedDate}">${icon("sun")}Déclarer une absence</button>`;
  if (leave?.status === "pending" && state.user.role === "admin")
    buttons += `<button class="btn secondary" data-page="leaves">Examiner la demande ${icon("arrow")}</button>`;
  detail += (data.absencesByDate?.get(selectedDate) || [])
    .map(
      (l) =>
        `<p class="day-description">${esc(absenceLabel(l))} · ${labels[l.status]}</p>`,
    )
    .join("");
  return `<section class="panel selected-day-panel"><div class="day-panel-title"><span class="eyebrow">Journée sélectionnée</span><h2>${title}</h2>${user.id !== state.user.id ? `<p>${esc(user.name)}</p>` : ""}</div><div class="selected-day-body">${detail}<div class="day-panel-actions">${buttons}</div></div></section>`;
}
function calendarUpcoming(user) {
  const next = state.leaves
    .filter(
      (l) =>
        l.user_id === user.id &&
        l.status !== "rejected" &&
        l.end >= state.today,
    )
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 2);
  return `<section class="panel upcoming-panel"><div class="panel-head"><div><h2>Prochaines vacances</h2><p>Une pause se prépare.</p></div>${icon("sun")}</div>${next.length ? `<div class="upcoming-items">${next.map((l) => `<div><span class="upcoming-icon">${icon("sun")}</span><div><strong>${fmt(l.start)} — ${fmt(l.end)}</strong><small>${l.days} jour(s) · ${labels[l.status]}</small></div></div>`).join("")}</div>` : '<p class="upcoming-empty">Aucune période planifiée pour le moment.</p>'}</section>`;
}
function selectDay(date, focus = false) {
  if (date < "2000-01-01" || date > "2100-12-31") return;
  selectedDate = date;
  if (hoursView !== "calendar") {
    month = date.slice(0, 7);
    calendarIndex = null;
    renderContent();
    if (focus) app.querySelector(`.calendar-day[data-date="${date}"]`)?.focus();
    return;
  }
  if (!date.startsWith(month)) {
    month = date.slice(0, 7);
    calendarIndex = null;
    renderContent();
  } else {
    for (const day of app.querySelectorAll(".calendar-day")) {
      const active = day.dataset.date === date;
      day.classList.toggle("selected", active);
      day.setAttribute("aria-pressed", String(active));
      day.tabIndex = active ? 0 : -1;
    }
    const panel = app.querySelector(".selected-day-panel");
    if (panel)
      panel.outerHTML = selectedDayPanel(
        calendarData(),
        selectedCalendarUser(),
      );
  }
  if (focus)
    app
      .querySelector(`.calendar-day[data-date="${date}"]`)
      ?.focus({ preventScroll: true });
}
function changeMonth(offset) {
  const next = shiftMonth(month, offset);
  if (next < "2000-01" || next > "2100-12") return;
  month = next;
  selectedDate =
    month === state.today.slice(0, 7) ? state.today : month + "-01";
  calendarIndex = null;
  renderContent();
}
function leaves() {
  const admin = state.user.role === "admin",
    rows = state.leaves,
    b = state.balance;
  return (
    heading(
      "Vos absences, simplement.",
      "Planifiez vos absences. Nous nous occupons du décompte.",
      `<button class="btn" data-action="leave">${icon("plus")}Déclarer une absence</button>`,
    ) +
    `<div class="stats">${stat("Mon quota annuel", decimal(b.allowance), "jours", state.today.slice(0, 4), "calendar")}${stat("Mes congés approuvés", decimal(b.used), "jours", "Déduits du solde annuel", "check")}${stat("Mon solde disponible", decimal(b.remaining), "jours", "Hors demandes en attente", "sun", true)}${stat(admin ? "Demandes à traiter" : "Mes demandes en attente", rows.filter((l) => l.status === "pending").length, "", admin ? "Pour l’ensemble de l’équipe" : "Validation administrateur", "report")}</div><div class="notice">Vacances, maladie, formation, déplacement ou congé sans solde : journées entières et demi-journées. Seules les vacances déduisent votre quota. Les jours ouvrés sont comptés du lundi au vendredi, jours fériés inclus.</div><section class="panel"><div class="panel-head"><div><h2>${admin ? "Les demandes de l’équipe" : "Mes demandes"}</h2><p>Un suivi clair, de la demande à la validation.</p></div></div>${rows.length ? `<div class="table-wrap"><table><thead><tr>${admin ? "<th>Collaborateur</th>" : ""}<th>Type</th><th>Période</th><th>Durée</th><th>Statut</th><th>Note</th><th>Actions</th></tr></thead><tbody>${rows.map((l) => `<tr>${admin ? `<td>${person(state.users.find((u) => u.id === l.user_id))}</td>` : ""}<td><strong>${esc(absenceLabel(l))}</strong></td><td>${fmt(l.start, { day: "numeric", month: "short", year: "numeric" })} → ${fmt(l.end, { day: "numeric", month: "short", year: "numeric" })}</td><td>${l.days} jour${l.days > 1 ? "s" : ""}</td><td>${badge(l.status)}</td><td class="note-cell">${esc(l.note) || "—"}</td><td><div class="actions">${l.status === "pending" ? `${admin ? `<button class="btn small" data-action="approve" data-id="${l.id}">Approuver</button><button class="btn small danger" data-action="reject" data-id="${l.id}">Refuser</button>` : ""}${l.user_id === state.user.id ? `<button class="link-button" data-action="cancel-leave" data-id="${l.id}">Annuler</button>` : ""}` : "—"}</div></td></tr>`).join("")}</tbody></table></div>` : empty("Aucune demande d’absence pour le moment.", "sun")}</section>`
  );
}
function attendance() {
  const rows = state.attendance;
  return (
    heading(
      "Une équipe, au même rythme.",
      "La visibilité dont vous avez besoin pour organiser votre journée.",
      "",
      "Présence de l’équipe",
    ) +
    `<div class="stats">${stat("Collaborateurs", rows.length, "", "Au sein de votre équipe", "people")}${stat("Heures déclarées", rows.filter((r) => r.status === "recorded").length, "", "Une saisie existe aujourd’hui", "clock")}${stat("En absence", rows.filter((r) => r.status === "leave").length, "", "Absences approuvées aujourd’hui", "sun", true)}${stat("Non renseignés", rows.filter((r) => r.status === "unknown").length, "", "Aucune saisie ni congé approuvé", "calendar")}</div><div class="notice">Présence du ${fmt(state.today, { day: "numeric", month: "long", year: "numeric" })}. Ce tableau associe les heures déclarées, les absences et les pointages en cours. Actualisez pour obtenir les derniers états.</div><div class="attendance-grid">${rows.map((u) => `<article class="panel person-card">${person(u, "Équipe Tempo")}<div class="person-meta">${u.status === "leave" ? `<span class="badge leave">${esc(absenceLabel({ kind: u.absence_kind, portion: u.portion }))}</span>` : badge(u.status)}<span>${u.start ? u.start + " – " + u.end : "—"}</span>${(u.absences || []).map((l) => `<small>${esc(absenceLabel(l))}</small>`).join("")}</div></article>`).join("")}</div>`
  );
}
function userSelect() {
  return state.user.role === "admin"
    ? `<label for="report-user">Collaborateur</label><select id="report-user">${state.users.map((u) => `<option value="${u.id}" ${String(u.id) === reportUser ? "selected" : ""}>${esc(u.name)}</option>`).join("")}<option value="all" ${reportUser === "all" ? "selected" : ""}>Toute l’équipe</option></select>`
    : "";
}
function reportRows() {
  const start = month + "-01",
    end = new Date(
      Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
    )
      .toISOString()
      .slice(0, 10);
  const selected =
    state.user.role === "admin"
      ? state.users.filter(
          (u) => reportUser === "all" || String(u.id) === reportUser,
        )
      : [state.user];
  return selected.map((u) => {
    const rows = state.entries.filter(
      (e) => e.user_id === u.id && e.date.startsWith(month),
    );
    let leaveDays = 0;
    state.leaves
      .filter(
        (l) =>
          l.user_id === u.id &&
          l.status === "approved" &&
          l.start <= end &&
          l.end >= start &&
          (!l.kind || l.kind === "vacation"),
      )
      .forEach((l) => {
        for (
          let d = new Date((l.start > start ? l.start : start) + "T12:00:00Z");
          d <= new Date((l.end < end ? l.end : end) + "T12:00:00Z");
          d.setUTCDate(d.getUTCDate() + 1)
        )
          if (![0, 6].includes(d.getUTCDay())) leaveDays += absenceFraction(l);
      });
    return {
      u,
      rows,
      minutes: rows.reduce((a, e) => a + mins(e), 0),
      pause: rows.reduce((a, e) => a + e.break_minutes, 0),
      leaveDays,
    };
  });
}
function reports() {
  const summary = reportRows(),
    total = summary.reduce((a, r) => a + r.minutes, 0),
    vacations = summary.reduce((a, r) => a + r.leaveDays, 0),
    count = summary.reduce((a, r) => a + r.rows.length, 0);
  return (
    heading(
      "Chaque mois, une vue claire.",
      "Un rapport fiable des heures déclarées et des congés approuvés.",
      `<div class="heading-actions"><button class="btn secondary" data-action="pdf">${icon("report")}Rapport PDF</button><button class="btn" data-action="export-report">${icon("download")}Exporter le rapport</button></div>`,
      "Rapports mensuels",
    ) +
    monthFilter(userSelect()) +
    `<div class="report-summary">${stat("Heures travaillées", duration(total), "", "Total net de la sélection", "clock")}${stat("Journées renseignées", count, "jours", "Chaque saisie compte pour une journée", "calendar")}${stat("Vacances approuvées", vacations, "jours", "Jours ouvrés de la période", "sun", true)}</div><section class="panel"><div class="panel-head"><div><h2>Synthèse · ${fmt(month + "-01", { month: "long", year: "numeric" })}</h2><p>Temps net et moyenne sur les journées renseignées.</p></div><span class="current-pill">${summary.length} collaborateur${summary.length > 1 ? "s" : ""}</span></div><div class="table-wrap"><table><thead><tr><th>Collaborateur</th><th>Jours saisis</th><th>Temps net</th><th>Pauses</th><th>Moyenne / jour</th><th>Vacances</th><th>Écart du mois</th><th>Validation</th></tr></thead><tbody>${summary.map((r) => `<tr><td>${person(r.u)}</td><td>${r.rows.length}</td><td><strong>${duration(r.minutes)}</strong></td><td>${duration(r.pause)}</td><td>${r.rows.length ? duration(Math.round(r.minutes / r.rows.length)) : "—"}</td><td>${r.leaveDays} j</td><td><strong>${signedDuration(windowSummary(r.u, month).delta_minutes)}</strong></td><td>${validationControls(r.u)}</td></tr>`).join("")}</tbody></table></div></section>${summary.length === 1 ? `<section class="panel bottom-panel"><div class="panel-head"><div><h2>Détail des journées</h2><p>${esc(summary[0].u.name)}</p></div></div>${summary[0].rows.length ? entryTable(summary[0].rows, false) : empty("Aucune heure renseignée sur cette période.")}</section>` : ""}<p class="helper">L’export CSV comprend une synthèse par collaborateur et le détail des journées. Les jours sans saisie ne sont pas considérés comme des absences. Ces rapports décrivent le temps déclaré et ne constituent pas un calcul de paie.</p>`
  );
}
function users() {
  return (
    heading(
      "Votre équipe, bien organisée.",
      "Gérez les accès, les droits et les quotas annuels de vacances.",
      `<button class="btn" data-action="user">${icon("plus")}Ajouter un utilisateur`,
      "Administration",
    ) +
    `<section class="panel"><div class="panel-head"><div><h2>Les membres de l’équipe</h2><p>${state.users.length} compte${state.users.length > 1 ? "s" : ""} · Les collaborateurs voient uniquement leurs heures et leurs demandes.</p></div></div><div class="table-wrap"><table><thead><tr><th>Collaborateur</th><th>E-mail</th><th>Rôle</th><th>Quota / an</th><th>Solde actuel</th><th>Contrat courant</th><th>Actions</th></tr></thead><tbody>${state.users.map((u) => `<tr><td>${person(u, u.id === state.user.id ? "Vous" : "")}</td><td>${esc(u.email)}</td><td><span class="badge ${u.role === "admin" ? "approved" : ""}">${u.role === "admin" ? "Administrateur" : "Collaborateur"}</span></td><td>${decimal(u.allowance)} jours</td><td><strong>${decimal(u.vacation_balance.remaining)} jours</strong><br><small class="week-days">${decimal(u.vacation_balance.used)} approuvés · ${state.today.slice(0, 4)}</small></td><td>${duration((scheduleFor(state.contracts || [], u.id, state.today)?.schedule || []).reduce((a, b) => a + b, 0))} / sem.</td><td><div class="actions"><button class="link-button" data-action="user" data-id="${u.id}">Compte</button><button class="link-button" data-action="contract" data-id="${u.id}">Contrat</button></div></td></tr>`).join("")}</tbody></table></div></section><p class="helper">Un administrateur peut consulter les rapports de l’équipe, traiter les vacances et créer les comptes. Le quota annuel s’applique à chaque année, sans report automatique. Les mots de passe ne sont jamais affichés.</p>`
  );
}
function dialog(
  title,
  subtitle,
  form,
  submit,
  handler,
  closeApplication = false,
) {
  modal.innerHTML = `<div class="modal-head"><div><h2>${title}</h2><p>${subtitle}</p></div><button class="close" data-action="close" aria-label="Fermer">×</button></div><form><div class="error" role="alert"></div>${form}<div class="modal-actions"><button class="btn secondary" type="button" data-action="close">Annuler</button><button class="btn" type="submit">${submit}</button></div></form>`;
  modal.showModal();
  modal.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget,
      btn = f.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      const result = await handler(Object.fromEntries(new FormData(f)));
      modal.close();
      if (closeApplication) return;
      await refresh();
      loadPage();
      toast(result?.message || "Enregistrement effectué.");
    } catch (err) {
      f.querySelector(".error").textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}
function entryDialog(id, date = state.today) {
  const e = id ? myEntries().find((x) => x.id === Number(id)) : null;
  if (state.clock?.date === (e?.date || date)) {
    toast("Terminez ou annulez le pointage avant la saisie manuelle.", true);
    return;
  }
  if (isLocked(state.user.id, e?.date || date)) {
    toast("Ce mois est validé et verrouillé.", true);
    return;
  }
  dialog(
    e ? "Modifier la journée" : "Saisir mes heures",
    "Une saisie par jour. Les pauses sont déduites du temps travaillé.",
    `<div class="form-grid">${state.favorites?.length ? `<label class="field full">Horaire favori<select id="entry-favorite"><option value="">Horaire personnalisé</option>${state.favorites.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join("")}</select></label>` : ""}<label class="field full">Date<input type="date" name="date" required ${e ? "readonly" : ""} value="${e?.date || date}" max="${state.today}"></label><label class="field">Heure de début<input type="time" name="start" required value="${e?.start || "08:00"}"></label><label class="field">Heure de fin<input type="time" name="end" required value="${e?.end || "17:00"}"></label><label class="field full">Pause (minutes)<input type="number" name="break_minutes" min="0" max="720" step="1" required value="${e?.break_minutes ?? 60}"></label><label class="field full">Note facultative<textarea name="note" maxlength="500" placeholder="Projet, activité, précision…">${esc(e?.note || "")}</textarea></label></div>`,
    "Enregistrer",
    (b) =>
      api("/api/entries", "POST", {
        ...b,
        break_minutes: Number(b.break_minutes),
      }),
  );
  const favorite = modal.querySelector("#entry-favorite");
  if (favorite)
    favorite.onchange = (e) => {
      const f = state.favorites.find((f) => f.id === Number(e.target.value));
      if (f)
        for (const name of ["start", "end", "break_minutes"])
          modal.querySelector(`[name="${name}"]`).value = f[name];
    };
}
function leaveDialog(date = state.today) {
  dialog(
    "Déclarer une absence",
    "Votre demande sera examinée par un administrateur.",
    `<div class="form-grid"><label class="field full">Type d’absence<select name="kind" id="absence-kind">${Object.entries(
      absenceTypes,
    )
      .map(([k, v]) => `<option value="${k}">${v}</option>`)
      .join(
        "",
      )}</select></label><label class="field full">Durée<select name="portion" id="absence-portion" aria-label="Durée"><option value="full">Journée(s) entière(s)</option><option value="morning">Demi-journée · matin</option><option value="afternoon">Demi-journée · après-midi</option></select></label><label class="field">Premier jour<input type="date" name="start" value="${date}" min="${state.today}" required></label><label class="field">Dernier jour inclus<input type="date" name="end" value="${date}" min="${state.today}" required></label><label class="field full">Note facultative<textarea name="note" maxlength="500" placeholder="Visible par vous et les administrateurs"></textarea></label></div><p class="helper" id="absence-help">Vacances : ${decimal(state.balance.remaining)} jours disponibles. Une demi-journée déduit 0,5 jour.</p>`,
    "Envoyer la demande",
    (b) => api("/api/leaves", "POST", b),
  );
  const kind = modal.querySelector("#absence-kind"),
    portion = modal.querySelector("#absence-portion"),
    start = modal.querySelector('[name="start"]'),
    end = modal.querySelector('[name="end"]');
  const update = () => {
    const minimum = kind.value === "vacation" ? state.today : "2000-01-01";
    start.min = end.min = minimum;
    end.readOnly = portion.value !== "full";
    if (end.readOnly) end.value = start.value;
    modal.querySelector("#absence-help").textContent =
      kind.value === "vacation"
        ? `Vacances : ${decimal(state.balance.remaining)} jours disponibles. Une demi-journée déduit 0,5 jour.`
        : kind.value === "unpaid"
          ? "L’objectif est réduit pour cette absence. Votre quota de vacances ne change pas."
          : "Les heures prévues au contrat sont créditées après approbation. Votre quota de vacances ne change pas.";
  };
  kind.onchange = portion.onchange = start.onchange = update;
}
function userDialog(id) {
  const u = id ? state.users.find((x) => x.id === Number(id)) : null;
  dialog(
    u ? "Gérer le compte" : "Ajouter un collaborateur",
    u
      ? esc(u.name) + " · " + esc(u.email)
      : "Créez un accès personnel pour un membre de votre équipe.",
    `<div class="form-grid">${!u ? '<label class="field full">Nom complet<input name="name" required maxlength="100" autocomplete="name"></label><label class="field full">Adresse e-mail<input type="email" name="email" required maxlength="200" autocomplete="off"></label>' : ""}<label class="field full">${u ? "Nouveau mot de passe (facultatif)" : "Mot de passe initial"}<input type="password" name="password" ${u ? "" : "required"} minlength="10" maxlength="128" autocomplete="new-password"><small>10 caractères minimum. ${u ? "Le changement déconnecte les sessions de ce compte." : "Transmettez le mot de passe de façon privée."}</small></label><label class="field">Rôle<select name="role"><option value="user" ${u?.role === "user" ? "selected" : ""}>Collaborateur</option><option value="admin" ${u?.role === "admin" ? "selected" : ""}>Administrateur</option></select></label><label class="field">Vacances / an (jours)<input type="number" name="allowance" min="0" max="365" step="0.5" required value="${u?.allowance ?? 25}"></label><label class="field full">Objectif quotidien (heures)<input type="number" name="daily_hours" min="1" max="16" step="0.25" required value="${u?.daily_hours ?? 8}"></label></div>`,
    u ? "Enregistrer" : "Créer le compte",
    (b) =>
      api(u ? "/api/users/" + u.id : "/api/users", u ? "PATCH" : "POST", {
        ...b,
        allowance: Number(b.allowance),
        daily_hours: Number(b.daily_hours),
      }),
  );
}
function accountDialog() {
  dialog(
    "Mon compte",
    esc(state.user.name) + " · " + esc(state.user.email),
    `<label class="field">Mot de passe actuel<input name="current_password" type="password" required maxlength="128" autocomplete="current-password"></label><label class="field">Nouveau mot de passe<input name="password" type="password" required minlength="10" maxlength="128" autocomplete="new-password"></label><label class="field">Confirmer le nouveau mot de passe<input name="confirm_password" type="password" required minlength="10" maxlength="128" autocomplete="new-password"></label><p class="helper">Les autres sessions de votre compte seront déconnectées.</p>`,
    "Changer le mot de passe",
    (b) => {
      if (b.password !== b.confirm_password)
        throw new Error(
          "Les deux nouveaux mots de passe ne correspondent pas.",
        );
      return api("/api/password", "POST", b);
    },
  );
}
function csvDownload(rows, name) {
  const cell = (v) => {
    let s = String(v ?? "");
    if (/^\s*[=+\-@]|^[\t\r\n]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  const blob = new Blob(
      ["\uFEFF" + rows.map((r) => r.map(cell).join(";")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    ),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Export téléchargé.");
}
function exportHours() {
  const rows = myEntries().filter((e) => e.date.startsWith(month));
  csvDownload(
    [
      ["Date", "Début", "Fin", "Pause (min)", "Temps net (min)", "Note"],
      ...rows.map((e) => [
        e.date,
        e.start,
        e.end,
        e.break_minutes,
        mins(e),
        e.note,
      ]),
    ],
    `tempo-horaires-${month}.csv`,
  );
}
function exportReport() {
  const summary = reportRows();
  csvDownload(
    [
      ["Rapport mensuel", month],
      [],
      [
        "Collaborateur",
        "Jours saisis",
        "Temps net (min)",
        "Pauses (min)",
        "Vacances (jours)",
      ],
      ...summary.map((r) => [
        r.u.name,
        r.rows.length,
        r.minutes,
        r.pause,
        r.leaveDays,
      ]),
      [],
      [
        "Collaborateur",
        "Date",
        "Début",
        "Fin",
        "Pause (min)",
        "Temps net (min)",
        "Note",
      ],
      ...summary.flatMap((r) =>
        r.rows.map((e) => [
          r.u.name,
          e.date,
          e.start,
          e.end,
          e.break_minutes,
          mins(e),
          e.note,
        ]),
      ),
    ],
    `tempo-rapport-${month}.csv`,
  );
}
async function confirmation(title, message, run, closeApplication = false) {
  dialog(title, message, "", "Confirmer", run, closeApplication);
}
document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-page],[data-action]");
  if (!target) return;
  if (target.dataset.page) {
    page = target.dataset.page;
    render();
    loadPage();
    return;
  }
  const { action, id } = target.dataset;
  try {
    switch (action) {
      case "clock-start":
      case "clock-pause":
      case "clock-resume":
      case "clock-stop":
        target.disabled = true;
        try {
          await api("/api/clock", "POST", { action: action.slice(6) });
          await refresh();
        } finally {
          target.disabled = false;
        }
        break;
      case "clock-cancel":
        confirmation(
          "Annuler le pointage ?",
          "Les heures de ce pointage ne seront pas enregistrées. Vous pourrez les saisir manuellement.",
          () => api("/api/clock", "POST", { action: "cancel" }),
        );
        break;
      case "alert-day":
        calendarUser = target.dataset.user;
        selectedDate = target.dataset.date;
        month = selectedDate.slice(0, 7);
        hoursView = "day";
        page = "hours";
        render();
        break;
      case "member-report":
        reportUser = target.dataset.user;
        month = target.dataset.month || adminMonth || state.today.slice(0, 7);
        page = "reports";
        render();
        break;
      case "admin-pending":
        document
          .querySelector("#pending-months")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
        break;
      case "theme": {
        const theme =
          document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = theme;
        try {
          localStorage.setItem("tempo-theme", theme);
        } catch {}
        render();
        break;
      }
      case "batch":
        batchDialog();
        break;
      case "favorite":
        favoriteDialog();
        break;
      case "save-week":
        saveWeekDialog();
        break;
      case "delete-favorite":
        confirmation(
          "Supprimer ce favori ?",
          "Vos saisies existantes ne changent pas.",
          () => api("/api/favorites/" + id, "DELETE"),
        );
        break;
      case "delete-template":
        confirmation(
          "Supprimer cette semaine type ?",
          "Les journées déjà saisies sont conservées.",
          () => api("/api/week-templates/" + id, "DELETE"),
        );
        break;
      case "contract":
        contractDialog(id);
        break;
      case "pdf":
        await downloadPdf();
        break;
      case "validate-month":
        validateMonth(target.dataset.user, target.dataset.month);
        break;
      case "reopen-month":
        reopenMonth(target.dataset.user, target.dataset.month);
        break;
      case "team-prev":
        teamStart = shiftDay(teamStart, -7);
        teamData = null;
        renderContent();
        loadPage();
        break;
      case "team-next":
        teamStart = shiftDay(teamStart, 7);
        teamData = null;
        renderContent();
        loadPage();
        break;
      case "team-today":
        teamStart = datesForWeek(state.today)[0];
        teamData = null;
        renderContent();
        loadPage();
        break;
      case "history-next":
        historyOffset += 100;
        historyData = null;
        renderContent();
        loadPage();
        break;
      case "history-prev":
        historyOffset = Math.max(0, historyOffset - 100);
        historyData = null;
        renderContent();
        loadPage();
        break;
      case "week-prev":
        selectDay(shiftDay(selectedDate, -7));
        renderContent();
        break;
      case "week-next":
        selectDay(shiftDay(selectedDate, 7));
        renderContent();
        break;
      case "day-prev":
        selectDay(shiftDay(selectedDate, -1));
        renderContent();
        break;
      case "day-next":
        selectDay(shiftDay(selectedDate, 1));
        renderContent();
        break;
      case "refresh":
        await refresh();
        loadPage();
        toast("Données actualisées.");
        break;
      case "menu":
        document.querySelector(".sidebar").classList.toggle("open");
        break;
      case "close":
        modal.close();
        break;
      case "entry":
        entryDialog(id, target.dataset.date || state.today);
        break;
      case "leave":
        leaveDialog(target.dataset.date || state.today);
        break;
      case "user":
        userDialog(id);
        break;
      case "account":
        accountDialog();
        break;
      case "quit":
        confirmation(
          "Quitter Tempo ?",
          "Vos données sont conservées sur cet ordinateur. Double-cliquez sur Tempo.exe pour revenir.",
          async () => {
            await api("/api/desktop/quit", "POST", {});
            modal.close();
            state = null;
            app.innerHTML = `<div class="loading"><h1>Tempo est fermé.</h1><p>Vos données sont enregistrées. Vous pouvez fermer cet onglet.</p><p>Double-cliquez sur Tempo.exe pour revenir.</p></div>`;
          },
          true,
        );
        break;
      case "logout":
        await api("/api/logout", "POST", {});
        state = null;
        month = "";
        selectedDate = "";
        calendarUser = "";
        calendarIndex = null;
        reportUser = "";
        page = "dashboard";
        auth(false);
        break;
      case "delete-entry":
        confirmation(
          "Supprimer cette journée ?",
          "Cette saisie sera supprimée du rapport mensuel.",
          () => api("/api/entries/" + id, "DELETE"),
        );
        break;
      case "cancel-leave":
        confirmation(
          "Annuler la demande ?",
          "Votre demande en attente sera supprimée.",
          () => api("/api/leaves/" + id, "DELETE"),
        );
        break;
      case "approve":
      case "reject":
        confirmation(
          action === "approve"
            ? "Approuver cette absence ?"
            : "Refuser la demande ?",
          action === "approve"
            ? state.leaves.find((l) => l.id === Number(id))?.kind === "vacation"
              ? "Cette demande sera approuvée et déduite du solde de vacances."
              : "Cette absence sera approuvée et prise en compte dans le solde d’heures. Le quota de vacances ne change pas."
            : "La demande sera marquée comme refusée.",
          () =>
            api("/api/leaves/" + id, "PATCH", {
              status: action === "approve" ? "approved" : "rejected",
            }),
        );
        break;
      case "select-day":
        selectDay(target.dataset.date);
        break;
      case "month-prev":
        changeMonth(-1);
        break;
      case "month-next":
        changeMonth(1);
        break;
      case "month-today":
        month = state.today.slice(0, 7);
        selectedDate = state.today;
        calendarIndex = null;
        renderContent();
        break;
      case "hours-view":
        hoursView = target.dataset.view;
        renderContent();
        break;
      case "export-calendar": {
        const user = selectedCalendarUser();
        csvDownload(
          [
            [
              "Collaborateur",
              "Date",
              "Début",
              "Fin",
              "Pause (min)",
              "Temps net (min)",
              "Note",
            ],
            ...calendarData().monthlyEntries.map((e) => [
              user.name,
              e.date,
              e.start,
              e.end,
              e.break_minutes,
              entryMinutes(e),
              e.note,
            ]),
          ],
          `tempo-horaires-${month}.csv`,
        );
        break;
      }
      case "export-hours":
        exportHours();
        break;
      case "export-report":
        exportReport();
        break;
    }
  } catch (e) {
    toast(e.message, true);
  }
});
document.addEventListener("change", (event) => {
  if (event.target.id === "admin-month") {
    const value = event.target.value;
    if (
      /^\d{4}-\d{2}$/.test(value) &&
      value >= "2000-01" &&
      value <= state.today.slice(0, 7)
    ) {
      adminMonth = value;
      renderContent();
    }
  }
  if (event.target.id === "month") {
    const v = event.target.value;
    if (/^\d{4}-\d{2}$/.test(v) && v >= "2000-01" && v <= "2100-12") {
      month = v;
      selectedDate =
        month === state.today.slice(0, 7) ? state.today : month + "-01";
      calendarIndex = null;
      renderContent();
    }
  }
  if (event.target.id === "overtime-user") {
    calendarUser = event.target.value;
    renderContent();
  }
  if (event.target.id === "calendar-user") {
    calendarUser = event.target.value;
    calendarIndex = null;
    renderContent();
  }
  if (event.target.id === "report-user") {
    reportUser = event.target.value;
    render();
  }
});
document.addEventListener("dblclick", (event) => {
  const day = event.target.closest(".calendar-day");
  if (
    !day ||
    selectedCalendarUser().id !== state.user.id ||
    day.dataset.date > state.today
  )
    return;
  const data = calendarData();
  if (isLocked(state.user.id, day.dataset.date)) return;
  if (fullAbsence(state.leaves, state.user.id, day.dataset.date)) return;
  entryDialog(data.entriesByDate.get(day.dataset.date)?.id, day.dataset.date);
});
document.addEventListener("keydown", (event) => {
  const day = event.target.closest(".calendar-day");
  if (!day) return;
  const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  if (event.key in offsets) {
    event.preventDefault();
    selectDay(shiftDay(day.dataset.date, offsets[event.key]), true);
  }
});
modal.addEventListener("click", (e) => {
  if (e.target === modal) {
    const r = modal.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      modal.close();
  }
});
(async () => {
  try {
    const status = await api("/api/status");
    if (status.setupRequired) return auth(true);
    try {
      await refresh();
    } catch (e) {
      if (e.message === "Veuillez vous connecter.") auth(false);
      else throw e;
    }
  } catch (e) {
    app.innerHTML = `<div class="loading"><h1>Tempo est momentanément indisponible.</h1><p>${esc(e.message)}</p><button class="btn" data-action="retry">Réessayer</button></div>`;
    app.querySelector("button").onclick = () => location.reload();
  }
})();
