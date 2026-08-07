/* ===================================================
   LINGKOD Meneses - Messages
   Messenger-style: searching only finds people. A chat only
   becomes a permanent entry in the left conversation list once
   an actual message has been sent - exactly like Facebook
   Messenger never adds someone to your chat list just because
   you viewed their profile. See ensureConversation() below for
   why conversation rows are still created lazily, at first-send.
   =================================================== */

const REPORT_REASONS = ["Spam", "Harassment", "Fake Account", "Inappropriate Content", "Impersonation", "Other"];
const MESSAGE_REPORT_REASONS = ["Spam", "Harassment", "Inappropriate Content", "Fake Information", "Other"];

// { key, emoji, label } - key is what's actually stored in
// message_reactions.reaction (matches the migration's check constraint).
const MESSAGE_REACTIONS = [
    { key: "like", emoji: "👍", label: "Like" },
    { key: "love", emoji: "❤️", label: "Love" },
    { key: "haha", emoji: "😂", label: "Haha" },
    { key: "wow", emoji: "😮", label: "Wow" },
    { key: "sad", emoji: "😢", label: "Sad" },
    { key: "angry", emoji: "😡", label: "Angry" }
];
const MESSAGE_REACTIONS_BY_KEY = {};
MESSAGE_REACTIONS.forEach(function(r){ MESSAGE_REACTIONS_BY_KEY[r.key] = r; });

const MESSAGE_ATTACHMENTS_BUCKET = "message-attachments";
const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024;
const ALLOWED_ATTACHMENT_EXTENSIONS = ["jpg","jpeg","png","gif","webp","pdf","doc","docx","xls","xlsx","ppt","pptx","txt","mp4","mov","avi","zip","rar"];

let myProfile = null;
let activeAccount = null;        // {id, full_name, student_number, role} being chatted with
let activeConversationId = null; // real conversations.id, once one exists
let myConversationIds = [];
let conversationListCache = [];  // persistent sidebar entries, most recent first
let archivedListCache = [];
let viewingArchived = false;
let iBlockedIds = new Set();     // people I've blocked
let blockedIds = new Set();      // either direction - can't message these people

// Composer state - not per-conversation, since the whole chat window (and
// its attachment queue) is rebuilt by renderChatWindow() every time a
// different conversation is opened anyway.
let pendingAttachments = [];     // [{ id, file, status, progress, cancel, meta, previewUrl }]
let recentEmojis = [];           // [emoji, ...] most-recent-first, from emoji_usage
let frequentEmojis = [];         // [emoji, ...] most-used-first, from emoji_usage

// Per-message feature state - all rebuilt on every loadMessages() call for
// whichever conversation is currently open (see loadMessages below).
let messageRowsCache = [];                    // the actual message rows last rendered, keyed for lookups by id
let messageReactionsByMessageId = {};         // { [messageId]: [{user_id, reaction}, ...] }
let messageReactorProfilesById = {};          // { [userId]: {full_name} } - just for the who-reacted tooltip
let removedForMeMessageIds = new Set();       // messages this user removed-for-me, hidden entirely
let pinnedMessageIds = new Set();             // message ids pinned in the currently open conversation
let pinnedMessagesOrdered = [];               // pinned rows for the currently open conversation, oldest first
let openReactionPickerAnchor = null;

const contactList = document.getElementById("contactList");
const chatPanel = document.getElementById("chatPanel");
const conversationSearch = document.getElementById("conversationSearch");
const archivedToggleBtn = document.getElementById("archivedToggleBtn");

function formatDateLabel(isoString){
    const date = new Date(isoString);
    const startOfDay = function(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
    const diffDays = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);
    if(diffDays === 0) return "Today";
    if(diffDays === 1) return "Yesterday";
    return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function formatTime(isoString){
    return new Date(isoString).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Compact sidebar timestamp (Messenger-style: clock time today, weekday
// this week, short date otherwise) - distinct from formatTime/formatDateLabel
// above, which are for the full chat transcript's separators/bubbles.
function formatContactTime(isoString){
    if(!isoString) return "";
    const date = new Date(isoString);
    const now = new Date();
    if(date.toDateString() === now.toDateString()){
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    const startOfDay = function(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
    const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
    if(diffDays === 1) return "Yesterday";
    if(diffDays < 7) return date.toLocaleDateString("en-US", { weekday: "short" });
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function initials(name){
    return (name || "?").trim().charAt(0).toUpperCase();
}

function roleLabel(dbRole){
    const uiRole = LINGKOD_DB_ROLE_TO_UI_ROLE[dbRole] || dbRole;
    return LINGKOD_ROLE_LABELS[uiRole] || uiRole;
}

function renderNoResults(container, message){
    container.innerHTML = "";
    const div = document.createElement("div");
    div.className = "no-results";
    div.textContent = message;
    container.appendChild(div);
}

/* ================= TYPING INDICATOR =================
   Ephemeral (Realtime Broadcast, not a DB table) - nothing to persist,
   no migration needed. Keyed by both participants' ids (sorted, so both
   sides compute the same channel name) rather than the conversation id,
   since a brand-new conversation has no conversations row - and no
   activeConversationId - until the first message is actually sent
   (see ensureConversation()/ensureConversationWith() above), but two
   people can still be typing to each other before that point. */

let typingChannel = null;
let typingIndicatorTimeout = null;
let lastTypingBroadcastAt = 0;
let activeChatRoleLine = null;

function typingChannelName(otherUserId){
    return "typing:" + [myProfile.id, otherUserId].sort().join(":");
}

function subscribeTypingChannel(otherAccount){
    if(typingChannel){
        supabaseClient.removeChannel(typingChannel);
        typingChannel = null;
    }
    if(!otherAccount) return;

    typingChannel = supabaseClient
        .channel(typingChannelName(otherAccount.id))
        .on("broadcast", { event: "typing" }, function(){ showTypingIndicator(); })
        .subscribe();
}

function showTypingIndicator(){
    if(!activeChatRoleLine) return;
    if(!activeChatRoleLine.dataset.originalText){
        activeChatRoleLine.dataset.originalText = activeChatRoleLine.textContent;
    }
    activeChatRoleLine.textContent = "Typing...";
    activeChatRoleLine.classList.add("typing-indicator-text");

    clearTimeout(typingIndicatorTimeout);
    typingIndicatorTimeout = setTimeout(function(){
        if(activeChatRoleLine){
            activeChatRoleLine.textContent = activeChatRoleLine.dataset.originalText;
            activeChatRoleLine.classList.remove("typing-indicator-text");
        }
    }, 3000);
}

// Throttled to one broadcast every 2s of continued typing, not one per
// keystroke - a "typing" signal only needs to be roughly current, and
// the receiving side's own 3s timeout (above) already covers the gap.
function broadcastTyping(){
    if(!typingChannel) return;
    const now = Date.now();
    if(now - lastTypingBroadcastAt < 2000) return;
    lastTypingBroadcastAt = now;
    typingChannel.send({ type: "broadcast", event: "typing", payload: {} });
}

function renderChatEmpty(message){
    subscribeTypingChannel(null);
    chatPanel.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "chat-empty";
    wrap.innerHTML = "<i class=\"fa-regular fa-comments\"></i>";
    const p = document.createElement("p");
    p.textContent = message;
    wrap.appendChild(p);
    chatPanel.appendChild(wrap);
}

/* ================= CONTEXT MENU (three-dot) ================= */
// Delegates to the shared js/common.js card-menu (lingkodOpenCardMenu/
// lingkodCloseCardMenu - same fixed-position dropdown used by the
// activity/project grid cards) instead of keeping its own positioning/
// open/close/Escape-key logic. This and the per-message menu below used
// to each carry a near-identical ~90-line copy of that machinery.

function closeContactMenu(){
    lingkodCloseCardMenu();
}

function openContactMenu(anchorEl, entry){
    const showUnread = entry.unreadCount > 0 || entry.manuallyMarkedUnread;
    const items = [
        {
            label: showUnread ? "Mark as Read" : "Mark as Unread",
            icon: showUnread ? "fa-envelope-open" : "fa-envelope",
            onClick: function(){ menuMarkReadUnread(entry, !showUnread); }
        },
        {
            label: entry.isMuted ? "Unmute Notifications" : "Mute Notifications",
            icon: entry.isMuted ? "fa-bell" : "fa-bell-slash",
            onClick: function(){ menuToggleMute(entry); }
        },
        { label: "View Profile", icon: "fa-user", onClick: function(){ menuViewProfile(entry); } },
        {
            label: entry.isArchived ? "Unarchive Chat" : "Archive Chat",
            icon: "fa-box-archive",
            onClick: function(){ menuToggleArchive(entry); }
        },
        { label: "Delete Chat", icon: "fa-trash", onClick: function(){ menuDeleteChat(entry); }, destructive: true },
        {
            label: iBlockedIds.has(entry.otherProfile.id) ? "Unblock User" : "Block User",
            icon: "fa-ban",
            onClick: function(){ menuToggleBlock(entry); },
            destructive: true
        },
        { label: "Report User", icon: "fa-flag", onClick: function(){ menuReportUser(entry); }, destructive: true }
    ];

    lingkodOpenCardMenu(anchorEl, items);
}

/* ================= CONTACT LIST RENDERING ================= */

// Shared by both the search-result list and the persistent conversation
// list - they only differ in what goes in the preview line and whether a
// time/unread badge/options menu is shown.
function buildContactItem(options){
    const item = document.createElement("div");
    item.className = "contact-item" + (options.isActive ? " active" : "") + (options.bold ? " unread" : "");

    const avatarWrap = document.createElement("div");
    avatarWrap.className = "avatar-wrap";
    avatarWrap.appendChild(lingkodBuildAvatarElement({ full_name: options.name, avatar_url: options.avatarUrl }, "avatar"));

    const body = document.createElement("div");
    body.className = "contact-body";

    const topRow = document.createElement("div");
    topRow.className = "contact-top-row";
    const name = document.createElement("h4");
    name.textContent = options.name;
    topRow.appendChild(name);
    if(options.time){
        const time = document.createElement("span");
        time.className = "contact-time";
        time.textContent = options.time;
        topRow.appendChild(time);
    }

    const previewRow = document.createElement("div");
    previewRow.className = "contact-preview-row";
    const previewLine = document.createElement("p");
    previewLine.textContent = options.preview;
    previewRow.appendChild(previewLine);
    if(options.unread){
        const badge = document.createElement("span");
        badge.className = "unread-badge";
        badge.textContent = options.unread > 9 ? "9+" : String(options.unread);
        previewRow.appendChild(badge);
    }

    body.appendChild(topRow);
    body.appendChild(previewRow);

    item.appendChild(avatarWrap);
    item.appendChild(body);

    item.addEventListener("click", options.onClick);

    if(options.onMenu){
        const menuBtn = document.createElement("button");
        menuBtn.type = "button";
        menuBtn.className = "contact-menu-btn";
        menuBtn.setAttribute("aria-label", "Conversation options");
        menuBtn.innerHTML = "<i class=\"fa-solid fa-ellipsis\"></i>";
        menuBtn.addEventListener("click", function(e){
            e.stopPropagation();
            options.onMenu(menuBtn);
        });
        item.appendChild(menuBtn);
    }

    return item;
}

function renderSearchResults(results, query){
    contactList.innerHTML = "";
    closeContactMenu();

    if(!query){
        renderConversationList();
        return;
    }

    if(results.length === 0){
        renderNoResults(contactList, "No registered users found.");
        return;
    }

    results.forEach(function(account){
        contactList.appendChild(buildContactItem({
            name: account.full_name,
            avatarUrl: account.avatar_url,
            preview: roleLabel(account.role),
            isActive: !!(activeAccount && activeAccount.id === account.id),
            onClick: function(){ selectAccount(account); }
        }));
    });
}

// The permanent, Messenger-style left panel - every conversation that has
// at least one message in it (and isn't archived/deleted-for-me), most
// recently active first. Shown whenever the search box is empty.
function renderConversationList(){
    contactList.innerHTML = "";
    closeContactMenu();

    const source = viewingArchived ? archivedListCache : conversationListCache;

    if(source.length === 0){
        renderNoResults(contactList, viewingArchived ? "No archived chats." : "No conversations yet - search for someone to say hello.");
        return;
    }

    source.forEach(function(entry){
        const isMine = entry.lastMessageSenderId === myProfile.id;
        const preview = entry.lastMessageContent
            ? (isMine ? "You: " : "") + entry.lastMessageContent
            : "Say hello!";
        const showUnread = entry.unreadCount > 0 || entry.manuallyMarkedUnread;

        contactList.appendChild(buildContactItem({
            name: entry.otherProfile.full_name,
            avatarUrl: entry.otherProfile.avatar_url,
            preview: preview,
            time: formatContactTime(entry.lastMessageAt),
            unread: entry.unreadCount > 0 ? entry.unreadCount : (entry.manuallyMarkedUnread ? 1 : 0),
            bold: showUnread,
            isActive: activeConversationId === entry.conversationId,
            onClick: function(){
                selectAccount({
                    id: entry.otherProfile.id,
                    full_name: entry.otherProfile.full_name,
                    role: entry.otherProfile.role,
                    avatar_url: entry.otherProfile.avatar_url
                });
            },
            onMenu: function(anchorEl){ openContactMenu(anchorEl, entry); }
        }));
    });
}

async function searchAccounts(query){
    const trimmed = query.trim();

    if(!trimmed){
        renderConversationList();
        return;
    }

    renderNoResults(contactList, "Searching...");

    // Strip characters that would break PostgREST's comma-separated
    // .or() filter syntax rather than search for them literally.
    const safeQuery = trimmed.replace(/[,()]/g, "");
    const orFilter = ["full_name", "first_name", "last_name", "email", "student_number"]
        .map(function(column){ return column + ".ilike.%" + safeQuery + "%"; })
        .join(",");

    const { data, error } = await supabaseClient
        .from("profiles")
        .select("id, full_name, role, avatar_url")
        .neq("id", myProfile.id)
        .or(orFilter)
        .order("full_name")
        .limit(20);

    // The box may have been changed (or cleared) again while this request
    // was in flight - a stale response should never clobber whatever's
    // actually being searched for now.
    if(conversationSearch.value.trim() !== trimmed) return;

    if(error){
        console.error("[messages] account search failed:", error);
        renderNoResults(contactList, "Couldn't search accounts (" + error.message + ").");
        return;
    }

    const filtered = (data || []).filter(function(row){ return !blockedIds.has(row.id); });
    renderSearchResults(filtered, trimmed);
}

/* ================= CONVERSATION LOOKUP / CREATION ================= */

// A "direct" conversation with exactly this other person may already
// exist from an earlier session - found by intersecting the conversations
// I'm a member of with the ones they're a member of. There's no
// persisted "recent conversations" list, so this lookup is how an old
// thread is found again after selecting the same account.
async function findExistingDirectConversation(targetId){
    const { data: mine, error: mineError } = await supabaseClient
        .from("conversation_members")
        .select("conversation_id")
        .eq("profile_id", myProfile.id);

    if(mineError || !mine || mine.length === 0) return null;

    const myConversationIdsLocal = mine.map(function(row){ return row.conversation_id; });

    const { data: theirs, error: theirsError } = await supabaseClient
        .from("conversation_members")
        .select("conversation_id")
        .eq("profile_id", targetId)
        .in("conversation_id", myConversationIdsLocal);

    if(theirsError || !theirs || theirs.length === 0) return null;

    const sharedIds = theirs.map(function(row){ return row.conversation_id; });

    const { data: direct, error: directError } = await supabaseClient
        .from("conversations")
        .select("id")
        .eq("type", "direct")
        .in("id", sharedIds)
        .limit(1);

    if(directError || !direct || direct.length === 0) return null;

    return direct[0].id;
}

// Every conversation I'm a member of, enriched with the other participant's
// profile, the denormalized last-message summary (kept in sync by the
// trg_touch_conversation_on_message trigger), my own per-conversation
// settings (mute/archive/delete/manual-unread), and an unread count.
// Rebuilt after every send/receive/settings change so the sidebar's
// ordering, preview text, and badges stay live.
async function loadMyConversations(){
    if(!myProfile) return;

    const { data: mine, error: mineError } = await supabaseClient
        .from("conversation_members")
        .select("conversation_id")
        .eq("profile_id", myProfile.id);

    if(mineError){
        console.error("[messages] conversation list load failed:", mineError);
        return;
    }

    const conversationIds = (mine || []).map(function(row){ return row.conversation_id; });
    myConversationIds = conversationIds;

    if(conversationIds.length === 0){
        conversationListCache = [];
        archivedListCache = [];
        if(!conversationSearch.value.trim()) renderConversationList();
        return;
    }

    const [othersRes, convRes, unreadRes, settingsRes] = await Promise.all([
        supabaseClient
            .from("conversation_members")
            .select("conversation_id, profile_id")
            .in("conversation_id", conversationIds)
            .neq("profile_id", myProfile.id),
        supabaseClient
            .from("conversations")
            .select("id, last_message_content, last_message_at, last_message_sender_id")
            .in("id", conversationIds),
        supabaseClient
            .from("messages")
            .select("conversation_id")
            .in("conversation_id", conversationIds)
            .neq("sender_id", myProfile.id)
            .eq("is_read", false),
        supabaseClient
            .from("conversation_settings")
            .select("conversation_id, is_muted, is_archived, is_deleted, manually_marked_unread")
            .eq("user_id", myProfile.id)
            .in("conversation_id", conversationIds)
    ]);

    if(othersRes.error || convRes.error){
        console.error("[messages] conversation list load failed:", othersRes.error || convRes.error);
        return;
    }

    // Both of these are allowed to fail without blanking out the whole
    // sidebar (unread badges/mute/archive just fall back to "off" via the
    // || [] below) - most likely because a later migration hasn't been run
    // yet on this project - but that should never fail *silently*.
    if(unreadRes.error) console.error("[messages] unread count load failed:", unreadRes.error);
    if(settingsRes.error) console.error("[messages] conversation settings load failed:", settingsRes.error);

    const otherProfileIdByConversation = {};
    (othersRes.data || []).forEach(function(row){
        otherProfileIdByConversation[row.conversation_id] = row.profile_id;
    });

    const profilesById = await lingkodFetchProfilesById(Object.values(otherProfileIdByConversation));

    const unreadCounts = {};
    (unreadRes.data || []).forEach(function(row){
        unreadCounts[row.conversation_id] = (unreadCounts[row.conversation_id] || 0) + 1;
    });

    const convById = {};
    (convRes.data || []).forEach(function(row){ convById[row.id] = row; });

    const settingsById = {};
    (settingsRes.data || []).forEach(function(row){ settingsById[row.conversation_id] = row; });

    const allEntries = conversationIds
        .map(function(id){
            const otherId = otherProfileIdByConversation[id];
            const otherProfile = otherId ? profilesById[otherId] : null;
            if(!otherProfile) return null;
            const conv = convById[id] || {};
            const settings = settingsById[id] || {};
            return {
                conversationId: id,
                otherProfile: otherProfile,
                lastMessageContent: conv.last_message_content || null,
                lastMessageAt: conv.last_message_at || null,
                lastMessageSenderId: conv.last_message_sender_id || null,
                unreadCount: unreadCounts[id] || 0,
                isMuted: !!settings.is_muted,
                isArchived: !!settings.is_archived,
                isDeleted: !!settings.is_deleted,
                manuallyMarkedUnread: !!settings.manually_marked_unread
            };
        })
        .filter(Boolean)
        .sort(function(a, b){
            const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
            const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
            return bt - at;
        });

    conversationListCache = allEntries.filter(function(e){ return !e.isDeleted && !e.isArchived; });
    archivedListCache = allEntries.filter(function(e){ return !e.isDeleted && e.isArchived; });

    if(!conversationSearch.value.trim()) renderConversationList();
}

async function loadBlockedRelationships(){
    if(!myProfile) return;

    const { data, error } = await supabaseClient
        .from("user_blocks")
        .select("blocker_id, blocked_id")
        .or("blocker_id.eq." + myProfile.id + ",blocked_id.eq." + myProfile.id);

    if(error){
        console.error("[messages] block list load failed:", error);
        return;
    }

    const nextIBlocked = new Set();
    const nextBlocked = new Set();

    (data || []).forEach(function(row){
        if(row.blocker_id === myProfile.id){
            nextIBlocked.add(row.blocked_id);
            nextBlocked.add(row.blocked_id);
        } else {
            nextBlocked.add(row.blocker_id);
        }
    });

    iBlockedIds = nextIBlocked;
    blockedIds = nextBlocked;
}

// Lazy: nothing is created just by selecting a search result - only the
// first actual message send creates the conversation + both memberships,
// so browsing search results never litters the table with empty threads.
// Generic "get or lazily create a direct conversation with this person"
// - ensureConversation() below is just this pinned to activeAccount/
// activeConversationId for the composer's own use; forwardMessageTo()
// (per-message Forward) needs the same lazy-create behavior for an
// arbitrary target who isn't necessarily the conversation currently open.
async function ensureConversationWith(targetId){
    const existing = await findExistingDirectConversation(targetId);
    if(existing) return existing;

    // conversations_select requires is_conversation_member(id) - which can't
    // be true yet for a conversation that has no members at all. Asking for
    // the row back via .select() (Prefer: return=representation) would make
    // Postgres apply that SELECT policy to the freshly-inserted row and
    // reject the insert outright, so the id is generated client-side instead
    // and this insert never asks for anything back.
    const newConversationId = crypto.randomUUID();

    const { error: convError } = await supabaseClient
        .from("conversations")
        .insert({ id: newConversationId, type: "direct", created_by: myProfile.id });

    if(convError){
        console.error("[messages] conversation creation failed:", convError);
        throw new Error("Couldn't start a conversation: " + convError.message);
    }

    // Inserted as two separate statements, not one batched array insert.
    // conversation_members' own insert policy falls back to "the
    // conversation's creator can add members," but that fallback clause
    // checks conversations_select (is_conversation_member) to find the row -
    // which is circular for anyone not already a member. Adding myself
    // first (via the policy's plain profile_id = auth.uid() clause) makes
    // is_conversation_member() true for the second insert, breaking the
    // circularity for the other person's row.
    const { error: selfMemberError } = await supabaseClient
        .from("conversation_members")
        .insert({ conversation_id: newConversationId, profile_id: myProfile.id, is_admin: true });

    if(selfMemberError){
        console.error("[messages] conversation membership (self) failed:", selfMemberError);
        throw new Error("Couldn't start a conversation: " + selfMemberError.message);
    }

    const { error: otherMemberError } = await supabaseClient
        .from("conversation_members")
        .insert({ conversation_id: newConversationId, profile_id: targetId, is_admin: false });

    if(otherMemberError){
        console.error("[messages] conversation membership (other) failed:", otherMemberError);
        throw new Error("Couldn't start a conversation: " + otherMemberError.message);
    }

    return newConversationId;
}

async function ensureConversation(){
    if(activeConversationId) return activeConversationId;
    activeConversationId = await ensureConversationWith(activeAccount.id);
    return activeConversationId;
}

// Clears the unread badge for a conversation once it's actually open - both
// on my own click-through and when a message arrives for the conversation
// I already have open. See messages_mark_read (migration) for why this
// broader UPDATE grant is safe (trigger-guarded to is_read only).
async function markConversationRead(conversationId){
    const { error } = await supabaseClient
        .from("messages")
        .update({ is_read: true })
        .eq("conversation_id", conversationId)
        .neq("sender_id", myProfile.id)
        .eq("is_read", false);

    if(error){
        console.error("[messages] mark read failed:", error);
        return;
    }

    const entry = conversationListCache.find(function(e){ return e.conversationId === conversationId; });
    if(entry) entry.unreadCount = 0;
}

/* ================= THREE-DOT MENU ACTIONS ================= */

// Every menu action is a network round-trip - this dims the list and
// blocks re-clicks for its duration, the same list that's about to be
// rebuilt by loadMyConversations() once the action resolves.
function setContactListBusy(isBusy){
    contactList.classList.toggle("busy", isBusy);
}

async function upsertConversationSetting(conversationId, patch){
    return supabaseClient
        .from("conversation_settings")
        .upsert(
            Object.assign({ conversation_id: conversationId, user_id: myProfile.id }, patch),
            { onConflict: "conversation_id,user_id" }
        );
}

async function menuMarkReadUnread(entry, markUnread){
    setContactListBusy(true);

    if(markUnread){
        const { error } = await upsertConversationSetting(entry.conversationId, { manually_marked_unread: true });
        setContactListBusy(false);
        if(error){
            console.error("[messages] mark unread failed:", error);
            lingkodToast("Couldn't mark this conversation as unread.", "error");
            return;
        }
        lingkodToast("Marked as unread.", "success");
    } else {
        await markConversationRead(entry.conversationId);
        const { error } = await upsertConversationSetting(entry.conversationId, { manually_marked_unread: false });
        setContactListBusy(false);
        if(error) console.error("[messages] clear manual-unread failed:", error);
        lingkodToast("Marked as read.", "success");
    }
    await loadMyConversations();
}

async function menuToggleMute(entry){
    const newMuted = !entry.isMuted;

    setContactListBusy(true);
    const { error } = await upsertConversationSetting(entry.conversationId, { is_muted: newMuted });
    setContactListBusy(false);

    if(error){
        console.error("[messages] mute toggle failed:", error);
        lingkodToast("Couldn't update notification settings.", "error");
        return;
    }
    lingkodToast(newMuted ? "Notifications muted for this conversation." : "Notifications unmuted.", "success");
    await loadMyConversations();
}

async function doArchiveConversation(entry, newArchived){
    // Belt-and-suspenders with the confirm modal's own button spinner (see
    // menuToggleArchive) - the un-confirmed restore path has no modal at
    // all, so this is the only loading indicator it gets.
    setContactListBusy(true);
    const { error } = await upsertConversationSetting(entry.conversationId, { is_archived: newArchived });
    setContactListBusy(false);

    if(error){
        console.error("[messages] archive toggle failed:", error);
        lingkodToast("Couldn't update this conversation.", "error");
        throw error;
    }
    lingkodToast(newArchived ? "Conversation archived successfully." : "Conversation restored.", "success");
    await loadMyConversations();
}

function menuToggleArchive(entry){
    const newArchived = !entry.isArchived;

    // Only archiving asks for confirmation - restoring a chat you already
    // archived is never destructive enough to need one.
    if(!newArchived){
        doArchiveConversation(entry, false);
        return;
    }

    lingkodConfirmAction({
        title: "Archive Chat?",
        message: "This conversation will be moved to your archived chats.",
        confirmLabel: "Archive",
        loadingLabel: "Archiving...",
        icon: "fa-box-archive",
        destructive: false,
        onConfirm: function(){ return doArchiveConversation(entry, true); }
    });
}

// Permanent, for both participants - not a per-user hide. Deletes the
// conversation/messages/membership rows via the hard_delete_conversation
// RPC (security definer - the base messaging tables' own RLS was never
// captured in this repo, so the RPC bypasses it and re-checks membership
// itself), then removes every attachment file the RPC reports from
// Storage. If either side starts a new conversation afterward, it's a
// genuinely new conversations row with no history - the old one no
// longer exists to find.
function menuDeleteChat(entry){
    lingkodConfirmDelete({
        title: "Delete Conversation?",
        message: "This will permanently delete this conversation for both you and the other person, including all messages and attachments. This action cannot be undone.",
        onConfirm: async function(){
            const { data: attachmentPaths, error } = await supabaseClient
                .rpc("hard_delete_conversation", { p_conversation_id: entry.conversationId });

            if(error){
                console.error("[messages] delete chat failed:", error);
                lingkodToast("Couldn't delete this conversation.", "error");
                throw error;
            }

            if(attachmentPaths && attachmentPaths.length > 0){
                const { error: storageError } = await supabaseClient
                    .storage
                    .from(MESSAGE_ATTACHMENTS_BUCKET)
                    .remove(attachmentPaths);
                if(storageError) console.error("[messages] attachment cleanup failed:", storageError);
            }

            if(activeConversationId === entry.conversationId){
                activeConversationId = null;
                activeAccount = null;
                renderChatEmpty("Select a conversation or search for someone to start chatting.");
            }

            lingkodToast("Conversation deleted successfully.", "success");
            await loadMyConversations();
        }
    });
}

async function unblockUser(entry){
    setContactListBusy(true);
    const { error } = await supabaseClient
        .from("user_blocks")
        .delete()
        .eq("blocker_id", myProfile.id)
        .eq("blocked_id", entry.otherProfile.id);
    setContactListBusy(false);

    if(error){
        console.error("[messages] unblock failed:", error);
        lingkodToast("Couldn't unblock this user.", "error");
        return;
    }
    lingkodToast(entry.otherProfile.full_name + " has been unblocked.", "success");

    await loadBlockedRelationships();
    if(activeAccount && activeAccount.id === entry.otherProfile.id) selectAccount(activeAccount);
    await loadMyConversations();
}

function menuToggleBlock(entry){
    if(iBlockedIds.has(entry.otherProfile.id)){
        unblockUser(entry);
        return;
    }

    lingkodConfirmDelete({
        title: "Block User?",
        message: "You will no longer be able to send or receive messages from this user until you unblock them.",
        confirmLabel: "Block",
        loadingLabel: "Blocking...",
        icon: "fa-ban",
        onConfirm: async function(){
            const { error } = await supabaseClient
                .from("user_blocks")
                .insert({ blocker_id: myProfile.id, blocked_id: entry.otherProfile.id });

            if(error){
                console.error("[messages] block failed:", error);
                lingkodToast("Couldn't block this user.", "error");
                throw error;
            }
            lingkodToast(entry.otherProfile.full_name + " has been blocked.", "success");

            await loadBlockedRelationships();
            if(activeAccount && activeAccount.id === entry.otherProfile.id) selectAccount(activeAccount);
            await loadMyConversations();
        }
    });
}

// Shared with directory/registered-users/reports' identical copies -
// see lingkodBuildProfileViewRow in js/common.js.
function buildProfileRow(label, value){
    return lingkodBuildProfileViewRow(label, value);
}

function renderProfileViewModal(profile, isVisible){
    const wrap = document.createElement("div");
    wrap.className = "profile-view";

    wrap.appendChild(lingkodBuildAvatarElement(profile, "profile-view-avatar"));

    const name = document.createElement("h3");
    name.className = "profile-view-name";
    name.textContent = profile.full_name;
    wrap.appendChild(name);

    const roleTag = document.createElement("p");
    roleTag.className = "profile-view-role";
    roleTag.textContent = roleLabel(profile.role);
    wrap.appendChild(roleTag);

    if(!isVisible){
        const note = document.createElement("p");
        note.className = "profile-view-private-note";
        note.textContent = "This user has limited who can see their full profile details.";
        wrap.appendChild(note);
    } else {
        const grid = document.createElement("div");
        grid.className = "profile-view-grid";
        grid.appendChild(buildProfileRow("Last Name", profile.last_name));
        grid.appendChild(buildProfileRow("First Name", profile.first_name));
        grid.appendChild(buildProfileRow("Middle Name", profile.middle_name));
        grid.appendChild(buildProfileRow("Username", profile.email ? profile.email.split("@")[0] : null));
        grid.appendChild(buildProfileRow("Student Number", profile.student_number));
        grid.appendChild(buildProfileRow("Department", profile.department));
        grid.appendChild(buildProfileRow("Organization", profile.organization));
        grid.appendChild(buildProfileRow("Position", profile.position));
        grid.appendChild(buildProfileRow("Email", profile.email));
        grid.appendChild(buildProfileRow("Account Status", profile.status ? profile.status.charAt(0).toUpperCase() + profile.status.slice(1) : null));
        wrap.appendChild(grid);
    }

    lingkodOpenModal("User Profile", wrap);
}

async function menuViewProfile(entry){
    const targetId = entry.otherProfile.id;

    setContactListBusy(true);
    const [profileRes, visibilityRes] = await Promise.all([
        supabaseClient
            .from("profiles")
            .select("full_name, last_name, first_name, middle_name, email, student_number, department, organization, position, role, status, avatar_url")
            .eq("id", targetId)
            .maybeSingle(),
        supabaseClient.rpc("profile_visibility_allowed", { target_id: targetId })
    ]);
    setContactListBusy(false);

    if(profileRes.error || !profileRes.data){
        console.error("[messages] profile view load failed:", profileRes.error);
        lingkodToast("Couldn't load this user's profile.", "error");
        return;
    }

    const isVisible = visibilityRes.error ? true : visibilityRes.data !== false;
    renderProfileViewModal(profileRes.data, isVisible);
}

function menuReportUser(entry){
    const wrap = document.createElement("div");
    wrap.className = "edit-profile-form";

    const reasonSelect = document.createElement("select");
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select a reason";
    placeholder.disabled = true;
    placeholder.selected = true;
    reasonSelect.appendChild(placeholder);
    REPORT_REASONS.forEach(function(reason){
        const opt = document.createElement("option");
        opt.value = reason;
        opt.textContent = reason;
        reasonSelect.appendChild(opt);
    });
    wrap.appendChild(lingkodBuildFormField("Reason", reasonSelect, "reportReasonError"));

    const description = document.createElement("textarea");
    description.rows = 4;
    description.placeholder = "Please describe the issue...";
    const descriptionField = lingkodBuildFormField("Details", description);
    descriptionField.hidden = true;
    wrap.appendChild(descriptionField);

    reasonSelect.addEventListener("change", function(){
        descriptionField.hidden = reasonSelect.value !== "Other";
        if(descriptionField.hidden) description.value = "";
    });

    const actions = document.createElement("div");
    actions.className = "modal-form-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn-secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", function(){ lingkodCloseModal(); });

    const submitBtn = document.createElement("button");
    submitBtn.type = "button";
    submitBtn.textContent = "Submit Report";

    actions.appendChild(cancelBtn);
    actions.appendChild(submitBtn);
    wrap.appendChild(actions);

    submitBtn.addEventListener("click", async function(){
        if(!reasonSelect.value){
            lingkodToast("Please choose a reason for this report.", "error");
            return;
        }

        lingkodSetButtonLoading(submitBtn, true, "Submitting...");
        cancelBtn.disabled = true;

        const { error } = await supabaseClient
            .from("message_reports")
            .insert({
                reporter_id: myProfile.id,
                reported_user_id: entry.otherProfile.id,
                conversation_id: entry.conversationId,
                reason: reasonSelect.value,
                description: description.value.trim() || null
            });

        lingkodSetButtonLoading(submitBtn, false);
        cancelBtn.disabled = false;

        if(error){
            console.error("[messages] report failed:", error);
            lingkodToast("Couldn't submit your report: " + error.message, "error");
            return;
        }

        lingkodCloseModal();
        lingkodToast("Report submitted successfully. Thank you for helping keep the platform safe.", "success");
    });

    lingkodOpenModal("Report User", wrap);
}

/* ================= CHAT TRANSCRIPT ================= */

/* ================= IMAGE LIGHTBOX (zoom + prev/next) =================
   Its own overlay - lingkodOpenSimpleFilePreview (shared across every
   module) is a single-file viewer with no zoom/navigation concept, so
   image attachments specifically get a richer viewer instead. Cycles
   through every image currently rendered in this chat transcript, not
   just ones attached to the same message - each attachment is its own
   message row (see doSend's "one attachment per message" comment), so
   "multiple images attached" shows up as consecutive image bubbles, and
   that's the natural set to page through together. */

let currentChatImageRows = [];
let lightboxOverlay = null;
let lightboxImg = null;
let lightboxIndex = 0;
let lightboxZoom = 1;

function ensureLightbox(){
    if(lightboxOverlay) return;

    lightboxOverlay = document.createElement("div");
    lightboxOverlay.className = "image-lightbox-overlay";

    const card = document.createElement("div");
    card.className = "image-lightbox-card";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "image-lightbox-close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.innerHTML = "<i class=\"fa-solid fa-xmark\"></i>";
    closeBtn.addEventListener("click", closeLightbox);
    card.appendChild(closeBtn);

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "image-lightbox-nav image-lightbox-prev";
    prevBtn.innerHTML = "<i class=\"fa-solid fa-chevron-left\"></i>";
    prevBtn.addEventListener("click", function(){ showLightboxImage(lightboxIndex - 1); });
    card.appendChild(prevBtn);

    const imgWrap = document.createElement("div");
    imgWrap.className = "image-lightbox-img-wrap";
    lightboxImg = document.createElement("img");
    lightboxImg.className = "image-lightbox-img";
    imgWrap.appendChild(lightboxImg);
    card.appendChild(imgWrap);

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "image-lightbox-nav image-lightbox-next";
    nextBtn.innerHTML = "<i class=\"fa-solid fa-chevron-right\"></i>";
    nextBtn.addEventListener("click", function(){ showLightboxImage(lightboxIndex + 1); });
    card.appendChild(nextBtn);

    const controls = document.createElement("div");
    controls.className = "image-lightbox-controls";

    const zoomOutBtn = document.createElement("button");
    zoomOutBtn.type = "button";
    zoomOutBtn.innerHTML = "<i class=\"fa-solid fa-magnifying-glass-minus\"></i>";
    zoomOutBtn.addEventListener("click", function(){ setLightboxZoom(lightboxZoom - 0.25); });
    controls.appendChild(zoomOutBtn);

    const zoomInBtn = document.createElement("button");
    zoomInBtn.type = "button";
    zoomInBtn.innerHTML = "<i class=\"fa-solid fa-magnifying-glass-plus\"></i>";
    zoomInBtn.addEventListener("click", function(){ setLightboxZoom(lightboxZoom + 0.25); });
    controls.appendChild(zoomInBtn);

    const downloadBtn = document.createElement("button");
    downloadBtn.type = "button";
    downloadBtn.innerHTML = "<i class=\"fa-solid fa-download\"></i> Download";
    downloadBtn.addEventListener("click", function(){
        const row = currentChatImageRows[lightboxIndex];
        if(row) lingkodDownloadFile(row, downloadBtn);
    });
    controls.appendChild(downloadBtn);

    card.appendChild(controls);
    lightboxOverlay.appendChild(card);
    document.body.appendChild(lightboxOverlay);

    lightboxOverlay.addEventListener("click", function(e){
        if(e.target === lightboxOverlay) closeLightbox();
    });
    imgWrap.addEventListener("wheel", function(e){
        e.preventDefault();
        setLightboxZoom(lightboxZoom + (e.deltaY < 0 ? 0.15 : -0.15));
    }, { passive: false });
    lightboxImg.addEventListener("dblclick", function(){
        setLightboxZoom(lightboxZoom > 1 ? 1 : 2);
    });

    document.addEventListener("keydown", function(e){
        if(!lightboxOverlay.classList.contains("open")) return;
        if(e.key === "Escape") closeLightbox();
        if(e.key === "ArrowLeft") showLightboxImage(lightboxIndex - 1);
        if(e.key === "ArrowRight") showLightboxImage(lightboxIndex + 1);
    });
}

function setLightboxZoom(value){
    lightboxZoom = Math.min(4, Math.max(1, value));
    lightboxImg.style.transform = "scale(" + lightboxZoom + ")";
}

function showLightboxImage(index){
    if(index < 0 || index >= currentChatImageRows.length) return;
    lightboxIndex = index;
    setLightboxZoom(1);
    lightboxImg.src = "";
    lingkodGetSignedFileUrl(currentChatImageRows[index], false).then(function(url){
        if(url && lightboxIndex === index) lightboxImg.src = url;
    });

    const prevBtn = lightboxOverlay.querySelector(".image-lightbox-prev");
    const nextBtn = lightboxOverlay.querySelector(".image-lightbox-next");
    prevBtn.disabled = index <= 0;
    nextBtn.disabled = index >= currentChatImageRows.length - 1;
}

function closeLightbox(){
    if(!lightboxOverlay) return;
    lightboxOverlay.classList.remove("open");
    document.body.style.overflow = "";
}

function openImageLightbox(index){
    ensureLightbox();
    lightboxOverlay.style.display = "flex";
    document.body.style.overflow = "hidden";
    requestAnimationFrame(function(){
        requestAnimationFrame(function(){ lightboxOverlay.classList.add("open"); });
    });
    showLightboxImage(index);
}

// row matches the file_name/file_path/file_type/file_size/storage_bucket
// shape every other module already uses (submissions, repository) - so
// this reuses that shared preview/download/signed-URL infrastructure from
// js/common.js unmodified rather than building a second one just for chat.
function buildMessageAttachment(row){
    if(!row.file_path) return null;

    const kind = lingkodGuessFilePreviewKind(row);
    const wrap = document.createElement("div");
    wrap.className = "message-attachment";

    if(kind === "image"){
        const imageIndex = currentChatImageRows.length;
        currentChatImageRows.push(row);

        const img = document.createElement("img");
        img.className = "message-attachment-image";
        img.alt = row.file_name || "Attachment";
        img.addEventListener("click", function(){ openImageLightbox(imageIndex); });
        wrap.appendChild(img);
        lingkodGetSignedFileUrl(row, false).then(function(url){ if(url) img.src = url; });
        return wrap;
    }

    if(kind === "video"){
        const video = document.createElement("video");
        video.className = "message-attachment-video";
        video.controls = true;
        wrap.appendChild(video);
        lingkodGetSignedFileUrl(row, false).then(function(url){ if(url) video.src = url; });
        return wrap;
    }

    const card = document.createElement("div");
    card.className = "message-attachment-file";

    const icon = document.createElement("i");
    icon.className = lingkodFileIconClass(row);
    card.appendChild(icon);

    const meta = document.createElement("div");
    meta.className = "file-meta";
    const nameLine = document.createElement("span");
    nameLine.textContent = row.file_name || "Attachment";
    meta.appendChild(nameLine);
    if(row.file_size !== null && row.file_size !== undefined){
        const sizeLine = document.createElement("span");
        sizeLine.textContent = lingkodFormatFileSize(row.file_size);
        meta.appendChild(sizeLine);
    }
    card.appendChild(meta);

    // Only PDFs get an inline Preview - matches every other file kind's
    // "icon + name + Download" treatment elsewhere in the app.
    if(kind === "pdf"){
        const previewBtn = document.createElement("button");
        previewBtn.type = "button";
        previewBtn.textContent = "Preview";
        previewBtn.addEventListener("click", function(){ lingkodOpenSimpleFilePreview(row); });
        card.appendChild(previewBtn);
    }

    const downloadBtn = document.createElement("button");
    downloadBtn.type = "button";
    downloadBtn.textContent = "Download";
    downloadBtn.addEventListener("click", function(){ lingkodDownloadFile(row, downloadBtn); });
    card.appendChild(downloadBtn);

    wrap.appendChild(card);
    return wrap;
}

/* ================= REACTIONS ================= */

function buildReactionSummary(messageId){
    const reactions = messageReactionsByMessageId[messageId] || [];
    if(reactions.length === 0) return null;

    const userIdsByReaction = {};
    reactions.forEach(function(r){
        if(!userIdsByReaction[r.reaction]) userIdsByReaction[r.reaction] = [];
        userIdsByReaction[r.reaction].push(r.user_id);
    });

    const row = document.createElement("div");
    row.className = "message-reactions";

    Object.keys(userIdsByReaction).forEach(function(key){
        const meta = MESSAGE_REACTIONS_BY_KEY[key];
        if(!meta) return;
        const userIds = userIdsByReaction[key];

        const pill = document.createElement("span");
        pill.className = "message-reaction-pill" + (userIds.indexOf(myProfile.id) !== -1 ? " mine" : "");
        pill.textContent = meta.emoji + " " + userIds.length;

        const names = userIds.map(function(id){
            if(id === myProfile.id) return "You";
            const p = messageReactorProfilesById[id];
            return p ? p.full_name : "Someone";
        });
        pill.title = meta.label + ": " + names.join(", ");

        pill.addEventListener("click", function(e){
            e.stopPropagation();
            toggleReaction(messageId, key);
        });
        row.appendChild(pill);
    });

    return row;
}

async function toggleReaction(messageId, reactionKey){
    const mine = (messageReactionsByMessageId[messageId] || []).find(function(r){ return r.user_id === myProfile.id; });

    let error;
    if(mine && mine.reaction === reactionKey){
        // Same reaction clicked again - remove it.
        ({ error } = await supabaseClient
            .from("message_reactions")
            .delete()
            .eq("message_id", messageId)
            .eq("user_id", myProfile.id));
    } else {
        // No reaction yet, or a different one - upsert replaces it (the PK
        // is (message_id, user_id), so there's never more than one row).
        ({ error } = await supabaseClient
            .from("message_reactions")
            .upsert(
                { message_id: messageId, user_id: myProfile.id, reaction: reactionKey },
                { onConflict: "message_id,user_id" }
            ));
    }

    if(error){
        console.error("[messages] reaction failed:", error);
        lingkodToast("Couldn't update your reaction.", "error");
        return;
    }

    await loadMessages(activeConversationId);
}

function closeReactionPicker(){
    const existing = document.getElementById("reactionPicker");
    if(existing) existing.remove();
    if(openReactionPickerAnchor){
        openReactionPickerAnchor.classList.remove("active");
        openReactionPickerAnchor = null;
    }
}

function openReactionPicker(anchorEl, messageId){
    const alreadyOpenForThis = openReactionPickerAnchor === anchorEl;
    closeReactionPicker();
    if(alreadyOpenForThis) return;

    const picker = document.createElement("div");
    picker.id = "reactionPicker";
    picker.className = "reaction-picker";

    MESSAGE_REACTIONS.forEach(function(r){
        const btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute("aria-label", r.label);
        btn.title = r.label;
        btn.textContent = r.emoji;
        btn.addEventListener("click", function(e){
            e.stopPropagation();
            closeReactionPicker();
            toggleReaction(messageId, r.key);
        });
        picker.appendChild(btn);
    });

    document.body.appendChild(picker);

    const anchorRect = anchorEl.getBoundingClientRect();
    const pickerRect = picker.getBoundingClientRect();
    let left = anchorRect.left + anchorRect.width / 2 - pickerRect.width / 2;
    left = Math.min(Math.max(8, left), window.innerWidth - pickerRect.width - 8);
    let top = anchorRect.top - pickerRect.height - 8;
    if(top < 8) top = anchorRect.bottom + 8;

    picker.style.left = left + "px";
    picker.style.top = top + "px";

    requestAnimationFrame(function(){ picker.classList.add("open"); });

    anchorEl.classList.add("active");
    openReactionPickerAnchor = anchorEl;

    document.addEventListener("click", handleReactionPickerDocClick, true);
}

function handleReactionPickerDocClick(e){
    const picker = document.getElementById("reactionPicker");
    if(picker && !picker.contains(e.target)){
        closeReactionPicker();
        document.removeEventListener("click", handleReactionPickerDocClick, true);
    }
}

/* ================= PINNED MESSAGES ================= */

function messagePreviewText(msg){
    if(msg.removed_for_everyone) return "Message removed";
    if(msg.content) return msg.content;
    if(msg.file_name) return "📎 " + msg.file_name;
    return "Attachment";
}

function renderPinnedBar(){
    const bar = document.getElementById("pinnedMessagesBar");
    if(!bar) return;

    bar.innerHTML = "";

    pinnedMessagesOrdered
        .filter(function(p){ return !removedForMeMessageIds.has(p.message_id); })
        .forEach(function(pin){
            const msg = messageRowsCache.find(function(m){ return m.id === pin.message_id; });
            if(!msg) return;

            const item = document.createElement("div");
            item.className = "pinned-message-item";

            const icon = document.createElement("i");
            icon.className = "fa-solid fa-thumbtack";
            item.appendChild(icon);

            const text = document.createElement("span");
            text.className = "pinned-message-text";
            text.textContent = messagePreviewText(msg);
            item.appendChild(text);

            const unpinBtn = document.createElement("button");
            unpinBtn.type = "button";
            unpinBtn.className = "pinned-message-unpin";
            unpinBtn.setAttribute("aria-label", "Unpin message");
            unpinBtn.innerHTML = "<i class=\"fa-solid fa-xmark\"></i>";
            unpinBtn.addEventListener("click", function(e){
                e.stopPropagation();
                togglePinMessage(msg, false);
            });
            item.appendChild(unpinBtn);

            item.addEventListener("click", function(){ scrollToMessage(msg.id); });

            bar.appendChild(item);
        });
}

function scrollToMessage(messageId){
    const row = document.querySelector('.message-row[data-message-id="' + messageId + '"]');
    if(!row) return;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.add("highlight");
    setTimeout(function(){ row.classList.remove("highlight"); }, 1600);
}

async function togglePinMessage(msg, pin){
    let error;
    if(pin){
        ({ error } = await supabaseClient
            .from("pinned_messages")
            .insert({ message_id: msg.id, conversation_id: activeConversationId, pinned_by: myProfile.id }));
    } else {
        ({ error } = await supabaseClient
            .from("pinned_messages")
            .delete()
            .eq("message_id", msg.id));
    }

    if(error){
        console.error("[messages] pin toggle failed:", error);
        lingkodToast("Couldn't update pinned messages.", "error");
        return;
    }

    lingkodToast(pin ? "Message pinned." : "Message unpinned.", "success");
    await loadMessages(activeConversationId);
}

/* ================= REMOVE MESSAGE ================= */

async function removeMessageForMe(msg){
    // ignoreDuplicates: true turns this into INSERT ... ON CONFLICT DO
    // NOTHING instead of DO UPDATE - message_removals only has INSERT/
    // SELECT RLS policies (no UPDATE policy, since there's nothing to
    // update - removed_at never changes once set), so a plain upsert
    // would work the first time a message is removed but fail on any
    // repeat attempt, which needs UPDATE permission it doesn't have.
    // DO NOTHING sidesteps that entirely - removing an already-removed
    // message for yourself is a no-op either way.
    const { error } = await supabaseClient
        .from("message_removals")
        .upsert(
            { message_id: msg.id, user_id: myProfile.id },
            { onConflict: "message_id,user_id", ignoreDuplicates: true }
        );

    if(error){
        console.error("[messages] remove-for-me failed:", error);
        lingkodToast("Couldn't remove this message.", "error");
        throw error;
    }

    lingkodToast("Message removed for you.", "success");
    await loadMessages(activeConversationId);
}

async function removeMessageForEveryone(msg){
    // Attachments are deleted from Storage (not just unlinked) so a
    // previously-signed URL someone had cached stops working too, not
    // just future requests through this app - "no longer accessible"
    // means the object itself is gone, not merely unreferenced.
    if(msg.file_path){
        try {
            await supabaseClient.storage.from(msg.storage_bucket || MESSAGE_ATTACHMENTS_BUCKET).remove([msg.file_path]);
        } catch(err){
            console.error("[messages] attachment cleanup on removal failed:", err);
        }
    }

    const { error } = await supabaseClient
        .from("messages")
        .update({
            removed_for_everyone: true,
            removed_by: myProfile.id,
            removed_at: new Date().toISOString(),
            content: null,
            file_name: null,
            file_path: null,
            file_type: null,
            file_size: null,
            storage_bucket: null
        })
        .eq("id", msg.id);

    if(error){
        console.error("[messages] remove-for-everyone failed:", error);
        lingkodToast("Couldn't remove this message.", "error");
        throw error;
    }

    lingkodToast("Message removed for everyone.", "success");
    await loadMessages(activeConversationId);
}

function openRemoveMessageModal(msg){
    const wrap = document.createElement("div");
    wrap.className = "confirm-modal";

    const icon = document.createElement("div");
    icon.className = "confirm-modal-icon";
    icon.innerHTML = "<i class=\"fa-solid fa-trash\"></i>";
    wrap.appendChild(icon);

    const message = document.createElement("p");
    message.className = "confirm-modal-message";
    message.textContent = "Choose how you'd like to remove this message.";
    wrap.appendChild(message);

    const actions = document.createElement("div");
    actions.className = "confirm-modal-actions confirm-modal-actions-stacked";

    const removeMeBtn = document.createElement("button");
    removeMeBtn.type = "button";
    removeMeBtn.className = "btn-secondary";
    removeMeBtn.textContent = "Remove for Me";
    removeMeBtn.addEventListener("click", async function(){
        lingkodSetButtonLoading(removeMeBtn, true, "Removing...");
        try {
            await removeMessageForMe(msg);
            lingkodCloseModal();
        } catch(err){
            lingkodSetButtonLoading(removeMeBtn, false);
        }
    });

    const removeEveryoneBtn = document.createElement("button");
    removeEveryoneBtn.type = "button";
    removeEveryoneBtn.className = "btn-danger";
    removeEveryoneBtn.textContent = "Remove for Everyone";
    removeEveryoneBtn.addEventListener("click", async function(){
        lingkodSetButtonLoading(removeEveryoneBtn, true, "Removing...");
        try {
            await removeMessageForEveryone(msg);
            lingkodCloseModal();
        } catch(err){
            lingkodSetButtonLoading(removeEveryoneBtn, false);
        }
    });

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn-secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", lingkodCloseModal);

    actions.appendChild(removeMeBtn);
    actions.appendChild(removeEveryoneBtn);
    actions.appendChild(cancelBtn);
    wrap.appendChild(actions);

    lingkodOpenModal("Remove Message?", wrap, "modal-confirm");
}

/* ================= REPORT MESSAGE ================= */

function openReportMessageModal(msg){
    const wrap = document.createElement("div");
    wrap.className = "edit-profile-form";

    const reasonSelect = document.createElement("select");
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select a reason";
    placeholder.disabled = true;
    placeholder.selected = true;
    reasonSelect.appendChild(placeholder);
    MESSAGE_REPORT_REASONS.forEach(function(reason){
        const opt = document.createElement("option");
        opt.value = reason;
        opt.textContent = reason;
        reasonSelect.appendChild(opt);
    });
    wrap.appendChild(lingkodBuildFormField("Reason", reasonSelect, "messageReportReasonError"));

    const description = document.createElement("textarea");
    description.rows = 4;
    description.placeholder = "Please describe the issue...";
    const descriptionField = lingkodBuildFormField("Details", description);
    descriptionField.hidden = true;
    wrap.appendChild(descriptionField);

    reasonSelect.addEventListener("change", function(){
        descriptionField.hidden = reasonSelect.value !== "Other";
        if(descriptionField.hidden) description.value = "";
    });

    const actions = document.createElement("div");
    actions.className = "modal-form-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn-secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", function(){ lingkodCloseModal(); });

    const submitBtn = document.createElement("button");
    submitBtn.type = "button";
    submitBtn.textContent = "Submit Report";

    actions.appendChild(cancelBtn);
    actions.appendChild(submitBtn);
    wrap.appendChild(actions);

    submitBtn.addEventListener("click", async function(){
        if(!reasonSelect.value){
            lingkodToast("Please choose a reason for this report.", "error");
            return;
        }

        lingkodSetButtonLoading(submitBtn, true, "Submitting...");
        cancelBtn.disabled = true;

        const { error } = await supabaseClient
            .from("message_reports")
            .insert({
                reporter_id: myProfile.id,
                reported_user_id: msg.sender_id,
                conversation_id: activeConversationId,
                message_id: msg.id,
                reason: reasonSelect.value,
                description: description.value.trim() || null
            });

        lingkodSetButtonLoading(submitBtn, false);
        cancelBtn.disabled = false;

        if(error){
            console.error("[messages] message report failed:", error);
            lingkodToast("Couldn't submit your report: " + error.message, "error");
            return;
        }

        lingkodCloseModal();
        lingkodToast("Report submitted successfully.", "success");
    });

    lingkodOpenModal("Report Message", wrap);
}

/* ================= FORWARD MESSAGE ================= */

async function fetchForwardTabAccounts(tab, query){
    if(tab === "search"){
        if(!query.trim()) return [];
        const safeQuery = query.trim().replace(/[,()]/g, "");
        const orFilter = ["full_name", "email", "student_number"]
            .map(function(column){ return column + ".ilike.%" + safeQuery + "%"; })
            .join(",");
        const { data, error } = await supabaseClient
            .from("profiles")
            .select("id, full_name, role, organization, avatar_url")
            .neq("id", myProfile.id)
            .or(orFilter)
            .order("full_name")
            .limit(20);
        return error ? [] : data;
    }

    if(tab === "recent"){
        return conversationListCache.map(function(e){ return e.otherProfile; });
    }

    if(tab === "org"){
        if(!myProfile.organization) return [];
        const { data, error } = await supabaseClient
            .from("profiles")
            .select("id, full_name, role, organization, avatar_url")
            .eq("organization", myProfile.organization)
            .neq("id", myProfile.id)
            .order("full_name")
            .limit(50);
        return error ? [] : data;
    }

    if(tab === "osoa"){
        const { data, error } = await supabaseClient
            .from("profiles")
            .select("id, full_name, role, organization, avatar_url")
            .eq("role", "osoa_eb")
            .neq("id", myProfile.id)
            .order("full_name")
            .limit(50);
        return error ? [] : data;
    }

    return [];
}

function buildForwardModalItem(account, selectedIds, onToggle){
    const item = document.createElement("div");
    const isSelected = selectedIds.has(account.id);
    item.className = "forward-modal-item" + (isSelected ? " selected" : "");

    item.appendChild(lingkodBuildAvatarElement(account, "avatar"));

    const name = document.createElement("span");
    name.className = "forward-modal-item-name";
    name.textContent = account.full_name;
    item.appendChild(name);

    const check = document.createElement("span");
    check.className = "forward-modal-item-check";
    if(isSelected) check.innerHTML = "<i class=\"fa-solid fa-check\"></i>";
    item.appendChild(check);

    item.addEventListener("click", function(){
        if(selectedIds.has(account.id)){
            selectedIds.delete(account.id);
            item.classList.remove("selected");
            check.innerHTML = "";
        } else {
            selectedIds.add(account.id);
            item.classList.add("selected");
            check.innerHTML = "<i class=\"fa-solid fa-check\"></i>";
        }
        onToggle();
    });

    return item;
}

// Copies the attachment into the destination conversation's own Storage
// folder rather than pointing the new row at the original file - the
// original conversation's folder-scoped read policy would otherwise make
// a forwarded attachment unreadable by anyone in the destination
// conversation who wasn't already a member of the source one. Fetches
// the current bytes via the same signed-URL path the chat transcript
// itself already uses to display it, then re-uploads with the composer's
// own upload helper.
async function forwardMessageTo(msg, targetId){
    const targetConversationId = await ensureConversationWith(targetId);

    const patch = {
        conversation_id: targetConversationId,
        sender_id: myProfile.id,
        content: msg.content || null,
        forwarded_from_message_id: msg.id
    };

    if(msg.file_path){
        const signedUrl = await lingkodGetSignedFileUrl(msg, false);
        if(!signedUrl) throw new Error("Couldn't access the original attachment.");

        const blob = await fetch(signedUrl).then(function(r){ return r.blob(); });
        const newPath = targetConversationId + "/" + crypto.randomUUID() + "-" + sanitizeFileNameForPath(msg.file_name || "file");

        const upload = lingkodUploadFileWithProgress(MESSAGE_ATTACHMENTS_BUCKET, newPath, blob, function(){});
        await upload.promise;

        patch.file_name = msg.file_name;
        patch.file_path = newPath;
        patch.file_type = msg.file_type;
        patch.file_size = msg.file_size;
        patch.storage_bucket = MESSAGE_ATTACHMENTS_BUCKET;
    }

    const { error } = await supabaseClient.from("messages").insert(patch);
    if(error) throw error;

    if(targetConversationId === activeConversationId){
        await loadMessages(activeConversationId);
    }
}

function openForwardModal(msg){
    const wrap = document.createElement("div");
    wrap.className = "forward-modal";

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search people...";
    wrap.appendChild(searchInput);

    const tabsRow = document.createElement("div");
    tabsRow.className = "forward-modal-tabs";
    const tabs = [
        { key: "recent", label: "Recent Conversations" },
        { key: "org", label: "Organization Members" },
        { key: "osoa", label: "OSOA EB" }
    ];
    const tabButtons = {};
    let activeTab = "recent";

    const list = document.createElement("div");
    list.className = "forward-modal-list";

    const footer = document.createElement("div");
    footer.className = "forward-modal-footer";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn-secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", lingkodCloseModal);

    const forwardBtn = document.createElement("button");
    forwardBtn.type = "button";
    forwardBtn.textContent = "Forward";
    forwardBtn.disabled = true;

    const selectedIds = new Set();
    const accountsById = {};

    function updateForwardButton(){
        forwardBtn.disabled = selectedIds.size === 0;
        forwardBtn.textContent = selectedIds.size > 1 ? "Forward (" + selectedIds.size + ")" : "Forward";
    }

    async function renderList(){
        const query = searchInput.value.trim();
        const tab = query ? "search" : activeTab;
        list.innerHTML = "<p class=\"forward-modal-empty\">Loading...</p>";

        const accounts = await fetchForwardTabAccounts(tab, query);

        list.innerHTML = "";
        if(accounts.length === 0){
            const empty = document.createElement("p");
            empty.className = "forward-modal-empty";
            empty.textContent = "No one found.";
            list.appendChild(empty);
            return;
        }

        accounts.forEach(function(account){
            accountsById[account.id] = account;
            list.appendChild(buildForwardModalItem(account, selectedIds, updateForwardButton));
        });
    }

    function setActiveTab(tab){
        activeTab = tab;
        searchInput.value = "";
        Object.keys(tabButtons).forEach(function(key){
            tabButtons[key].classList.toggle("active", key === tab);
        });
        renderList();
    }

    tabs.forEach(function(t){
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = t.label;
        btn.addEventListener("click", function(){ setActiveTab(t.key); });
        tabButtons[t.key] = btn;
        tabsRow.appendChild(btn);
    });
    wrap.appendChild(tabsRow);
    wrap.appendChild(list);

    searchInput.addEventListener("input", function(){
        Object.keys(tabButtons).forEach(function(key){ tabButtons[key].classList.remove("active"); });
        renderList();
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(forwardBtn);
    wrap.appendChild(footer);

    forwardBtn.addEventListener("click", async function(){
        lingkodSetButtonLoading(forwardBtn, true, "Forwarding...");
        cancelBtn.disabled = true;

        try {
            const targets = Array.from(selectedIds).map(function(id){ return accountsById[id]; }).filter(Boolean);
            for(const target of targets){
                await forwardMessageTo(msg, target.id);
            }
            await loadMyConversations();
            lingkodCloseModal();
            lingkodToast("Message forwarded successfully.", "success");
        } catch(err){
            console.error("[messages] forward failed:", err);
            lingkodToast("Couldn't forward this message: " + err.message, "error");
        } finally {
            lingkodSetButtonLoading(forwardBtn, false);
            cancelBtn.disabled = false;
        }
    });

    setActiveTab("recent");

    lingkodOpenModal("Forward Message", wrap);
}

/* ================= PER-MESSAGE THREE-DOT MENU ================= */
// Delegates to the shared js/common.js card-menu, same as the
// conversation-options menu above.

function closeMessageMenu(){
    lingkodCloseCardMenu();
}

function openMessageMenu(anchorEl, msg){
    const isMine = msg.sender_id === myProfile.id;
    const isPinned = pinnedMessageIds.has(msg.id);

    const items = [];
    if(isMine){
        items.push({ label: "Remove", icon: "fa-trash", onClick: function(){ openRemoveMessageModal(msg); }, destructive: true });
    }
    items.push({ label: "Forward", icon: "fa-share", onClick: function(){ openForwardModal(msg); } });
    items.push({
        label: isPinned ? "Unpin Message" : "Pin Message",
        icon: "fa-thumbtack",
        onClick: function(){ togglePinMessage(msg, !isPinned); }
    });
    items.push({ label: "Report", icon: "fa-flag", onClick: function(){ openReportMessageModal(msg); }, destructive: true });

    lingkodOpenCardMenu(anchorEl, items);
}

/* ================= MESSAGE ROW RENDERING ================= */

function buildMessageBubble(msg){
    const isMine = msg.sender_id === myProfile.id;
    const bubble = document.createElement("div");
    bubble.className = "message " + (isMine ? "sent" : "received") + (msg.removed_for_everyone ? " removed" : "");

    if(msg.removed_for_everyone){
        const removedText = document.createElement("span");
        removedText.textContent = msg.removed_by === myProfile.id ? "You removed a message." : "This message was removed.";
        bubble.appendChild(removedText);
    } else {
        if(msg.forwarded_from_message_id){
            const label = document.createElement("div");
            label.className = "message-forwarded-label";
            label.innerHTML = "<i class=\"fa-solid fa-share\"></i> Forwarded";
            bubble.appendChild(label);
        }

        const attachmentEl = buildMessageAttachment(msg);
        if(attachmentEl) bubble.appendChild(attachmentEl);

        if(msg.content){
            bubble.appendChild(document.createTextNode(msg.content));
        }

        const reactionsEl = buildReactionSummary(msg.id);
        if(reactionsEl) bubble.appendChild(reactionsEl);
    }

    const meta = document.createElement("div");
    meta.className = "message-meta";
    const time = document.createElement("span");
    time.textContent = formatTime(msg.created_at);
    meta.appendChild(time);

    if(isMine && !msg.removed_for_everyone){
        const check = document.createElement("i");
        check.className = "fa-solid " + (msg.is_read ? "fa-check-double read" : "fa-check");
        meta.appendChild(check);
    }

    bubble.appendChild(meta);
    return bubble;
}

function buildMessageHoverActions(msg){
    const wrap = document.createElement("div");
    wrap.className = "message-hover-actions";

    if(msg.removed_for_everyone) return wrap;

    const reactBtn = document.createElement("button");
    reactBtn.type = "button";
    reactBtn.setAttribute("aria-label", "React");
    reactBtn.innerHTML = "<i class=\"fa-regular fa-face-smile\"></i>";
    reactBtn.addEventListener("click", function(e){
        e.stopPropagation();
        openReactionPicker(reactBtn, msg.id);
    });
    wrap.appendChild(reactBtn);

    const forwardBtn = document.createElement("button");
    forwardBtn.type = "button";
    forwardBtn.setAttribute("aria-label", "Forward");
    forwardBtn.innerHTML = "<i class=\"fa-solid fa-share\"></i>";
    forwardBtn.addEventListener("click", function(e){
        e.stopPropagation();
        openForwardModal(msg);
    });
    wrap.appendChild(forwardBtn);

    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.setAttribute("aria-label", "More options");
    moreBtn.innerHTML = "<i class=\"fa-solid fa-ellipsis\"></i>";
    moreBtn.addEventListener("click", function(e){
        e.stopPropagation();
        openMessageMenu(moreBtn, msg);
    });
    wrap.appendChild(moreBtn);

    return wrap;
}

// Long-press (mobile, no hover) toggles the same reveal class a desktop
// :hover would - one finger-down timer per row, cancelled by move/end
// before it fires so a normal tap/scroll never triggers it.
function wireLongPress(rowEl){
    let timer = null;
    rowEl.addEventListener("touchstart", function(){
        timer = setTimeout(function(){ rowEl.classList.add("show-actions"); }, 450);
    }, { passive: true });
    ["touchend", "touchmove", "touchcancel"].forEach(function(evt){
        rowEl.addEventListener(evt, function(){ clearTimeout(timer); });
    });
}

function renderMessages(rows){
    const chatBody = document.getElementById("chatBody");
    if(!chatBody) return;

    chatBody.innerHTML = "";
    currentChatImageRows = [];

    if(rows.length === 0){
        const empty = document.createElement("p");
        empty.style.textAlign = "center";
        empty.style.color = "var(--color-text-muted)";
        empty.style.fontSize = "13px";
        empty.textContent = "No messages yet - say hello!";
        chatBody.appendChild(empty);
        return;
    }

    let lastDateLabel = null;

    rows.forEach(function(msg){
        const dateLabel = formatDateLabel(msg.created_at);
        if(dateLabel !== lastDateLabel){
            const sep = document.createElement("div");
            sep.className = "date-separator";
            sep.textContent = dateLabel;
            chatBody.appendChild(sep);
            lastDateLabel = dateLabel;
        }

        const isMine = msg.sender_id === myProfile.id;
        const row = document.createElement("div");
        row.className = "message-row " + (isMine ? "sent" : "received");
        row.dataset.messageId = msg.id;
        wireLongPress(row);

        const bubble = buildMessageBubble(msg);
        const hoverActions = buildMessageHoverActions(msg);

        if(isMine){
            row.appendChild(hoverActions);
            row.appendChild(bubble);
        } else {
            row.appendChild(bubble);
            row.appendChild(hoverActions);
        }

        chatBody.appendChild(row);
    });

    chatBody.scrollTo({ top: chatBody.scrollHeight, behavior: "smooth" });
}

const MESSAGES_BASE_COLUMNS = "id, sender_id, content, created_at, is_read, removed_for_everyone, removed_by, removed_at, forwarded_from_message_id";
const MESSAGES_ATTACHMENT_COLUMNS = "file_name, file_path, file_type, file_size, storage_bucket";
// Flips to false the first time the attachment columns turn out not to
// exist (the messaging-attachments migration hasn't been run on this
// project yet) - every subsequent load then skips straight to the safe
// query instead of re-discovering the same failure every time.
let messagesSupportAttachmentColumns = true;

async function loadMessageExtras(conversationId, messageIds){
    if(messageIds.length === 0){
        messageReactionsByMessageId = {};
        messageReactorProfilesById = {};
        removedForMeMessageIds = new Set();
        pinnedMessageIds = new Set();
        pinnedMessagesOrdered = [];
        return;
    }

    const [reactionsRes, removalsRes, pinsRes] = await Promise.all([
        supabaseClient.from("message_reactions").select("message_id, user_id, reaction").in("message_id", messageIds),
        supabaseClient.from("message_removals").select("message_id").eq("user_id", myProfile.id).in("message_id", messageIds),
        supabaseClient.from("pinned_messages").select("message_id, pinned_by, pinned_at").eq("conversation_id", conversationId).order("pinned_at", { ascending: true })
    ]);

    messageReactionsByMessageId = {};
    (reactionsRes.data || []).forEach(function(r){
        if(!messageReactionsByMessageId[r.message_id]) messageReactionsByMessageId[r.message_id] = [];
        messageReactionsByMessageId[r.message_id].push(r);
    });

    messageReactorProfilesById = await lingkodFetchProfilesById(
        (reactionsRes.data || []).map(function(r){ return r.user_id; })
    );

    removedForMeMessageIds = new Set((removalsRes.data || []).map(function(r){ return r.message_id; }));

    const pinnedRows = pinsRes.data || [];
    pinnedMessageIds = new Set(pinnedRows.map(function(r){ return r.message_id; }));
    pinnedMessagesOrdered = pinnedRows;
}

async function loadMessages(conversationId){
    const selectColumns = messagesSupportAttachmentColumns
        ? MESSAGES_BASE_COLUMNS + ", " + MESSAGES_ATTACHMENT_COLUMNS
        : MESSAGES_BASE_COLUMNS;

    let { data, error } = await supabaseClient
        .from("messages")
        .select(selectColumns)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

    // file_name/file_path/... were added by a later migration - asking for
    // columns that don't exist yet fails the *entire* query (Postgres
    // undefined_column, code 42703), which would otherwise blank out the
    // whole conversation even though every message is really there. Retried
    // once without those columns so text messages always display
    // regardless of migration status - only attachments stay unavailable
    // until it's run.
    if(error && messagesSupportAttachmentColumns && (error.code === "42703" || /column .* does not exist/i.test(error.message || ""))){
        console.error("[messages] attachment columns unavailable - has 20260719040000_messaging_attachments_and_emoji.sql been run?", error);
        messagesSupportAttachmentColumns = false;
        lingkodToast("Attachments aren't available yet on this project (pending database update) - messages still work normally.", "error");

        const retry = await supabaseClient
            .from("messages")
            .select(MESSAGES_BASE_COLUMNS)
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: true });
        data = retry.data;
        error = retry.error;
    }

    if(error){
        console.error("[messages] load failed:", error);
        renderMessages([]);
        return;
    }

    messageRowsCache = data;
    await loadMessageExtras(conversationId, data.map(function(m){ return m.id; }));

    renderMessages(data.filter(function(m){ return !removedForMeMessageIds.has(m.id); }));
    renderPinnedBar();
}

/* ================= ATTACHMENTS (composer) ================= */

function sanitizeFileNameForPath(name){
    return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function validateAttachmentFile(file){
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if(!ALLOWED_ATTACHMENT_EXTENSIONS.includes(ext)){
        return "\"" + file.name + "\" isn't a supported file type.";
    }
    if(file.size > MAX_ATTACHMENT_SIZE_BYTES){
        return "\"" + file.name + "\" is larger than 25 MB.";
    }
    return null;
}

function isDuplicatePendingFile(file){
    return pendingAttachments.some(function(item){
        return item.status !== "removed" && item.file.name === file.name && item.file.size === file.size;
    });
}

function buildAttachmentChip(item){
    const chip = document.createElement("div");
    chip.className = "attachment-chip" + (item.status === "error" ? " error" : "");
    chip.dataset.attachmentId = item.id;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "attachment-chip-remove";
    removeBtn.setAttribute("aria-label", "Remove attachment");
    removeBtn.innerHTML = "<i class=\"fa-solid fa-xmark\"></i>";
    removeBtn.addEventListener("click", function(){ removePendingAttachment(item); });
    chip.appendChild(removeBtn);

    const thumb = document.createElement("div");
    thumb.className = "attachment-chip-thumb";
    if(item.previewUrl){
        if(item.file.type.indexOf("video/") === 0){
            const video = document.createElement("video");
            video.src = item.previewUrl;
            video.muted = true;
            thumb.appendChild(video);
        } else {
            const img = document.createElement("img");
            img.src = item.previewUrl;
            thumb.appendChild(img);
        }
    } else {
        const icon = document.createElement("i");
        icon.className = lingkodFileIconClass({ file_name: item.file.name, file_type: item.file.type });
        thumb.appendChild(icon);
    }
    chip.appendChild(thumb);

    const name = document.createElement("span");
    name.className = "attachment-chip-name";
    name.textContent = item.file.name;
    chip.appendChild(name);

    if(item.status === "uploading"){
        const progress = document.createElement("div");
        progress.className = "attachment-chip-progress";
        const fill = document.createElement("div");
        fill.className = "attachment-chip-progress-fill";
        fill.style.width = (item.progress || 0) + "%";
        progress.appendChild(fill);
        chip.appendChild(progress);
    } else if(item.status === "error"){
        const retryBtn = document.createElement("button");
        retryBtn.type = "button";
        retryBtn.className = "attachment-chip-retry";
        retryBtn.textContent = "Retry";
        retryBtn.addEventListener("click", function(){ startAttachmentUpload(item); });
        chip.appendChild(retryBtn);
    } else {
        const size = document.createElement("span");
        size.className = "attachment-chip-size";
        size.textContent = lingkodFormatFileSize(item.file.size);
        chip.appendChild(size);
    }

    return chip;
}

function renderAttachmentQueue(){
    const queueEl = document.getElementById("attachmentQueue");
    if(!queueEl) return;

    if(pendingAttachments.length === 0){
        queueEl.innerHTML = "";
        queueEl.style.display = "none";
    } else {
        queueEl.style.display = "flex";
        queueEl.innerHTML = "";
        pendingAttachments.forEach(function(item){ queueEl.appendChild(buildAttachmentChip(item)); });
    }

    const sendBtn = document.getElementById("chatSendBtn");
    if(sendBtn){
        sendBtn.disabled = pendingAttachments.some(function(item){ return item.status === "uploading"; });
    }
}

// Turns whatever Supabase Storage's REST API actually said into the
// specific, actionable messages callers expect (bucket missing/RLS denial/
// too large/unsupported type/network) rather than a raw API error string -
// the underlying error is still logged in full via console.error.
function describeAttachmentUploadError(err, fileName){
    const message = (err && err.message) || "";
    const lower = message.toLowerCase();

    if(lower.indexOf("bucket not found") !== -1){
        return "File attachments aren't set up yet on this project (the \"" + MESSAGE_ATTACHMENTS_BUCKET + "\" Storage bucket is missing). Ask your administrator to run the pending database migration.";
    }
    if(lower.indexOf("row-level security") !== -1 || lower.indexOf("permission") !== -1 || lower.indexOf("not authorized") !== -1 || lower.indexOf("policy") !== -1){
        return "You don't have permission to upload to this conversation.";
    }
    if(lower.indexOf("exceeded the maximum allowed size") !== -1 || lower.indexOf("too large") !== -1 || lower.indexOf("payload too large") !== -1){
        return "\"" + fileName + "\" is too large for the upload limit.";
    }
    if(lower.indexOf("mime type") !== -1 || (lower.indexOf("not allowed") !== -1 && lower.indexOf("type") !== -1)){
        return "\"" + fileName + "\" isn't a supported file type.";
    }
    if(!message || lower.indexOf("network") !== -1 || lower.indexOf("failed to fetch") !== -1){
        return "Upload failed - check your internet connection and try again.";
    }
    return "Couldn't upload \"" + fileName + "\": " + message;
}

async function startAttachmentUpload(item){
    item.status = "uploading";
    item.progress = 0;
    renderAttachmentQueue();

    try {
        const conversationId = await ensureConversation();
        const path = conversationId + "/" + crypto.randomUUID() + "-" + sanitizeFileNameForPath(item.file.name);

        const upload = lingkodUploadFileWithProgress(MESSAGE_ATTACHMENTS_BUCKET, path, item.file, function(percent){
            item.progress = percent;
            const fill = document.querySelector('.attachment-chip[data-attachment-id="' + item.id + '"] .attachment-chip-progress-fill');
            if(fill) fill.style.width = percent + "%";
        });
        item.cancel = upload.cancel;

        await upload.promise;

        item.status = "done";
        item.meta = {
            file_name: item.file.name,
            file_path: path,
            file_type: item.file.type || null,
            file_size: item.file.size,
            storage_bucket: MESSAGE_ATTACHMENTS_BUCKET
        };
        renderAttachmentQueue();
    } catch(err){
        if(item.status === "removed") return; // cancelled - not a real failure
        item.status = "error";
        renderAttachmentQueue();
        console.error("[messages] attachment upload failed:", err);
        lingkodToast(describeAttachmentUploadError(err, item.file.name), "error");
    }
}

// Cancels an in-flight upload (real mid-transfer abort, via
// lingkodUploadFileWithProgress's XHR-based cancel) or, if it already
// finished, removes the now-orphaned object from Storage - either way the
// file never ends up attached to a sent message.
function removePendingAttachment(item){
    const wasDone = item.status === "done";
    item.status = "removed";
    if(item.cancel) item.cancel();
    if(wasDone && item.meta){
        supabaseClient.storage.from(MESSAGE_ATTACHMENTS_BUCKET).remove([item.meta.file_path])
            .catch(function(err){ console.error("[messages] attachment cleanup failed:", err); });
    }
    if(item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    pendingAttachments = pendingAttachments.filter(function(p){ return p.id !== item.id; });
    renderAttachmentQueue();
}

function addFilesToQueue(fileList){
    Array.from(fileList).forEach(function(file){
        const validationError = validateAttachmentFile(file);
        if(validationError){
            lingkodToast(validationError, "error");
            return;
        }
        if(isDuplicatePendingFile(file)){
            lingkodToast("\"" + file.name + "\" is already attached.", "error");
            return;
        }

        const item = {
            id: crypto.randomUUID(),
            file: file,
            status: "pending",
            progress: 0,
            cancel: null,
            meta: null,
            previewUrl: (file.type.indexOf("image/") === 0 || file.type.indexOf("video/") === 0) ? URL.createObjectURL(file) : null
        };
        pendingAttachments.push(item);
        startAttachmentUpload(item);
    });
    renderAttachmentQueue();
}

/* ================= EMOJI PICKER ================= */

const EMOJI_DYNAMIC_CATEGORIES = [
    { key: "frequent", label: "Frequently Used", icon: "👑" },
    { key: "recent", label: "Recently Used", icon: "🕒" }
];

function getAllEmojiCategories(){
    return EMOJI_DYNAMIC_CATEGORIES.concat(LINGKOD_EMOJI_CATEGORIES.map(function(c){
        return { key: c.key, label: c.label, icon: c.icon };
    }));
}

function getEmojisForCategory(key){
    if(key === "recent") return recentEmojis.map(function(e){ return [e, ""]; });
    if(key === "frequent") return frequentEmojis.map(function(e){ return [e, ""]; });
    const cat = LINGKOD_EMOJI_CATEGORIES.find(function(c){ return c.key === key; });
    return cat ? cat.emojis : [];
}

// A flat, de-duplicated search index across every static category - built
// once and reused (the same emoji legitimately appears in more than one
// category, e.g. 🔥 under both Nature and Symbols; searching should only
// ever surface it once).
let emojiSearchIndex = null;
function buildEmojiSearchIndex(){
    if(emojiSearchIndex) return emojiSearchIndex;
    const byChar = new Map();
    LINGKOD_EMOJI_CATEGORIES.forEach(function(cat){
        cat.emojis.forEach(function(pair){
            const existing = byChar.get(pair[0]);
            if(existing) existing.keywords += " " + pair[1];
            else byChar.set(pair[0], { emoji: pair[0], keywords: pair[1] });
        });
    });
    emojiSearchIndex = Array.from(byChar.values());
    return emojiSearchIndex;
}

function searchEmojis(query){
    const q = query.trim().toLowerCase();
    if(!q) return [];
    return buildEmojiSearchIndex()
        .filter(function(entry){ return entry.keywords.indexOf(q) !== -1; })
        .map(function(entry){ return [entry.emoji, entry.keywords]; })
        .slice(0, 200);
}

function autoResizeTextarea(textarea){
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";
}

function insertEmojiAtCursor(textarea, emoji){
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    textarea.value = value.slice(0, start) + emoji + value.slice(end);
    const newPos = start + emoji.length;
    textarea.focus();
    textarea.setSelectionRange(newPos, newPos);
    autoResizeTextarea(textarea);
}

// Per-account, persisted server-side (emoji_usage table) - survives
// logout/login rather than living in localStorage. "Recently Used" orders
// by last_used_at, "Frequently Used" by use_count - both read from the
// same table.
async function loadEmojiUsage(){
    if(!myProfile) return;

    const { data, error } = await supabaseClient
        .from("emoji_usage")
        .select("emoji, use_count, last_used_at")
        .eq("user_id", myProfile.id);

    if(error){
        console.error("[messages] emoji usage load failed:", error);
        return;
    }

    recentEmojis = (data || []).slice()
        .sort(function(a, b){ return new Date(b.last_used_at) - new Date(a.last_used_at); })
        .slice(0, 40)
        .map(function(r){ return r.emoji; });

    frequentEmojis = (data || []).slice()
        .sort(function(a, b){ return b.use_count - a.use_count; })
        .slice(0, 40)
        .map(function(r){ return r.emoji; });
}

async function recordEmojiUsage(emoji){
    if(!myProfile) return;

    const { error } = await supabaseClient.rpc("increment_emoji_usage", { p_emoji: emoji });
    if(error){
        console.error("[messages] emoji usage tracking failed:", error);
        return;
    }

    await loadEmojiUsage();
    const picker = document.getElementById("emojiPicker");
    if(picker && picker.refresh) picker.refresh();
}

function onEmojiPicked(emoji){
    const chatInput = document.getElementById("chatInput");
    if(chatInput) insertEmojiAtCursor(chatInput, emoji);
    recordEmojiUsage(emoji);
}

function buildEmojiGridSection(entries){
    const grid = document.createElement("div");
    grid.className = "emoji-picker-grid";
    entries.forEach(function(pair){
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = pair[0];
        if(pair[1]) btn.title = pair[1];
        btn.addEventListener("click", function(e){
            e.stopPropagation();
            onEmojiPicked(pair[0]);
        });
        grid.appendChild(btn);
    });
    return grid;
}

function buildEmojiPicker(){
    const picker = document.createElement("div");
    picker.className = "emoji-picker";
    picker.id = "emojiPicker";

    const searchWrap = document.createElement("div");
    searchWrap.className = "emoji-picker-search";
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search emoji...";
    searchWrap.appendChild(searchInput);

    const tabsWrap = document.createElement("div");
    tabsWrap.className = "emoji-picker-tabs";

    const body = document.createElement("div");
    body.className = "emoji-picker-body";

    picker.appendChild(searchWrap);
    picker.appendChild(tabsWrap);
    picker.appendChild(body);

    let activeCategory = frequentEmojis.length ? "frequent" : (recentEmojis.length ? "recent" : LINGKOD_EMOJI_CATEGORIES[0].key);
    // Whether the grid is currently showing search results rather than a
    // category - kept independent of whatever text is sitting in the
    // search box, so switching categories never has to clear it.
    let searchActive = false;
    const tabButtons = {};

    // Built exactly once. A category switch afterwards only ever toggles
    // .active on these same button elements - rebuilding tabsWrap's
    // contents from inside a tab's own click handler was the actual bug:
    // it detached the just-clicked button mid-event, so the document-level
    // "click outside closes the picker" listener's picker.contains(e.target)
    // check went false right after, and closed the picker on every switch.
    function buildTabs(){
        getAllEmojiCategories().forEach(function(cat){
            const tab = document.createElement("button");
            tab.type = "button";
            tab.className = "emoji-picker-tab" + (cat.key === activeCategory ? " active" : "");
            tab.textContent = cat.icon;
            tab.title = cat.label;
            tab.addEventListener("click", function(e){
                e.stopPropagation();
                activeCategory = cat.key;
                searchActive = false;
                updateActiveTab();
                renderGrid();
            });
            tabsWrap.appendChild(tab);
            tabButtons[cat.key] = tab;
        });
    }

    function updateActiveTab(){
        Object.keys(tabButtons).forEach(function(key){
            tabButtons[key].classList.toggle("active", key === activeCategory);
        });
    }

    function renderGrid(){
        body.innerHTML = "";
        const query = searchInput.value.trim();

        if(searchActive && query){
            const results = searchEmojis(query);
            if(results.length === 0){
                const empty = document.createElement("div");
                empty.className = "emoji-picker-empty";
                empty.textContent = "No emoji found for \"" + query + "\".";
                body.appendChild(empty);
                return;
            }
            body.appendChild(buildEmojiGridSection(results));
            return;
        }

        const entries = getEmojisForCategory(activeCategory);
        const catInfo = getAllEmojiCategories().find(function(c){ return c.key === activeCategory; });

        if(entries.length === 0){
            const empty = document.createElement("div");
            empty.className = "emoji-picker-empty";
            empty.textContent = activeCategory === "recent"
                ? "Emoji you use will show up here."
                : (activeCategory === "frequent" ? "Your most-used emoji will show up here." : "No emoji in this category.");
            body.appendChild(empty);
            return;
        }

        const label = document.createElement("div");
        label.className = "emoji-picker-category-label";
        label.textContent = catInfo ? catInfo.label : "";
        body.appendChild(label);
        body.appendChild(buildEmojiGridSection(entries));
    }

    // Typing searches; clearing the box back to empty falls straight back
    // to whatever category is currently selected - it was never changed by
    // searching, so there's nothing to "restore".
    searchInput.addEventListener("input", function(){
        searchActive = searchInput.value.trim().length > 0;
        renderGrid();
    });
    searchInput.addEventListener("click", function(e){ e.stopPropagation(); });

    // Only re-renders the grid - never touches the tabs, never rebuilds
    // the picker, and never changes which category is active, so picking
    // several emoji in a row from the same category never gets yanked over
    // to "Frequently Used" mid-browse.
    picker.refresh = function(){ renderGrid(); };

    buildTabs();
    renderGrid();

    return picker;
}

function renderChatWindow(account){
    subscribeTypingChannel(account);
    chatPanel.innerHTML = "";
    pendingAttachments.forEach(function(item){ if(item.previewUrl) URL.revokeObjectURL(item.previewUrl); });
    pendingAttachments = [];

    const isBlockedEitherWay = blockedIds.has(account.id);

    const header = document.createElement("div");
    header.className = "chat-header";

    const backBtn = document.createElement("button");
    backBtn.className = "chat-back";
    backBtn.setAttribute("aria-label", "Back to conversations");
    backBtn.innerHTML = "<i class=\"fa-solid fa-arrow-left\"></i>";
    backBtn.addEventListener("click", function(){
        chatPanel.classList.remove("mobile-active");
    });

    const avatarWrap = document.createElement("div");
    avatarWrap.className = "avatar-wrap";
    avatarWrap.appendChild(lingkodBuildAvatarElement(account, "avatar"));

    const info = document.createElement("div");
    info.className = "chat-header-info";
    const name = document.createElement("h3");
    name.textContent = account.full_name;
    const roleLine = document.createElement("p");
    roleLine.textContent = roleLabel(account.role);
    info.appendChild(name);
    info.appendChild(roleLine);
    activeChatRoleLine = roleLine;

    header.appendChild(backBtn);
    header.appendChild(avatarWrap);
    header.appendChild(info);

    const pinnedBar = document.createElement("div");
    pinnedBar.className = "pinned-messages-bar";
    pinnedBar.id = "pinnedMessagesBar";

    const body = document.createElement("div");
    body.className = "chat-body";
    body.id = "chatBody";

    const dropHint = document.createElement("div");
    dropHint.className = "chat-drop-hint";
    dropHint.textContent = "Drop files to attach";

    chatPanel.appendChild(header);
    chatPanel.appendChild(pinnedBar);
    chatPanel.appendChild(body);
    chatPanel.appendChild(dropHint);

    if(isBlockedEitherWay){
        const note = document.createElement("div");
        note.className = "chat-blocked-note";
        note.textContent = iBlockedIds.has(account.id)
            ? "You've blocked this user. Unblock them to send messages."
            : "You can't send messages to this user.";
        chatPanel.appendChild(note);
        return;
    }

    const queueEl = document.createElement("div");
    queueEl.className = "attachment-queue";
    queueEl.id = "attachmentQueue";
    queueEl.style.display = "none";
    chatPanel.appendChild(queueEl);

    const emojiPicker = buildEmojiPicker();
    chatPanel.appendChild(emojiPicker);

    const footer = document.createElement("div");
    footer.className = "chat-footer";

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.multiple = true;
    fileInput.style.display = "none";
    fileInput.accept = ALLOWED_ATTACHMENT_EXTENSIONS.map(function(ext){ return "." + ext; }).join(",");
    fileInput.addEventListener("change", function(){
        if(fileInput.files.length) addFilesToQueue(fileInput.files);
        fileInput.value = "";
    });

    const attachBtn = document.createElement("button");
    attachBtn.className = "icon-btn";
    attachBtn.setAttribute("aria-label", "Attach file");
    attachBtn.innerHTML = "<i class=\"fa-solid fa-paperclip\"></i>";
    attachBtn.addEventListener("click", function(){ fileInput.click(); });

    const emojiBtn = document.createElement("button");
    emojiBtn.className = "icon-btn";
    emojiBtn.setAttribute("aria-label", "Insert emoji");
    emojiBtn.innerHTML = "<i class=\"fa-regular fa-face-smile\"></i>";

    const chatInput = document.createElement("textarea");
    chatInput.id = "chatInput";
    chatInput.rows = 1;
    chatInput.placeholder = "Type your message...";
    chatInput.addEventListener("input", broadcastTyping);

    const sendBtn = document.createElement("button");
    sendBtn.className = "send-btn";
    sendBtn.id = "chatSendBtn";
    sendBtn.setAttribute("aria-label", "Send message");
    sendBtn.innerHTML = "<i class=\"fa-solid fa-paper-plane\"></i>";

    footer.appendChild(fileInput);
    footer.appendChild(attachBtn);
    footer.appendChild(emojiBtn);
    footer.appendChild(chatInput);
    footer.appendChild(sendBtn);

    chatPanel.appendChild(footer);

    async function doSend(){
        const text = chatInput.value.trim();
        const readyAttachments = pendingAttachments.filter(function(item){ return item.status === "done"; });
        const stillUploading = pendingAttachments.some(function(item){ return item.status === "uploading"; });

        if(stillUploading){
            lingkodToast("Please wait for the attachment to finish uploading.", "error");
            return;
        }

        if(!text && readyAttachments.length === 0) return;

        sendBtn.disabled = true;

        try {
            const conversationId = await ensureConversation();
            const rows = [];

            // The schema is one attachment per message row (matching every
            // other file-carrying table in this app) - sending several files
            // at once becomes several bubbles, the same way Facebook
            // Messenger sends each image as its own message. Any text rides
            // along on the first row rather than becoming a separate bubble.
            if(readyAttachments.length === 0){
                rows.push({ conversation_id: conversationId, sender_id: myProfile.id, content: text });
            } else {
                readyAttachments.forEach(function(item, index){
                    rows.push(Object.assign(
                        { conversation_id: conversationId, sender_id: myProfile.id, content: index === 0 ? (text || null) : null },
                        item.meta
                    ));
                });
            }

            for(const row of rows){
                const { error } = await supabaseClient.from("messages").insert(row);
                if(error){
                    console.error("[messages] send failed:", error);
                    lingkodToast("Your message could not be sent: " + error.message, "error");
                    return;
                }
            }

            chatInput.value = "";
            autoResizeTextarea(chatInput);
            pendingAttachments = [];
            renderAttachmentQueue();
            await loadMessages(conversationId);
            // Covers a brand-new conversation (first send) appearing in the
            // sidebar immediately, without waiting on the realtime round-trip.
            await loadMyConversations();
        } catch(err){
            lingkodToast(err.message, "error");
        } finally {
            sendBtn.disabled = false;
            chatInput.focus();
        }
    }

    sendBtn.addEventListener("click", doSend);

    // Enter sends; Shift+Enter inserts a newline - Messenger's own
    // convention, and why the composer is a <textarea> now rather than a
    // single-line <input>.
    chatInput.addEventListener("keydown", function(e){
        if(e.key === "Enter" && !e.shiftKey){
            e.preventDefault();
            doSend();
        }
    });

    chatInput.addEventListener("input", function(){ autoResizeTextarea(chatInput); });

    chatInput.addEventListener("paste", function(e){
        const items = (e.clipboardData || window.clipboardData).items;
        if(!items) return;
        const imageFiles = [];
        for(let i = 0; i < items.length; i++){
            if(items[i].type.indexOf("image/") === 0){
                const file = items[i].getAsFile();
                if(file) imageFiles.push(file);
            }
        }
        if(imageFiles.length){
            e.preventDefault();
            addFilesToQueue(imageFiles);
        }
    });

    emojiBtn.addEventListener("click", function(e){
        e.stopPropagation();
        emojiPicker.classList.toggle("visible");
    });
}

// Registered once here (module scope), not inside renderChatWindow - that
// function reruns on every conversation switch, and re-registering these
// on #chatPanel itself (which is never recreated, only its contents are)
// would stack up a fresh duplicate handler on every switch.
document.addEventListener("click", function(e){
    const picker = document.getElementById("emojiPicker");
    if(!picker || !picker.classList.contains("visible")) return;
    const emojiBtn = chatPanel.querySelector(".icon-btn[aria-label=\"Insert emoji\"]");
    if(!picker.contains(e.target) && e.target !== emojiBtn && !(emojiBtn && emojiBtn.contains(e.target))){
        picker.classList.remove("visible");
    }
});

document.addEventListener("keydown", function(e){
    if(e.key !== "Escape") return;
    const picker = document.getElementById("emojiPicker");
    if(picker) picker.classList.remove("visible");
});

// Drag-and-drop: the whole chat panel is the drop target (matches
// Messenger - drop anywhere in the open conversation, not just the
// composer row). Guarded on #attachmentQueue existing, so this is a no-op
// when no conversation is open yet or the active one is blocked.
let messagesDragCounter = 0;

chatPanel.addEventListener("dragenter", function(e){
    if(!document.getElementById("attachmentQueue")) return;
    e.preventDefault();
    messagesDragCounter++;
    chatPanel.classList.add("drag-over");
});

chatPanel.addEventListener("dragover", function(e){
    if(!document.getElementById("attachmentQueue")) return;
    e.preventDefault();
});

chatPanel.addEventListener("dragleave", function(e){
    if(!document.getElementById("attachmentQueue")) return;
    e.preventDefault();
    messagesDragCounter = Math.max(0, messagesDragCounter - 1);
    if(messagesDragCounter === 0) chatPanel.classList.remove("drag-over");
});

chatPanel.addEventListener("drop", function(e){
    if(!document.getElementById("attachmentQueue")) return;
    e.preventDefault();
    messagesDragCounter = 0;
    chatPanel.classList.remove("drag-over");
    if(e.dataTransfer.files.length) addFilesToQueue(e.dataTransfer.files);
});

async function selectAccount(account){
    activeAccount = account;
    activeConversationId = null;

    // Messenger behavior: picking a result (from search or the persistent
    // list) always empties the search box and falls back to the
    // conversation list underneath - the chat window itself takes over the
    // right panel. Done synchronously, before any awaits below, so the
    // search results disappear the instant the click happens rather than
    // waiting on the conversation lookup.
    conversationSearch.value = "";
    viewingArchived = false;
    archivedToggleBtn.classList.remove("active");
    renderConversationList();

    renderChatWindow(account);
    renderMessages([]);

    const existingId = await findExistingDirectConversation(account.id);
    if(existingId){
        activeConversationId = existingId;
        await loadMessages(existingId);
        await markConversationRead(existingId);
        renderConversationList();
    }

    if(window.innerWidth <= 900){
        chatPanel.classList.add("mobile-active");
    }

    const chatInput = document.getElementById("chatInput");
    if(chatInput) chatInput.focus();
}

// A message landing anywhere (mine, sent from another tab/device, or from
// whoever I'm talking to) always refreshes the sidebar - covers a brand
// new incoming conversation too, since the conversation lists are rebuilt
// from scratch by loadMyConversations() rather than checked against a
// stale local cache. If it belongs to the conversation I currently have
// open, the transcript refreshes live and, if I'm not the sender, is
// marked read immediately since I'm already looking at it. Otherwise, a
// toast announces it - unless that conversation is muted.
function handleIncomingMessage(row){
    if(!myProfile) return;

    if(row.conversation_id === activeConversationId){
        loadMessages(activeConversationId);
        if(row.sender_id !== myProfile.id){
            markConversationRead(activeConversationId);
        }
    } else if(row.sender_id !== myProfile.id){
        const known = conversationListCache.find(function(e){ return e.conversationId === row.conversation_id; })
            || archivedListCache.find(function(e){ return e.conversationId === row.conversation_id; });
        if(!known || !known.isMuted){
            lingkodToast(known ? "New message from " + known.otherProfile.full_name + "." : "New message received.", "success");
        }
    }

    loadMyConversations();
}

conversationSearch.addEventListener("input", function(){
    searchAccounts(conversationSearch.value);
});

archivedToggleBtn.addEventListener("click", function(){
    viewingArchived = !viewingArchived;
    archivedToggleBtn.classList.toggle("active", viewingArchived);
    archivedToggleBtn.setAttribute("aria-label", viewingArchived ? "Back to conversations" : "View archived chats");
    conversationSearch.value = "";
    renderConversationList();
});

document.addEventListener("DOMContentLoaded", async function(){
    myProfile = await lingkodGetAuthedProfile();

    if(!myProfile){
        renderNoResults(contactList, "Messaging requires a registered account.");
        renderChatEmpty("Log in with a registered account to send messages.");
        conversationSearch.disabled = true;
        archivedToggleBtn.disabled = true;
        return;
    }

    renderChatEmpty("Select a conversation or search for someone to start chatting.");
    renderNoResults(contactList, "Loading conversations...");
    await loadBlockedRelationships();
    await loadEmojiUsage();
    await loadMyConversations();
    await openConversationFromUrl();
});

// Deep link from anywhere else in the app (currently the Directory page's
// Message button) - "../messages/index.html?user=<profile id>" opens (or
// lazily creates, on first send - see ensureConversation()) a conversation
// with that person immediately, the same as picking them from search.
async function openConversationFromUrl(){
    const targetId = new URLSearchParams(location.search).get("user");
    if(!targetId || targetId === myProfile.id) return;

    const { data, error } = await supabaseClient
        .from("profiles")
        .select("id, full_name, role, avatar_url")
        .eq("id", targetId)
        .maybeSingle();

    // Clears the query param either way so refreshing/reopening the tab
    // later doesn't keep jumping back to this conversation.
    history.replaceState(null, "", location.pathname);

    if(error || !data){
        console.error("[messages] deep-link user lookup failed:", error);
        lingkodToast("Couldn't open a conversation with that user.", "error");
        return;
    }

    await selectAccount(data);
}

// Real-time messaging: a new message (from either side, or another open
// tab) and read-receipt updates both need to reach this page instantly,
// for both the open chat transcript and the sidebar's ordering/preview/
// unread badge - without anyone needing to refresh.
supabaseClient
    .channel("messages_page_changes")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, function(payload){
        handleIncomingMessage(payload.new);
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, function(payload){
        handleIncomingMessage(payload.new);
    })
    .subscribe();

// Mute/archive/delete-for-me and block state both need to sync live
// across tabs/devices for the same account too.
supabaseClient
    .channel("messages_page_settings_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "conversation_settings" }, function(){
        loadMyConversations();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "user_blocks" }, async function(){
        await loadBlockedRelationships();
        if(!conversationSearch.value.trim()) renderConversationList();
        if(activeAccount) renderChatWindow(activeAccount);
    })
    .subscribe();

// Reactions/pins need to reach both participants instantly too - reloads
// the currently open conversation's transcript on any change anywhere
// (simplest correct approach; message_reactions/pinned_messages don't
// carry conversation_id directly on the reactions row, only pins do, so
// filtering the subscription itself isn't worth the complexity over just
// re-fetching whatever's already on screen).
supabaseClient
    .channel("messages_page_reactions_pins_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, function(){
        if(activeConversationId) loadMessages(activeConversationId);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "pinned_messages" }, function(){
        if(activeConversationId) loadMessages(activeConversationId);
    })
    .subscribe();
