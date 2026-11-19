// GBA SP の「基盤なし（中身がない）」判定。LINE通知（api/sp-alert.js）と写真判定（api/inspect.js）で共通に使う。
// 説明文・タイトルにこの語があれば対象外（「基盤」と「基板」の表記ゆれも含める）
const NG_DESC_WORDS = [
  '基盤なし', '基盤無し', '基盤欠品', '基盤無', '基板なし', '基板無し', '基板欠品', '基板無',
  '基盤ありません', '基板ありません', '基盤がありません', '基板がありません', '基盤は入っていません', '基板は入っていません',
  '中身なし', '中身無し', '外装のみ', 'シェルのみ', 'ガワのみ', 'ハウジングのみ', '部品取り',
];

function norm(s) { return String(s || '').normalize('NFKC').replace(/\s+/g, ''); }
function ngWordIn(text) {
  const t = norm(text);
  return NG_DESC_WORDS.find((w) => t.includes(norm(w))) || null;
}

module.exports = { NG_DESC_WORDS, ngWordIn };
