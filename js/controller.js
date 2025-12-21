import {
    DEFAULT_SESSION_ID, // config.js で定義された sid のデフォルト値（sid 省略時の最終手段）。
    ensureSession, // sessions テーブルに行が無い場合は作成し、既存なら取得するユーティリティ。
    getOrCreateClientId, // localStorage を利用しつつ client_id を生成・再利用するユーティリティ。
    getSessionIdFromUrl, // URL クエリ sid を抽出しセッション識別に使うユーティリティ。
    getSupabaseClientIfAvailable, // Supabase URL/KEY が埋まっている場合にクライアントを返す安全ラッパー。
    insertEvent, // events テーブルへ {session_id, client_id, type} を挿入するユーティリティ。
    upsertParticipant, // participants テーブルへ {session_id, client_id, avatar_id} を upsert するユーティリティ。
} from './config.js';

// ステータス表示用の DOM 要素を取得する（通信状態を利用者に知らせるため）。
const statusBar = document.getElementById('status-bar'); // index.html 側の #status-bar と紐付く。

// URL から sid を取得し、指定が無い場合は規定のセッション ID にフォールバックする。
const sessionId = getSessionIdFromUrl() || DEFAULT_SESSION_ID; // GitHub Pages でも sid が無ければデフォルトを利用。

// 端末を一意に識別する client_id（participants / events で共通に利用）を取得する。
const clientId = getOrCreateClientId(); // QR スキャン後に生成され、同一ブラウザで継続利用される。

// Supabase クライアントと Realtime チャンネルをモジュール全体で共有するための変数。
let supabaseClient = null; // Supabase 接続オブジェクトを保持（config.js の設定を利用）。
let realtimeChannel = null; // Realtime 用のチャンネル参照を保持（Broadcast/Presence 送信用）。

// 初期化処理。Supabase 設定の確認 → セッション保証 → 参加者登録 → Realtime 接続の順で進める。
async function init() {
    // Supabase 設定が空の場合は GitHub Pages 単体表示のみとする（オフラインで UI だけ確認可能）。
    supabaseClient = getSupabaseClientIfAvailable(); // __env__ などに URL/KEY が無い場合は null を返す。
    if (!supabaseClient) {
        statusBar.innerText = 'Supabase未設定のためオフライン表示'; // 利用者に設定不足を明示。
        statusBar.style.color = '#f97316'; // オレンジ色で警告的に表示。
        return; // DB 連携ができないため Realtime 処理は行わない。
    }

    statusBar.innerText = 'Supabaseへ接続中...'; // 接続開始を表示。

    try {
        // セッションを作成または確認（sessions テーブル：id, created_at, title）。
        await ensureSession(sessionId); // sid が URL 由来かデフォルトかに関わらず DB 上で存在を担保。

        // 参加者情報を登録（participants テーブル：session_id, client_id, avatar_id）。
        await upsertParticipant(); // avatar_id は未指定（null）で登録し、Presence と合わせて表示する。

        // join イベントは送らない（join 型は RPC の許可リストにないため）
        // await insertEvent('join');

        statusBar.innerText = 'Realtime接続準備中...'; // 次のステップで Realtime に入ることを示す。

        // Presence + Broadcast の接続を開始する。
        connectToStageChannel(); // stage 側の購読が動いていれば Presence/Broadcast が届く。
    } catch (error) {
        console.error('初期化でエラーが発生しました', error); // デバッグ用に詳細を出力。
        statusBar.innerText = '初期化エラー'; // UI で異常を知らせる。
        statusBar.style.color = '#ef4444'; // 赤色でエラーを示す。
    }
}

// Realtime チャンネルへ接続し、Presence で在席通知、Broadcast でリアクション送信を行う。
function connectToStageChannel() {
    // Supabase チャンネル名は設計意図に合わせて stage:{session_id} を使用する（Docs の Realtime 想定に準拠）。
    const channelName = `stage:${sessionId}`; // session_id ごとに独立したリアルタイムルームを形成。

    // presence.key には client_id を用いてセッション内一意性を担保する（participants.client_id と一致させる）。
    realtimeChannel = supabaseClient.channel(channelName, {
        config: { presence: { key: clientId } }, // Presence のキーは controller 側 client_id。
    });

    // 接続状態を監視し、参加者として Presence トラッキングを開始する。
    realtimeChannel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
            statusBar.innerText = `🟢 接続済 / ID: ${clientId.slice(0, 4)}`; // 接続完了を短縮 ID とともに表示。
            statusBar.style.color = '#22c55e'; // 緑色で正常を示す。

            // Presence に user_id と入室時刻を載せる（stage.js 側が user_id からアバターを紐付ける）。
            await realtimeChannel.track({
                user_id: clientId, // stage.js 側の handleReaction / presenceState で参照されるキー。
                joined_at: new Date().toISOString(), // 参考情報として入室時刻を付与。
            });
        } else {
            statusBar.innerText = '🔴 切断'; // SUBSCRIBED 以外は未接続とみなし通知。
            statusBar.style.color = '#ef4444'; // 赤色で異常を示す。
        }
    });

    // ボタンイベントはチャンネル作成後に紐付ける（clap 以外は無効化する前提）。
    setupButtons(); // Realtime が無いと送信できないため、チャンネル準備後に実行。
}

// ボタン押下をハンドリングし、Broadcast 送信と events テーブル記録を同時に行う。
function setupButtons() {
    const supportedButtons = new Map([
        ['btn-clap', 'clap'],
        ['btn-surprise', 'surprise'],
    ]); // 現在動作確認対象のリアクション一覧。

    document.querySelectorAll('.action-btn').forEach((button) => {
        const action = supportedButtons.get(button.id);
        if (!action) {
            button.disabled = true; // 未対応のリアクションは UI から無効化する。
            button.title = '拍手・驚く以外のリアクションは準備中です'; // 無効化理由をツールチップで伝える。
            return;
        }

        button.addEventListener('click', () => {
            if (navigator.vibrate) navigator.vibrate(40); // 振動で触覚フィードバックを返す（対応端末のみ）。

            flashButton(button); // 視覚的な押下フィードバック。

            sendBroadcast(action, null); // Broadcast で即時反映。
            persistEvent(action); // DB への永続化。
        });
    });
}

function flashButton(button) {
    button.style.transition = 'none'; // 一瞬のハイライト演出を設定。
    button.style.backgroundColor = '#fff'; // ハイライト色を指定（白く光る）。
    button.style.opacity = '0.8'; // 不透明度を下げて押下感を演出。
    setTimeout(() => {
        button.style.transition = 'all 0.3s'; // 元のトランジションに戻す。
        button.style.backgroundColor = ''; // 背景色をリセット。
        button.style.opacity = ''; // 不透明度をリセット。
    }, 50); // 50ms だけ強調してすぐ元に戻す。
}

// Realtime Broadcast でステージ側へ即時にリアクションを届ける。
function sendBroadcast(type, text) {
    if (!realtimeChannel) return; // Realtime が確立していない場合は送信をスキップ。

    realtimeChannel.send({
        type: 'broadcast', // Supabase Realtime Broadcast を利用。
        event: 'reaction', // stage.js 側が購読しているイベント名。
        payload: {
            client_id: clientId, // 発信者識別（presenceState と紐付く）。
            type, // clap 固定のリアクション種別。
            text, // 今回は null 固定だがプロパティは残す。
        },
    });
}

// events テーブルへ非同期に記録する（payload カラムは存在しないため type のみを保存）。
async function persistEvent(type) {
    try {
        await insertEvent(type); // config.js 経由で Supabase RPC を実施。
    } catch (error) {
        console.error('イベント保存に失敗しました', error); // 非同期保存失敗はコンソールに記録。
    }
}

// 実行開始。
init(); // モジュール読み込み時に自動で初期化をキックする。
