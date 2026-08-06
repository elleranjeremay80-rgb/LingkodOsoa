/* ===================================================
   LINGKOD Meneses - Shared App Shell Script
   Highlights the sidebar menu item that matches the
   module currently open, so every page's nav stays in
   sync without hardcoding "active" per module.

   Also enforces the demo role-based access: requires
   a logged-in session, shows who's logged in, and
   locks any element marked data-roles="..." to the
   roles listed.
   =================================================== */

/* ================= DARK MODE ================= */
// The database (user_settings.dark_mode) is the source of truth - this
// cache exists purely so the theme can be applied *synchronously*,
// before first paint, rather than flashing light mode while the real
// value loads over the network. Every page reconciles with the database
// on load (see lingkodSyncThemeFromDatabase below) and corrects the
// cache if it was ever wrong.

const LINGKOD_DARK_MODE_CACHE_KEY = "lingkod_dark_mode";

function lingkodApplyTheme(isDark){
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
    localStorage.setItem(LINGKOD_DARK_MODE_CACHE_KEY, isDark ? "1" : "0");
}

(function lingkodApplyCachedThemeFastPath(){
    if(localStorage.getItem(LINGKOD_DARK_MODE_CACHE_KEY) === "1"){
        document.documentElement.setAttribute("data-theme", "dark");
    }
})();

// No-op for demo accounts (js/auth.js's LINGKOD_ACCOUNTS) - they have no
// real Supabase session, so no user_settings row to read; whatever the
// fast-path cache already applied (or the light-mode default) stands.
async function lingkodSyncThemeFromDatabase(){
    if(typeof supabaseClient === "undefined") return;

    const { data: userData } = await supabaseClient.auth.getUser();
    if(!userData || !userData.user) return;

    const { data, error } = await supabaseClient
        .from("user_settings")
        .select("dark_mode")
        .eq("user_id", userData.user.id)
        .maybeSingle();

    if(error || !data) return;

    lingkodApplyTheme(!!data.dark_mode);
}

// Rehydrates the local session cache from a real, still-valid Supabase
// session (e.g. the browser was closed and reopened — sessionStorage is
// gone, but Supabase's own session survives in localStorage). Returns
// null if there's no real session either.
async function lingkodRehydrateFromSupabase(){
    const { data } = await supabaseClient.auth.getSession();
    if(!data.session) return null;

    const { data: profile, error } = await supabaseClient
        .from("profiles")
        .select("role, full_name, student_number")
        .eq("id", data.session.user.id)
        .single();

    if(error || !profile) return null;

    const account = lingkodBuildAccountFromProfile(profile);
    lingkodSetSession(account);
    return account;
}

// Injects the same soft blob/wave/dot background decoration the Login
// page uses as inline markup, once, as the very first element in <body> -
// shared across every page that loads this stylesheet (see ".app-bg-*"
// in common.css) instead of each page hand-coding its own copy. Purely
// visual (aria-hidden, pointer-events:none via CSS) - idempotent via its
// own id so it's safe to call more than once.
function lingkodBuildAppBackgroundDecor(){
    if(document.getElementById("lingkodBgDecor")) return;

    const decor = document.createElement("div");
    decor.id = "lingkodBgDecor";
    decor.className = "app-bg-decor";
    decor.setAttribute("aria-hidden", "true");
    decor.innerHTML =
        "<div class=\"app-bg-blob app-bg-blob-1\"></div>" +
        "<div class=\"app-bg-blob app-bg-blob-2\"></div>" +
        "<svg class=\"app-bg-wave\" viewBox=\"0 0 1600 300\" preserveAspectRatio=\"none\" xmlns=\"http://www.w3.org/2000/svg\">" +
        "<defs><linearGradient id=\"appWaveGrad\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\">" +
        "<stop offset=\"0%\" stop-color=\"#E73F1E\"/><stop offset=\"55%\" stop-color=\"#FB6C00\"/><stop offset=\"100%\" stop-color=\"#F9B637\"/>" +
        "</linearGradient></defs>" +
        "<path fill=\"url(#appWaveGrad)\" opacity=\"0.5\" d=\"M0,120 C300,40 600,200 900,120 C1200,60 1400,160 1600,110 L1600,300 L0,300 Z\"/>" +
        "<path fill=\"url(#appWaveGrad)\" opacity=\"0.7\" d=\"M0,160 C320,100 620,240 920,160 C1220,110 1420,200 1600,150 L1600,300 L0,300 Z\"/>" +
        "</svg>" +
        "<div class=\"app-bg-dots app-bg-dots-br\"></div>";

    document.body.insertBefore(decor, document.body.firstChild);
}

// Builds the universal search/notifications/messages/profile topbar once
// and inserts it as the first child of .content - shared across every
// page that loads this stylesheet (see the ".app-topbar" rules in
// common.css) instead of each page hand-coding its own copy. Idempotent
// (checked via the existing #lingkodTopbarAvatar id) so this is safe to
// call even if a page's DOMContentLoaded handler somehow runs twice.
function lingkodBuildAppTopbar(session){
    const content = document.querySelector(".content");
    if(!content || document.getElementById("lingkodTopbarAvatar")) return;

    const topbar = document.createElement("div");
    topbar.className = "app-topbar";

    const search = document.createElement("div");
    search.className = "app-topbar-search";
    search.innerHTML = "<i class=\"fa-solid fa-magnifying-glass\"></i>";
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search anything...";
    searchInput.setAttribute("aria-label", "Search");
    search.appendChild(searchInput);
    topbar.appendChild(search);

    const actions = document.createElement("div");
    actions.className = "app-topbar-actions";
    // lingkodInitNotifications() (called once the authed profile loads)
    // appends its own .topbar-icon-wrap bell button here.

    const messageLink = document.createElement("a");
    messageLink.className = "topbar-icon-btn";
    messageLink.href = "../messages/index.html";
    messageLink.setAttribute("aria-label", "Messages");
    messageLink.innerHTML = "<i class=\"fa-regular fa-envelope\"></i>";
    actions.appendChild(messageLink);

    const userLink = document.createElement("a");
    userLink.className = "app-topbar-user";
    userLink.href = "../profile/index.html";

    const avatar = document.createElement("div");
    avatar.className = "app-topbar-avatar";
    avatar.id = "lingkodTopbarAvatar";
    avatar.textContent = lingkodAvatarInitials(session.name);
    userLink.appendChild(avatar);

    const info = document.createElement("div");
    info.className = "app-topbar-user-info";
    const nameEl = document.createElement("span");
    nameEl.className = "app-topbar-user-name";
    nameEl.textContent = session.name;
    const roleEl = document.createElement("span");
    roleEl.className = "app-topbar-user-role";
    roleEl.textContent = LINGKOD_ROLE_LABELS[session.role] || session.role;
    info.appendChild(nameEl);
    info.appendChild(roleEl);
    userLink.appendChild(info);

    const chevron = document.createElement("i");
    chevron.className = "fa-solid fa-chevron-down app-topbar-chevron";
    userLink.appendChild(chevron);

    actions.appendChild(userLink);
    topbar.appendChild(actions);

    content.insertBefore(topbar, content.firstChild);
}

document.addEventListener("DOMContentLoaded", async function(){

    let session = lingkodGetSession();

    if(!session){
        session = await lingkodRehydrateFromSupabase();
    }

    if(!session){
        window.location.href = "../login/index.html";
        return;
    }

    lingkodSyncThemeFromDatabase();

    lingkodBuildAppBackgroundDecor();
    lingkodBuildAppTopbar(session);

    // The cached session object (lingkodGetSession) only ever carries
    // {studentNumber, role, name, title} - no real profile id - so the
    // notification bell (and the topbar avatar's real photo) need their
    // own lookup rather than reusing it. Skipped entirely if this somehow
    // isn't a real registered account (no demo-account fallback exists
    // for notifications).
    lingkodGetAuthedProfile().then(function(profile){
        if(!profile) return;
        lingkodInitNotifications(profile.id);
        const avatarSlot = document.getElementById("lingkodTopbarAvatar");
        if(avatarSlot){
            avatarSlot.innerHTML = "";
            avatarSlot.appendChild(lingkodBuildAvatarElement(profile, "app-topbar-avatar"));
        }
    });

    document.querySelectorAll("[data-roles]").forEach(function(el){
        const allowedRoles = el.getAttribute("data-roles").split(/\s+/);
        if(allowedRoles.includes(session.role)) return;

        // Sidebar links for features a role can't reach are removed
        // outright rather than shown as a locked placeholder.
        if(el.closest(".menu")){
            el.remove();
            return;
        }

        const note = document.createElement("p");
        note.className = "locked-note";
        note.innerHTML = "<i class=\"fa-solid fa-lock\"></i> View-only access — this action requires "
            + allowedRoles.join(" or ") + " permissions.";
        el.replaceWith(note);
    });

    document.querySelectorAll("[data-role-view]").forEach(function(el){
        const allowedRoles = el.getAttribute("data-role-view").split(/\s+/);
        if(!allowedRoles.includes(session.role)){
            el.style.display = "none";
        }
    });

    document.querySelectorAll(".menu a[href$=\"login/index.html\"]").forEach(function(link){
        link.addEventListener("click", function(e){
            e.preventDefault();
            lingkodConfirmLogout(link.getAttribute("href"));
        });
    });

    initSidebarToggle();

    const segments = location.pathname.split("/").filter(Boolean);

    if(segments[segments.length - 1] === "index.html"){
        segments.pop();
    }

    const currentModule = segments[segments.length - 1];

    document.querySelectorAll(".menu li").forEach(function(item){

        const link = item.querySelector("a");
        if(!link) return;

        const linkSegments = link.getAttribute("href")
            .split("/")
            .filter(function(part){
                return part && part !== ".." && part !== "index.html";
            });

        const linkModule = linkSegments[linkSegments.length - 1];

        item.classList.toggle("active", linkModule === currentModule);

    });

    initServicesMenu();

});

// Services submenu (Requests / Feedback / Digital Repository / Ongoing
// Projects / Upcoming Activities / Implemented Activities / Income-
// Generating Projects): expand/collapse, remembered across page loads via
// localStorage, and always shown expanded - regardless of the remembered
// state - whenever the page actually open lives inside it, with both the
// parent and the specific active child highlighted. Runs after the
// .active-highlighting loop above, which already marks the correct child
// <li> (a plain per-link check, same as every other sidebar item).
const LINGKOD_SERVICES_EXPANDED_KEY = "lingkod_services_expanded";

function initServicesMenu(){
    const parent = document.getElementById("servicesMenuParent");
    const toggleBtn = document.getElementById("servicesToggleBtn");
    const submenu = document.getElementById("servicesSubmenu");
    if(!parent || !toggleBtn || !submenu) return;

    const hasActiveChild = !!submenu.querySelector("li.active");
    if(hasActiveChild) parent.classList.add("active");

    function setExpanded(expanded){
        parent.classList.toggle("expanded", expanded);
        toggleBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
        submenu.style.maxHeight = expanded ? submenu.scrollHeight + "px" : "0px";
    }

    const remembered = localStorage.getItem(LINGKOD_SERVICES_EXPANDED_KEY) === "1";
    setExpanded(hasActiveChild || remembered);

    toggleBtn.addEventListener("click", function(){
        const nowExpanded = !parent.classList.contains("expanded");
        setExpanded(nowExpanded);
        localStorage.setItem(LINGKOD_SERVICES_EXPANDED_KEY, nowExpanded ? "1" : "0");
    });
}

/* ================= TABLE RENDERING HELPERS ================= */
// Shared by every page that renders a Supabase-backed table (requests,
// feedback, submission, repository) so each one isn't reimplementing
// identical date formatting / cell / empty-row markup - and, since some
// of these values (request_type, subject, file names...) are free text
// that other users' rows can contain, built with textContent/DOM nodes
// rather than string-concatenated innerHTML, so nothing in a row can be
// interpreted as markup.

function lingkodFormatDate(isoString){
    return new Date(isoString).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// Shared by Requests and Feedback's own formatRequestDateTime/
// formatFeedbackDateTime (identical copies) - a date/time pair for
// their stacked "date on one line, time in a muted second line" cells.
function lingkodFormatDateTime(isoString){
    const d = new Date(isoString);
    return {
        date: d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
        time: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
    };
}

// The actual DOM-building half of that same cell - takes the wrapper's
// class name since Requests and Feedback each style it under their own
// page-scoped class (.request-datetime / .feedback-datetime), even
// though the two rules are identical.
function lingkodBuildDateTimeCell(isoString, wrapClassName){
    const td = document.createElement("td");
    const wrap = document.createElement("div");
    wrap.className = wrapClassName;

    const parts = lingkodFormatDateTime(isoString);

    const dateSpan = document.createElement("span");
    dateSpan.textContent = parts.date;
    wrap.appendChild(dateSpan);

    const timeSpan = document.createElement("span");
    timeSpan.className = "time";
    timeSpan.textContent = parts.time;
    wrap.appendChild(timeSpan);

    td.appendChild(wrap);
    return td;
}

// Calendar-aligned "Today / This Week / This Month" date filter - shared
// by Requests and Feedback's management tables (both had an identical
// copy of this boundary calculation + comparison). Week starts on Sunday
// (Date.getDay() === 0). NOTE: Announcements uses a different, rolling-
// window version of "This Week"/"This Month" (last 7 days / last 1
// month from now, not calendar-aligned) - the two aren't interchangeable;
// see announcements/script.js's own getFilteredSortedAnnouncements().
function lingkodMatchesCalendarDateFilter(isoString, dateFilter){
    if(dateFilter === "all") return true;

    const created = new Date(isoString);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if(dateFilter === "today") return created >= startOfToday;

    if(dateFilter === "week"){
        const startOfWeek = new Date(startOfToday);
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
        return created >= startOfWeek;
    }

    if(dateFilter === "month"){
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        return created >= startOfMonth;
    }

    return true;
}

function lingkodCreateCell(text){
    const td = document.createElement("td");
    td.textContent = text;
    return td;
}

function lingkodCreateStatusCell(statusValue, labels){
    const td = document.createElement("td");
    const span = document.createElement("span");
    span.className = "status " + statusValue;
    span.textContent = (labels && labels[statusValue]) || statusValue;
    td.appendChild(span);
    return td;
}

// The Submission & Tracking page and the Dashboard's own submissions
// widgets both need to turn a submissions.category enum value into its
// display label - identical six-entry map, previously kept as two
// separate copies (submission/script.js's SUBMISSION_CATEGORY_LABELS and
// dashboard/script.js's DASHBOARD_SUBMISSION_CATEGORY_LABELS) that would
// silently drift apart if only one were ever updated (e.g. a new
// category added to the DB enum and only wired into one of the two).
const LINGKOD_SUBMISSION_CATEGORY_LABELS = {
    renewal: "Renewal",
    financial_report: "Financial Report",
    policy: "Policy",
    memorandum: "Memorandum",
    proposal: "Proposal",
    other: "Other"
};

function lingkodCreateEmptyRow(message, colspan){
    const tr = document.createElement("tr");
    tr.className = "empty-row";
    const td = document.createElement("td");
    td.colSpan = colspan;
    td.textContent = message;
    tr.appendChild(td);
    return tr;
}

/* ================= TOAST NOTIFICATIONS ================= */
// Shared across every module - creates the container on first use so
// pages that never show a toast pay no cost.

function lingkodToast(message, type){
    let container = document.getElementById("lingkodToastContainer");
    if(!container){
        container = document.createElement("div");
        container.id = "lingkodToastContainer";
        container.className = "toast-container";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = "toast " + (type || "success");

    const icon = document.createElement("i");
    icon.className = type === "error" ? "fa-solid fa-circle-exclamation" : "fa-solid fa-circle-check";
    toast.appendChild(icon);

    toast.appendChild(document.createTextNode(message));
    container.appendChild(toast);

    setTimeout(function(){
        toast.classList.add("leaving");
        setTimeout(function(){ toast.remove(); }, 200);
    }, 4000);
}

/* ================= BUTTON LOADING STATE ================= */
// Disables a button and swaps its label for a spinner + loadingText while
// isLoading is true, restoring the original label when it's set back to
// false. Used to prevent duplicate clicks/submissions on async actions.

function lingkodSetButtonLoading(button, isLoading, loadingText){
    if(!button) return;

    if(isLoading){
        if(button.dataset.originalLabel === undefined){
            button.dataset.originalLabel = button.innerHTML;
        }
        button.disabled = true;
        button.innerHTML = "<span class=\"btn-spinner\"></span>" + (loadingText || "Please wait...");
    } else {
        button.disabled = false;
        if(button.dataset.originalLabel !== undefined){
            button.innerHTML = button.dataset.originalLabel;
            delete button.dataset.originalLabel;
        }
    }
}

/* ================= MODAL ================= */
// Shared across every module (calendar event details today, anything else
// later) - builds the overlay once on first use, then just swaps its
// title/body content on every subsequent open.

// Whatever had focus right before a modal opened (e.g. the button that
// triggered it) - restored on close so keyboard/screen-reader users land
// back where they were instead of at the top of <body>.
let lingkodModalReturnFocusTo = null;

// Tracks the pending "actually hide" timeout from a close currently
// mid-fade-out (see lingkodCloseModal) - lingkodOpenModal cancels it if a
// new modal opens before it fires, otherwise that stale timeout would
// close the *new* modal out from under the user a moment after it opened.
let lingkodModalCloseTimeout = null;

function lingkodGetModalFocusable(container){
    return container.querySelectorAll('a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])');
}

function lingkodCloseModal(){
    const overlay = document.getElementById("lingkodModalOverlay");
    if(!overlay || !overlay.classList.contains("open") || overlay.classList.contains("closing")) return;

    // "closing" plays a reverse fade/scale (see the .modal-overlay.closing
    // rule in common.css) for the same duration as this timeout, then
    // "open" actually comes off - so the whole overlay disappears smoothly
    // instead of the backdrop+modal just vanishing instantly.
    overlay.classList.add("closing");
    lingkodModalCloseTimeout = window.setTimeout(function(){
        overlay.classList.remove("open");
        overlay.classList.remove("closing");
        lingkodModalCloseTimeout = null;
    }, 180);

    document.body.style.overflow = "";

    if(lingkodModalReturnFocusTo && typeof lingkodModalReturnFocusTo.focus === "function"){
        lingkodModalReturnFocusTo.focus();
    }
    lingkodModalReturnFocusTo = null;
}

function lingkodOpenModal(titleText, contentNode, extraModalClass){
    let overlay = document.getElementById("lingkodModalOverlay");

    if(!overlay){
        overlay = document.createElement("div");
        overlay.id = "lingkodModalOverlay";
        overlay.className = "modal-overlay";

        const modal = document.createElement("div");
        modal.id = "lingkodModal";
        modal.className = "modal";
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        modal.setAttribute("aria-labelledby", "lingkodModalTitle");

        const header = document.createElement("div");
        header.className = "modal-header";

        const title = document.createElement("h3");
        title.id = "lingkodModalTitle";
        header.appendChild(title);

        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.className = "modal-close";
        closeBtn.setAttribute("aria-label", "Close");
        closeBtn.innerHTML = "<i class=\"fa-solid fa-xmark\"></i>";
        closeBtn.addEventListener("click", lingkodCloseModal);
        header.appendChild(closeBtn);

        const body = document.createElement("div");
        body.className = "modal-body";
        body.id = "lingkodModalBody";

        modal.appendChild(header);
        modal.appendChild(body);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        overlay.addEventListener("click", function(e){
            if(e.target === overlay) lingkodCloseModal();
        });

        // Escape closes; Tab/Shift+Tab wraps focus inside the modal so it
        // can't leak to the page underneath while open (basic focus trap).
        document.addEventListener("keydown", function(e){
            if(!overlay.classList.contains("open")) return;

            if(e.key === "Escape"){
                lingkodCloseModal();
                return;
            }

            if(e.key === "Tab"){
                const focusable = lingkodGetModalFocusable(modal);
                if(focusable.length === 0) return;

                const first = focusable[0];
                const last = focusable[focusable.length - 1];

                if(e.shiftKey && document.activeElement === first){
                    e.preventDefault();
                    last.focus();
                } else if(!e.shiftKey && document.activeElement === last){
                    e.preventDefault();
                    first.focus();
                }
            }
        });
    }

    document.getElementById("lingkodModalTitle").textContent = titleText;

    // Reset to the base class every call - a previous call's extraModalClass
    // (e.g. "modal-wide") must not leak into a later, plain modal.
    document.getElementById("lingkodModal").className = "modal" + (extraModalClass ? " " + extraModalClass : "");

    const body = document.getElementById("lingkodModalBody");
    body.innerHTML = "";
    body.appendChild(contentNode);

    // Cancel a fade-out left running from a previous close - otherwise it
    // would fire mid-way through this new open and rip the modal being
    // opened right back out from under the user.
    if(lingkodModalCloseTimeout){
        clearTimeout(lingkodModalCloseTimeout);
        lingkodModalCloseTimeout = null;
    }
    overlay.classList.remove("closing");

    lingkodModalReturnFocusTo = document.activeElement;
    overlay.classList.add("open");
    document.body.style.overflow = "hidden";

    // Deferred a frame so the modal's own contentNode is actually in the
    // DOM (and thus focusable) by the time this runs.
    requestAnimationFrame(function(){
        const focusable = lingkodGetModalFocusable(body);
        if(focusable.length > 0) focusable[0].focus();
        else document.getElementById("lingkodModal").querySelector(".modal-close").focus();
    });
}

/* ================= CARD OPTIONS MENU (three-dot) ================= */
// Shared by every activity/project grid card (Ongoing Projects, Upcoming
// Activities, Implemented Activities, Income-Generating Projects) that
// needs a per-card Edit/Delete menu. Same fixed-position dropdown pattern
// as Messages' own per-conversation context menu (messages/script.js),
// just generalized to take a plain [{label, icon, onClick, destructive}]
// list instead of being wired to conversation-specific actions.

let lingkodOpenCardMenuAnchor = null;

function lingkodCloseCardMenu(){
    const existing = document.getElementById("lingkodCardContextMenu");
    if(existing) existing.remove();
    if(lingkodOpenCardMenuAnchor){
        lingkodOpenCardMenuAnchor.classList.remove("active");
        lingkodOpenCardMenuAnchor = null;
    }
    document.removeEventListener("click", lingkodHandleCardMenuDocClick, true);
    document.removeEventListener("keydown", lingkodHandleCardMenuDocKey, true);
}

function lingkodHandleCardMenuDocClick(e){
    const menu = document.getElementById("lingkodCardContextMenu");
    if(menu && !menu.contains(e.target) && e.target !== lingkodOpenCardMenuAnchor && !(lingkodOpenCardMenuAnchor && lingkodOpenCardMenuAnchor.contains(e.target))){
        lingkodCloseCardMenu();
    }
}

function lingkodHandleCardMenuDocKey(e){
    if(e.key === "Escape") lingkodCloseCardMenu();
}

function lingkodOpenCardMenu(anchorEl, items){
    const alreadyOpenForThis = lingkodOpenCardMenuAnchor === anchorEl;
    lingkodCloseCardMenu();
    if(alreadyOpenForThis) return;

    const menu = document.createElement("div");
    menu.id = "lingkodCardContextMenu";
    menu.className = "context-menu";

    items.forEach(function(item){
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "context-menu-item" + (item.destructive ? " destructive" : "");
        btn.innerHTML = "<i class=\"fa-solid " + item.icon + "\"></i> " + item.label;
        btn.addEventListener("click", function(){
            lingkodCloseCardMenu();
            item.onClick();
        });
        menu.appendChild(btn);
    });

    document.body.appendChild(menu);

    const anchorRect = anchorEl.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    let left = anchorRect.right - menuRect.width;
    if(left < 8) left = 8;
    left = Math.min(left, window.innerWidth - menuRect.width - 8);
    let top = anchorRect.bottom + 6;
    if(top + menuRect.height > window.innerHeight - 8){
        top = anchorRect.top - menuRect.height - 6;
    }
    menu.style.left = left + "px";
    menu.style.top = Math.max(8, top) + "px";

    requestAnimationFrame(function(){ menu.classList.add("open"); });

    anchorEl.classList.add("active");
    lingkodOpenCardMenuAnchor = anchorEl;

    document.addEventListener("click", lingkodHandleCardMenuDocClick, true);
    document.addEventListener("keydown", lingkodHandleCardMenuDocKey, true);
}

// Builds the three-dot trigger button itself - callers just append the
// returned button to their card (it's absolutely positioned via the
// shared .card-menu-btn rule, so it drops into the card's top-right
// corner regardless of what else is in the card).
function lingkodBuildCardMenuButton(items){
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "card-menu-btn";
    btn.setAttribute("aria-label", "Activity options");
    btn.innerHTML = "<i class=\"fa-solid fa-ellipsis\"></i>";
    btn.addEventListener("click", function(e){
        e.stopPropagation();
        lingkodOpenCardMenu(btn, items);
    });
    return btn;
}

/* ================= CONFIRMATION MODAL ================= */
// Reuses the shared modal overlay (lingkodOpenModal above) rather than
// the browser's native confirm() - lets the confirm button show its own
// loading state and keeps the dialog open with an error toast if the
// action actually fails server-side, instead of the confirm() dialog
// having already closed before anything async even started.
//
// lingkodConfirmAction is the generic form (icon/button color/labels all
// opt-in, defaulting to a neutral look) - lingkodConfirmDelete below is
// just this with destructive defaults, kept as its own name since that's
// what every existing caller (Ongoing Projects/Upcoming Activities/
// Implemented Activities/Income-Generating Projects/Directory/Logout)
// already calls.

function lingkodConfirmAction(options){
    const wrap = document.createElement("div");
    wrap.className = "confirm-modal";

    const icon = document.createElement("div");
    icon.className = "confirm-modal-icon" + (options.destructive === false ? " confirm-modal-icon-neutral" : "");
    icon.innerHTML = "<i class=\"fa-solid " + (options.icon || "fa-trash") + "\"></i>";
    wrap.appendChild(icon);

    const message = document.createElement("p");
    message.className = "confirm-modal-message";
    message.textContent = options.message;
    wrap.appendChild(message);

    const actions = document.createElement("div");
    actions.className = "confirm-modal-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn-secondary";
    cancelBtn.textContent = options.cancelLabel || "Cancel";
    cancelBtn.addEventListener("click", lingkodCloseModal);

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = options.destructive === false ? "btn-primary-action" : "btn-danger";
    confirmBtn.textContent = options.confirmLabel || "Delete";
    confirmBtn.addEventListener("click", async function(){
        lingkodSetButtonLoading(confirmBtn, true, options.loadingLabel || "Please wait...");
        cancelBtn.disabled = true;

        try {
            await options.onConfirm();
            lingkodCloseModal();
        } catch(err){
            lingkodSetButtonLoading(confirmBtn, false);
            cancelBtn.disabled = false;
        }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    wrap.appendChild(actions);

    lingkodOpenModal(options.title || "Confirm", wrap, "modal-confirm");
}

function lingkodConfirmDelete(options){
    return lingkodConfirmAction(Object.assign({
        icon: "fa-trash",
        confirmLabel: "Delete",
        loadingLabel: "Deleting...",
        destructive: true,
        title: "Delete Activity?"
    }, options));
}

/* ================= LOGOUT CONFIRMATION MODAL ================= */
// Wired up to every sidebar's Logout link below - reuses the same shared
// modal/confirm-modal styling as lingkodConfirmDelete above. Reopening
// (e.g. the Logout link clicked again while the modal is already open)
// just resets the same singleton modal's content rather than stacking a
// second one, since lingkodOpenModal only ever has one overlay.

function lingkodConfirmLogout(redirectHref){
    const wrap = document.createElement("div");
    wrap.className = "confirm-modal";

    const icon = document.createElement("div");
    icon.className = "confirm-modal-icon";
    icon.innerHTML = "<i class=\"fa-solid fa-right-from-bracket\"></i>";
    wrap.appendChild(icon);

    const message = document.createElement("p");
    message.className = "confirm-modal-message";
    message.textContent = "Are you sure you want to log out of your account?";
    wrap.appendChild(message);

    const actions = document.createElement("div");
    actions.className = "confirm-modal-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn-secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", lingkodCloseModal);

    const logoutBtn = document.createElement("button");
    logoutBtn.type = "button";
    logoutBtn.className = "btn-danger";
    logoutBtn.textContent = "Logout";
    logoutBtn.addEventListener("click", async function(){
        lingkodSetButtonLoading(logoutBtn, true, "Logging out...");
        cancelBtn.disabled = true;

        // finally, not just after a successful await - a dropped network
        // request signing out of Supabase shouldn't strand the user on a
        // stuck spinner instead of actually reaching the login page.
        try {
            await lingkodSignOut();
        } finally {
            window.location.href = redirectHref;
        }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(logoutBtn);
    wrap.appendChild(actions);

    lingkodOpenModal("Confirm Logout", wrap, "modal-confirm");
}

/* ================= ORGANIZATION MANAGEMENT PERMISSION ================= */
// Shared by Directory (organization CRUD, officer/member management) and
// List of Members (Organization Information, logo upload) - both need
// the exact same "can this viewer manage this organization's records"
// rule: osoa_eb can manage any organization, org_president only their
// own. Compares by organization_id (a stable uuid), never by name text -
// List of Members' own canManageOrgLogo() used to compare org.name
// against viewerProfile.organization directly, which is exactly the
// case/whitespace-drift bug class this app has already had to fix
// elsewhere (see 20260722070000_org_logo_upload_rls_fix.sql) - two
// organizations differing only in casing would have let a president
// manage the wrong one, or been unfairly blocked from their own.

function lingkodCanManageOrganization(viewerProfile, orgId){
    if(!viewerProfile) return false;
    if(viewerProfile.role === "osoa_eb") return true;
    return viewerProfile.role === "org_president"
        && !!viewerProfile.organization_id
        && viewerProfile.organization_id === orgId;
}

// A different (and NOT interchangeable) rule for the four activity/project
// grids (Ongoing Projects, Upcoming Activities, Implemented Activities,
// Income-Generating Projects) - projects_activities.organization is plain
// text, not a organization_id foreign key, and the write RLS policy
// (owns_org()) for that table compares by that same text name. So unlike
// lingkodCanManageOrganization above, comparing by name here isn't a bug
// to fix - it's what the server itself actually enforces. This was
// duplicated identically across all four page scripts as their own local
// canManageRow(), which is the only part worth centralizing.
function lingkodCanManageOrgNamedRow(viewerProfile, rowOrganizationName){
    if(!viewerProfile) return false;
    if(viewerProfile.role === "osoa_eb") return true;
    return viewerProfile.role === "org_president"
        && !!viewerProfile.organization
        && viewerProfile.organization === rowOrganizationName;
}

/* ================= ANNOUNCEMENT CARD ================= */
// Single reusable card builder for full announcement details - used by
// the Announcements page, the dashboard's "Latest Announcements" widget,
// and the student dashboard's announcement feed, so all three render
// identically instead of three hand-rolled markups drifting apart.

const LINGKOD_ANNOUNCEMENT_VISIBILITY_LABELS = {
    public: "Public",
    organization: "Organization",
    department: "Department"
};

function lingkodBuildAnnouncementDetailLine(iconClass, label, value){
    const span = document.createElement("span");
    const icon = document.createElement("i");
    icon.className = iconClass;
    span.appendChild(icon);
    const strong = document.createElement("strong");
    strong.textContent = label + ": ";
    span.appendChild(strong);
    span.appendChild(document.createTextNode(value || "Not specified"));
    return span;
}

// An OSOA EB viewer can manage (edit/delete) any row. An Org President
// viewer can only manage rows they personally created (created_by ===
// their own auth.uid()). Everyone else (students, demo accounts with no
// real Supabase session) can't manage anything.
function lingkodCanManageAnnouncement(row, viewerSession, viewerProfileId){
    if(!viewerSession) return false;
    if(viewerSession.role === "admin") return true;
    if(viewerSession.role === "staff") return !!viewerProfileId && row.created_by === viewerProfileId;
    return false;
}

// announcements.created_by / submissions.submitted_by / submissions.reviewer_id
// are all bare uuids (no FK to profiles), so PostgREST can't auto-embed
// display info in one query - fetched separately and joined client-side by
// every page that needs a name/role/organization for a user id
// (announcement cards, dashboard widgets, calendar, the submissions review
// queue).
async function lingkodFetchProfilesById(userIds){
    const uniqueIds = [...new Set(userIds.filter(Boolean))];
    if(uniqueIds.length === 0) return {};

    const { data, error } = await supabaseClient
        .from("profiles")
        .select("id, full_name, role, organization, avatar_url")
        .in("id", uniqueIds);

    if(error){
        console.error("[profiles] batch lookup failed:", error);
        return {};
    }

    const byId = {};
    data.forEach(function(profile){ byId[profile.id] = profile; });
    return byId;
}

// options: { posterInfo: {id: {full_name, role}}, canManage(row) -> bool,
// onEdit(row), onDelete(row, buttonEl) }. Edit/Delete are only rendered
// when canManage(row) is truthy - callers that never allow management
// (e.g. the student dashboard feed) can simply omit canManage/onEdit/onDelete.
function lingkodBuildAnnouncementCard(row, options){
    options = options || {};

    const card = document.createElement("div");
    card.className = "announcement-card";
    card.dataset.id = row.id;

    const header = document.createElement("div");
    header.className = "card-header";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = LINGKOD_ANNOUNCEMENT_VISIBILITY_LABELS[row.visibility] || row.visibility;
    header.appendChild(badge);

    const h2 = document.createElement("h2");
    h2.textContent = row.title;

    const eventWhen = row.event_date
        ? new Date(row.event_date + "T00:00:00").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
        : null;

    const details = document.createElement("div");
    details.className = "announcement-details";
    details.appendChild(lingkodBuildAnnouncementDetailLine("fa-solid fa-calendar-day", "When", eventWhen));
    details.appendChild(lingkodBuildAnnouncementDetailLine("fa-solid fa-location-dot", "Where", row.event_location));
    details.appendChild(lingkodBuildAnnouncementDetailLine("fa-solid fa-users", "Who", row.event_who));

    const p = document.createElement("p");
    p.textContent = row.content;

    const info = document.createElement("div");
    info.className = "info";

    const dateSpan = document.createElement("span");
    const dateIcon = document.createElement("i");
    dateIcon.className = "fa-solid fa-calendar";
    dateSpan.appendChild(dateIcon);
    dateSpan.appendChild(document.createTextNode(" Posted " + lingkodFormatDate(row.created_at)));

    const poster = options.posterInfo && options.posterInfo[row.created_by];
    const posterSpan = document.createElement("span");
    const posterIcon = document.createElement("i");
    posterIcon.className = "fa-solid fa-user";
    posterSpan.appendChild(posterIcon);
    posterSpan.appendChild(document.createTextNode(" " + (poster ? poster.full_name : "OSOA")));

    info.appendChild(dateSpan);
    info.appendChild(posterSpan);

    card.appendChild(header);
    card.appendChild(h2);
    card.appendChild(details);
    card.appendChild(p);
    card.appendChild(info);

    if(options.canManage && options.canManage(row)){
        const actions = document.createElement("div");
        actions.className = "card-actions";

        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "edit-btn";
        editBtn.innerHTML = "<i class=\"fa-solid fa-pen\"></i> Edit";
        editBtn.addEventListener("click", function(){
            if(options.onEdit) options.onEdit(row);
        });

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "delete-btn";
        delBtn.innerHTML = "<i class=\"fa-solid fa-trash\"></i> Delete";
        delBtn.addEventListener("click", function(){
            if(options.onDelete) options.onDelete(row, delBtn);
        });

        actions.appendChild(editBtn);
        actions.appendChild(delBtn);
        card.appendChild(actions);
    }

    return card;
}

function lingkodRenderAnnouncementEmptyState(container, message){
    container.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = message;
    container.appendChild(empty);
}

async function lingkodDeleteAnnouncementRow(id, triggerButton){
    if(!confirm("Delete this announcement? This can't be undone.")) return false;

    lingkodSetButtonLoading(triggerButton, true, "Deleting...");
    const { error } = await supabaseClient.from("announcements").delete().eq("id", id);
    lingkodSetButtonLoading(triggerButton, false);

    if(error){
        console.error("[announcements] delete failed:", error);
        lingkodToast("Failed to delete announcement: " + error.message, "error");
        return false;
    }

    lingkodToast("Announcement Deleted Successfully", "success");
    return true;
}

/* ================= PROFILE VIEW ROW ================= */
// A read-only "label on the left, value on the right" row for viewing
// (not editing) a profile's details - used by Messages' View Profile
// modal, Directory's officer/member profile modal, Registered Users'
// View Profile modal, and Reports' reported-user profile modal. All
// four previously kept an identical copy of this same 12-line function
// under a different local name.

function lingkodBuildProfileViewRow(label, value){
    const row = document.createElement("div");
    row.className = "profile-view-row";
    const dt = document.createElement("span");
    dt.className = "profile-view-label";
    dt.textContent = label;
    const dd = document.createElement("span");
    dd.className = "profile-view-value";
    dd.textContent = value || "Not set";
    row.appendChild(dt);
    row.appendChild(dd);
    return row;
}

/* ================= FORM FIELD BUILDER ================= */
// Shared by every page that builds a form dynamically inside a modal
// (Profile's Edit Profile / Change Password, Settings' 2FA enrollment) -
// a labeled input/select wrapper with an optional error slot, matching
// the .input-group/.field-error markup those pages' CSS already styles.

function lingkodBuildFormField(labelText, inputEl, errorId){
    const wrapper = document.createElement("div");
    wrapper.className = "input-group";

    const label = document.createElement("label");
    label.textContent = labelText;
    wrapper.appendChild(label);
    wrapper.appendChild(inputEl);

    if(errorId){
        const errorEl = document.createElement("small");
        errorEl.className = "field-error";
        errorEl.id = errorId;
        wrapper.appendChild(errorEl);
    }

    return wrapper;
}

/* ================= PAGINATION ================= */
// Shared Prev/[page numbers]/Next control, used by every page that
// paginates a client-side-filtered list (Announcements, the submissions
// review queue). onPageChange(page) is called with the requested page
// number - the caller owns "what page am I on" state and re-renders.

function lingkodRenderPagination(container, currentPage, totalPages, onPageChange){
    container.innerHTML = "";
    if(totalPages <= 1) return;

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.textContent = "Prev";
    prevBtn.disabled = currentPage === 1;
    prevBtn.addEventListener("click", function(){ onPageChange(currentPage - 1); });
    container.appendChild(prevBtn);

    for(let page = 1; page <= totalPages; page++){
        const pageBtn = document.createElement("button");
        pageBtn.type = "button";
        pageBtn.textContent = String(page);
        if(page === currentPage) pageBtn.classList.add("active");
        pageBtn.addEventListener("click", function(){ onPageChange(page); });
        container.appendChild(pageBtn);
    }

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.textContent = "Next";
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.addEventListener("click", function(){ onPageChange(currentPage + 1); });
    container.appendChild(nextBtn);
}

/* ================= FILE PREVIEW / DOWNLOAD HELPERS ================= */
// Shared by every page that shows an uploaded file (both Submission &
// Tracking tables, the dashboard's approved-submissions widgets, the
// Profile page's submission feed, the Digital Repository) - one preview/
// download implementation instead of one per page. Two shapes of row are
// supported: `file_path` (a private Storage object - submissions -
// signed on demand, since a stored URL would go stale) and a plain
// `file_url` (an already-public Storage URL - the repository's
// "public-files" bucket - used as-is, no signing needed).

const LINGKOD_SUBMISSION_BUCKET = "submission-documents";

function lingkodGuessFilePreviewKind(row){
    const mime = (row.file_type || "").toLowerCase();
    const name = (row.file_name || "").toLowerCase();

    if(mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
    if(mime.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/.test(name)) return "image";
    if(mime.startsWith("video/") || /\.(mp4|mov|avi)$/.test(name)) return "video";
    if(mime === "text/plain" || name.endsWith(".txt")) return "text";
    return "unsupported";
}

function lingkodFileIconClass(row){
    const kind = lingkodGuessFilePreviewKind(row);
    if(kind === "image") return "fa-solid fa-file-image";
    if(kind === "pdf") return "fa-solid fa-file-pdf";
    if(kind === "video") return "fa-solid fa-file-video";
    if(kind === "text") return "fa-solid fa-file-lines";
    const name = (row.file_name || "").toLowerCase();
    if(name.endsWith(".docx") || name.endsWith(".doc")) return "fa-solid fa-file-word";
    if(name.endsWith(".xlsx") || name.endsWith(".xls")) return "fa-solid fa-file-excel";
    if(name.endsWith(".pptx") || name.endsWith(".ppt")) return "fa-solid fa-file-powerpoint";
    if(name.endsWith(".zip") || name.endsWith(".rar")) return "fa-solid fa-file-zipper";
    return "fa-solid fa-file";
}

function lingkodFormatFileSize(bytes){
    if(bytes === null || bytes === undefined) return "";
    if(bytes < 1024) return bytes + " B";
    if(bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// Signed URLs are short-lived but cheap to reuse within their own window -
// this avoids re-requesting one from Storage every time the same row's
// file is viewed twice in a row (e.g. Preview then Download).
const lingkodSignedUrlCache = new Map();

// forDownload=true forces Content-Disposition: attachment + a short
// expiry (used immediately); forDownload=false (preview) uses a longer
// expiry so an open modal doesn't go stale mid-read.
//
// Rows with a plain `file_url` and no `file_path` (e.g. the Digital
// Repository's public "public-files" bucket, via getPublicUrl()) need no
// signing at all - the URL already works for anyone who has it, so it's
// returned as-is.
async function lingkodGetSignedFileUrl(row, forDownload){
    if(!row.file_path) return row.file_url || null;

    const cacheKey = row.file_path + "|" + (forDownload ? "download" : "preview");
    const cached = lingkodSignedUrlCache.get(cacheKey);
    if(cached && cached.expiresAt > Date.now()) return cached.url;

    const expiresIn = forDownload ? 60 : 3600;
    const { data, error } = await supabaseClient.storage
        .from(row.storage_bucket || LINGKOD_SUBMISSION_BUCKET)
        .createSignedUrl(row.file_path, expiresIn, forDownload ? { download: row.file_name || true } : undefined);

    if(error){
        console.error("[submission] signed URL generation failed:", error);
        return null;
    }

    // Cached slightly short of the real expiry so a reused URL is never
    // handed out right as it's about to stop working.
    lingkodSignedUrlCache.set(cacheKey, { url: data.signedUrl, expiresAt: Date.now() + (expiresIn - 10) * 1000 });
    return data.signedUrl;
}

// Uploads with real progress + real mid-transfer cancel - neither of which
// supabase-js's own storage .upload() exposes (it's fetch-based under the
// hood, with no upload-progress event and no reliable abort). Hits
// Storage's REST endpoint directly instead via XMLHttpRequest, which
// supports both natively. Returns { promise, cancel } rather than just a
// promise so a caller (the Messages composer's attachment queue) can
// abort a specific in-flight upload.
function lingkodUploadFileWithProgress(bucket, path, file, onProgress){
    const xhr = new XMLHttpRequest();

    const promise = new Promise(async function(resolve, reject){
        const { data: sessionData } = await supabaseClient.auth.getSession();
        const accessToken = sessionData && sessionData.session ? sessionData.session.access_token : null;
        if(!accessToken){
            reject(new Error("You must be signed in to upload files."));
            return;
        }

        xhr.open("POST", SUPABASE_URL + "/storage/v1/object/" + bucket + "/" + path, true);
        xhr.setRequestHeader("Authorization", "Bearer " + accessToken);
        xhr.setRequestHeader("apikey", SUPABASE_ANON_KEY);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.setRequestHeader("x-upsert", "false");

        xhr.upload.onprogress = function(e){
            if(onProgress && e.lengthComputable){
                onProgress(Math.round((e.loaded / e.total) * 100));
            }
        };

        xhr.onload = function(){
            if(xhr.status >= 200 && xhr.status < 300){
                resolve();
                return;
            }
            let message = "Upload failed (status " + xhr.status + ").";
            try {
                const parsed = JSON.parse(xhr.responseText);
                if(parsed && parsed.message) message = parsed.message;
            } catch(parseErr){ /* non-JSON error body - keep the generic message */ }
            reject(new Error(message));
        };

        xhr.onerror = function(){ reject(new Error("Upload failed - check your connection.")); };
        xhr.onabort = function(){ reject(new Error("Upload cancelled.")); };

        xhr.send(file);
    });

    return { promise: promise, cancel: function(){ xhr.abort(); } };
}

async function lingkodDownloadFile(row, triggerButton, loadingText){
    lingkodSetButtonLoading(triggerButton, true, loadingText || "Preparing...");
    const url = await lingkodGetSignedFileUrl(row, true);
    lingkodSetButtonLoading(triggerButton, false);

    if(!url){
        lingkodToast("The uploaded file could not be located. Please verify the Supabase Storage path or database reference.", "error");
        return;
    }

    window.open(url, "_blank");
}

function lingkodShowPreviewMessage(panel, iconClass, message){
    panel.innerHTML = "";
    const p = document.createElement("p");
    p.className = "preview-unavailable";
    const icon = document.createElement("i");
    icon.className = iconClass;
    p.appendChild(icon);
    p.appendChild(document.createTextNode(" " + message));
    panel.appendChild(p);
}

// Loads asynchronously into an already-mounted panel - callers should
// show a "Loading preview..." placeholder immediately (a signed URL needs
// a Storage round-trip), then call this to fill it in.
async function lingkodLoadFilePreview(panel, row){
    if(!row.file_path && !row.file_url){
        lingkodShowPreviewMessage(panel, "fa-solid fa-file-circle-question", "No file attached to this record.");
        return;
    }

    const kind = lingkodGuessFilePreviewKind(row);

    if(kind === "unsupported"){
        lingkodShowPreviewMessage(panel, "fa-solid fa-triangle-exclamation", "Preview is unavailable for this file type. Use Download instead.");
        return;
    }

    const url = await lingkodGetSignedFileUrl(row, false);

    if(!url){
        lingkodShowPreviewMessage(panel, "fa-solid fa-circle-exclamation", "The uploaded file could not be located. Please verify the Supabase Storage path or database reference.");
        return;
    }

    panel.innerHTML = "";

    if(kind === "image"){
        const img = document.createElement("img");
        img.src = url;
        img.alt = row.document_title || row.file_name || "Preview";
        panel.appendChild(img);
    } else if(kind === "video"){
        const video = document.createElement("video");
        video.src = url;
        video.controls = true;
        video.style.maxWidth = "100%";
        panel.appendChild(video);
    } else {
        // pdf / text - both render natively in an iframe, no extra
        // library needed (DOCX/XLSX rendering is a separate, larger
        // addition - not built yet, hence "unsupported" for those above).
        const iframe = document.createElement("iframe");
        iframe.src = url;
        iframe.title = "Document preview";
        panel.appendChild(iframe);
    }
}

// Compact "file card" for a table cell: icon + file name, a type/size
// meta line, and View/Download actions - used by both Submission &
// Tracking tables. options: { onView(row) } - omit to hide the View
// button (Download always shows when a file is attached).
function lingkodBuildFileInfoCell(row, options){
    options = options || {};
    const td = document.createElement("td");

    if(!row.file_path){
        td.textContent = "—";
        return td;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "file-info-cell";

    const nameLine = document.createElement("span");
    nameLine.className = "file-info-name";
    const icon = document.createElement("i");
    icon.className = lingkodFileIconClass(row);
    nameLine.appendChild(icon);
    nameLine.appendChild(document.createTextNode(" " + (row.file_name || "Uploaded file")));
    wrapper.appendChild(nameLine);

    const metaParts = [];
    if(row.file_type) metaParts.push(row.file_type.split("/").pop().toUpperCase());
    if(row.file_size !== null && row.file_size !== undefined) metaParts.push(lingkodFormatFileSize(row.file_size));
    if(metaParts.length){
        const metaLine = document.createElement("span");
        metaLine.className = "file-info-meta";
        metaLine.textContent = metaParts.join(" • ");
        wrapper.appendChild(metaLine);
    }

    const actions = document.createElement("div");
    actions.className = "file-info-actions";

    if(options.onView){
        const viewBtn = document.createElement("button");
        viewBtn.type = "button";
        viewBtn.className = "file-action-btn";
        viewBtn.innerHTML = "<i class=\"fa-solid fa-eye\"></i> View";
        viewBtn.addEventListener("click", function(){ options.onView(row); });
        actions.appendChild(viewBtn);
    }

    const downloadBtn = document.createElement("button");
    downloadBtn.type = "button";
    downloadBtn.className = "file-action-btn";
    downloadBtn.innerHTML = "<i class=\"fa-solid fa-download\"></i> Download";
    downloadBtn.addEventListener("click", function(){ lingkodDownloadFile(row, downloadBtn); });
    actions.appendChild(downloadBtn);

    wrapper.appendChild(actions);
    td.appendChild(wrapper);
    return td;
}

// A minimal preview modal (no review actions) for contexts that just need
// to show + download a file - the dashboard/Profile approved-submissions
// feeds a student sees, for example.
function lingkodOpenSimpleFilePreview(row){
    const wrapper = document.createElement("div");
    wrapper.className = "view-modal";

    const panel = document.createElement("div");
    panel.className = "view-modal-preview";
    lingkodShowPreviewMessage(panel, "fa-solid fa-spinner fa-spin", "Loading preview...");
    lingkodLoadFilePreview(panel, row);
    wrapper.appendChild(panel);

    if(row.file_path || row.file_url){
        const actions = document.createElement("div");
        actions.className = "view-modal-actions";
        const downloadBtn = document.createElement("button");
        downloadBtn.type = "button";
        downloadBtn.className = "download-link";
        downloadBtn.innerHTML = "<i class=\"fa-solid fa-download\"></i> Download";
        downloadBtn.addEventListener("click", function(){ lingkodDownloadFile(row, downloadBtn); });
        actions.appendChild(downloadBtn);
        wrapper.appendChild(actions);
    }

    lingkodOpenModal(row.document_title || row.title || row.file_name || "Document Preview", wrapper, "modal-wide");
}

/* ================= AVATARS ================= */
// Shared by every page that shows a user's profile picture (Profile,
// Directory, Messages' contact list/chat header/search results) - a real
// photo (profiles.avatar_url) if one exists, initials in a colored circle
// otherwise. className lets each caller reuse its own sizing (.avatar,
// .directory-avatar, .profile-view-avatar, ...) while sharing this one
// build+fallback implementation.

function lingkodAvatarInitials(name){
    return (name || "?").trim().charAt(0).toUpperCase();
}

function lingkodBuildAvatarElement(profile, className){
    const el = document.createElement("div");
    el.className = className || "avatar";

    const url = profile && profile.avatar_url;
    const name = (profile && profile.full_name) || "";

    if(url){
        const img = document.createElement("img");
        img.src = url;
        img.alt = name;
        img.loading = "lazy";
        img.addEventListener("error", function(){
            img.remove();
            el.textContent = lingkodAvatarInitials(name);
        });
        el.appendChild(img);
    } else {
        el.textContent = lingkodAvatarInitials(name);
    }

    return el;
}

/* ================= AVATAR CROPPER ================= */
// Interactive pan/zoom/rotate(90 deg) square cropper, confirmed into a
// fixed-size JPEG blob - used by the Profile page's "Change Photo" flow.
// A fixed preview resolution independent of the final output size keeps
// the drag/zoom math simple; confirmAvatarCrop scales the same transform
// up to the real output resolution.

const LINGKOD_AVATAR_OUTPUT_SIZE = 600;
const LINGKOD_AVATAR_PREVIEW_SIZE = 300;

function lingkodOpenAvatarCropper(file, onConfirm){
    const validationError = lingkodValidateImageFile(file);
    if(validationError){
        lingkodToast(validationError, "error");
        return;
    }

    const img = new Image();
    const sourceUrl = URL.createObjectURL(file);

    img.onload = function(){
        lingkodBuildAvatarCropperUI(img, sourceUrl, onConfirm);
    };
    img.onerror = function(){
        URL.revokeObjectURL(sourceUrl);
        lingkodToast("Couldn't read this image file - it may be corrupted.", "error");
    };
    img.src = sourceUrl;
}

function lingkodBuildAvatarCropperUI(img, sourceUrl, onConfirm){
    const wrap = document.createElement("div");
    wrap.className = "avatar-cropper";

    const stage = document.createElement("div");
    stage.className = "avatar-cropper-stage";
    const canvas = document.createElement("canvas");
    canvas.width = LINGKOD_AVATAR_PREVIEW_SIZE;
    canvas.height = LINGKOD_AVATAR_PREVIEW_SIZE;
    stage.appendChild(canvas);
    wrap.appendChild(stage);

    const ctx = canvas.getContext("2d");

    // Smallest scale that fully covers the square preview (like
    // object-fit:cover), before the user's own zoom is applied on top.
    const baseScale = Math.max(
        LINGKOD_AVATAR_PREVIEW_SIZE / img.naturalWidth,
        LINGKOD_AVATAR_PREVIEW_SIZE / img.naturalHeight
    );

    let zoom = 1;
    let rotation = 0;
    let offsetX = 0;
    let offsetY = 0;

    function clampOffsets(){
        const scale = baseScale * zoom;
        const w = img.naturalWidth * scale;
        const h = img.naturalHeight * scale;
        const rotated90 = rotation % 180 !== 0;
        const effW = rotated90 ? h : w;
        const effH = rotated90 ? w : h;
        const maxX = Math.max(0, (effW - LINGKOD_AVATAR_PREVIEW_SIZE) / 2);
        const maxY = Math.max(0, (effH - LINGKOD_AVATAR_PREVIEW_SIZE) / 2);
        offsetX = Math.min(maxX, Math.max(-maxX, offsetX));
        offsetY = Math.min(maxY, Math.max(-maxY, offsetY));
    }

    function draw(){
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(canvas.width / 2 + offsetX, canvas.height / 2 + offsetY);
        ctx.rotate(rotation * Math.PI / 180);
        const scale = baseScale * zoom;
        ctx.drawImage(
            img,
            -img.naturalWidth * scale / 2, -img.naturalHeight * scale / 2,
            img.naturalWidth * scale, img.naturalHeight * scale
        );
        ctx.restore();
    }

    clampOffsets();
    draw();

    let dragging = false;
    let dragStartX = 0, dragStartY = 0, startOffsetX = 0, startOffsetY = 0;

    function pointerDown(x, y){
        dragging = true;
        dragStartX = x; dragStartY = y;
        startOffsetX = offsetX; startOffsetY = offsetY;
    }
    function pointerMove(x, y){
        if(!dragging) return;
        offsetX = startOffsetX + (x - dragStartX);
        offsetY = startOffsetY + (y - dragStartY);
        clampOffsets();
        draw();
    }
    function pointerUp(){ dragging = false; }

    canvas.addEventListener("mousedown", function(e){ pointerDown(e.clientX, e.clientY); });
    window.addEventListener("mousemove", function(e){ pointerMove(e.clientX, e.clientY); });
    window.addEventListener("mouseup", pointerUp);

    canvas.addEventListener("touchstart", function(e){
        const t = e.touches[0];
        pointerDown(t.clientX, t.clientY);
    }, { passive: true });
    canvas.addEventListener("touchmove", function(e){
        const t = e.touches[0];
        pointerMove(t.clientX, t.clientY);
        e.preventDefault();
    }, { passive: false });
    canvas.addEventListener("touchend", pointerUp);

    const controls = document.createElement("div");
    controls.className = "avatar-cropper-controls";

    const zoomRow = document.createElement("div");
    zoomRow.className = "avatar-cropper-zoom-row";
    const zoomOutIcon = document.createElement("i");
    zoomOutIcon.className = "fa-solid fa-magnifying-glass-minus";
    const zoomSlider = document.createElement("input");
    zoomSlider.type = "range";
    zoomSlider.min = "1";
    zoomSlider.max = "3";
    zoomSlider.step = "0.01";
    zoomSlider.value = "1";
    const zoomInIcon = document.createElement("i");
    zoomInIcon.className = "fa-solid fa-magnifying-glass-plus";
    zoomRow.appendChild(zoomOutIcon);
    zoomRow.appendChild(zoomSlider);
    zoomRow.appendChild(zoomInIcon);
    controls.appendChild(zoomRow);

    zoomSlider.addEventListener("input", function(){
        zoom = Number(zoomSlider.value);
        clampOffsets();
        draw();
    });

    const rotateBtn = document.createElement("button");
    rotateBtn.type = "button";
    rotateBtn.className = "btn-secondary avatar-cropper-rotate";
    rotateBtn.innerHTML = "<i class=\"fa-solid fa-rotate-right\"></i> Rotate";
    rotateBtn.addEventListener("click", function(){
        rotation = (rotation + 90) % 360;
        offsetX = 0;
        offsetY = 0;
        clampOffsets();
        draw();
    });
    controls.appendChild(rotateBtn);

    wrap.appendChild(controls);

    const hint = document.createElement("p");
    hint.className = "field-hint";
    hint.textContent = "Drag to reposition, use the slider to zoom. Recommended: 600 × 600 pixels.";
    wrap.appendChild(hint);

    const actions = document.createElement("div");
    actions.className = "profile-view-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn-secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", function(){
        URL.revokeObjectURL(sourceUrl);
        lingkodCloseModal();
    });
    actions.appendChild(cancelBtn);

    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.textContent = "Apply";
    applyBtn.addEventListener("click", function(){
        const outCanvas = document.createElement("canvas");
        outCanvas.width = LINGKOD_AVATAR_OUTPUT_SIZE;
        outCanvas.height = LINGKOD_AVATAR_OUTPUT_SIZE;
        const outCtx = outCanvas.getContext("2d");
        const outScale = LINGKOD_AVATAR_OUTPUT_SIZE / LINGKOD_AVATAR_PREVIEW_SIZE;

        outCtx.save();
        outCtx.translate(
            outCanvas.width / 2 + offsetX * outScale,
            outCanvas.height / 2 + offsetY * outScale
        );
        outCtx.rotate(rotation * Math.PI / 180);
        const scale = baseScale * zoom * outScale;
        outCtx.drawImage(
            img,
            -img.naturalWidth * scale / 2, -img.naturalHeight * scale / 2,
            img.naturalWidth * scale, img.naturalHeight * scale
        );
        outCtx.restore();

        outCanvas.toBlob(function(blob){
            URL.revokeObjectURL(sourceUrl);
            if(!blob){
                lingkodToast("Couldn't process this image.", "error");
                return;
            }
            lingkodCloseModal();
            onConfirm(blob);
        }, "image/jpeg", 0.92);
    });
    actions.appendChild(applyBtn);

    wrap.appendChild(actions);

    lingkodOpenModal("Adjust Photo", wrap);
}

// Fixed path per user ("<user id>/avatar.jpg"), not a random name per
// upload - upsert:true genuinely replaces the previous photo instead of
// leaving it orphaned in Storage. The ?v= query string cache-busts every
// page that already has this exact URL cached (browsers, and any other
// open tab), since getPublicUrl() always returns the same URL for the
// same path regardless of how many times the underlying bytes change.
async function lingkodUploadAvatarImage(userId, blob){
    const path = userId + "/avatar.jpg";

    const { error } = await supabaseClient.storage
        .from("profile-images")
        .upload(path, blob, { contentType: "image/jpeg", upsert: true });

    if(error){
        throw new Error(error.message);
    }

    const { data } = supabaseClient.storage.from("profile-images").getPublicUrl(path);
    return data.publicUrl + "?v=" + Date.now();
}

/* ================= SQUARE COVER IMAGES ================= */
// Shared by Ongoing Projects, Upcoming Activities, Implemented Activities,
// and Income-Generating Projects - all four write to the same
// projects_activities.image_url column and the same public "project-images"
// Storage bucket, so the validate/crop/upload/cleanup logic lives here once
// instead of four times.

const LINGKOD_IMAGE_MAX_SIZE_BYTES = 10 * 1024 * 1024;
const LINGKOD_IMAGE_ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
const LINGKOD_SQUARE_IMAGE_DIMENSION = 1080;

function lingkodValidateImageFile(file){
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if(!LINGKOD_IMAGE_ALLOWED_EXTENSIONS.includes(ext)){
        return "Please choose a JPG, PNG, or WEBP image.";
    }
    if(file.size > LINGKOD_IMAGE_MAX_SIZE_BYTES){
        return "That image is larger than 10 MB.";
    }
    return null;
}

// Center-crops to a true square (matching the source's shorter side) and
// caps it at 1080x1080 - never upscales a smaller image, since that would
// just blur it without adding real detail. Resolves { blob, objectUrl } -
// objectUrl is safe to hand straight to an <img src> as a "what you'll
// actually upload" preview; the caller owns revoking it once it's done
// with it (URL.revokeObjectURL).
function lingkodCropImageToSquare(file){
    return new Promise(function(resolve, reject){
        const img = new Image();
        const sourceUrl = URL.createObjectURL(file);

        img.onload = function(){
            const side = Math.min(img.naturalWidth, img.naturalHeight);
            const sx = (img.naturalWidth - side) / 2;
            const sy = (img.naturalHeight - side) / 2;
            const outputSide = Math.min(side, LINGKOD_SQUARE_IMAGE_DIMENSION);

            const canvas = document.createElement("canvas");
            canvas.width = outputSide;
            canvas.height = outputSide;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, sx, sy, side, side, 0, 0, outputSide, outputSide);

            URL.revokeObjectURL(sourceUrl);

            // PNG and WEBP can both carry transparency - re-encoding either
            // as JPEG would silently flatten it onto black. JPEG stays
            // JPEG (never had alpha to begin with, and is the smaller file).
            const outputType = (file.type === "image/png" || file.type === "image/webp") ? "image/png" : "image/jpeg";
            canvas.toBlob(function(blob){
                if(!blob){
                    reject(new Error("Couldn't process this image."));
                    return;
                }
                resolve({ blob: blob, objectUrl: URL.createObjectURL(blob) });
            }, outputType, 0.92);
        };

        img.onerror = function(){
            URL.revokeObjectURL(sourceUrl);
            reject(new Error("Couldn't read this image file - it may be corrupted."));
        };

        img.src = sourceUrl;
    });
}

// Wires a file input to live-validate, crop-to-square, and preview a
// selected image in one step. onReady(blob, objectUrl) fires once
// cropping finishes; onClear() fires when the user removes the selection
// via removeBtn.
function lingkodWireSquareImageInput(options){
    const fileInput = options.fileInput;
    const previewWrap = options.previewWrap;
    const previewImg = options.previewImg;
    const removeBtn = options.removeBtn;

    fileInput.addEventListener("change", async function(){
        const file = fileInput.files[0];
        if(!file) return;

        const validationError = lingkodValidateImageFile(file);
        if(validationError){
            lingkodToast(validationError, "error");
            fileInput.value = "";
            return;
        }

        try {
            const cropped = await lingkodCropImageToSquare(file);
            previewImg.src = cropped.objectUrl;
            previewWrap.hidden = false;
            options.onReady(cropped.blob, cropped.objectUrl);
        } catch(err){
            console.error("[image] crop failed:", err);
            lingkodToast("Couldn't process this image: " + err.message, "error");
            fileInput.value = "";
        }
    });

    if(removeBtn){
        removeBtn.addEventListener("click", function(){
            fileInput.value = "";
            previewWrap.hidden = true;
            previewImg.src = "";
            if(options.onClear) options.onClear();
        });
    }
}

function lingkodSanitizeFileNameForPath(name){
    return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

// Builds the "Activity Cover Image" edit-modal field (existing-image
// preview + remove button + file input wired through
// lingkodWireSquareImageInput + the standard size/format hint) - used by
// the edit modals of all four activity/project grids (Ongoing Projects,
// Upcoming Activities, Implemented Activities, Income-Generating
// Projects), which used to each carry an identical ~50-line copy of this
// block. The caller still owns the actual upload/patch/cleanup calls
// (lingkodUploadPublicImage/lingkodDeletePublicImage) in its own submit
// handler, since those need the row id and bucket name - this only
// tracks whether the viewer picked a new image or removed the existing
// one, via the returned state object.
function lingkodBuildCoverImageField(existingImageUrl){
    const imageField = document.createElement("div");
    imageField.className = "image-field";
    const imageLabel = document.createElement("label");
    imageLabel.className = "field-label";
    imageLabel.textContent = "Activity Cover Image";
    imageField.appendChild(imageLabel);

    const previewWrap = document.createElement("div");
    previewWrap.className = "image-preview";
    previewWrap.hidden = !existingImageUrl;
    const previewImg = document.createElement("img");
    if(existingImageUrl) previewImg.src = existingImageUrl;
    previewWrap.appendChild(previewImg);

    const state = { removeExisting: false, newBlob: null };

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "image-preview-remove";
    removeBtn.setAttribute("aria-label", "Remove cover image");
    removeBtn.innerHTML = "<i class=\"fa-solid fa-xmark\"></i>";
    removeBtn.addEventListener("click", function(){
        state.removeExisting = true;
        state.newBlob = null;
        previewWrap.hidden = true;
        imageFileInput.value = "";
    });
    previewWrap.appendChild(removeBtn);
    imageField.appendChild(previewWrap);

    const imageFileInput = document.createElement("input");
    imageFileInput.type = "file";
    imageFileInput.accept = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
    imageField.appendChild(imageFileInput);

    lingkodWireSquareImageInput({
        fileInput: imageFileInput,
        previewWrap: previewWrap,
        previewImg: previewImg,
        onReady: function(blob){
            state.newBlob = blob;
            state.removeExisting = false;
        }
    });

    const imageHint = document.createElement("small");
    imageHint.className = "field-hint";
    imageHint.textContent = "Recommended image size: 1080 × 1080 pixels (Square / Facebook Post). JPG, PNG, or WEBP. Max 10 MB.";
    imageField.appendChild(imageHint);

    return { field: imageField, state: state };
}

/* ================= ORGANIZATION LOGOS ================= */
// Same "one fixed path per owner, upsert replaces it" idea as
// lingkodUploadAvatarImage, generalized to organizations and widened to
// also accept SVG - a vector logo shouldn't be rasterized through the
// square-crop canvas pipeline (that would throw away the exact resolution
// independence a designer chose SVG for), so it's stored as-is instead.

const LINGKOD_ORG_LOGO_ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "svg"];

function lingkodValidateOrgLogoFile(file){
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if(!LINGKOD_ORG_LOGO_ALLOWED_EXTENSIONS.includes(ext)){
        return "Please choose a JPG, PNG, WEBP, or SVG image.";
    }
    if(file.size > LINGKOD_IMAGE_MAX_SIZE_BYTES){
        return "That image is larger than 10 MB.";
    }
    return null;
}

// Resolves { blob, objectUrl, ext, contentType }. SVGs pass through
// untouched (no crop/resize/compress - see comment above); everything
// else goes through the existing square-crop pipeline.
function lingkodProcessOrgLogoFile(file){
    const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);

    if(isSvg){
        return Promise.resolve({
            blob: file,
            objectUrl: URL.createObjectURL(file),
            ext: "svg",
            contentType: "image/svg+xml"
        });
    }

    return lingkodCropImageToSquare(file).then(function(result){
        return {
            blob: result.blob,
            objectUrl: result.objectUrl,
            ext: result.blob.type === "image/png" ? "png" : "jpg",
            contentType: result.blob.type
        };
    });
}

function lingkodOrgLogoInitials(name){
    return lingkodAvatarInitials(name);
}

// Mirrors lingkodBuildAvatarElement's real-image/initials-fallback split,
// but for an organization's logo_url/name instead of a person's
// avatar_url/full_name.
function lingkodBuildOrgLogoElement(org, className){
    const el = document.createElement("div");
    el.className = className || "org-logo";

    const url = org && org.logo_url;
    const name = (org && org.name) || "";

    if(url){
        const img = document.createElement("img");
        img.src = url;
        img.alt = name;
        img.loading = "lazy";
        img.addEventListener("error", function(){
            img.remove();
            el.textContent = lingkodOrgLogoInitials(name);
        });
        el.appendChild(img);
    } else {
        el.textContent = lingkodOrgLogoInitials(name);
    }

    return el;
}

// Removes whatever extension the org's logo previously used before
// uploading the new one - necessary because the upload format can change
// between uploads (e.g. PNG replaced by SVG), so a plain upsert on a
// fixed filename wouldn't clean up the old file. 404s from files that
// were never uploaded are expected and ignored.
async function lingkodClearOrgLogoFiles(orgId){
    const paths = LINGKOD_ORG_LOGO_ALLOWED_EXTENSIONS.map(function(ext){
        return orgId + "/logo." + ext;
    });
    await supabaseClient.storage.from("organization-logos").remove(paths).catch(function(){});
}

async function lingkodUploadOrgLogo(orgId, processed){
    await lingkodClearOrgLogoFiles(orgId);

    const path = orgId + "/logo." + processed.ext;

    const { error } = await supabaseClient.storage
        .from("organization-logos")
        .upload(path, processed.blob, { contentType: processed.contentType, upsert: true });

    if(error){
        throw new Error(error.message);
    }

    const { data } = supabaseClient.storage.from("organization-logos").getPublicUrl(path);
    return data.publicUrl + "?v=" + Date.now();
}

async function lingkodRemoveOrgLogo(orgId){
    await lingkodClearOrgLogoFiles(orgId);
}

// Populates an <select name="organization"> with every row from
// public.organizations, live (relies on its "Anyone can read
// organizations" RLS policy - no auth/role check needed to read the
// list). Shared by every "Add" form that used to take a free-text
// organization name (Ongoing Projects, Upcoming Activities, Implemented
// Activities, Income-Generating Projects) - those forms still submit the
// organization's plain NAME (not organizations.id) into
// projects_activities.organization, matching that table's existing
// free-text column and its org_president write-RLS (which compares
// organization to the caller's own profiles.organization text) - only the
// picker itself becomes a real dropdown instead of a typed-in string.
// selectedName pre-selects a matching option if given; found via a plain
// value match since both sides are the same organization name string.
async function lingkodPopulateOrganizationSelect(selectEl, selectedName){
    if(!selectEl) return;

    const { data, error } = await supabaseClient
        .from("organizations")
        .select("id, name")
        .order("name");

    selectEl.innerHTML = "";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select Organization";
    selectEl.appendChild(placeholder);

    if(error){
        console.error("[common] failed to load organizations for dropdown:", error);
        return;
    }

    (data || []).forEach(function(org){
        const opt = document.createElement("option");
        opt.value = org.name;
        opt.textContent = org.name;
        if(selectedName && org.name === selectedName) opt.selected = true;
        selectEl.appendChild(opt);
    });
}

// Same as lingkodPopulateOrganizationSelect, but the option VALUE is the
// organization's id (uuid) instead of its name - for tables that store a
// real organization_id FK (Documents) rather than a free-text name
// (Ongoing Projects/Upcoming Activities/Implemented Activities/Income-
// Generating Projects, which all still submit the name - see that
// function's own comment for why those stayed name-based).
async function lingkodPopulateOrganizationSelectById(selectEl, selectedId){
    if(!selectEl) return;

    const { data, error } = await supabaseClient
        .from("organizations")
        .select("id, name")
        .order("name");

    selectEl.innerHTML = "";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select Organization";
    selectEl.appendChild(placeholder);

    if(error){
        console.error("[common] failed to load organizations for dropdown:", error);
        return;
    }

    (data || []).forEach(function(org){
        const opt = document.createElement("option");
        opt.value = org.id;
        opt.textContent = org.name;
        if(selectedId && org.id === selectedId) opt.selected = true;
        selectEl.appendChild(opt);
    });
}

// Mirrors lingkodPopulateOrganizationSelectById above - departments is
// the same shape of lookup table (text id, name), used by Registered
// Users' Edit User modal so OSOA EB has a real way to set/correct a
// member's department_id (profiles_department_required requires it to
// never be null - see the migration comment where it's added).
async function lingkodPopulateDepartmentSelect(selectEl, selectedId){
    if(!selectEl) return;

    const { data, error } = await supabaseClient
        .from("departments")
        .select("id, name")
        .order("name");

    selectEl.innerHTML = "";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select Department";
    selectEl.appendChild(placeholder);

    if(error){
        console.error("[common] failed to load departments for dropdown:", error);
        return;
    }

    (data || []).forEach(function(dept){
        const opt = document.createElement("option");
        opt.value = dept.id;
        opt.textContent = dept.name;
        if(selectedId && dept.id === selectedId) opt.selected = true;
        selectEl.appendChild(opt);
    });
}

async function lingkodUploadPublicImage(bucket, folderId, blob){
    const ext = blob.type === "image/png" ? "png" : "jpg";
    const path = folderId + "/" + crypto.randomUUID() + "-cover." + ext;

    const { error } = await supabaseClient.storage
        .from(bucket)
        .upload(path, blob, { contentType: blob.type, upsert: false });

    if(error){
        throw new Error(error.message);
    }

    const { data } = supabaseClient.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
}

function lingkodExtractStoragePathFromPublicUrl(url, bucket){
    if(!url) return null;
    const marker = "/object/public/" + bucket + "/";
    const index = url.indexOf(marker);
    if(index === -1) return null;
    return decodeURIComponent(url.slice(index + marker.length));
}

function lingkodDeletePublicImage(bucket, url){
    const path = lingkodExtractStoragePathFromPublicUrl(url, bucket);
    if(!path) return;
    supabaseClient.storage.from(bucket).remove([path])
        .catch(function(err){ console.error("[image] cleanup failed:", err); });
}

/* ================= COLLAPSIBLE SIDEBAR ================= */

function initSidebarToggle(){

    const sidebar = document.querySelector(".sidebar");
    if(!sidebar) return;

    const backdrop = document.createElement("div");
    backdrop.className = "sidebar-backdrop";
    document.body.appendChild(backdrop);

    const toggle = document.createElement("button");
    toggle.className = "sidebar-toggle";
    toggle.setAttribute("aria-label", "Toggle sidebar");
    toggle.innerHTML = "<i class=\"fa-solid fa-bars\"></i>";
    sidebar.insertBefore(toggle, sidebar.firstChild);

    // Lives outside the sidebar so it's still reachable when the
    // sidebar itself is off-screen (mobile, hidden by default).
    const mobileToggle = document.createElement("button");
    mobileToggle.className = "mobile-menu-btn";
    mobileToggle.setAttribute("aria-label", "Open menu");
    mobileToggle.innerHTML = "<i class=\"fa-solid fa-bars\"></i>";
    document.body.appendChild(mobileToggle);

    function isMobile(){
        return window.innerWidth <= 900;
    }

    function closeMobile(){
        sidebar.classList.remove("mobile-open");
        backdrop.classList.remove("visible");
        mobileToggle.classList.remove("hide");
    }

    function toggleSidebar(){
        if(isMobile()){
            const opening = !sidebar.classList.contains("mobile-open");
            sidebar.classList.toggle("mobile-open", opening);
            backdrop.classList.toggle("visible", opening);
            mobileToggle.classList.toggle("hide", opening);
        } else {
            const collapsed = sidebar.classList.toggle("collapsed");
            localStorage.setItem("lingkod_sidebar_collapsed", collapsed ? "1" : "0");
        }
    }

    if(!isMobile() && localStorage.getItem("lingkod_sidebar_collapsed") === "1"){
        sidebar.classList.add("collapsed");
    }

    toggle.addEventListener("click", toggleSidebar);
    mobileToggle.addEventListener("click", toggleSidebar);
    backdrop.addEventListener("click", closeMobile);

    const topbarHamburger = document.querySelector(".topbar > i.fa-bars");
    if(topbarHamburger){
        topbarHamburger.style.cursor = "pointer";
        topbarHamburger.addEventListener("click", toggleSidebar);
    }

    window.addEventListener("resize", function(){
        if(!isMobile()) closeMobile();
    });

}

/* ================= NOTIFICATIONS ================= */
// Shared bell icon + dropdown, injected once per page load into every
// page's sidebar (see the DOMContentLoaded handler above) - not gated to
// any one role, since any account could plausibly receive a notification
// in the future even though today only OSOA EB ever does (see
// notify_osoa_eb_on_report() in the 20260728040000 migration). The
// notifications table has no INSERT policy for `authenticated` at all -
// every row is written by a security-definer trigger, never by this
// client - so nothing here ever inserts, only reads and flips read_at.

let lingkodNotificationsCache = [];
let lingkodNotificationsUnreadCount = 0;

function lingkodRenderNotificationBadge(){
    const badge = document.getElementById("lingkodNotificationBadge");
    if(!badge) return;
    if(lingkodNotificationsUnreadCount > 0){
        badge.textContent = lingkodNotificationsUnreadCount > 9 ? "9+" : String(lingkodNotificationsUnreadCount);
        badge.hidden = false;
    } else {
        badge.hidden = true;
    }
}

function lingkodFormatNotificationTime(isoString){
    const date = new Date(isoString);
    const diffMins = Math.round((Date.now() - date.getTime()) / 60000);
    if(diffMins < 1) return "Just now";
    if(diffMins < 60) return diffMins + "m ago";
    const diffHours = Math.round(diffMins / 60);
    if(diffHours < 24) return diffHours + "h ago";
    const diffDays = Math.round(diffHours / 24);
    if(diffDays < 7) return diffDays + "d ago";
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

async function lingkodMarkNotificationRead(notification){
    if(notification.read_at) return;
    notification.read_at = new Date().toISOString();
    lingkodNotificationsUnreadCount = Math.max(0, lingkodNotificationsUnreadCount - 1);
    lingkodRenderNotificationBadge();

    const { error } = await supabaseClient
        .from("notifications")
        .update({ read_at: notification.read_at })
        .eq("id", notification.id);

    if(error) console.error("[notifications] mark read failed:", error);
}

async function lingkodMarkAllNotificationsRead(){
    const unreadIds = lingkodNotificationsCache.filter(function(n){ return !n.read_at; }).map(function(n){ return n.id; });
    if(unreadIds.length === 0) return;

    const nowIso = new Date().toISOString();
    lingkodNotificationsCache.forEach(function(n){ if(!n.read_at) n.read_at = nowIso; });
    lingkodNotificationsUnreadCount = 0;
    lingkodRenderNotificationBadge();
    lingkodRenderNotificationList();

    const { error } = await supabaseClient
        .from("notifications")
        .update({ read_at: nowIso })
        .in("id", unreadIds);

    if(error) console.error("[notifications] mark all read failed:", error);
}

function lingkodBuildNotificationItem(notification){
    const item = document.createElement("div");
    item.className = "notification-item" + (notification.read_at ? "" : " unread");

    const title = document.createElement("p");
    title.className = "notification-item-title";
    title.textContent = notification.title;
    item.appendChild(title);

    if(notification.body){
        const body = document.createElement("p");
        body.className = "notification-item-body";
        body.textContent = notification.body;
        item.appendChild(body);
    }

    const time = document.createElement("span");
    time.className = "notification-item-time";
    time.textContent = lingkodFormatNotificationTime(notification.created_at);
    item.appendChild(time);

    item.addEventListener("click", function(){
        lingkodMarkNotificationRead(notification);
        item.classList.remove("unread");
        if(notification.link_url) window.location.href = notification.link_url;
    });

    return item;
}

function lingkodRenderNotificationList(){
    const list = document.getElementById("lingkodNotificationList");
    if(!list) return;

    list.innerHTML = "";

    if(lingkodNotificationsCache.length === 0){
        const empty = document.createElement("p");
        empty.className = "notification-empty";
        empty.textContent = "No notifications yet.";
        list.appendChild(empty);
        return;
    }

    lingkodNotificationsCache.forEach(function(n){ list.appendChild(lingkodBuildNotificationItem(n)); });
}

function lingkodCloseNotificationPanel(){
    const panel = document.getElementById("lingkodNotificationPanel");
    if(panel) panel.classList.remove("open");
}

function lingkodToggleNotificationPanel(){
    const panel = document.getElementById("lingkodNotificationPanel");
    if(panel) panel.classList.toggle("open");
}

async function lingkodLoadNotifications(profileId){
    const { data, error } = await supabaseClient
        .from("notifications")
        .select("id, type, title, body, link_url, read_at, created_at")
        .eq("recipient_id", profileId)
        .order("created_at", { ascending: false })
        .limit(30);

    if(error){
        console.error("[notifications] load failed:", error);
        return;
    }

    lingkodNotificationsCache = data;
    lingkodNotificationsUnreadCount = data.filter(function(n){ return !n.read_at; }).length;
    lingkodRenderNotificationBadge();
    lingkodRenderNotificationList();
}

function lingkodInitNotifications(profileId){
    const actions = document.querySelector(".app-topbar-actions");
    if(!actions || document.getElementById("lingkodNotificationBell")) return;

    const wrap = document.createElement("div");
    wrap.className = "topbar-icon-wrap";

    const bellBtn = document.createElement("button");
    bellBtn.type = "button";
    bellBtn.id = "lingkodNotificationBell";
    bellBtn.className = "notification-bell-btn";
    bellBtn.setAttribute("aria-label", "Notifications");
    bellBtn.innerHTML = "<i class=\"fa-solid fa-bell\"></i><span class=\"notification-badge\" id=\"lingkodNotificationBadge\" hidden></span>";
    bellBtn.addEventListener("click", function(e){
        e.stopPropagation();
        lingkodToggleNotificationPanel();
    });
    wrap.appendChild(bellBtn);

    const panel = document.createElement("div");
    panel.id = "lingkodNotificationPanel";
    panel.className = "notification-panel";

    const header = document.createElement("div");
    header.className = "notification-panel-header";
    const heading = document.createElement("h4");
    heading.textContent = "Notifications";
    header.appendChild(heading);

    const markAllBtn = document.createElement("button");
    markAllBtn.type = "button";
    markAllBtn.className = "notification-mark-all";
    markAllBtn.textContent = "Mark all read";
    markAllBtn.addEventListener("click", function(e){
        e.stopPropagation();
        lingkodMarkAllNotificationsRead();
    });
    header.appendChild(markAllBtn);
    panel.appendChild(header);

    const list = document.createElement("div");
    list.className = "notification-list";
    list.id = "lingkodNotificationList";
    panel.appendChild(list);

    wrap.appendChild(panel);
    // First in the icon cluster, ahead of the message icon and profile
    // (see .app-topbar-actions in common.css) - inserted rather than
    // appended since lingkodBuildAppTopbar() already populated the
    // message/profile elements before this async callback runs.
    actions.insertBefore(wrap, actions.firstChild);

    document.addEventListener("click", function(e){
        if(!panel.contains(e.target) && e.target !== bellBtn && !bellBtn.contains(e.target)){
            lingkodCloseNotificationPanel();
        }
    });
    document.addEventListener("keydown", function(e){
        if(e.key === "Escape") lingkodCloseNotificationPanel();
    });

    lingkodLoadNotifications(profileId);

    supabaseClient
        .channel("notifications_for_" + profileId)
        .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: "recipient_id=eq." + profileId }, function(){
            lingkodLoadNotifications(profileId);
        })
        .subscribe();
}
