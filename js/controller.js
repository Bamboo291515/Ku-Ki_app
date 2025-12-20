import { supabase, ROOM_NAME } from './config.js';

// DOM要素の取得
const statusBar = document.getElementById('status-bar');

// ★ここにセッションID（イベント識別用）を定義
// 本来はQRコードのURLパラメータから取りますが、今回は固定値でOK
const CURRENT_SESSION_ID = 'session_v1_demo';

// ユーザー情報とチャンネルをグローバル変数として保持
let myUserId = null;
let channel = null; // ★ここ重要：どこからでも送信できるように外に出しました

// ==========================================
// 1. 初期化プロセス
// ==========================================
async function init() {
    try {
        statusBar.innerText = 'Signing in...';
        
        // 匿名ログイン (ID維持)
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error) throw error;
        
        myUserId = data.user.id;
        console.log('My User ID:', myUserId);
        statusBar.innerText = 'Connecting to room...';

        // 部屋への接続開始
        connectToStage();

    } catch (err) {
        console.error('Login failed:', err);
        statusBar.innerText = 'Login Error';
    }
}

// ==========================================
// 2. Realtime接続 (Presence & Broadcast)
// ==========================================
function connectToStage() {
    // チャンネルを作成してグローバル変数に入れる
    channel = supabase.channel(ROOM_NAME);

    channel
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                statusBar.innerText = '🟢 Connected / ID: ' + myUserId.slice(0, 4);
                statusBar.style.color = '#4ade80';

                // 入室通知 (Presence)
                const userColor = getRandomColor();
                await channel.track({
                    user_id: myUserId,
                    color: userColor,
                    online_at: new Date().toISOString()
                });
            } else {
                statusBar.innerText = '🔴 Disconnected';
                statusBar.style.color = '#ff4444';
            }
        });

    // ボタンの準備（チャンネル接続に関係なくセットアップしてOK）
    setupButtons();
}

// ==========================================
// 3. ★ハイブリッド送信ロジック (爆速 + 記録)
// ==========================================
async function sendHybridAction(type, content) {
    if (!channel) return; // 接続前なら何もしない

    // --------------------------------------------------
    // 🚀 処理A: Broadcast送信 (演出用・最優先)
    // --------------------------------------------------
    // DBを待たず、メモリ経由でPCへ直行させる！
    const broadcastPayload = {
        userId: myUserId,
        action: type === 'message' ? 'msg' : content, // PC側が判別しやすい値
        text: type === 'message' ? content : null     // テキストがある場合
    };

    channel.send({
        type: 'broadcast',
        event: 'reaction', // PC側はこのイベント名で待機
        payload: broadcastPayload
    });

    console.log('🚀 Broadcast sent:', content);

    // --------------------------------------------------
    // 📝 処理B: DB保存 (記録用・裏側処理)
    // --------------------------------------------------
    // ユーザーを待たせないため、あえて await しない
    supabase.from('events').insert({
        session_id: CURRENT_SESSION_ID,
        participant_id: myUserId,
        action_type: type, // 'reaction' or 'message'
        payload: { content: content }
    }).then(({ error }) => {
        if (error) console.error('❌ Log save failed:', error);
        else console.log('✅ Log saved to DB');
    });
}

// ==========================================
// 4. ボタン操作のイベント設定
// ==========================================
function setupButtons() {
    const buttons = document.querySelectorAll('.action-btn');

    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            // --- 演出パート ---
            // 振動 (触覚フィードバック)
            if (navigator.vibrate) navigator.vibrate(40);

            // ボタンを一瞬光らせる演出
            btn.style.transition = 'none';
            btn.style.backgroundColor = '#fff';
            btn.style.opacity = '0.8';
            setTimeout(() => {
                btn.style.transition = 'all 0.3s';
                btn.style.backgroundColor = ''; 
                btn.style.opacity = '';
            }, 50);

            // --- 送信データ準備パート ---
            // ボタンIDから "btn-" を取り除く (例: "question", "achive")
            const key = btn.id.replace('btn-', '');
            
            // データ属性にテキストがあればメッセージ、なければリアクション
            if (btn.hasAttribute('data-text')) {
                // テキストボタンの場合 ("偉業", "感謝"など)
                const text = btn.getAttribute('data-text');
                sendHybridAction('message', text);
            } else {
                // リアクションボタンの場合 ("clap", "jump"など)
                sendHybridAction('reaction', key);
            }
        });
    });
}

// ヘルパー関数: ランダムな色
function getRandomColor() {
    const hue = Math.floor(Math.random() * 360);
    return `hsl(${hue}, 70%, 60%)`;
}

// 実行開始
init();