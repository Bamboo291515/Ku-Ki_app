import {
    DEFAULT_SESSION_ID,
    ensureSession,
    getOrCreateClientId,
    getSessionIdFromUrl,
    getSupabaseClientIfAvailable,
    insertEvent,
    upsertParticipant,
} from './config.js';

// ステータス表示用の DOM 要素を取得する（通信状態を利用者に知らせるため）。
const statusBar = document.getElementById('status-bar');

// URL から sid を取得し、指定が無い場合は規定のセッション ID にフォールバックする。
const sessionId = getSessionIdFromUrl() || DEFAULT_SESSION_ID;

// 端末を一意に識別する client_id（participants / events で共通に利用）を取得する。
const clientId = getOrCreateClientId();

// Supabase クライアントと Realtime チャンネルをモジュール全体で共有するための変数。
let supabaseClient = null;
let realtimeChannel = null;

// 初期化処理。Supabase 設定の確認 → セッション保証 → 参加者登録 → Realtime 接続の順で進める。
async function init() {
    // Supabase 設定が空の場合は GitHub Pages 単体表示のみとする。
    supabaseClient = getSupabaseClientIfAvailable();
    if (!supabaseClient) {
        statusBar.innerText = 'Supabase未設定のためオフライン表示';
        statusBar.style.color = '#f97316';
        return;
    }

    statusBar.innerText = 'Supabaseへ接続中...';

    try {
        // セッションを作成または確認（sessions テーブル：id, created_at, title）。
        await ensureSession(sessionId);

        // 参加者情報を登録（participants テーブル：session_id, client_id, avatar_id）。
        await upsertParticipant();

        // join イベントを記録（events テーブル：session_id, client_id, type）。
        await insertEvent('join');

        statusBar.innerText = 'Realtime接続準備中...';

        // Presence + Broadcast の接続を開始する。
        connectToStageChannel();
    } catch (error) {
        console.error('初期化でエラーが発生しました', error);
        statusBar.innerText = '初期化エラー';
        statusBar.style.color = '#ef4444';
    }
}

// Realtime チャンネルへ接続し、Presence で在席通知、Broadcast でリアクション送信を行う。
function connectToStageChannel() {
    // Supabase チャンネル名は設計意図に合わせて stage:{session_id} を使用する。
    const channelName = `stage:${sessionId}`;

    // presence.key には client_id を用いてセッション内一意性を担保する。
    realtimeChannel = supabaseClient.channel(channelName, {
        config: { presence: { key: clientId } },
    });

    // 接続状態を監視し、参加者として Presence トラッキングを開始する。
    realtimeChannel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
            statusBar.innerText = `🟢 接続済 / ID: ${clientId.slice(0, 4)}`;
            statusBar.style.color = '#22c55e';

            // Presence に user_id と入室時刻を載せる（stage.js 側が user_id からアバターを紐付ける）。
            await realtimeChannel.track({
                user_id: clientId,
                joined_at: new Date().toISOString(),
            });
        } else {
            statusBar.innerText = '🔴 切断';
            statusBar.style.color = '#ef4444';
        }
    });

    // ボタンイベントはチャンネル作成後に紐付ける。
    setupButtons();
}

// ボタン押下をハンドリングし、Broadcast 送信と events テーブル記録を同時に行う。
function setupButtons() {
    // .action-btn クラスを持つ全てのボタンを取得する。
    const buttons = document.querySelectorAll('.action-btn');

    buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
            // 振動で触覚フィードバックを返す（対応端末のみ）。
            if (navigator.vibrate) navigator.vibrate(40);

            // クリック演出として一瞬スタイルを変更する。
            btn.style.transition = 'none';
            btn.style.backgroundColor = '#fff';
            btn.style.opacity = '0.8';
            setTimeout(() => {
                btn.style.transition = 'all 0.3s';
                btn.style.backgroundColor = '';
                btn.style.opacity = '';
            }, 50);

            // ボタン ID から "btn-" を除いた値をイベント種別として扱う（例: question, clap）。
            const eventType = btn.id.replace('btn-', '');

            // data-text を持つボタンはメッセージ系としてテキストを付与、それ以外はリアクション系。
            const textContent = btn.hasAttribute('data-text')
                ? btn.getAttribute('data-text')
                : null;

            // Broadcast で即時反映（stage.js の handleReaction が type/text を使用）。
            sendBroadcast(eventType, textContent);

            // DB への永続化（events.type に eventType を格納）。
            persistEvent(eventType);
        });
    });
}

// Realtime Broadcast でステージ側へ即時にリアクションを届ける。
function sendBroadcast(type, text) {
    if (!realtimeChannel) return;

    realtimeChannel.send({
        type: 'broadcast',
        event: 'reaction',
        payload: {
            client_id: clientId,
            type,
            text,
        },
    });
}

// events テーブルへ非同期に記録する（payload カラムは存在しないため type のみを保存）。
async function persistEvent(type) {
    try {
        await insertEvent(type);
    } catch (error) {
        console.error('イベント保存に失敗しました', error);
    }
}

// 実行開始。
init();
