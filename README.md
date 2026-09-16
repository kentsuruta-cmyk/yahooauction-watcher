# yahooauction-watcher

KENJAGAMES の仕入れ用。ヤフオクとメルカリの中古ゲーム機（GB / GBC / GBP / GBA / GBA SP /
DS / DS Lite / DSi / DSi LL / 3DS / 3DS LL / PSP 1000・2000・3000）を監視する。

本番: https://yahooauction-watcher.vercel.app （main に push すると Vercel が自動デプロイ）

## 構成

| ファイル | 役割 |
| --- | --- |
| `index.html` | 画面（ビルドなし。ヤフオク／メルカリの2タブ） |
| `api/search.js` | ヤフオク検索（スクレイピング。`MODELS` が抽出条件の本体） |
| `api/mercari.js` | メルカリ検索（内部API + DPoP） |
| `api/checked.js` | チェック済みの保存（Upstash Redis） |
| `api/watch.js` | メルカリのオークション終了通知リストの登録・解除 |
| `api/watch-check.js` | 監視中オークションの確認と通知（GitHub Actions から5分おき） |
| `lib/mercari-client.js` | メルカリ内部APIの共通クライアント（DPoP・商品取得） |
| `lib/watch-store.js` | 通知リストの保存先（Upstash Redis） |

## オークション終了通知（メルカリ）

メルカリのオークションには代理入札（上限を預けて自動で競る仕組み）が無く、入札の取り消しも
できない。そのため**自動入札はせず、終了前に確実に気付ける**ところまでを機械の仕事にしている。

1. メルカリタブの一覧で、オークション出品の行の「+ 通知」を押して入札上限額を入れる
2. GitHub Actions が5分おきに `/api/watch-check` を叩く
3. 終了60分前・15分前・5分前に通知が飛ぶ。現在価格が上限を超えたら通知して監視を自動解除

### 必要な環境変数（Vercel）

| 変数 | 用途 |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | 既存（チェック済み・通知リストの保存） |
| `NOTIFY_WEBHOOK_URL` | 通知の送り先。Discord / Slack の Webhook URL、または ntfy.sh のトピックURL |
| `WATCH_CHECK_TOKEN` | 任意。設定すると `/api/watch-check` にトークンが必要になる（GitHub 側は同名の Secret に入れる） |

### 動作確認

```
# 通知を飛ばさずに判定結果だけ見る
curl "https://yahooauction-watcher.vercel.app/api/watch-check?dry=1"
```

## メモ

- ヤフオクの `istatus`: 1=未使用 / 2=中古（すべて）/ 3=未使用に近い / 4=目立った傷や汚れなし /
  5=やや傷や汚れあり / 6=傷や汚れあり / 7=全体的に状態が悪い。**2 は 6・7 も含む**ので
  状態を絞りたいモデルでは使わない。
- ヤフオクの定額（フリマ）出品は「現在」ラベルも入札数も残り時間も持たない。これで
  オークションと定額を判別している。
- メルカリの検索は `withAuction: true` を付けたときだけ `auction`（終了予定時刻・入札数・
  最高入札額）が返る。商品単体は `items/get` に `include_auction=true` と
  `include_product_page_component=true` の**両方**が要る。
- メルカリのオークションは終了間際の入札で終了予定時刻が延長される。「あと何分」は常に暫定値。
