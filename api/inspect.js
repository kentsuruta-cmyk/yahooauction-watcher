// 出品の「写真と説明文」を見て、仕入れ候補として見る価値があるかを判定する。
//
//   ◎ ok     … 画面が点いている写真がある（ヤケだけ目で確認すればいい）
//   △ maybe  … 電源オフの写真しかないが、タイトル・説明文に「動作品」などの記載がある
//   × ng     … 画面が真っ黒・割れ・「電源入らず」などの記載、または動作の根拠が何もない
//   ? unknown… 判定できなかった（写真が取れない・AIの設定が無いなど）
//
// 機種ごとのルール（2026-11-20 に Kenさんと確認）
//   GBA SP … 状態が悪くても・画面が点いた写真がなくても・動作未確認でも、「基板なし」系の記載が無ければ ◎（あれば ×）
//   GBA    … 画面が点いた写真があれば ◎。無くても「動作確認済」などの記載があれば ◎。どちらも無ければ △（× にはしない）
//   その他 … ジャンクは売れない。状態が「傷や汚れあり」「全体的に状態が悪い」は無条件で ×。
//            「やや傷や汚れあり」までであっても、ジャンク・動作未確認などの記載があれば ×。
//            画面が点いた写真が無ければ、「動作品」と書いてあっても ×（△ は使わない）
//
// 1. 説明文とタイトルのキーワードで先にふるう（無料）
// 2. 残ったものだけ、写真を AI（Claude）に見せて判定する
// 3. 結果は Redis に14日間保存し、同じ出品は二度判定しない
//
//   POST /api/inspect  { items: [{ link, model, title }] }  … 1回8件まで
//   GET  /api/inspect?link=...&model=...&title=...&fresh=1 … 1件だけ（動作確認用。fresh=1 で保存を無視）
const { fetchItem } = require('../lib/mercari-client');
const { redisCommand } = require('../lib/watch-store');
const spRules = require('../lib/sp-rules');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
// 判定ルールを変えたら版を上げる（古い判定を使い回さないため）。
// v2: GBA SP は基板なしの記載が無ければ ◎ ／ v3: GBA は動作確認の記載があれば ◎、その他は状態とジャンク記載で ×
// v4: その他は点灯写真が無ければ × ／ v5: ヤフオクの説明文を全文で読む（v4 までは冒頭だけだった）
// v6: 【A】【B】【C】【D】のようなランク説明の表も読み飛ばす
const CACHE_PREFIX = 'inspect:v6:';
const CACHE_TTL_SEC = 14 * 24 * 60 * 60;
const MAX_ITEMS_PER_CALL = 8;
const MAX_IMAGES = 10; // AIに見せる写真の枚数（ヤフオクの上限10枚を全部。6枚だと後ろの起動画面を見落とした：2026-11-20）

// ジャンクでも仕入れる機種（× にしない）

// GBA・GBA SP 以外の機種で、説明文・タイトルにあれば ×。表記ゆれは norm() で吸収する
const NG_TEXT_WORDS = [
  '電源入らず', '電源が入らない', '電源入りません', '電源が入りません', '通電しない', '通電しません', '通電せず',
  '起動しない', '起動しません', '起動せず', '画面が映らない', '画面映らない', '映りません', '画面が映りません',
  '液晶不良', '液晶割れ', '画面割れ', '液晶漏れ', '液晶にドット抜け多数', '画面が真っ暗', '画面真っ暗',
  // ※「ジャンク」単体は入れない（説明文の「ジャンク扱いではありません」まで弾いてしまうため。タイトルは検索側で除外済み）
  '動作未確認', '通電未確認', '動作不良', '不動品', '故障品', '部品取り',
];
// その他の機種で、出品の状態がこれなら無条件で ×（「やや傷や汚れあり」は含めない）
function badCondition(condition) {
  const c = norm(condition);
  if (!c) return null;
  if (c.includes(norm('全体的に状態が悪い'))) return '全体的に状態が悪い';
  if (c.includes(norm('傷や汚れあり')) && !c.includes(norm('やや傷や汚れあり'))) return '傷や汚れあり';
  return null;
}

// 説明文に「ジャンク」があれば ×。ただし「ジャンクではありません」のような打ち消しは除く
const JUNK_NEGATION = /ジャンク(?:品|扱い)?(?:では|じゃ)(?:ありません|ない|なく|ございません)|ジャンク扱い(?:は|を)?(?:しません|していません)/g;
function junkIn(text) {
  const t = String(text || '').normalize('NFKC').replace(/\s+/g, '').replace(JUNK_NEGATION, '');
  return t.includes('ジャンク') ? 'ジャンク' : null;
}

// 説明文・タイトルにあれば「動作する」と書いてある扱い（電源オフの写真しかなくても △ にする）
const WORKING_TEXT_WORDS = [
  '動作品', '動作確認済', '動作確認しました', '動作確認ずみ', '完動品', '動作良好', '動作問題なし',
  '動作に問題なし', '動作に問題ありません', '動作に問題はありません', '動作は問題ありません',
  '動作OK', '起動確認済', '起動確認しました', '通電確認済', '通電・動作確認', 'ソフト起動確認',
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

function norm(s) { return String(s || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase(); }
function findWord(text, words) {
  const t = norm(text);
  return words.find((w) => t.includes(norm(w))) || null;
}
function workingWordIn(text) {
  return findWord(text, WORKING_TEXT_WORDS);
}

function idOf(link) {
  const m = String(link).match(/\/(?:auction|item|shops\/product)\/([A-Za-z0-9]+)/);
  return m ? m[1] : String(link);
}

// ── 商品ページから写真と説明文を取る ─────────────────────────────

function nextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}

// 商品ページの __NEXT_DATA__ の中身（2026-11-19 にブラウザで確認）:
//   ヤフオク     props.pageProps.initialState.item.detail.item.img[].image / .description（文字列の配列）
//   Yahoo!フリマ props.initialState.itemsState.items.item.images[].url / .description（文字列）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 続けて読みに行くとヤフオクが一時的に HTTP 500 を返す（2026-11-19、16件同時で約4分の1が失敗）。
// 少し待って2回までやり直す
async function fetchPage(link) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(link, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja,en;q=0.9' } });
    if (res.ok || res.status === 404 || attempt >= 2 || (res.status < 500 && res.status !== 429)) return res;
    await sleep(1500 * (attempt + 1) + Math.random() * 1000);
  }
}

async function fetchYahoo(link) {
  const res = await fetchPage(link);
  if (res.status === 404) return { ended: true };
  if (!res.ok) throw new Error(`商品ページが HTTP ${res.status}`);
  const html = await res.text();
  const data = nextData(html);
  let images = [];
  let description = '';
  let condition = '';
  if (data) {
    const ps = data.props || {};
    const auc = (((ps.pageProps || {}).initialState || ps.initialState || {}).item || {}).detail;
    const it = auc && auc.item;
    if (it) {
      images = (it.img || []).map((x) => x && x.image).filter(Boolean);
      // description（文字列の配列）は冒頭の数行だけで「...」で切れている（2026-11-20 に確認）。
      // 全文は descriptionHtml にあるので、そちらを優先する
      const short = Array.isArray(it.description) ? it.description.join('\n') : String(it.description || '');
      const full = htmlToText(it.descriptionHtml);
      description = full.length > short.length ? full : short;
      condition = it.conditionName || '';
    }
    const flea = (((ps.initialState || (ps.pageProps || {}).initialState || {}).itemsState || {}).items || {}).item;
    if (!images.length && flea) {
      images = (flea.images || []).map((x) => x && x.url).filter(Boolean);
      description = String(flea.description || '');
    }
  }
  // 構造が変わっても止まらないよう、最後の手段として画像URLを文字列から拾う
  if (!images.length) {
    images = [...new Set(html.match(/https:\/\/auctions\.c\.yimg\.jp\/images\.auctions\.yahoo\.co\.jp\/image\/[^"'\s\\?]+?\.(?:jpg|jpeg|png)/gi) || [])];
  }
  return { images, description, condition };
}

async function fetchMercari(link) {
  if (/\/shops\/product\//.test(link)) throw new Error('メルカリShopsの出品は未対応');
  const item = await fetchItem(idOf(link));
  if (item.status && item.status !== 'on_sale') return { ended: true };
  const images = (item.photos || item.thumbnails || []).map((p) => (typeof p === 'string' ? p : p && (p.url || p.uri))).filter(Boolean);
  return { images, description: String(item.description || ''), condition: (item.item_condition || {}).name || '' };
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').trim();
}

// ストアの説明文によくある「状態の説明表」（例：「状態10 新品…」「状態2 …ジャンク品扱い」「状態1 基本的にジャンク品…」）を取り除く。
// 表の中の「ジャンク」「動作未確認」で、きれいな出品まで × にしないため。
// 「状態」「ランク」＋数字や【A】【B】のような印が、短い間隔で3つ以上続いている部分を表とみなす（その出品1件だけの「状態 1」などは残る）
function stripConditionLegend(text) {
  let t = String(text || '').normalize('NFKC');
  // 「状態1」「ランク3」のような数字の表と、「【A】【B】【C】【D】」「Sランク Aランク…」のような英字の表の両方を見る
  const re = /(?:状態|ランク)\s*\d{1,2}(?![\d])|【\s*[SABCDEJ][+＋]?\s*】|(?:^|[\s　])[SABCDE][+＋]?\s*ランク/g;
  for (let guard = 0; guard < 5; guard++) {
    const marks = [];
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(t))) marks.push(m.index);
    let start = -1;
    let i = 0;
    for (; i + 2 < marks.length; i++) {
      if (marks[i + 2] - marks[i] < 400) { start = marks[i]; break; }
    }
    if (start < 0) break;
    let j = i + 2;
    while (j + 1 < marks.length && marks[j + 1] - marks[j] < 250) j++;
    const after = t.slice(marks[j]);
    const nl = after.search(/\n/);
    const end = marks[j] + Math.min(nl < 0 ? after.length : nl, 200);
    t = t.slice(0, start) + ' ' + t.slice(end);
  }
  return t;
}

// ヤフオクの写真は縮小サーバー経由で取る（AIに送るデータ量とコストを抑える）
function smallUrl(url) {
  if (/^https:\/\/auctions\.c\.yimg\.jp\//.test(url)) {
    return 'https://auc-pctr.c.yimg.jp/i/' + url.replace(/^https:\/\//, '') + '?pri=l&w=640&h=640&up=0';
  }
  return url;
}

async function loadImage(url) {
  for (const u of [smallUrl(url), url]) {
    try {
      const res = await fetch(u, { headers: { 'User-Agent': UA, Referer: 'https://auctions.yahoo.co.jp/' } });
      if (!res.ok) continue;
      let type = (res.headers.get('content-type') || '').split(';')[0].trim();
      if (!/^image\/(jpeg|png|gif|webp)$/.test(type)) type = 'image/jpeg';
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 500 || buf.length > 4.5 * 1024 * 1024) continue;
      return { type, data: buf.toString('base64') };
    } catch (e) { /* 次の候補へ */ }
  }
  return null;
}

// ── AI に写真を見せる ─────────────────────────────────────────

const PROMPT = `あなたは中古の携帯ゲーム機（ゲームボーイ、DS、3DS、PSPなど）の仕入れ担当です。
オークションの出品写真が順番に（0番から）並んでいます。写真だけを見て、次の点を判定してください。

- screen_on_index: 本体の液晶画面に電源が入って映像（起動画面・ゲーム画面・メニューなど）が表示されている写真の番号。
  最もはっきり画面が見える1枚を選ぶ。無ければ null。画面に照明や景色が反射しているだけのものは「点いている」に含めない。
- screen_dead: 電源が入っている様子（電源ランプ点灯など）なのに画面が真っ黒・真っ白・縦線だらけ等で、液晶が壊れていそうなら true。
  単に電源オフで撮っているだけなら false。
- cracked: 液晶や画面カバーにはっきりした割れ・ヒビが写っていれば true。
- burn_suspect: 点いている画面に、焼き付き・黄ばみ・ムラ・ドット抜け・液晶漏れの疑いが見えれば true（判断できなければ false）。
- comment: 日本語で30文字以内の短い所見。

結果は report ツールで報告してください。`;

const REPORT_TOOL = {
  name: 'report',
  description: '写真の判定結果を報告する',
  input_schema: {
    type: 'object',
    properties: {
      screen_on_index: { type: ['integer', 'null'], description: '画面が点いている写真の番号（0始まり）。無ければ null' },
      screen_dead: { type: 'boolean' },
      cracked: { type: 'boolean' },
      burn_suspect: { type: 'boolean' },
      comment: { type: 'string', description: '日本語30文字以内の所見' },
    },
    required: ['screen_on_index', 'screen_dead', 'cracked', 'burn_suspect', 'comment'],
  },
};

async function askAi(images) {
  const content = [];
  images.forEach((img, i) => {
    content.push({ type: 'text', text: `写真${i}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: img.type, data: img.data } });
  });
  content.push({ type: 'text', text: PROMPT });
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    // 返事の形を固定するため、「report」という道具（ツール）を必ず使って答えさせる。
    // 文章で答えさせると、前置きが付いたり途中で切れたりして JSON として読めないことがあった（2026-11-19）
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 800,
      tools: [REPORT_TOOL],
      tool_choice: { type: 'tool', name: 'report' },
      messages: [{ role: 'user', content }],
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`AI ${res.status}: ${body && body.error ? body.error.message : ''}`);
  const use = (body.content || []).find((c) => c.type === 'tool_use' && c.name === 'report');
  if (use && use.input) return use.input;
  // 念のため、文章で返ってきた場合も読めるようにしておく
  const text = (body.content || []).map((c) => c.text || '').join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`AIの返事を読めません（${body.stop_reason || ''}: ${text.slice(0, 60)}）`);
  return JSON.parse(m[0]);
}

// ── 1件の判定 ──────────────────────────────────────────────

async function inspectOne({ link, model, title }) {
  const isSp = model === 'ゲームボーイアドバンスSP';
  const isGba = model === 'ゲームボーイアドバンス';
  const isMercari = /mercari\.com/.test(link);
  const page = isMercari ? await fetchMercari(link) : await fetchYahoo(link);
  if (page.ended) return { verdict: 'ng', reason: '終了・売り切れ', ended: true };

  const text = `${title || ''}\n${page.description || ''}`;
  const images = (page.images || []).slice(0, MAX_IMAGES);
  // 判定ルールを変えたときに商品ページを読み直さなくて済むよう、説明文と状態も保存しておく
  const base = { images, firstImage: images[0] || null, condition: page.condition || '', desc: String(page.description || '').slice(0, 3000) };
  // ストアの状態説明の表は、ジャンク・動作確認のどちらの判定にも使わない
  const body = stripConditionLegend(text);
  const working = workingWordIn(body);

  // ── ルールだけで決まるもの（写真は見ない） ──
  const spOk = { verdict: 'ok', reason: 'SP：基板なしの記載なし' };
  const gbaOk = { verdict: 'ok', reason: `GBA：「${working}」の記載あり` };
  if (isSp) {
    const noBoard = spRules.ngWordIn(text);
    if (noBoard) return Object.assign(base, { verdict: 'ng', reason: `「${noBoard}」の記載あり`, by: 'text' });
  } else if (!isGba) {
    const bad = badCondition(page.condition);
    if (bad) return Object.assign(base, { verdict: 'ng', reason: `状態が「${bad}」`, by: 'text' });
    const ng = findWord(body, NG_TEXT_WORDS) || junkIn(body);
    if (ng) return Object.assign(base, { verdict: 'ng', reason: `説明文に「${ng}」`, by: 'text' });
  }

  // ── 写真を AI に見せる ──
  // SP と（動作確認の記載がある）GBA は判定がもう決まっている。写真は一覧に点灯写真を出すためだけに見せる
  const fixed = isSp ? spOk : (isGba && working ? gbaOk : null);
  const noAi = (reason, extra) => {
    if (fixed) return Object.assign(base, fixed, { by: 'text' });
    if (isGba) return Object.assign(base, { verdict: 'maybe', reason: `GBA：動作確認の記載なし（${reason}）`, by: 'text' }, extra);
    return Object.assign(base, { verdict: 'unknown', reason, by: 'none', noCache: true }, extra);
  };
  if (!ANTHROPIC_API_KEY) return noAi('AI未設定（ANTHROPIC_API_KEY）');
  if (!images.length) {
    if (fixed || isGba) return noAi('写真なし', { noCache: false });
    return Object.assign(base, { verdict: 'ng', reason: '写真なし', by: 'text' });
  }
  const loaded = await Promise.all(images.map(loadImage));
  const usable = [];
  loaded.forEach((img, i) => { if (img) usable.push({ img, src: images[i] }); });
  if (!usable.length) return noAi('写真を読み込めませんでした', isGba && !fixed ? { noCache: true } : {});
  let ai;
  try {
    ai = await askAi(usable.map((u) => u.img));
  } catch (e) {
    if (fixed) return Object.assign(base, fixed, { by: 'text' });
    throw e;
  }
  const idx = Number.isInteger(ai.screen_on_index) && usable[ai.screen_on_index] ? ai.screen_on_index : null;
  const screenImage = idx !== null ? usable[idx].src : null;
  const out = Object.assign(base, {
    by: 'ai',
    screenImage,
    burnSuspect: !!ai.burn_suspect,
    comment: String(ai.comment || '').slice(0, 60),
  });

  if (isGba && screenImage) return Object.assign(out, { verdict: 'ok', reason: '画面点灯の写真あり' });
  if (fixed) return Object.assign(out, fixed);
  if (isGba) {
    if (screenImage) return Object.assign(out, { verdict: 'ok', reason: '画面点灯の写真あり' });
    return Object.assign(out, { verdict: 'maybe', reason: 'GBA：点灯写真も動作確認の記載もなし' });
  }
  if (ai.cracked) return Object.assign(out, { verdict: 'ng', reason: '画面割れの疑い' });
  if (ai.screen_dead) return Object.assign(out, { verdict: 'ng', reason: '液晶が死んでいる疑い' });
  if (screenImage) return Object.assign(out, { verdict: 'ok', reason: '画面点灯の写真あり' });
  return Object.assign(out, { verdict: 'ng', reason: '画面点灯の写真なし' });
}

// 古い版の判定のうち、新しいルールでも変わらないものだけを使い回す（全件の商品ページを読み直すとヤフオクに断られるため）。
// どれを使い回すかは migrate() を参照
const OLD_CACHE_PREFIXES = ['inspect:v5:', 'inspect:v4:', 'inspect:v3:', 'inspect:v2:', 'inspect:v1:'];

function migrate(old, model, prefix) {
  if (!old || old.by === 'error' || old.verdict === 'unknown') return null;
  // v5 → v6：変わったのは説明文の読み飛ばしだけ。説明文の語で × になったものだけ読み直す
  if (prefix === 'inspect:v5:') return /^説明文に「/.test(old.reason || '') ? null : old;
  // 説明文が途中までしか読めていなかったので（v4 まで）、全文を読むと判定が変わりうるものは読み直す。
  // 使い回すのは、全文を読んでも変わらないものだけ：
  //   × … 見えていた部分だけで × なら、全文でも ×（GBA・SP は × の理由が残るので同じ）
  //   GBA で画面点灯の写真あり … 説明文に関係なく ◎
  if (old.verdict === 'ng' && model !== 'ゲームボーイアドバンス') return old;
  if (model === 'ゲームボーイアドバンス' && old.screenImage) {
    return Object.assign({}, old, { verdict: 'ok', reason: '画面点灯の写真あり' });
  }
  return null;
}

async function inspectCached(item, fresh) {
  const id = idOf(item.link);
  const key = CACHE_PREFIX + id;
  if (!fresh) {
    try {
      const hit = await redisCommand('GET', key);
      if (hit) return Object.assign(JSON.parse(hit), { cached: true });
      for (const prefix of OLD_CACHE_PREFIXES) {
        const old = await redisCommand('GET', prefix + id);
        const moved = old && migrate(JSON.parse(old), item.model, prefix);
        if (moved) {
          await redisCommand('SET', key, JSON.stringify(moved), 'EX', CACHE_TTL_SEC);
          return Object.assign(moved, { cached: true });
        }
      }
    } catch (e) { /* 保存先が使えなくても判定は続ける */ }
  }
  let result;
  try {
    result = await inspectOne(item);
  } catch (e) {
    return { verdict: 'unknown', reason: `判定エラー: ${e.message}`, by: 'error' };
  }
  result.at = Date.now();
  if (!result.noCache) {
    try { await redisCommand('SET', key, JSON.stringify(result), 'EX', CACHE_TTL_SEC); } catch (e) { /* 無視 */ }
  }
  return result;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  try {
    let items;
    let fresh = false;
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      items = Array.isArray(body.items) ? body.items : [];
    } else {
      const q = req.query || {};
      if (!q.link) return res.status(400).json({ error: 'link required' });
      items = [{ link: q.link, model: q.model || '', title: q.title || '' }];
      fresh = q.fresh === '1';
    }
    items = items.filter((i) => i && i.link).slice(0, MAX_ITEMS_PER_CALL);
    // 同時に読みに行くのは2件まで（ヤフオクに断られないように）
    const results = new Array(items.length);
    let next = 0;
    await Promise.all([0, 1].map(async () => {
      while (next < items.length) {
        const n = next++;
        results[n] = await inspectCached(items[n], fresh);
      }
    }));
    const out = {};
    items.forEach((i, n) => { out[idOf(i.link)] = results[n]; });
    return res.status(200).json({ results: out, aiConfigured: !!ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

module.exports._test = { findWord, workingWordIn, idOf, smallUrl, NG_TEXT_WORDS, badCondition, junkIn, migrate, stripConditionLegend, htmlToText };
