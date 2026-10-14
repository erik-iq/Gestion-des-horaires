const app = document.querySelector("#app"),
  modal = document.querySelector("#modal");
const icons = {
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
const fmt = (d, options = { day: "2-digit", month: "short" }) =>
  new Intl.DateTimeFormat("fr-CH", options).format(new Date(d + "T12:00:00"));
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
  pending: "En attente",
  approved: "Approuvée",
  rejected: "Refusée",
};
const badge = (status) =>
  `<span class="badge ${status}"><i></i>${labels[status]}</span>`;
const brand = () =>
  `<div class="brand"><span class="brand-mark">ıı</span><div>tempo<small>Le temps, simplement.</small></div></div>`;
let state,
  page = "dashboard",
  month = "",
  reportUser = "",
  toastTimer;
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
  if (state.user.role !== "admin" && page === "users") page = "dashboard";
  if (!month) month = state.today.slice(0, 7);
  if (!reportUser) reportUser = String(state.user.id);
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
  leaves: "Vacances",
  attendance: "Présence de l’équipe",
  reports: "Rapports mensuels",
  users: "Gestion des utilisateurs",
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
function render() {
  app.innerHTML = `<div class="shell"><aside class="sidebar">${brand()}<div class="nav-label">Espace personnel</div><nav class="nav" aria-label="Navigation principale">${navItem("dashboard", "Vue d’ensemble", "grid")}${navItem("hours", "Mes horaires", "clock")}${navItem("leaves", "Vacances", "sun")}${navItem("attendance", "Présence", "people")}${navItem("reports", "Rapports mensuels", "report")}${state.user.role === "admin" ? `<div class="nav-label">Administration</div>${navItem("users", "Utilisateurs", "people")}` : ""}</nav><div class="sidebar-bottom">${person(state.user, state.user.role === "admin" ? "Administrateur" : "Collaborateur")}<button class="logout" data-action="logout">${icon("logout")}Se déconnecter</button></div></aside><main class="main"><header class="topbar"><div class="breadcrumb"><button class="mobile-menu" data-action="menu" aria-label="Ouvrir le menu">${icon("menu")}</button><span>Mon espace /</span><b>${pageTitles[page]}</b></div><div class="topbar-right"><button class="refresh-button" data-action="refresh" title="Actualiser les données" aria-label="Actualiser les données">${icon("arrow")}</button><span class="date-chip">${icon("calendar")}${fmt(state.today, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span><button class="avatar account-button" data-action="account" aria-label="Mon compte : ${esc(state.user.name)}" title="Mon compte">${esc(initials(state.user.name))}</button></div></header><div class="content">${{ dashboard: dashboard, hours: hours, leaves: leaves, attendance: attendance, reports: reports, users: users }[page]()}<footer class="footer"><span>Tempo · Le temps, simplement.</span><span>Données privées · Espace ${state.user.role === "admin" ? "administrateur" : "collaborateur"}</span></footer></div></main></div>`;
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
function dashboard() {
  const own = myEntries(),
    dates = weekDates(),
    week = own.filter((e) => dates.includes(e.date)),
    monthly = own.filter((e) => e.date.startsWith(state.today.slice(0, 7))),
    pending = state.leaves.filter(
      (l) => l.user_id === state.user.id && l.status === "pending",
    ),
    b = state.balance,
    weekTotal = week.reduce((a, e) => a + mins(e), 0),
    monthTotal = monthly.reduce((a, e) => a + mins(e), 0),
    entries = own.slice(0, 5);
  const values = dates.map(
      (d) =>
        week.filter((e) => e.date === d).reduce((a, e) => a + mins(e), 0) / 60,
    ),
    max = Math.max(10, ...values);
  return (
    heading(
      `Bonjour, ${esc(state.user.name.split(" ")[0])} <span aria-hidden="true">☀</span>`,
      "Un regard sur votre temps. Une longueur d’avance sur votre journée.",
      `<button class="btn" data-action="entry">${icon("plus")}Saisir mes heures</button>`,
      "Tableau de bord",
    ) +
    `<div class="stats">${stat("Cette semaine", duration(weekTotal), "", `${week.length} jour${week.length > 1 ? "s" : ""} renseigné${week.length > 1 ? "s" : ""}`, "clock")}${stat("Ce mois-ci", duration(monthTotal), "", fmt(state.today, { month: "long", year: "numeric" }), "calendar")}${stat("Solde de vacances", decimal(b.remaining), "jours", `${decimal(b.used)} jours pris sur ${decimal(b.allowance)}`, "sun", true)}${stat("Demandes en attente", pending.length, "", pending.length ? "En cours de validation" : "Tout est à jour", "report")}</div><div class="dashboard-grid"><section class="panel"><div class="panel-head"><div><h2>Votre semaine en un coup d’œil</h2><p>${fmt(dates[0])} — ${fmt(dates[6])}</p></div><span class="legend"><i></i>Heures travaillées</span></div><div class="chart" role="img" aria-label="${esc(dates.map((d, i) => fmt(d, { weekday: "long" }) + ": " + decimal(values[i]) + " heures").join(", "))}"><div class="chart-axis"><span>${decimal(max)}h</span><span>${decimal(max / 2)}h</span><span>0h</span></div><div class="chart-plot">${values.map((v, i) => `<div class="bar-col"><span class="bar-value">${v ? decimal(v) + "h" : ""}</span><div class="bar" style="height:${(v / max) * 85}%"></div><span class="bar-day">${fmt(dates[i], { weekday: "short" })}</span></div>`).join("")}</div></div><div class="week-note">${icon("")}<span class="week-days">Temps net, pauses déduites · Objectif quotidien : ${decimal(state.user.daily_hours)}h</span></div></section><section class="panel balance-panel"><div class="panel-head"><div><h2>Un peu de temps pour vous.</h2><p>Votre solde annuel · ${state.today.slice(0, 4)}</p></div>${icon("sun")}</div><div class="balance-body"><div class="balance-number">${decimal(b.remaining)} <span>jours disponibles</span></div><div class="progress" role="progressbar" aria-label="Vacances utilisées" aria-valuenow="${b.used}" aria-valuemin="0" aria-valuemax="${b.allowance}"><div style="width:${b.allowance ? Math.min(100, (b.used / b.allowance) * 100) : 0}%"></div></div><div class="balance-details"><span>${decimal(b.used)} jours approuvés</span><span>${decimal(b.allowance)} jours / an</span></div><button class="btn" data-action="leave">${icon("plus")}Planifier mes vacances</button><p class="helper">${pending.reduce((a, l) => a + l.days, 0)} jour(s) en attente · Décompte du lundi au vendredi.</p></div></section></div><section class="panel bottom-panel"><div class="panel-head"><div><h2>Mes dernières saisies</h2><p>Chaque journée compte. Gardez-en une trace.</p></div><button class="link-button" data-page="hours">Tout voir →</button></div>${entries.length ? entryTable(entries, false) : empty("Votre première journée commence ici.<br>Saisissez vos heures pour suivre votre activité.")}</section>`
  );
}
function entryTable(rows, actions = true) {
  return `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Arrivée</th><th>Départ</th><th>Pause</th><th>Temps net</th><th>Note</th>${actions ? "<th>Actions</th>" : ""}</tr></thead><tbody>${rows.map((e) => `<tr><td><strong>${fmt(e.date, { weekday: "short", day: "numeric", month: "short" })}</strong></td><td>${e.start}</td><td>${e.end}</td><td>${e.break_minutes} min</td><td><strong>${duration(mins(e))}</strong></td><td class="note-cell">${esc(e.note) || "—"}</td>${actions ? `<td><div class="actions"><button class="link-button" data-action="entry" data-id="${e.id}">Modifier</button><button class="btn small danger" data-action="delete-entry" data-id="${e.id}" aria-label="Supprimer la saisie du ${e.date}">${icon("trash")}</button></div></td>` : ""}</tr>`).join("")}</tbody></table></div>`;
}
function monthFilter(extra = "") {
  return `<div class="filters"><label for="month">Période</label><input id="month" type="month" value="${month}" min="2000-01" max="2100-12">${extra}</div>`;
}
function hours() {
  const rows = myEntries().filter((e) => e.date.startsWith(month)),
    total = rows.reduce((a, e) => a + mins(e), 0);
  return (
    heading(
      "Mes horaires",
      "Une journée, une saisie. Suivez vos heures en toute simplicité.",
      `<button class="btn" data-action="entry">${icon("plus")}Saisir mes heures</button>`,
    ) +
    monthFilter() +
    `<div class="stats">${stat("Temps travaillé", duration(total), "", "Pauses déduites", "clock")}${stat("Jours renseignés", rows.length, "jours", fmt(month + "-01", { month: "long", year: "numeric" }), "calendar")}${stat("Moyenne quotidienne", rows.length ? duration(Math.round(total / rows.length)) : "—", "", "Sur les jours renseignés", "report")}${stat("Pauses cumulées", duration(rows.reduce((a, e) => a + e.break_minutes, 0)), "", "Non comptées comme travail", "sun")}</div><section class="panel"><div class="panel-head"><div><h2>Journal de travail</h2><p>${fmt(month + "-01", { month: "long", year: "numeric" })}</p></div><button class="btn secondary small" data-action="export-hours">${icon("download")}Exporter</button></div>${rows.length ? entryTable(rows) : empty("Aucune heure saisie pour ce mois.")} </section><p class="helper">Les journées sont saisies avec une heure de début, une heure de fin et une pause. Une nouvelle saisie pour la même date remplace la précédente. Les horaires passant minuit doivent être répartis sur deux journées.</p>`
  );
}
function leaves() {
  const admin = state.user.role === "admin",
    rows = state.leaves,
    b = state.balance;
  return (
    heading(
      "Vacances & équilibre",
      "Planifiez vos absences. Nous nous occupons du décompte.",
      `<button class="btn" data-action="leave">${icon("plus")}Demander des vacances</button>`,
    ) +
    `<div class="stats">${stat("Mon quota annuel", decimal(b.allowance), "jours", state.today.slice(0, 4), "calendar")}${stat("Mes congés approuvés", decimal(b.used), "jours", "Déduits du solde annuel", "check")}${stat("Mon solde disponible", decimal(b.remaining), "jours", "Hors demandes en attente", "sun", true)}${stat(admin ? "Demandes à traiter" : "Mes demandes en attente", rows.filter((l) => l.status === "pending").length, "", admin ? "Pour l’ensemble de l’équipe" : "Validation administrateur", "report")}</div><div class="notice">Les congés sont comptés en jours entiers du lundi au vendredi. Les jours fériés sont inclus. Une demande couvrant deux années doit être répartie en deux demandes. Les demandes en attente réservent votre solde lors d’une nouvelle demande.</div><section class="panel"><div class="panel-head"><div><h2>${admin ? "Les demandes de l’équipe" : "Mes demandes"}</h2><p>Un suivi clair, de la demande à la validation.</p></div></div>${rows.length ? `<div class="table-wrap"><table><thead><tr>${admin ? "<th>Collaborateur</th>" : ""}<th>Période</th><th>Durée</th><th>Statut</th><th>Note</th><th>Actions</th></tr></thead><tbody>${rows.map((l) => `<tr>${admin ? `<td>${person(state.users.find((u) => u.id === l.user_id))}</td>` : ""}<td>${fmt(l.start, { day: "numeric", month: "short", year: "numeric" })} → ${fmt(l.end, { day: "numeric", month: "short", year: "numeric" })}</td><td>${l.days} jour${l.days > 1 ? "s" : ""}</td><td>${badge(l.status)}</td><td class="note-cell">${esc(l.note) || "—"}</td><td><div class="actions">${l.status === "pending" ? `${admin ? `<button class="btn small" data-action="approve" data-id="${l.id}">Approuver</button><button class="btn small danger" data-action="reject" data-id="${l.id}">Refuser</button>` : ""}${l.user_id === state.user.id ? `<button class="link-button" data-action="cancel-leave" data-id="${l.id}">Annuler</button>` : ""}` : "—"}</div></td></tr>`).join("")}</tbody></table></div>` : empty("Aucune demande de vacances pour le moment.", "sun")}</section>`
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
    `<div class="stats">${stat("Collaborateurs", rows.length, "", "Au sein de votre équipe", "people")}${stat("Heures déclarées", rows.filter((r) => r.status === "recorded").length, "", "Une saisie existe aujourd’hui", "clock")}${stat("En vacances", rows.filter((r) => r.status === "leave").length, "", "Congés approuvés aujourd’hui", "sun", true)}${stat("Non renseignés", rows.filter((r) => r.status === "unknown").length, "", "Aucune saisie ni congé approuvé", "calendar")}</div><div class="notice">Présence du ${fmt(state.today, { day: "numeric", month: "long", year: "numeric" })}. Ce tableau reflète les déclarations du jour ; il ne constitue pas un pointage en temps réel.</div><div class="attendance-grid">${rows.map((u) => `<article class="panel person-card">${person(u, "Équipe Tempo")}<div class="person-meta">${badge(u.status)}<span>${u.start ? u.start + " – " + u.end : "—"}</span></div></article>`).join("")}</div>`
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
          l.end >= start,
      )
      .forEach((l) => {
        for (
          let d = new Date((l.start > start ? l.start : start) + "T12:00:00Z");
          d <= new Date((l.end < end ? l.end : end) + "T12:00:00Z");
          d.setUTCDate(d.getUTCDate() + 1)
        )
          if (![0, 6].includes(d.getUTCDay())) leaveDays++;
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
      `<button class="btn" data-action="export-report">${icon("download")}Exporter le rapport`,
      "Rapports mensuels",
    ) +
    monthFilter(userSelect()) +
    `<div class="report-summary">${stat("Heures travaillées", duration(total), "", "Total net de la sélection", "clock")}${stat("Journées renseignées", count, "jours", "Chaque saisie compte pour une journée", "calendar")}${stat("Vacances approuvées", vacations, "jours", "Jours ouvrés de la période", "sun", true)}</div><section class="panel"><div class="panel-head"><div><h2>Synthèse · ${fmt(month + "-01", { month: "long", year: "numeric" })}</h2><p>Temps net et moyenne sur les journées renseignées.</p></div><span class="current-pill">${summary.length} collaborateur${summary.length > 1 ? "s" : ""}</span></div><div class="table-wrap"><table><thead><tr><th>Collaborateur</th><th>Jours saisis</th><th>Temps net</th><th>Pauses</th><th>Moyenne / jour</th><th>Vacances</th></tr></thead><tbody>${summary.map((r) => `<tr><td>${person(r.u)}</td><td>${r.rows.length}</td><td><strong>${duration(r.minutes)}</strong></td><td>${duration(r.pause)}</td><td>${r.rows.length ? duration(Math.round(r.minutes / r.rows.length)) : "—"}</td><td>${r.leaveDays} j</td></tr>`).join("")}</tbody></table></div></section>${summary.length === 1 ? `<section class="panel bottom-panel"><div class="panel-head"><div><h2>Détail des journées</h2><p>${esc(summary[0].u.name)}</p></div></div>${summary[0].rows.length ? entryTable(summary[0].rows, false) : empty("Aucune heure renseignée sur cette période.")}</section>` : ""}<p class="helper">L’export CSV comprend une synthèse par collaborateur et le détail des journées. Les jours sans saisie ne sont pas considérés comme des absences. Ces rapports décrivent le temps déclaré et ne constituent pas un calcul de paie.</p>`
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
    `<section class="panel"><div class="panel-head"><div><h2>Les membres de l’équipe</h2><p>${state.users.length} compte${state.users.length > 1 ? "s" : ""} · Les collaborateurs voient uniquement leurs heures et leurs demandes.</p></div></div><div class="table-wrap"><table><thead><tr><th>Collaborateur</th><th>E-mail</th><th>Rôle</th><th>Quota / an</th><th>Solde actuel</th><th>Objectif / jour</th><th>Actions</th></tr></thead><tbody>${state.users.map((u) => `<tr><td>${person(u, u.id === state.user.id ? "Vous" : "")}</td><td>${esc(u.email)}</td><td><span class="badge ${u.role === "admin" ? "approved" : ""}">${u.role === "admin" ? "Administrateur" : "Collaborateur"}</span></td><td>${decimal(u.allowance)} jours</td><td><strong>${decimal(u.vacation_balance.remaining)} jours</strong><br><small class="week-days">${decimal(u.vacation_balance.used)} approuvés · ${state.today.slice(0, 4)}</small></td><td>${decimal(u.daily_hours)}h</td><td><button class="link-button" data-action="user" data-id="${u.id}">Gérer le compte →</button></td></tr>`).join("")}</tbody></table></div></section><p class="helper">Un administrateur peut consulter les rapports de l’équipe, traiter les vacances et créer les comptes. Le quota annuel s’applique à chaque année, sans report automatique. Les mots de passe ne sont jamais affichés.</p>`
  );
}
function dialog(title, subtitle, form, submit, handler) {
  modal.innerHTML = `<div class="modal-head"><div><h2>${title}</h2><p>${subtitle}</p></div><button class="close" data-action="close" aria-label="Fermer">×</button></div><form><div class="error" role="alert"></div>${form}<div class="modal-actions"><button class="btn secondary" type="button" data-action="close">Annuler</button><button class="btn" type="submit">${submit}</button></div></form>`;
  modal.showModal();
  modal.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget,
      btn = f.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      await handler(Object.fromEntries(new FormData(f)));
      modal.close();
      await refresh();
      toast("Enregistrement effectué.");
    } catch (err) {
      f.querySelector(".error").textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}
function entryDialog(id) {
  const e = id ? myEntries().find((x) => x.id === Number(id)) : null;
  dialog(
    e ? "Modifier la journée" : "Saisir mes heures",
    "Une saisie par jour. Les pauses sont déduites du temps travaillé.",
    `<div class="form-grid"><label class="field full">Date<input type="date" name="date" required value="${e?.date || state.today}" max="${state.today}"></label><label class="field">Heure de début<input type="time" name="start" required value="${e?.start || "08:00"}"></label><label class="field">Heure de fin<input type="time" name="end" required value="${e?.end || "17:00"}"></label><label class="field full">Pause (minutes)<input type="number" name="break_minutes" min="0" max="720" step="1" required value="${e?.break_minutes ?? 60}"></label><label class="field full">Note facultative<textarea name="note" maxlength="500" placeholder="Projet, activité, précision…">${esc(e?.note || "")}</textarea></label></div>`,
    "Enregistrer",
    (b) =>
      api("/api/entries", "POST", {
        ...b,
        break_minutes: Number(b.break_minutes),
      }),
  );
}
function leaveDialog() {
  dialog(
    "Un peu de temps pour vous.",
    "Votre demande sera transmise à un administrateur.",
    `<div class="form-grid"><label class="field">Premier jour<input type="date" name="start" required min="${state.today}" value="${state.today}"></label><label class="field">Dernier jour inclus<input type="date" name="end" required min="${state.today}" value="${state.today}"></label><label class="field full">Note facultative<textarea name="note" maxlength="500" placeholder="Une précision pour votre équipe…"></textarea></label></div><p class="helper">Jours entiers, du lundi au vendredi. Les jours fériés sont inclus. Solde actuel : ${decimal(state.balance.remaining)} jours (${state.today.slice(0, 4)}).</p>`,
    "Envoyer la demande",
    (b) => api("/api/leaves", "POST", b),
  );
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
async function confirmation(title, message, run) {
  dialog(title, message, "", "Confirmer", run);
}
document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-page],[data-action]");
  if (!target) return;
  if (target.dataset.page) {
    page = target.dataset.page;
    render();
    return;
  }
  const { action, id } = target.dataset;
  try {
    switch (action) {
      case "refresh":
        await refresh();
        toast("Données actualisées.");
        break;
      case "menu":
        document.querySelector(".sidebar").classList.toggle("open");
        break;
      case "close":
        modal.close();
        break;
      case "entry":
        entryDialog(id);
        break;
      case "leave":
        leaveDialog();
        break;
      case "user":
        userDialog(id);
        break;
      case "account":
        accountDialog();
        break;
      case "logout":
        await api("/api/logout", "POST", {});
        state = null;
        month = "";
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
            ? "Approuver les vacances ?"
            : "Refuser la demande ?",
          action === "approve"
            ? "Les jours ouvrés seront déduits du solde de ce collaborateur."
            : "La demande sera marquée comme refusée.",
          () =>
            api("/api/leaves/" + id, "PATCH", {
              status: action === "approve" ? "approved" : "rejected",
            }),
        );
        break;
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
  if (event.target.id === "month") {
    const v = event.target.value;
    if (/^\d{4}-\d{2}$/.test(v) && v >= "2000-01" && v <= "2100-12") {
      month = v;
      render();
    }
  }
  if (event.target.id === "report-user") {
    reportUser = event.target.value;
    render();
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
