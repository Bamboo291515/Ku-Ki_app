// import { supabase, ROOM_NAME } from './config.js';
const stage = document.getElementById('stage');

// 現在の URL を取得 ⇒ コントローラー画面の URL 取得に変更必須
const controllerUrl = window.location.origin;
new QRCode(document.getElementById("qrcode-area"), {
    text: controllerUrl,
    width: 120,
    height: 120
});

// const channel = supabase.channel(ROOM_NAME);
// channel
//     // presence -> ユーザの接続状況の確認
//     // event: 'sync' -> 「presence(同期)状態が更新されたとき」にイベントが発生
//     .on('presence', { event: 'sync' }, () => {
//         // 現在の全接続者のメタデータ
//         const state = channel.presenceState();
//         // アバターロジック用関数に state を渡す
//         renderAvaiars(state);
//     })
//     // broadcast -> スマホボタンからの入力を高速に反映
//     // broadcast状態だと通信が高速だが、DBにデータが保存されない
//     // 'reaction' は、カスタム名であり、reactionラベルのついた、特に payload のみを扱う
//     .on(
//         'broadcast',
//         { event: 'reaction' },
//         (payload) => {
//             handleReaction(payload.payload);
//         }
//     )
//     .subscribe((status) => {
//         if (status === 'SUBSCRIBED') {
//             console.log('Ready to receive actions!');
//         }
//     });

// // アバターの表示・非表示
// function renderAvaiars(state) {
//     for (const metas of Object.values(state)) {
//         for (const meta of metas) {
//             const userId = meta.userId;
//             if (!document.getElementById(`avatar-${userId}`)) {
//                 const avatar = document.createElement('div');
//                 avatar.className = 'avatar';
//                 avatar.id = `avatar-${userId}`;

//                 const img = document.createElement('img');
//                 img.src = `assets/avatars/${meta.avatarId || 'avatar_01'}.svg`;
//                 img.className = 'avatar-img';
//                 avatar.appendChild(img);

//                 avatar.style.left = Math.random() * 80 + '%';
//                 avatar.style.top  = Math.random() * 80 + '%';

//                 stage.appendChild(avatar);
//             }
//         }
//     }
// }

// // リアクションモーションの適応
// function handleReaction(data) {
//     if (!data) return;

//     const targetAvatar = document.getElementById(`avatar-${data.userId}`);
//     if (!targetAvatar) return;

//     if (data.text) {
//         showBubble(targetAvatar, data.text);
//     } else {
//         playAnimation(targetAvatar, data.action);
//     }
// }

// function playAnimation(element, actionName) {
//     const className = `is-${actionName}`;
//     element.classList.remove(className);
//     void element.offsetWidth;
//     element.classList.add(className);
//     element.addEventListener(
//         'animationend',
//         () => element.classList.remove(className),
//         { once: true }
//     );
// }

// function showBubble(avatar, text) {
//     let bubble = avatar.querySelector('.bubble');
//     if (!bubble) {
//         bubble = document.createElement('div');
//         bubble.className = 'bubble';
//         avatar.appendChild(bubble);
//     }
//     bubble.textContent = text;
//     bubble.classList.add('show');
//     setTimeout(() => {
//         bubble.classList.remove('show');
//     }, 2000);
// }