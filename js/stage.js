import { supabase, ROOM_NAME } from './config.js';
const  stage = document.getElementById('stage');

// 現在の URL を取得 ⇒ コントローラー画面の URL 取得に変更必須
const controllerUrl = window.location.origin;
new QRCode(document.getElementById("qrcode-area"), {
    text: controllerUrl,
    width: 120,
    height: 120
});

const channel = supabase.channel(ROOM_NAME);
channel
    // presence -> ユーザの接続状況の確認
    // event: 'sync' -> 「presence(同期)状態が更新されたとき」にイベントが発生
    .on('presence', { event: 'sync' }, () => {
        // 現在の全接続者のメタデータ
        const state = channel.presenceState();
        // アバターロジック用関数に state を渡す
        renderAvaiars(state);
    })
    // broadcast -> スマホボタンからの入力を高速に反映
    // broadcast状態だと通信が高速だが、DBにデータが保存されない
    // 'reaction' は、カスタム名であり、reactionラベルのついた、特に payload のみを扱う
    .on('broadcast', { event: 'reaction'}, ({ payload }) => {
        // リアクションの動きを定義した関数に payload を渡す
        handleReaction(payload);

        // DBへのデータ保存
    })
    .subscribe();

    // アバターの表示・非表示
    function renderAvaiars(state) {

    }

    // リアクションモーションの適応
    function handleReaction(payload) {

    }


