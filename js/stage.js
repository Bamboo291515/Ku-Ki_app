import {
    ensureSession, // Supabase 上でセッションを保証するための関数（sessions テーブル操作）。
    getSessionIdFromUrl, // URL クエリ sid を取得してセッション識別に利用する関数。
    getSupabaseClientIfAvailable, // Supabase クライアントが設定済みか安全に取得する関数。
    tableNames, // Supabase テーブル名の定数（events / participants / sessions）。
    DEFAULT_SESSION_ID, // sid が無い場合のフォールバック ID（GitHub Pages での手動動作確認用）。
} from './config.js';
// NOTE: config.js のエクスポート名や返却形が変わった場合、この import と下部の Supabase 利用箇所（ensureSession / tableNames / Realtime 初期化）を合わせて更新すること。

const stage = document.getElementById('stage'); // アバターを描画するメイン領域（stage.html の <main id="stage">）。
const avatarRegistry = new Map(); // userId をキーとして生成済み DOM ノードをキャッシュする（再描画を避けるため）。
const avatarFallbackCache = new Map(); // アバター未指定時に選んだデフォルトの記憶領域（同じ userId に同一アバターを維持）。
let realtimeChannel = null; // Realtime チャンネルの参照（Presence / Broadcast を購読）。
let supabaseClient = null; // Supabase クライアントの参照（DB 読み込みと Realtime を兼用）。
let currentSessionId = null; // 画面が扱うセッション ID（sid または DEFAULT_SESSION_ID）。
let scaleValue = 1; // ステージの拡大率（wheel で変更）。

const SCALE_MIN = 0.6; // ズームアウトの下限値。
const SCALE_MAX = 1.6; // ズームインの上限値。
const SCALE_STEP = 0.08; // 拡大縮小のステップ幅。

const REACTION_CLASS_MAP = {
    clap: 'clap', // 拍手ボタン → is-clap アニメーション。
    surprise: 'surprise', // 驚きボタン → is-surprise アニメーション。
    question: 'question', // 疑問ボタン → is-question アニメーション。
    okay: 'okay', // 同意ボタン → is-okay アニメーション。
    // achive: 'achive',
    // thank: 'thank',
    // cheer: 'cheer',
    // devotion: 'devotion',
    // NOTE: DB の events.type / controller.js で送る type が変わったら必ず同期させること。
};

const STICKER_ACTIONS = new Set(['thank', 'devotion', 'cheer', 'achive']); // ステッカー表示対象。

const FALLBACK_AVATAR_IDS = ['Avatar(Female)']; // アバター指定が無い場合は女性アバターで固定する。

function setupQrCode(sessionId) {
    const controllerUrl = new URL('./', window.location.href); // Controller ページの URL を生成（GitHub Pages 配信パスも含める）。
    if (sessionId) {
        controllerUrl.searchParams.set('sid', sessionId); // スキャン時に同じ sid を渡し、同一セッションに参加させる。
    }

    new QRCode(document.getElementById('qrcode-area'), {
        text: controllerUrl.toString(), // QR コードの内容（Controller の参加用 URL）。
        width: 120, // QR コードの幅。
        height: 120, // QR コードの高さ。
    });
}
// NOTE: index.html のパスや sid パラメータの扱いが変わる場合は QR 生成処理を必ず同期すること。

async function initStage() {
    const sessionFromUrl = getSessionIdFromUrl(); // URL から sid を取得。
    currentSessionId = sessionFromUrl || DEFAULT_SESSION_ID; // 指定が無い場合はデフォルト ID を採用。
    setupQrCode(currentSessionId); // QR コードを表示して参加者に sid を共有する。

    setupScalingControls(); // スクロールによるズーム制御を有効化。

    supabaseClient = getSupabaseClientIfAvailable(); // Supabase クライアントを取得（設定漏れ時は null）。
    if (!supabaseClient) {
        console.warn('Supabase 設定が見つからないため、オフラインモードで表示します。'); // 設定不足を日本語で警告。
        return; // DB なしで静的表示のみ行う。
    }

    try {
        await ensureSession(currentSessionId); // sessions テーブル上でセッションの存在を保証。
    } catch (error) {
        console.warn('Supabase 上でセッション保証に失敗したため、リアルタイム表示のみ継続します。', error); // 失敗時も Realtime は動かし続ける旨を通知。
    }

    await loadInitialParticipants(); // participants テーブルから初期アバターを描画。
    setupRealtime(currentSessionId); // Presence / Broadcast / DB 監視を開始。
}

function setupRealtime(sessionId) {
    if (!supabaseClient || !sessionId) return; // クライアント未設定またはセッション不明なら何もしない。

    const channelName = `stage:${sessionId}`; // controller と一致する Realtime チャンネル名（設計資料に準拠）。
    realtimeChannel = supabaseClient.channel(channelName, {
        config: {
            // stage 側は閲覧専用のため固定キーで Presence に参加し、参加者側(client_id)の Presence を受信する。
            presence: { key: `stage-observer-${sessionId}` }, // PresenceState に stage 自身が入るのを区別するためのキー。
        },
    });

    realtimeChannel
        .on('presence', { event: 'sync' }, () => {
            const state = realtimeChannel.presenceState(); // Presence 全体を取得し、参加者ごとにアバターを表示する。
            renderAvaiars(state); // presenceState をそのまま描画に流用。
        })
        .on('presence', { event: 'leave' }, ({ key }) => {
            if (key) removeAvatar(key); // key が離脱したら該当アバターを除去。
        })
        .on('broadcast', { event: 'reaction' }, (payload) => {
            handleReaction(payload.payload); // controller.js からの Broadcast (type=text=null) を即時反映。
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                realtimeChannel.track({
                    role: 'stage', // Presence 上でステージ本人であることを示す。
                    joined_at: new Date().toISOString(), // デバッグ用の入室時刻。
                });
                console.log('Realtime channel ready'); // 接続完了をコンソールに通知（英語コメントも日本語に置き換え済み）。
            }
        });

    supabaseClient
        .channel(`events:${sessionId}`) // DB 監視用のチャンネル。Broadcast を受け取れない場合の冗長経路。
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: tableNames.events, // config.js の定数を利用（テーブル名変更時に同期しやすい）。
                filter: `session_id=eq.${sessionId}`, // 同一セッションのイベントのみ受信。
            },
            (payload) => handleReaction(payload.new) // DB 反映を受けてアニメーションを行う（Broadcast と同じ処理に集約）。
        )
        .subscribe();
}
// NOTE: tableNames.events/participants のテーブル名・スキーマが変わる場合は config.js と合わせてこの購読・初期ロードも更新すること。

async function loadInitialParticipants() {
    if (!supabaseClient || !currentSessionId) return; // セッション未確定やクライアント未設定なら読み込み不要。

    const { data, error } = await supabaseClient
        .from(tableNames.participants) // participants テーブルを参照（config.js と同じ定義を共有）。
        .select('*') // avatar_id / client_id を含めて取得。
        .eq('session_id', currentSessionId); // 現在のセッションに絞り込む。

    if (error) {
        console.warn('参加者の初期読み込みに失敗しました:', error); // 日本語で警告を出し、描画はスキップ。
        return;
    }

    const syntheticPresence = {}; // PresenceState 形式のオブジェクトを自前で組み立てる。
    data?.forEach((row) => {
        const key = row.client_id || row.id; // presence.key として利用する識別子（client_id 優先）。
        if (!key) return; // いずれも無ければ描画対象外。
        syntheticPresence[key] = [
            {
                userId: row.client_id, // stage.js の upsertAvatar が参照する ID。
                avatarId: row.avatar_id, // participants.avatar_id をそのまま反映。
            },
        ];
    });

    renderAvaiars(syntheticPresence); // Presence 風データを使って初期描画。
}

// アバターの表示・非表示
function renderAvaiars(state) {
    const nextIds = new Set(); // 今回の Presence で存在している userId を集計。

    Object.entries(state || {}).forEach(([presenceKey, metas]) => {
        metas.forEach((meta) => {
            if (meta?.role === 'stage') return; // ステージ自身の Presence は描画対象外。
            const userId = meta?.userId || meta?.user_id || presenceKey;
            if (!userId) return;
            nextIds.add(userId); // 残すべき userId として記録。
            upsertAvatar(userId, meta); // 既存なら更新、新規なら作成して描画。
        });
    });

    [...avatarRegistry.keys()].forEach((userId) => {
        if (!nextIds.has(userId)) {
            removeAvatar(userId); // Presence にいないアバターを削除して整合性を保つ。
        }
    });

    stage.setAttribute('data-avatar-count', `${avatarRegistry.size}`); // デバッグやスタイル用に現在の人数を属性化。
}

function upsertAvatar(userId, meta = {}) {
    let avatar = avatarRegistry.get(userId); // 既存の DOM ノードを取得（無ければ生成）。

    if (!avatar) {
        avatar = document.createElement('div'); // アバターの外枠 DOM を生成。
        avatar.className = 'avatar'; // スタイル用の共通クラスを付与。
        avatar.id = `avatar-${userId}`; // userId と連動した DOM ID を付けて後続検索を容易にする。

        const img = document.createElement('img'); // 実際の SVG を描画する <img>。
        img.className = 'avatar-img'; // サイズや形状を CSS で制御するためのクラス。
        avatar.appendChild(img); // 枠の中に画像ノードを入れる。

        const { x, y } = computeAvatarPosition(); // 新規アバターの初期配置（重なり回避の乱数計算）。
        avatar.style.left = `${x}%`; // 横位置をパーセント指定で設定。
        avatar.style.top = `${y}%`; // 縦位置をパーセント指定で設定。
        avatar.style.zIndex = `${computeZIndex(y)}`; // y に応じて前後関係を決定（奥行きを表現）。

        stage.appendChild(avatar); // ステージに追加して描画。
        avatarRegistry.set(userId, avatar); // レジストリに保存して次回参照を高速化。
    }

    const imgEl = avatar.querySelector('img'); // アバターの画像ノードを取得。
    const avatarId = resolveAvatarId(userId, meta); // meta.avatar_id またはフォールバックから表示用 ID を取得。
    imgEl.src = encodeURI(`assets/avatars/${avatarId}.svg`); // SVG へのパスをエンコードして設定。
    imgEl.alt = `Avatar ${avatarId}`; // アクセシビリティ用に代替テキストを設定。

    if (meta.color) {
        avatar.style.setProperty('--avatar-accent', meta.color); // Presence.meta 由来の色があればアクセントカラーを反映。
    }
}

function removeAvatar(userId) {
    const avatar = avatarRegistry.get(userId); // レジストリから DOM を取得。
    if (avatar?.parentNode) {
        avatar.parentNode.removeChild(avatar); // ステージから取り除き表示を消す。
    }
    avatarRegistry.delete(userId); // レジストリからも削除しメモリを解放。
}

function computeAvatarPosition() {
    const existing = [...avatarRegistry.values()].map((node) => ({
        left: parseFloat(node.style.left) || 0, // 既存ノードの X 位置を取得。
        top: parseFloat(node.style.top) || 0, // 既存ノードの Y 位置を取得。
    })); // 配置衝突を避けるために使用。

    let attempts = 0; // 配置試行回数をカウント。
    while (attempts < 12) {
        const x = 10 + Math.random() * 80; // 端を避けるため 10〜90% の範囲に乱数配置。
        const y = 34 + Math.random() * 64; // 画面下 2/3 を中心に乱数配置。

        const overlaps = existing.some((pos) =>
            Math.hypot(pos.left - x, pos.top - y) < 14 // 既存ノードとの距離が近すぎるか判定。
        );

        if (!overlaps) return { x, y }; // 重なりが無ければこの座標を採用。
        attempts += 1; // 重なった場合は再試行。
    }

    return { x: 12 + Math.random() * 76, y: 45 + Math.random() * 50 }; // 12 回超えたら妥協値で配置。
}

function computeZIndex(yPercent) {
    // 画面下側（y が大きいほど）を手前にする
    const minZ = 60; // 最背面の z-index。
    const maxZ = 150; // 最前面の z-index。
    const clampedY = Math.min(100, Math.max(0, yPercent)); // 0〜100% に丸める。
    const ratio = (clampedY - 34) / (98 - 34); // 0 〜 1 に正規化（初期配置レンジ基準）
    return Math.round(minZ + (maxZ - minZ) * ratio); // 下に行くほど大きい z-index を付与。
}

// ステージの拡大縮小
function Scaling(direction) {
    if (!direction) return scaleValue; // 引数未指定の場合は現在値を返して終了。
    const delta = direction === 'in' ? SCALE_STEP * -1 : SCALE_STEP; // 入力方向に応じて増減幅を決定。
    const next = clampScale(scaleValue - delta); // 最小/最大値を超えないように丸める。
    applyScale(next); // ステージとアバターへ反映。
    return scaleValue; // 更新後の値を返す。
}

function setupScalingControls() {
    stage.addEventListener('wheel', (event) => {
        if (!event.ctrlKey && !event.metaKey) return; // ピンチズームの意図が無い通常スクロールは無視。
        event.preventDefault(); // デフォルトの拡大縮小を抑制。
        const direction = event.deltaY > 0 ? 'out' : 'in'; // ホイール方向で拡大/縮小を決定。
        Scaling(direction); // 計算した方向でスケールを更新。
    });
}

function clampScale(value) {
    return Math.min(SCALE_MAX, Math.max(SCALE_MIN, value)); // SCALE_MIN〜SCALE_MAX の間に収める。
}

function applyScale(next) {
    scaleValue = next; // 現在の拡大率を更新。
    stage.style.setProperty('--stage-scale', scaleValue); // ステージ全体の CSS 変数を更新。
    avatarRegistry.forEach((node) => {
        node.style.setProperty('--stage-scale', scaleValue); // 各アバターにも同じスケールを伝播。
    });
}

// リアクションモーションの適応
function handleReaction(data) {
    if (!data) return; // payload が空なら何もしない。

    const actionKey = normalizeAction(data); // events.type / Broadcast の type から CSS 用クラスを決定。
    const userId = data.userId || data.user_id || data.participant_id || data.client_id; // events.client_id と Presence メタを併用して発信者を特定。
    if (!userId) return; // 識別子が無い場合は描画できないため終了。

    const targetAvatar = document.getElementById(`avatar-${userId}`); // 対象ユーザーのアバター DOM を取得。
    if (!targetAvatar) return; // まだ参加者が表示されていない場合はスキップ。

    const bubbleText = resolveBubbleText(data); // テキスト系イベントなら吹き出しに表示する内容を決定。
    if (bubbleText) {
        showBubble(targetAvatar, bubbleText); // 吹き出しを表示して 2 秒後に消す。
    }

    const action = (data.action || data.type || data.action_type || '').toLowerCase();
    if (STICKER_ACTIONS.has(action)) {
        showSticker(targetAvatar, action); // ステッカー表示系リアクション。
    } else if (actionKey) {
        playAnimation(targetAvatar, actionKey); // CSS アニメーションをトリガー。
    }
}

function normalizeAction(data) {
    const raw = data.action || data.type || data.action_type; // controller.js からの Broadcast / events.type から元の値を取得。
    if (!raw) return null; // 値が無ければクラス化できない。
    const lowered = String(raw).toLowerCase(); // 大文字小文字を吸収。
    return REACTION_CLASS_MAP[lowered] ? REACTION_CLASS_MAP[lowered] : null; // マッピングが無い場合はアニメーション無し。
}

function resolveBubbleText(data) {
    if (typeof data.text === 'string') return data.text; // Broadcast の text プロパティを最優先で採用。
    if (data.message) return data.message; // 互換性のため message も確認。
    return null; // 表示すべきテキストが無い場合。
}

function resolveAvatarId(userId, meta = {}) {
    const fromMeta = meta.avatarId || meta.avatar_id; // Presence メタまたは participants.avatar_id からアバター指定を取得。
    if (fromMeta) {
        avatarFallbackCache.set(userId, fromMeta); // 次回のためにキャッシュ。
        return fromMeta;
    }

    if (avatarFallbackCache.has(userId)) {
        return avatarFallbackCache.get(userId); // 以前に決定したデフォルトを再利用。
    }

    const pick =
        FALLBACK_AVATAR_IDS[Math.floor(Math.random() * FALLBACK_AVATAR_IDS.length)]; // 男女いずれかをランダムに選択。
    avatarFallbackCache.set(userId, pick); // 同じユーザーで固定化するため記録。
    return pick; // 選択したアバター ID を返却。
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

const stickerTimeoutMap = new WeakMap();

function showSticker(avatar, action) {
    const existing = avatar.querySelector('.sticker');
    const sticker = existing || document.createElement('img');
    sticker.className = 'sticker';
    sticker.src = `assets/Controller_Components/${action}.png`;
    sticker.alt = action;
    if (!existing) avatar.appendChild(sticker);

    sticker.classList.add('show');

    if (stickerTimeoutMap.has(sticker)) {
        clearTimeout(stickerTimeoutMap.get(sticker));
    }
    const timeoutId = setTimeout(() => {
        sticker.classList.remove('show');
    }, 2500);
    stickerTimeoutMap.set(sticker, timeoutId);
}

initStage();
