# Config.js API ドキュメント

Supabase 操作層 (`config.js`) の API リファレンスです。

---

## 概要

`config.js` は以下を管理します：
- **Supabase クライアント初期化** と認証設定
- **Client ID 管理** （参加者識別）
- **Session ID 管理** （URL から抽出）
- **DB操作** （Session、Participant、Event のCRUD）

---

## API リファレンス

### Client ID 管理

#### `getOrCreateClientId()`

**説明**: 現在のブラウザの一意な参加者IDを取得または生成します。  
初回実行時に生成され、localStorage に保存されます。

**戻り値**: `string` - UUID 形式の Client ID

**使用例**:
```javascript
import { getOrCreateClientId } from './config.js';

const clientId = getOrCreateClientId();
console.log('Your ID:', clientId);
// 出力例: "550e8400-e29b-41d4-a716-446655440000"
```

**ストレージ**: `localStorage['kuki_client_id']`

---

#### `refreshClientId()`

**説明**: Client ID を再生成して localStorage に保存します。  
ログアウトや新規参加時に使用します。

**戻り値**: `string` - 新しい Client ID

**使用例**:
```javascript
import { refreshClientId } from './config.js';

const newClientId = refreshClientId();
console.log('New ID:', newClientId);
```

---

### Session ID 管理

#### `getSessionIdFromUrl()`

**説明**: URL クエリパラメータ `sid` を抽出します。

**戻り値**: `string | null` - Session ID、またはクエリがない場合は null

**使用例**:
```javascript
import { getSessionIdFromUrl } from './config.js';

const sessionId = getSessionIdFromUrl();
if (sessionId) {
  console.log('Session:', sessionId);
} else {
  console.error('No session provided in URL');
}
```

**URL 例**:
- `index.html?sid=session-abc123`
- `stage.html?sid=session-abc123`

> Note: セッション作成画面が未実装の間は、`ensureSession()` などが `sid` を取得できなかった場合、`DEFAULT_SESSION_ID` にフォールバックします。

#### `DEFAULT_SESSION_ID`

**説明**: `sid` クエリが指定されていないときに一時的に使用されるセッションID。画面実装後はこの定数を更新または削除してください。

**現在値**: `119af2e3-6a49-41df-a648-81c215b1cbfd`

**使用例**:
```javascript
import { DEFAULT_SESSION_ID, ensureSession } from './config.js';

await ensureSession(DEFAULT_SESSION_ID);
```

---

### Session 操作

#### `ensureSession(sessionId?, options?)`

**説明**: セッションがサーバー側に存在するか確認します。存在しなければ作成します。

`sessionId` を省略し、かつ URL に `sid` が含まれていない場合は `DEFAULT_SESSION_ID` が自動的に利用されます。

**パラメータ**:
- `sessionId` (string, optional) - セッションID。省略時は URL から抽出
- `options` (object, optional) - 作成時の追加オプション
  - `title` (string, optional) - セッション名

**戻り値**: `Promise<object>` - Session データ

**使用例**:
```javascript
import { ensureSession } from './config.js';

// URL から sessionId を自動抽出して確認
const session = await ensureSession();
console.log('Session:', session);

// 明示的に指定
const session2 = await ensureSession('session-abc123', { title: 'My Event' });

// エラーハンドリング
try {
  const session = await ensureSession();
} catch (error) {
  console.error('Failed to ensure session:', error);
}
```

---

#### `fetchSession(sessionId)`

**説明**: 指定した Session ID のセッション情報を取得します。

**パラメータ**:
- `sessionId` (string) - セッションID

**戻り値**: `Promise<object | null>` - Session データ、存在しない場合は null

**使用例**:
```javascript
import { fetchSession } from './config.js';

const session = await fetchSession('session-abc123');
if (session) {
  console.log('Session found:', session);
} else {
  console.log('Session not found');
}
```

---

### Participant 操作

#### `upsertParticipant(options?)`

**説明**: 現在の参加者情報をサーバーに登録または更新します。  
Client ID と Session ID の組み合わせで一意に識別されます。

**パラメータ**:
- `options` (object, optional)
  - `avatarId` (string, optional) - アバター識別子

**戻り値**: `Promise<object>` - 登録された Participant データ

**使用例**:
```javascript
import { upsertParticipant } from './config.js';

// デフォルト設定で登録
const participant = await upsertParticipant();
console.log('Registered:', participant);

// アバター付きで登録
const participant2 = await upsertParticipant({ avatarId: 'avatar-001' });

// 更新
const updated = await upsertParticipant({ avatarId: 'avatar-002' });
```

**内部動作**:
- `session_id` と `client_id` は自動的に設定されます
- 同じセッション・クライアントで複数回実行すると、前回のデータが更新されます

---

### Event 操作

#### `insertEvent(type)`

**説明**: イベントをサーバーに記録します。

**パラメータ**:
- `type` (string) - イベント種別

**戻り値**: `Promise<object>` - 記録されたイベントデータ

**有効なイベント type**:
- `join` - 参加した
- `question` - 疑問
- `clap` - 拍手
- `surprise` - 驚き
- `okay` - 同意
- `achive` - 偉業
- `thank` - 感謝
- `cheer` - 応援
- `devotion` - 精進

**使用例**:
```javascript
import { insertEvent } from './config.js';

// join イベント
await insertEvent('join');

// モーション系
await insertEvent('clap');
await insertEvent('surprise');

// テキスト系
await insertEvent('thank');

// エラーハンドリング
try {
  await insertEvent('clap');
  console.log('Event recorded');
} catch (error) {
  console.error('Failed to record event:', error);
}
```

**内部動作**:
- `session_id` と `client_id` は自動的に付加されます
- イベントはタイムスタンプ付きで記録されます

---

## ヘルパー関数

#### `hasSupabaseClient()`

**説明**: Supabase クライアントが正常に初期化されているか確認します。

**戻り値**: `boolean`

**使用例**:
```javascript
import { hasSupabaseClient } from './config.js';

if (hasSupabaseClient()) {
  console.log('Supabase is ready');
} else {
  console.warn('Supabase not configured');
}
```

---

#### `getSupabaseClientIfAvailable()`

**説明**: Supabase クライアントを取得します。初期化に失敗している場合は null を返します。

**戻り値**: `SupabaseClient | null`

**使用例**:
```javascript
import { getSupabaseClientIfAvailable } from './config.js';

const supabase = getSupabaseClientIfAvailable();
if (supabase) {
  // カスタムクエリなど
}
```

---

#### `getSupabaseSettings()`

**説明**: 現在の Supabase 設定を取得します。

**戻り値**: `object` - { url, anonKey, storageKey }

**使用例**:
```javascript
import { getSupabaseSettings } from './config.js';

const settings = getSupabaseSettings();
console.log('Supabase URL:', settings.url);
```

---

#### `tableNames`

**説明**: 使用するテーブル名の定数を提供します。

**値**:
```javascript
{
  sessions: 'sessions',
  participants: 'participants',
  events: 'events'
}
```

**使用例**:
```javascript
import { tableNames } from './config.js';

console.log(tableNames.sessions);  // 'sessions'
console.log(tableNames.events);    // 'events'
```

---

## 使用フロー例

### Controller（参加者側）の初期化

```javascript
import {
  getOrCreateClientId,
  getSessionIdFromUrl,
  ensureSession,
  upsertParticipant,
  insertEvent,
} from './config.js';

async function initController() {
  // 1. Session ID を URL から抽出
  const sessionId = getSessionIdFromUrl();
  if (!sessionId) throw new Error('Missing sid');

  // 2. セッションを確認・作成
  await ensureSession(sessionId);

  // 3. Client ID を取得（初回は生成）
  const clientId = getOrCreateClientId();

  // 4. 参加者情報を登録
  await upsertParticipant();

  // 5. join イベントを送信
  await insertEvent('join');

  console.log('Controller ready:', { sessionId, clientId });
}

initController().catch(console.error);
```

### Stage（表示側）の初期化

```javascript
import {
  getSessionIdFromUrl,
  ensureSession,
  getSupabaseClientIfAvailable,
  tableNames,
} from './config.js';

async function initStage() {
  // 1. Session ID を URL から抽出
  const sessionId = getSessionIdFromUrl();
  if (!sessionId) throw new Error('Missing sid');

  // 2. セッションを確認・作成
  await ensureSession(sessionId);

  // 3. Supabase Realtime で events を購読
  const supabase = getSupabaseClientIfAvailable();
  if (supabase) {
    supabase
      .channel(`events:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: tableNames.events,
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          console.log('Event received:', payload.new);
        }
      )
      .subscribe();
  }

  console.log('Stage ready:', { sessionId });
}

initStage().catch(console.error);
```

---

## エラーハンドリング

すべての async 関数は失敗時に例外をスローします。

```javascript
try {
  await ensureSession();
} catch (error) {
  if (error.message.includes('Missing sid')) {
    console.error('Session ID が URL にありません');
  } else {
    console.error('Database error:', error);
  }
}
```

---

## トラブルシューティング

| 問題 | 原因 | 解決策 |
|------|------|--------|
| "Supabase client not configured" | 環境変数が設定されていない | `window.__env__` に SUPABASE_URL と SUPABASE_ANON_KEY を設定 |
| "Missing sid query parameter" | URL に `sid` クエリがない | URL に `?sid=xxxx` を追加 |
| localStorage エラー | ブラウザが localStorage をサポートしていない | メモリ内キャッシュを使用（保存は失敗するがIDは有効） |
| "onConflict is not allowed" | テーブルの RLS ポリシー設定エラー | Supabase のテーブル設定を確認 |
