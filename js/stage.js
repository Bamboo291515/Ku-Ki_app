import {
    ensureSession,
    getSessionIdFromUrl,
    getSupabaseClientIfAvailable,
    tableNames,
    DEFAULT_SESSION_ID,
} from './config.js';
// NOTE: config.js のエクスポート名や返却形が変わった場合、この import と下部の Supabase 利用箇所（ensureSession / tableNames / Realtime 初期化）を合わせて更新すること。

const stage = document.getElementById('stage');
const avatarRegistry = new Map();
const avatarFallbackCache = new Map();
let realtimeChannel = null;
let supabaseClient = null;
let currentSessionId = null;
let scaleValue = 1;

const SCALE_MIN = 0.6;
const SCALE_MAX = 1.6;
const SCALE_STEP = 0.08;

const REACTION_CLASS_MAP = {
    question: 'question',
    clap: 'clap',
    surprise: 'surprise',
    okay: 'okay',
    achive: 'achive',
    thank: 'thank',
    cheer: 'cheer',
    devotion: 'devotion',
    // NOTE: DBのイベント種別や controller.js で送る action 値が変わったらここを更新すること。
};

const FALLBACK_AVATAR_IDS = ['Avatar(Female)', 'Avatar(Male)'];

function setupQrCode(sessionId) {
    const controllerUrl = new URL(window.location.origin + '/');
    if (sessionId) {
        controllerUrl.searchParams.set('sid', sessionId);
    }

    new QRCode(document.getElementById('qrcode-area'), {
        text: controllerUrl.toString(),
        width: 120,
        height: 120,
    });
}
// NOTE: index.html のパスや sid パラメータの扱いが変わる場合は QR 生成処理を必ず同期すること。

async function initStage() {
    const sessionFromUrl = getSessionIdFromUrl();
    currentSessionId = sessionFromUrl || DEFAULT_SESSION_ID;
    setupQrCode(currentSessionId);

    setupScalingControls();

    supabaseClient = getSupabaseClientIfAvailable();
    if (!supabaseClient) {
        console.warn('Supabase client is not configured. Stage will run offline.');
        return;
    }

    try {
        await ensureSession(currentSessionId);
    } catch (error) {
        console.warn('Failed to ensure session in Supabase. Continuing with realtime only.', error);
    }

    await loadInitialParticipants();
    setupRealtime(currentSessionId);
}

function setupRealtime(sessionId) {
    if (!supabaseClient || !sessionId) return;

    const channelName = `stage:${sessionId}`;
    realtimeChannel = supabaseClient.channel(channelName, {
        config: {
            presence: { key: `stage-${sessionId}` },
        },
    });

    realtimeChannel
        .on('presence', { event: 'sync' }, () => {
            const state = realtimeChannel.presenceState();
            renderAvaiars(state);
        })
        .on('presence', { event: 'leave' }, ({ key }) => {
            if (key) removeAvatar(key);
        })
        .on('broadcast', { event: 'reaction' }, (payload) => {
            handleReaction(payload.payload);
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                realtimeChannel.track({
                    role: 'stage',
                    joined_at: new Date().toISOString(),
                });
                console.log('Realtime channel ready');
            }
        });

    supabaseClient
        .channel(`events:${sessionId}`)
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: tableNames.events,
                filter: `session_id=eq.${sessionId}`,
            },
            (payload) => handleReaction(payload.new)
        )
        .subscribe();
}
// NOTE: tableNames.events/participants のテーブル名・スキーマが変わる場合は config.js と合わせてこの購読・初期ロードも更新すること。

async function loadInitialParticipants() {
    if (!supabaseClient || !currentSessionId) return;

    const { data, error } = await supabaseClient
        .from(tableNames.participants)
        .select('*')
        .eq('session_id', currentSessionId);

    if (error) {
        console.warn('Unable to load participants:', error);
        return;
    }

    const syntheticPresence = {};
    data?.forEach((row) => {
        const key = row.client_id || row.id;
        if (!key) return;
        syntheticPresence[key] = [
            {
                userId: row.client_id,
                avatarId: row.avatar_id,
                color: row.color,
            },
        ];
    });

    renderAvaiars(syntheticPresence);
}

// アバターの表示・非表示
function renderAvaiars(state) {
    const nextIds = new Set();

    Object.entries(state || {}).forEach(([presenceKey, metas]) => {
        metas.forEach((meta) => {
            const userId = meta?.userId || meta?.user_id || presenceKey;
            if (!userId) return;
            nextIds.add(userId);
            upsertAvatar(userId, meta);
        });
    });

    [...avatarRegistry.keys()].forEach((userId) => {
        if (!nextIds.has(userId)) {
            removeAvatar(userId);
        }
    });

    stage.setAttribute('data-avatar-count', `${avatarRegistry.size}`);
}

function upsertAvatar(userId, meta = {}) {
    let avatar = avatarRegistry.get(userId);

    if (!avatar) {
        avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.id = `avatar-${userId}`;

        const img = document.createElement('img');
        img.className = 'avatar-img';
        avatar.appendChild(img);

        const { x, y } = computeAvatarPosition();
        avatar.style.left = `${x}%`;
        avatar.style.top = `${y}%`;
        avatar.style.zIndex = `${computeZIndex(y)}`;

        stage.appendChild(avatar);
        avatarRegistry.set(userId, avatar);
    }

    const imgEl = avatar.querySelector('img');
    const avatarId = resolveAvatarId(userId, meta);
    imgEl.src = encodeURI(`assets/avatars/${avatarId}.svg`);
    imgEl.alt = `Avatar ${avatarId}`;

    if (meta.color) {
        avatar.style.setProperty('--avatar-accent', meta.color);
    }
}

function removeAvatar(userId) {
    const avatar = avatarRegistry.get(userId);
    if (avatar?.parentNode) {
        avatar.parentNode.removeChild(avatar);
    }
    avatarRegistry.delete(userId);
}

function computeAvatarPosition() {
    const existing = [...avatarRegistry.values()].map((node) => ({
        left: parseFloat(node.style.left) || 0,
        top: parseFloat(node.style.top) || 0,
    }));

    let attempts = 0;
    while (attempts < 12) {
        const x = 10 + Math.random() * 80; // avoid extreme edges
        const y = 34 + Math.random() * 64; // bottom 2/3 of the screen

        const overlaps = existing.some((pos) =>
            Math.hypot(pos.left - x, pos.top - y) < 14
        );

        if (!overlaps) return { x, y };
        attempts += 1;
    }

    return { x: 12 + Math.random() * 76, y: 45 + Math.random() * 50 };
}

function computeZIndex(yPercent) {
    // 画面下側（y が大きいほど）を手前にする
    const minZ = 60;
    const maxZ = 150;
    const clampedY = Math.min(100, Math.max(0, yPercent));
    const ratio = (clampedY - 34) / (98 - 34); // 0 〜 1 に正規化（初期配置レンジ基準）
    return Math.round(minZ + (maxZ - minZ) * ratio);
}

// ステージの拡大縮小
function Scaling(direction) {
    if (!direction) return scaleValue;
    const delta = direction === 'in' ? SCALE_STEP * -1 : SCALE_STEP;
    const next = clampScale(scaleValue - delta);
    applyScale(next);
    return scaleValue;
}

function setupScalingControls() {
    stage.addEventListener('wheel', (event) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        const direction = event.deltaY > 0 ? 'out' : 'in';
        Scaling(direction);
    });
}

function clampScale(value) {
    return Math.min(SCALE_MAX, Math.max(SCALE_MIN, value));
}

function applyScale(next) {
    scaleValue = next;
    stage.style.setProperty('--stage-scale', scaleValue);
    avatarRegistry.forEach((node) => {
        node.style.setProperty('--stage-scale', scaleValue);
    });
}

// リアクションモーションの適応
function handleReaction(data) {
    if (!data) return;

    const actionKey = normalizeAction(data);
    const userId = data.userId || data.user_id || data.participant_id || data.client_id;
    if (!userId) return;

    const targetAvatar = document.getElementById(`avatar-${userId}`);
    if (!targetAvatar) return;

    const bubbleText = resolveBubbleText(data);
    if (bubbleText) {
        showBubble(targetAvatar, bubbleText);
    }

    if (actionKey) {
        playAnimation(targetAvatar, actionKey);
    }
}

function normalizeAction(data) {
    const raw = data.action || data.type || data.action_type;
    if (!raw) return null;
    const lowered = String(raw).toLowerCase();
    return REACTION_CLASS_MAP[lowered] ? REACTION_CLASS_MAP[lowered] : null;
}

function resolveBubbleText(data) {
    if (typeof data.text === 'string') return data.text;
    if (data.payload?.content) return data.payload.content;
    if (data.message) return data.message;
    return null;
}

function resolveAvatarId(userId, meta = {}) {
    const fromMeta = meta.avatarId || meta.avatar_id;
    if (fromMeta) {
        avatarFallbackCache.set(userId, fromMeta);
        return fromMeta;
    }

    if (avatarFallbackCache.has(userId)) {
        return avatarFallbackCache.get(userId);
    }

    const pick =
        FALLBACK_AVATAR_IDS[Math.floor(Math.random() * FALLBACK_AVATAR_IDS.length)];
    avatarFallbackCache.set(userId, pick);
    return pick;
}

function playAnimation(element, actionName) {
    const className = `is-${actionName}`;
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
    element.addEventListener(
        'animationend',
        () => element.classList.remove(className),
        { once: true }
    );
}

function showBubble(avatar, text) {
    let bubble = avatar.querySelector('.bubble');
    if (!bubble) {
        bubble = document.createElement('div');
        bubble.className = 'bubble';
        avatar.appendChild(bubble);
    }
    bubble.textContent = text;
    bubble.classList.add('show');
    setTimeout(() => {
        bubble.classList.remove('show');
    }, 2000);
}

initStage();
