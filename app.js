'use strict';
/* Ders Takip — özel ders programı, ders yoklaması ve ödeme takibi.
   Tüm veriler yalnızca bu cihazda (localStorage) tutulur; yedek dosyasıyla taşınır. */

const KEY = 'dersTakip.v1';
const GUN = ['', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
const GUNK = ['', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const AY = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const DUZEN = { haftalik: 'Haftalık ödeme', paket: 'Paket (peşin)', ders: 'Ders başı ödeme' };
const YONTEM = { elden: 'Elden', iban: 'IBAN' };
const DURUM = { planlandi: 'Planlandı', yapildi: 'Yapıldı', iptal: 'İptal edildi', ertelendi: 'Ertelendi' };

/* ---------- yardımcılar ---------- */
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
const bugun = () => ymd(new Date());
const dow = s => { const g = parse(s).getDay(); return g === 0 ? 7 : g; };
const pazartesi = s => addDays(s, 1 - dow(s));
const tarihYaz = (s, gunlu = true) => { const d = parse(s); return `${d.getDate()} ${AY[d.getMonth()]}` + (gunlu ? ` ${GUN[dow(s)]}` : ''); };
const tl = n => Math.round(n).toLocaleString('tr-TR') + ' TL';
const dk = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const saat = m => `${pad(Math.floor(m / 60) % 24)}:${pad(((m % 60) + 60) % 60)}`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sirala = (a, b) => (a.tarih + a.bas).localeCompare(b.tarih + b.bas);
const adSirala = (a, b) => a.ad.localeCompare(b.ad, 'tr');
/* 24 saat biçiminde saat seçici (cihazın ÖÖ/ÖS ayarından bağımsız).
   Değer gizli <input name="..."> içinde "HH:MM" olarak tutulur; seçim değişince input'a "change" gönderilir. */
function saatAlani(name, val = '17:00') {
  const [h, m] = (val || '17:00').split(':');
  const saatler = [...Array(18)].map((_, i) => pad(i + 6));            // 06–23
  const dakikalar = [...Array(12)].map((_, i) => pad(i * 5));          // 00, 05 … 55
  if (!saatler.includes(h)) saatler.push(h);
  if (!dakikalar.includes(m)) dakikalar.push(m);
  saatler.sort(); dakikalar.sort();
  const sec = (l, v) => l.map(x => `<option ${x === v ? 'selected' : ''}>${x}</option>`).join('');
  return `<span class="saat-sec"><select data-p="h" aria-label="Saat">${sec(saatler, h)}</select><b>:</b><select data-p="m" aria-label="Dakika">${sec(dakikalar, m)}</select><input type="hidden" name="${name}" value="${h}:${m}"></span>`;
}
function saatYaz(inp, val) {
  const w = inp.closest('.saat-sec'), [h, m] = val.split(':');
  for (const [p, v] of [['h', h], ['m', m]]) {
    const s = w.querySelector(`[data-p=${p}]`);
    if (![...s.options].some(o => o.value === v)) s.add(new Option(v, v));
    s.value = v;
  }
  inp.value = val;
}
/* Tarih kutusunun altında Türkçe okunuşu ("6 Kasım Cuma") */
document.addEventListener('input', e => {
  if (e.target.type !== 'date') return;
  const y = e.target.nextElementSibling;
  if (y?.classList.contains('tarih-yazi')) y.textContent = /^\d{4}-\d{2}-\d{2}$/.test(e.target.value) ? tarihYaz(e.target.value) : '';
});
document.addEventListener('change', e => {
  if (e.target.tagName !== 'SELECT') return;
  const w = e.target.closest('.saat-sec'); if (!w) return;
  const inp = w.querySelector('input');
  inp.value = `${w.querySelector('[data-p=h]').value}:${w.querySelector('[data-p=m]').value}`;
  inp.dispatchEvent(new Event('change'));
});
const sayi = v => { const n = Number(String(v).replace(/\./g, '').replace(',', '.')); return isFinite(n) ? n : NaN; };

/* ---------- veri ---------- */
function bosDb() { return { surum: 1, ayarlar: { ad: '', iban: '', ibanAd: '', sonYedek: null }, ogrenciler: [], dersler: [], odemeler: [] }; }
function gocEt(x) {
  x.ayarlar ||= {}; x.ogrenciler ||= []; x.dersler ||= []; x.odemeler ||= [];
  for (const o of x.ogrenciler) { o.program ||= []; o.odemeDuzeni ||= 'haftalik'; o.yontem ||= 'elden'; o.paketDers ||= 8; }
  // Eski kayıtlardaki ücretsiz "tanışma" ve "hibe" dersleri → değerlendirme dersi
  for (const d of x.dersler || []) {
    if (d.ucret === 0 && !d.tur && /^(Tanışma dersi|Hibe)/.test(d.not || '')) {
      const kim = (d.not.match(/^Tanışma dersi \(([^)]+)\)/) || [])[1];
      d.tur = 'degerlendirme';
      const kendi = (x.ogrenciler || []).find(o => o.id === d.ogrenciId)?.ad;
      d.not = kim && kim !== kendi ? `Değerlendirme dersi (${kim})` : 'Değerlendirme dersi';
    }
  }
  // Haftalık yedek hatırlatması bu tarihten sayılır (hiç yedek alınmadıysa)
  x.ayarlar.yedekSayac ||= x.ayarlar.sonYedek || new Date().toISOString();
  return x;
}
let db = null;
try { db = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { db = null; }
if (db && !db.ayarlar?.yedekSayac) { gocEt(db); localStorage.setItem(KEY, JSON.stringify(db)); }
else if (db) gocEt(db);

function kaydet() {
  db.degisti = new Date().toISOString();
  localStorage.setItem(KEY, JSON.stringify(db));
  HC.clear(); PC.clear(); GC.clear();
}
const ogr = id => db.ogrenciler.find(o => o.id === id);

/* Haftalık programdan gelen dersler, işaretlenene kadar "sanal" kalır;
   bir işlem yapılınca gerçek kayda dönüşür. */
function gunDersleri(t) {
  const g = dow(t);
  const list = db.dersler.filter(x => x.tarih === t && ogr(x.ogrenciId));
  for (const o of db.ogrenciler) {
    if (o.aktif === false && (!o.ayrilis || t >= o.ayrilis)) continue;
    if (o.baslangic && t < o.baslangic) continue;
    for (const s of o.program) {
      if (s.gun !== g) continue;
      if (db.dersler.some(x => x.slotId === s.id && x.slotTarih === t)) continue;
      list.push({ id: `v|${s.id}|${t}`, sanal: true, ogrenciId: o.id, tarih: t, bas: s.bas, bit: s.bit, ucret: s.ucret, durum: 'planlandi', kaynak: 'program', slotId: s.id, slotTarih: t });
    }
  }
  return list.sort((a, b) => a.bas.localeCompare(b.bas));
}
function dersBul(id) {
  if (id.startsWith('v|')) { const t = id.split('|')[2]; return gunDersleri(t).find(x => x.id === id); }
  return db.dersler.find(x => x.id === id);
}
function gercekle(d) {
  if (!d.sanal) return db.dersler.find(x => x.id === d.id) || d;
  const n = { ...d, id: uid() }; delete n.sanal;
  db.dersler.push(n); return n;
}
function isaretlenmemis() {
  const b = bugun(), out = [];
  for (let t = addDays(b, -60); t < b; t = addDays(t, 1)) out.push(...gunDersleri(t).filter(x => x.durum === 'planlandi'));
  return out;
}

/* Gün listesi önbelleği (her çizimde sıfırlanır) */
const GC = new Map();
const gunDersleriC = t => { if (!GC.has(t)) GC.set(t, gunDersleri(t)); return GC.get(t); };

/* Bakiye ve ödeme dağıtımı (öğrenci başına):
   - Bakiye = ödemeler − yapılan derslerin ücreti.
   - Bir derse bağlı ödeme (dersId) önce o derse yazılır.
   - Kalan ödemeler, tarih sırasıyla önce yapılan derslere (en eskiden), sonra planlı derslere dağıtılır.
   - Her ders hangi ödemeyle karşılandığını bilir; birden fazla dersi karşılayan ya da dersten önce
     yapılan ödeme "önden ödeme" sayılır ve derslerine 1/N, 2/N … sırası verilir. */
const HC = new Map();
function H(oid) {
  if (HC.has(oid)) return HC.get(oid);
  const o = ogr(oid), b = bugun();
  const odemeler = db.odemeler.filter(p => p.ogrenciId === oid).sort((x, y) => x.tarih.localeCompare(y.tarih));
  const odenen = odemeler.reduce((a, p) => a + p.tutar, 0);
  const yapilan = db.dersler.filter(d => d.ogrenciId === oid && d.durum === 'yapildi').sort(sirala);
  const borc = yapilan.reduce((a, d) => a + d.ucret, 0);
  // Planlı dersler (gerçek + programdan gelen), bugünün 60 gün öncesinden 90 gün sonrasına
  const planli = [];
  for (let t = addDays(b, -60); t <= addDays(b, 90); t = addDays(t, 1))
    for (const x of gunDersleriC(t)) if (x.ogrenciId === oid && x.durum === 'planlandi') planli.push(x);
  const sira = [...yapilan, ...planli];
  const kalan = new Map(sira.map(d => [d.id, d.ucret]));   // dersin karşılanmamış tutarı
  const kaynak = new Map();                                  // ders → onu karşılayan (ilk) ödeme
  const kapsam = new Map(odemeler.map(p => [p.id, []]));     // ödeme → [{ d: ders, a: tutar }]
  const artan = new Map();                                   // ödeme → hiçbir derse dağıtılamayan kısım
  const kuyruk = [];
  for (const p of odemeler) {
    let m = p.tutar;
    if (p.dersId && kalan.has(p.dersId)) {
      const a = Math.min(m, kalan.get(p.dersId));
      if (a > 0) { kalan.set(p.dersId, kalan.get(p.dersId) - a); kaynak.set(p.dersId, p); kapsam.get(p.id).push({ d: sira.find(x => x.id === p.dersId), a }); }
      m -= a;
    }
    if (m > 0) kuyruk.push({ p, m });
  }
  let qi = 0;
  for (const d of sira) {
    let k = kalan.get(d.id);
    while (k > 0 && qi < kuyruk.length) {
      const q = kuyruk[qi], a = Math.min(k, q.m);
      if (!kaynak.has(d.id)) kaynak.set(d.id, q.p);
      kapsam.get(q.p.id).push({ d, a });
      k -= a; q.m -= a; if (q.m <= 0) qi++;
    }
    kalan.set(d.id, k);
  }
  for (const q of kuyruk) if (q.m > 0) artan.set(q.p.id, q.m);
  const odenmis = new Set(), pesin = new Set(), odenmemis = [];
  for (const d of yapilan) (kalan.get(d.id) <= 0 ? odenmis.add(d.id) : odenmemis.push(d));
  for (const d of planli) if (kalan.get(d.id) <= 0) pesin.add(d.id);
  // Önden ödeme blokları
  const gruplar = new Map();
  for (const d of sira) {
    const p = kaynak.get(d.id);
    if (!p || kalan.get(d.id) > 0 || d.ucret === 0) continue;
    if (!gruplar.has(p.id)) gruplar.set(p.id, { p, l: [] });
    gruplar.get(p.id).l.push(d);
  }
  const blok = new Map();
  for (const { p, l } of gruplar.values()) {
    l.sort(sirala);
    // Önden ödeme: ilk dersten önce ya da o gün alınmış ve (birden fazla dersi kapsıyor ya da dersten önce alınmış)
    if (p.tarih > l[0].tarih || !(l.length >= 2 || p.tarih < l[0].tarih)) continue;
    const N = Math.max(l.length, p.paketDers || 0), yap = l.filter(d => d.durum === 'yapildi').length;
    l.forEach((d, i) => blok.set(d.id, { k: i + 1, N, yapildi: yap, odeme: p }));
  }
  const prog = o?.program || [];
  const birim = prog[0]?.ucret || yapilan.at(-1)?.ucret || 0;
  const haftalik = prog.reduce((a, s) => a + s.ucret, 0);
  const r = { bakiye: odenen - borc, odenmis, odenmemis, pesin, kalan, blok, kapsam, artan, birim, haftalik };
  HC.set(oid, r); return r;
}
function odendiMi(d) {
  const h = H(d.ogrenciId);
  if (d.durum === 'yapildi') return h.odenmis.has(d.id);
  if (d.durum === 'planlandi') return h.pesin.has(d.id);
  return false;
}
/* Paket öğrencilerinde her yapılan derse "3/8" gibi sıra numarası. */
const PC = new Map();
function paketEt(oid) {
  if (PC.has(oid)) return PC.get(oid);
  const o = ogr(oid), et = {};
  if (o?.odemeDuzeni === 'paket') {
    const ev = [
      ...db.odemeler.filter(p => p.ogrenciId === oid && p.paketDers).map(p => ({ k: p.tarih + ' 00', p })),
      ...db.dersler.filter(d => d.ogrenciId === oid && d.durum === 'yapildi').map(d => ({ k: d.tarih + ' ' + d.bas, d }))
    ].sort((a, b) => a.k.localeCompare(b.k));
    let n = 0, N = 0;
    for (const e of ev) { if (e.p) { n = 0; N = e.p.paketDers; } else if (N) { n++; et[e.d.id] = `${n}/${N}`; } }
  }
  PC.set(oid, et); return et;
}
function alacaklar() {
  const liste = db.ogrenciler.map(o => ({ o, b: H(o.id).bakiye })).filter(x => x.b < 0).sort((a, b) => a.b - b.b);
  return { liste, toplam: liste.reduce((a, x) => a - x.b, 0) };
}

/* ---------- ekran durumu ---------- */
const E = { sekme: 'bugun', hafta: pazartesi(bugun()), ay: bugun().slice(0, 7), ogrenci: null, tumGecmis: false };

function render() {
  HC.clear(); PC.clear(); GC.clear();
  if (!db) { karsilama(); return; }
  $('#alt').hidden = false;
  let r;
  if (E.sekme === 'ogrenciler' && E.ogrenci && ogr(E.ogrenci)) r = sOgrenci(ogr(E.ogrenci));
  else { E.ogrenci = null; r = ({ bugun: sBugun, hafta: sHafta, ogrenciler: sOgrenciler, program: sProgram, kasa: sKasa, ayarlar: sAyarlar })[E.sekme](); }
  $('#baslik').textContent = r.baslik;
  $('#geri').hidden = !r.geri;
  $('#ust-sag').innerHTML = r.sag || '';
  $('#icerik').innerHTML = r.html;
  $$('#alt button').forEach(b => b.classList.toggle('aktif', b.dataset.sekme === E.sekme));
}

/* ---------- parçalar ---------- */
function kart(et, deger, alt = '', renk = '', git = '') {
  const tag = git ? 'button' : 'div';
  return `<${tag} class="kart ${renk}" ${git ? `data-git="${git}"` : ''}><span class="k-et">${et}</span><span class="k-deger">${deger}</span><span class="k-alt">${alt}</span></${tag}>`;
}
function renkTonu(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }

function dersSatiri(d, { tarihli = false } = {}) {
  const o = ogr(d.ogrenciId); if (!o) return '';
  let rozet = '';
  if (d.tur === 'degerlendirme') rozet = '<span class="rozet mavi">Değerlendirme</span>';
  // Önden ödeme: "Önden ödeme · 7/8 (6 yapıldı)"
  const bl = (d.durum === 'yapildi' || d.durum === 'planlandi') && H(o.id).blok.get(d.id);
  const onden = bl ? `<div class="d-onden"><b>önden ödeme · ${bl.k}/${bl.N}</b> <span>(${bl.yapildi} yapıldı)</span></div>` : '';
  if (d.durum === 'iptal') rozet = '<span class="rozet gri">İptal</span>';
  else if (d.durum === 'ertelendi') {
    const n = db.dersler.find(x => x.id === d.ertelemeId);
    rozet = `<span class="rozet turuncu">→ ${n ? tarihYaz(n.tarih, false) + ' ' + n.bas : 'Ertelendi'}</span>`;
  } else if (d.kaynak === 'erteleme') rozet += '<span class="rozet mavi">Telafi</span>';
  else if (d.kaynak === 'ekstra') rozet += '<span class="rozet mavi">Ekstra</span>';

  let hizli = '';
  if (d.durum === 'planlandi' || d.durum === 'yapildi') {
    const yap = d.durum === 'yapildi', od = odendiMi(d);
    hizli = `<div class="ikili">
      <button class="tus tus-yapildi ${yap ? 'acik' : ''}" data-hizli="ders" data-id="${d.id}" aria-pressed="${yap}"><span class="i">${yap ? '✓' : '–'}</span>${yap ? 'Yapıldı' : 'Yapılmadı'}</button>
      <button class="tus tus-odendi ${od ? 'acik' : yap ? 'bekliyor' : ''}" data-hizli="odeme" data-id="${d.id}" aria-pressed="${od}"><span class="i">₺</span>${d.ucret === 0 ? 'Ücretsiz' : od ? (yap ? 'Ödendi' : 'Peşin') : 'Ödenmedi'}</button>
    </div>`;
  }

  return `<div class="ders d-${d.durum}" data-ders="${d.id}">
    <div class="d-saat"><b>${d.bas}</b><span>${d.bit}</span></div>
    <div class="d-orta"><div class="d-ad">${esc(o.ad)}</div>${onden}
      <div class="d-alt">${tarihli ? `<span>${tarihYaz(d.tarih)}</span>` : ''}<span>${d.ucret === 0 ? 'Ücretsiz' : tl(d.ucret)}</span>${rozet}</div>
      ${d.not ? `<div class="d-not">${esc(d.not)}</div>` : ''}</div>
    ${hizli}</div>`;
}

function bakiyeRozet(o) {
  const h = H(o.id);
  if (h.bakiye < 0) return `<span class="rozet kirmizi buyuk">${tl(-h.bakiye)} alacak</span>`;
  if (o.odemeDuzeni === 'paket' && h.birim) {
    const k = Math.floor(h.bakiye / h.birim);
    return k > 0 ? `<span class="rozet ${k <= 1 ? 'turuncu' : 'yesil'} buyuk">${k} ders kaldı</span>` : '<span class="rozet turuncu buyuk">Paket bitti</span>';
  }
  if (h.bakiye > 0) return `<span class="rozet yesil buyuk">${tl(h.bakiye)} peşin</span>`;
  return '<span class="rozet gri buyuk">Borç yok</span>';
}

function yedekUyari() {
  if (!db.ogrenciler.length) return '';
  const s = db.ayarlar.sonYedek, baz = s || db.ayarlar.yedekSayac;
  if (!baz) { db.ayarlar.yedekSayac = new Date().toISOString(); localStorage.setItem(KEY, JSON.stringify(db)); return ''; }
  const g = Math.floor((Date.now() - new Date(baz)) / 864e5);
  if (g < 7) return '';
  return `<div class="uyari-kutu">📦 <b>Haftalık yedek zamanı.</b> ${s ? `Son yedek ${g} gün önce alındı.` : ''}
    <button class="btn ana genis" data-act="yedek-al">Şimdi yedek al</button>
    <span class="kucuk-yazi" style="display:block;margin:8px 0 0">Açılan pencerede <b>"Dosyalar'a Kaydet"</b> → <b>iCloud Drive</b> seç.</span></div>`;
}

/* ---------- sayfalar ---------- */
function sBugun() {
  const b = bugun();
  let h = yedekUyari();
  const isr = isaretlenmemis();
  if (isr.length) h += `<h3 class="bolum uyari">İşaretlenmemiş dersler <span class="sayi">${isr.length}</span></h3>
    <p class="ipucu">Geçmiş günlerde olup durumu girilmemiş dersler. "Yapıldı"ya bas; iptal ya da erteleme için dersin adına dokun.</p>
    <div class="liste">${isr.map(d => dersSatiri(d, { tarihli: true })).join('')}</div>`;
  const bg = gunDersleri(b);
  h += `<h3 class="bolum bugun">Bugün · ${tarihYaz(b)}</h3>` + (bg.length ? `<div class="liste">${bg.map(d => dersSatiri(d)).join('')}</div>` : '<div class="bos">Bugün ders yok.</div>');
  const y = addDays(b, 1), yg = gunDersleri(y);
  h += `<h3 class="bolum">Yarın · ${tarihYaz(y)}</h3>` + (yg.length ? `<div class="liste">${yg.map(d => dersSatiri(d)).join('')}</div>` : '<div class="bos">Yarın ders yok.</div>');

  const al = alacaklar();
  const p = pazartesi(b), son = addDays(p, 6);
  const tah = db.odemeler.filter(x => x.tarih >= p && x.tarih <= son).reduce((a, x) => a + x.tutar, 0);
  h += `<div class="kartlar">
    ${kart('Toplam alacak', tl(al.toplam), al.liste.length ? al.liste.map(x => esc(x.o.ad)).join(', ') : 'Kimsenin borcu yok', al.toplam > 0 ? 'kirmizi' : 'yesil', 'kasa')}
    ${kart('Bu hafta tahsil edilen', tl(tah), 'Haftalık programa git', 'yesil', 'hafta')}
  </div>
  <div class="buton-satiri"><button class="btn ana" data-act="odeme-yeni"><span class="arti">+</span>Ödeme kaydet</button><button class="btn" data-act="ders-yeni"><span class="arti">+</span>Ekstra ders</button></div>`;
  return { baslik: 'Bugün', html: h };
}

function haftaAd(p) {
  const a = parse(p), b = parse(addDays(p, 6));
  return a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${AY[b.getMonth()]}` : `${a.getDate()} ${AY[a.getMonth()]} – ${b.getDate()} ${AY[b.getMonth()]}`;
}
/* Haftanın hesabı:
   - toplam: haftadaki derslerin tutarı (iptal / ertelenen hariç; değerlendirme ücretsiz)
   - tahsil: hafta içinde alınan ödemeler (önden ödemeler dahil)
   - alacak: bu haftanın derslerinden henüz karşılanmamış tutar */
function haftaHesap(p) {
  const son = addDays(p, 6), dersler = [];
  for (let i = 0; i < 7; i++) dersler.push(...gunDersleri(addDays(p, i)));
  const gecerli = dersler.filter(d => d.durum === 'planlandi' || d.durum === 'yapildi');
  const kalanTutar = d => d.ucret === 0 ? 0 : (H(d.ogrenciId).kalan.get(d.id) ?? d.ucret);
  const odemeler = db.odemeler.filter(x => x.tarih >= p && x.tarih <= son && ogr(x.ogrenciId)).sort((a, b) => a.tarih.localeCompare(b.tarih));
  return {
    dersler, gecerli, odemeler, kalanTutar,
    iptal: dersler.filter(d => d.durum === 'iptal'),
    toplam: gecerli.reduce((a, d) => a + d.ucret, 0),
    tahsil: odemeler.reduce((a, x) => a + x.tutar, 0),
    alacak: gecerli.reduce((a, d) => a + kalanTutar(d), 0)
  };
}
function hesapKart(tur, et, deger, alt, renk = '') {
  return `<button class="kart ${renk}" data-act="hafta-detay" data-tur="${tur}"><span class="k-et">${et}</span><span class="k-deger">${deger}</span><span class="k-alt">${alt}</span><span class="k-detay">ayrıntı ›</span></button>`;
}
function sHafta() {
  const p = E.hafta, b = bugun();
  const govde = [...Array(7)].map((_, i) => {
    const t = addDays(p, i), l = gunDersleri(t);
    if (!l.length) return '';
    return `<h3 class="bolum ${t === b ? 'bugun' : ''}">${tarihYaz(t)}${t === b ? ' · bugün' : ''}</h3><div class="liste">${l.map(d => dersSatiri(d)).join('')}</div>`;
  }).join('');
  const hh = haftaHesap(p);
  const h = `<div class="hafta-nav">
      <button class="btn kucuk" data-act="hafta-onceki" aria-label="Önceki hafta">‹</button>
      <button class="hafta-ad" data-act="hafta-bu">${haftaAd(p)}${p === pazartesi(b) ? '' : '<br><small style="color:var(--ana);font-size:12px">Bu haftaya dön</small>'}</button>
      <button class="btn kucuk" data-act="hafta-sonraki" aria-label="Sonraki hafta">›</button></div>
    <div class="kartlar uc">
      ${hesapKart('toplam', 'Haftanın toplamı', tl(hh.toplam), `${hh.gecerli.length} ders${hh.iptal.length ? ` · ${hh.iptal.length} iptal` : ''}`)}
      ${hesapKart('tahsil', 'Tahsil edilen', tl(hh.tahsil), `${hh.odemeler.length} ödeme`, 'yesil')}
      ${hesapKart('alacak', 'Kalan alacak', tl(hh.alacak), hh.alacak ? 'ödenmemiş' : 'hepsi ödendi', hh.alacak ? 'kirmizi' : '')}
    </div>
    ${govde || '<div class="bos" style="margin-top:16px">Bu hafta ders yok.</div>'}
    <div class="buton-satiri"><button class="btn" data-act="ders-yeni"><span class="arti">+</span>Ekstra ders</button><button class="btn" data-act="odeme-yeni"><span class="arti">+</span>Ödeme kaydet</button></div>`;
  return { baslik: 'Haftalık program', html: h };
}

/* Program sekmesi: defterdeki "Haftalık Ders Planı" gibi saat çizelgesi (09–19) */
function sProgram() {
  const p = E.hafta, b = bugun();
  const dk = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const gunler = [...Array(7)].map((_, i) => addDays(p, i));
  const hepsi = gunler.flatMap(t => gunDersleri(t));
  let ilk = 9, son = 19;
  for (const d of hepsi) { ilk = Math.min(ilk, Math.floor(dk(d.bas) / 60)); son = Math.max(son, Math.ceil(dk(d.bit) / 60)); }
  // Her öğrenciye belirgin farklı bir renk; aynı ilk adı taşıyanlar "Öykü B." gibi ayrılır
  const TON = [205, 340, 145, 30, 270, 0, 185, 95, 300, 50, 230, 160];
  const ton = new Map(db.ogrenciler.map((o, i) => [o.id, TON[i % TON.length]]));
  const kisaAd = o => { const [a, b2] = o.ad.split(' '); return b2 && db.ogrenciler.some(x => x !== o && x.ad.split(' ')[0] === a) ? `${a} ${b2[0]}.` : a; };
  const SY = 46, px = m => (m - ilk * 60) * SY / 60;
  const saatler = [...Array(son - ilk + 1)].map((_, i) => ilk + i);

  const kolon = t => {
    const l = gunDersleri(t).filter(d => d.durum !== 'ertelendi');
    // Çakışan dersler yan yana bölünür
    const serit = [], sira = new Map();
    for (const d of l) { let i = serit.findIndex(s => s <= dk(d.bas)); if (i < 0) { i = serit.length; serit.push(0); } serit[i] = dk(d.bit); sira.set(d.id, i); }
    const n = Math.max(1, serit.length);
    const bloklar = l.map(d => {
      const o = ogr(d.ogrenciId), ad = kisaAd(o);
      const top = px(dk(d.bas)), h = Math.max(22, px(dk(d.bit)) - top);
      const isaret = d.durum === 'yapildi' ? ' ✓' : '';
      return `<button class="pb p-${d.durum}${d.tur === 'degerlendirme' ? ' p-deg' : ''}" data-ders="${d.id}" style="--h:${ton.get(o.id)};top:${top}px;height:${h - 2}px;left:calc(${sira.get(d.id) * 100 / n}% + 1px);width:calc(${100 / n}% - 2px)">
        <b${ad.replace(/ .*/, "").length > 6 ? ' class="uzun"' : ""}>${esc(ad)}</b><span>${d.bas}${isaret}</span></button>`;
    }).join('');
    const simdi = t === b ? (() => { const n2 = new Date(), m = n2.getHours() * 60 + n2.getMinutes(); return m >= ilk * 60 && m <= son * 60 ? `<div class="p-simdi" style="top:${px(m)}px"></div>` : ''; })() : '';
    return `<div class="p-gun${t === b ? ' bugun' : ''}" style="height:${(son - ilk) * SY}px">${bloklar}${simdi}</div>`;
  };

  const ust = gunler.map(t => `<div class="p-bas${t === b ? ' bugun' : ''}"><span>${GUNK[dow(t)]}</span><b>${parse(t).getDate()}</b></div>`).join('');
  const sol = saatler.slice(0, -1).map(h => `<div style="height:${SY}px">${String(h).padStart(2, '0')}:00</div>`).join('');
  const gecerli = hepsi.filter(d => d.durum === 'planlandi' || d.durum === 'yapildi');
  const saat = gecerli.reduce((a, d) => a + dk(d.bit) - dk(d.bas), 0) / 60;

  const h = `<div class="hafta-nav">
      <button class="btn kucuk" data-act="hafta-onceki" aria-label="Önceki hafta">‹</button>
      <button class="hafta-ad" data-act="hafta-bu">${haftaAd(p)}${p === pazartesi(b) ? '' : '<br><small style="color:var(--ana);font-size:12px">Bu haftaya dön</small>'}</button>
      <button class="btn kucuk" data-act="hafta-sonraki" aria-label="Sonraki hafta">›</button></div>
    <div class="plan">
      <div class="p-ust"><div></div>${ust}</div>
      <div class="p-govde" style="--sy:${SY}px">
        <div class="p-saatler">${sol}</div>
        ${gunler.map(kolon).join('')}
      </div>
    </div>
    <p class="ipucu" style="text-align:center;margin-top:10px">${gecerli.length} ders · ${String(+saat.toFixed(1)).replace('.', ',')} saat. Bir derse dokununca ayrıntısı açılır.<br>
      <span class="p-lej"><i class="l-yap"></i>yapıldı</span> <span class="p-lej"><i class="l-plan"></i>planlı</span> <span class="p-lej"><i class="l-ipt"></i>iptal</span></p>`;
  return { baslik: 'Haftalık plan', html: h };
}

/* Haftalık kartların ayrıntısı */
function haftaDetay(tur) {
  const p = E.hafta, hh = haftaHesap(p);
  const gunK = t => `${parse(t).getDate()} ${AY[parse(t).getMonth()].slice(0, 3)} ${GUNK[dow(t)]}`;
  const satir = (sol, sag, alt = '', sinif = '') => `<div class="${sinif}"><span>${sol}${alt ? `<small>${alt}</small>` : ''}</span><b>${sag}</b></div>`;
  let baslik, x;

  if (tur === 'toplam') {
    baslik = `Haftanın toplamı · ${haftaAd(p)}`;
    x = `<p class="ipucu" style="margin:4px 0 10px">Bu haftaki derslerin toplam ücreti. İptal edilen ve başka güne ertelenen dersler hesaba katılmaz.</p>
      <div class="bilgi detay">${hh.gecerli.map(d => satir(`${gunK(d.tarih)} ${d.bas} · ${esc(ogr(d.ogrenciId).ad)}`,
        d.ucret === 0 ? 'Ücretsiz' : tl(d.ucret), d.tur === 'degerlendirme' ? 'Değerlendirme dersi' : d.durum === 'yapildi' ? 'Yapıldı' : 'Henüz yapılmadı')).join('') || satir('Bu hafta ders yok', '')}
      ${satir('<b>Toplam</b>', tl(hh.toplam), '', 'toplam')}</div>`;
    const disari = hh.dersler.filter(d => d.durum === 'iptal' || d.durum === 'ertelendi');
    if (disari.length) x += `<h3 class="bolum">Hesaba katılmayanlar</h3><div class="bilgi detay">${disari.map(d => {
      const n = d.durum === 'ertelendi' && db.dersler.find(z => z.id === d.ertelemeId);
      return satir(`<s>${gunK(d.tarih)} ${d.bas} · ${esc(ogr(d.ogrenciId).ad)}</s>`, `<s>${tl(d.ucret)}</s>`, d.durum === 'iptal' ? 'İptal edildi' : `Ertelendi${n ? ` → ${gunK(n.tarih)} ${n.bas}` : ''}`);
    }).join('')}</div>`;
  }

  else if (tur === 'tahsil') {
    baslik = `Tahsil edilen · ${haftaAd(p)}`;
    const elden = hh.odemeler.filter(o => o.yontem === 'elden').reduce((a, o) => a + o.tutar, 0);
    x = `<p class="ipucu" style="margin:4px 0 10px">Bu hafta içinde alınan bütün ödemeler (önden ödemeler dahil). Ödemenin alındığı gün esas alınır; bu yüzden başka haftaların dersleri için alınan paralar da burada görünür. Her ödemenin altında hangi derslere sayıldığı yazar.</p>
      <div class="bilgi detay">${hh.odemeler.map(o => {
        const h = H(o.ogrenciId), k = h.kapsam.get(o.id) || [], ar = h.artan.get(o.id);
        const dersler = k.map(({ d, a }) => `${gunK(d.tarih)}${d.durum === 'planlandi' ? ' (yapılmadı)' : ''} ${tl(a)}`).join(' · ');
        const onden = k.some(({ d }) => d.tarih > o.tarih);
        return satir(`${gunK(o.tarih)} · ${esc(ogr(o.ogrenciId).ad)} <span class="rozet ${o.yontem === 'iban' ? 'mavi' : 'gri'}">${YONTEM[o.yontem]}</span>${onden ? ' <span class="rozet yesil">önden</span>' : ''}`, tl(o.tutar),
          `${dersler ? 'Karşıladığı dersler: ' + dersler : ''}${ar ? `${dersler ? '<br>' : ''}${tl(ar)} peşin bakiye olarak duruyor` : ''}${o.paketDers ? `<br>${o.paketDers} derslik paket` : ''}${o.not ? `<br>Not: ${esc(o.not)}` : ''}`);
      }).join('') || satir('Bu hafta ödeme alınmadı', '')}
      ${satir('Elden', tl(elden))}${satir('IBAN', tl(hh.tahsil - elden))}
      ${satir('<b>Toplam</b>', tl(hh.tahsil), '', 'toplam')}</div>`;
  }

  else {
    baslik = `Kalan alacak · ${haftaAd(p)}`;
    const ogrler = {};
    for (const d of hh.gecerli) { const k = hh.kalanTutar(d); if (k > 0) (ogrler[d.ogrenciId] ||= []).push({ d, k }); }
    const sirali = Object.entries(ogrler).sort((a, b) => adSirala(ogr(a[0]), ogr(b[0])));
    x = `<p class="ipucu" style="margin:4px 0 10px">Bu haftanın derslerinden ödemesi henüz alınmamış tutar. Yapılmamış dersler de dahil; onların parası genelde ders günü alınır.</p>`;
    x += sirali.length ? sirali.map(([oid, l]) => `<h3 class="bolum" style="margin-top:14px">${esc(ogr(oid).ad)} · ${tl(l.reduce((a, z) => a + z.k, 0))}</h3>
      <div class="bilgi detay">${l.map(({ d, k }) => satir(`${gunK(d.tarih)} ${d.bas}`, tl(k), `${d.durum === 'yapildi' ? 'Ders yapıldı, ödenmedi' : 'Ders henüz yapılmadı'}${k < d.ucret ? ` · ${tl(d.ucret - k)} kısmen ödendi` : ''}`)).join('')}</div>`).join('')
      + `<div class="bilgi detay" style="margin-top:14px">${satir('<b>Toplam kalan alacak</b>', tl(hh.alacak), '', 'toplam')}</div>`
      : '<div class="bos">Bu haftanın bütün dersleri ödendi.</div>';
  }
  sheet(baslik, x);
}

function ogrSatiri(o) {
  const gunler = [...new Set(o.program.map(s => s.gun))].sort().map(g => GUNK[g]).join(', ');
  return `<div class="ogr" data-ogr="${o.id}">
    <div class="avatar" style="--h:${renkTonu(o.ad)}">${esc(o.ad.charAt(0).toLocaleUpperCase('tr'))}</div>
    <div class="d-orta"><div class="d-ad">${esc(o.ad)}</div><div class="d-alt">${DUZEN[o.odemeDuzeni]} · ${YONTEM[o.yontem]}${gunler ? ' · ' + gunler : ''}</div></div>
    ${bakiyeRozet(o)}</div>`;
}
function sOgrenciler() {
  const akt = db.ogrenciler.filter(o => o.aktif !== false).sort(adSirala);
  const pas = db.ogrenciler.filter(o => o.aktif === false).sort(adSirala);
  let h = akt.length ? `<div class="liste" style="margin-top:8px">${akt.map(ogrSatiri).join('')}</div>` : '<div class="bos" style="margin-top:8px">Henüz öğrenci yok.</div>';
  if (pas.length) h += `<h3 class="bolum">Arşiv · ders almayı bırakanlar</h3><p class="ipucu">Tüm geçmiş dersleri ve ödemeleri saklanıyor. Görmek için dokun.</p><div class="liste">${pas.map(ogrSatiri).join('')}</div>`;
  h += `<button class="btn ana genis" data-act="ogr-yeni" style="margin-top:18px"><span class="arti">+</span>Yeni öğrenci ekle</button>`;
  return { baslik: 'Öğrenciler', html: h, sag: '<button class="ust-btn" data-act="ogr-yeni"><span class="arti">+</span>Ekle</button>' };
}

function sOgrenci(o) {
  const h = H(o.id), b = bugun();
  let ust;
  if (h.bakiye < 0) ust = `<div class="bakiye kirmizi"><span>Alacak</span><b>${tl(-h.bakiye)}</b><small>${h.odenmemis.length} dersin ödemesi bekleniyor: ${h.odenmemis.map(d => tarihYaz(d.tarih, false)).join(', ')}</small></div>`;
  else if (h.bakiye > 0) {
    const k = h.birim ? Math.floor(h.bakiye / h.birim) : 0;
    ust = `<div class="bakiye yesil"><span>${o.odemeDuzeni === 'paket' ? 'Paketten kalan' : 'Peşin ödenmiş'}</span><b>${o.odemeDuzeni === 'paket' ? k + ' ders' : tl(h.bakiye)}</b><small>${o.odemeDuzeni === 'paket' ? tl(h.bakiye) + ' peşin bakiye' : k ? k + ' dersi karşılıyor' : ''}</small></div>`;
  } else ust = `<div class="bakiye gri"><span>Hesap</span><b>${o.odemeDuzeni === 'paket' ? 'Paket bitti' : 'Borç yok'}</b><small>${o.odemeDuzeni === 'paket' ? 'Yeni paket ödemesi alınabilir' : 'Yapılan tüm derslerin ödemesi alındı'}</small></div>`;

  if (o.aktif === false) {
    const a = o.ayrilis ? parse(o.ayrilis) : null;
    ust = `<div class="arsiv-kutu">🗄 <b>Arşivde</b>${a ? ` · ${a.getDate()} ${AY[a.getMonth()]} ${a.getFullYear()} tarihinde ders almayı bıraktı` : ''}. Tüm geçmişi aşağıda.
      <button class="btn genis" data-act="arsivden-cikar">Arşivden çıkar (derslere yeniden başladı)</button></div>` + ust;
  }
  let x = ust + `<div class="dortlu">
    <button class="btn" data-act="odeme-ogr"><span class="ikon">₺</span>Ödeme</button>
    <button class="btn" data-act="ders-ogr"><span class="ikon"><span class="arti buyuk">+</span></span>Ders ekle</button>
    <button class="btn" data-act="ogr-duzenle"><span class="ikon">✎</span>Düzenle</button></div>`;

  x += `<h3 class="bolum">Bilgiler</h3><div class="bilgi">
    <div><span>Ödeme düzeni</span><b>${DUZEN[o.odemeDuzeni]}${o.odemeDuzeni === 'paket' ? ` · ${o.paketDers} ders` : ''}</b></div>
    <div><span>Ödeme yöntemi</span><b>${YONTEM[o.yontem]}</b></div>
    <div><span>${o.odemeDuzeni === 'paket' ? 'Paket ücreti' : 'Haftalık tutar'}</span><b>${tl(o.odemeDuzeni === 'paket' ? o.paketDers * h.birim : h.haftalik)}</b></div>
    ${o.veliAd ? `<div><span>Veli</span><b>${esc(o.veliAd)}</b></div>` : ''}
    ${o.telefon ? `<div><span>Telefon</span><b><a href="tel:${esc(o.telefon.replace(/[^\d+]/g, ''))}">${esc(o.telefon)}</a></b></div>` : ''}
    ${o.not ? `<div><span>Not</span><b>${esc(o.not)}</b></div>` : ''}
  </div>`;

  x += `<h3 class="bolum">Haftalık program</h3>` + (o.program.length ? `<div class="bilgi">${[...o.program].sort((a, b) => a.gun - b.gun || a.bas.localeCompare(b.bas)).map(s => `<div><span>${GUN[s.gun]}</span><b>${s.bas}–${s.bit} · ${tl(s.ucret)}</b></div>`).join('')}</div>` : '<div class="bos">Sabit ders saati yok. "Düzenle"den eklenebilir.</div>');

  const yak = [];
  for (let t = b; t <= addDays(b, 21) && yak.length < 4; t = addDays(t, 1)) yak.push(...gunDersleri(t).filter(d => d.ogrenciId === o.id && d.durum === 'planlandi'));
  if (yak.length) x += `<h3 class="bolum">Yaklaşan dersler</h3><div class="liste">${yak.slice(0, 4).map(d => dersSatiri(d, { tarihli: true })).join('')}</div>`;

  const olaylar = [
    ...db.dersler.filter(d => d.ogrenciId === o.id && (d.durum !== 'planlandi' || d.tarih < b)).map(d => ({ k: d.tarih + ' ' + d.bas, d })),
    ...db.odemeler.filter(p => p.ogrenciId === o.id).map(p => ({ k: p.tarih + ' ~', p }))
  ].sort((a, b) => b.k.localeCompare(a.k));
  const gor = E.tumGecmis ? olaylar : olaylar.slice(0, 25);
  x += `<h3 class="bolum">Geçmiş</h3>` + (gor.length ? `<div class="liste">${gor.map(e => e.d ? dersSatiri(e.d, { tarihli: true }) : odemeSatiri(e.p, false)).join('')}
    ${olaylar.length > gor.length ? `<button class="daha" data-act="tum-gecmis">Tümünü göster (${olaylar.length})</button>` : ''}</div>` : '<div class="bos">Henüz kayıt yok.</div>');

  return { baslik: o.ad, html: x, geri: true };
}

function odemeSatiri(p, isimli = true) {
  const o = ogr(p.ogrenciId);
  return `<div class="olay" data-odeme="${p.id}">
    <div class="o-ikon">₺</div>
    <div class="d-orta"><div class="d-ad">${isimli && o ? esc(o.ad) + ' · ' : ''}<span class="tutar">+${tl(p.tutar)}</span></div>
    <div class="d-alt"><span>${tarihYaz(p.tarih)}</span><span class="rozet ${p.yontem === 'iban' ? 'mavi' : 'gri'}">${YONTEM[p.yontem]}</span>${p.paketDers ? `<span class="rozet yesil">${p.paketDers} ders paketi</span>` : ''}</div>
    ${p.not ? `<div class="d-not">${esc(p.not)}</div>` : ''}</div></div>`;
}

function sKasa() {
  const [y, m] = E.ay.split('-').map(Number);
  const ilk = `${E.ay}-01`, son = ymd(new Date(y, m, 0));
  const ders = db.dersler.filter(d => d.durum === 'yapildi' && d.tarih >= ilk && d.tarih <= son && ogr(d.ogrenciId));
  const od = db.odemeler.filter(p => p.tarih >= ilk && p.tarih <= son && ogr(p.ogrenciId)).sort((a, b) => b.tarih.localeCompare(a.tarih));
  const kazanc = ders.reduce((a, d) => a + d.ucret, 0);
  const elden = od.filter(p => p.yontem === 'elden').reduce((a, p) => a + p.tutar, 0);
  const iban = od.filter(p => p.yontem === 'iban').reduce((a, p) => a + p.tutar, 0);
  const al = alacaklar();
  const pesin = db.ogrenciler.map(o => ({ o, b: H(o.id).bakiye })).filter(x => x.b > 0);

  let h = `<div class="hafta-nav">
    <button class="btn kucuk" data-act="ay-onceki" aria-label="Önceki ay">‹</button>
    <div class="hafta-ad">${AY[m - 1]} ${y}</div>
    <button class="btn kucuk" data-act="ay-sonraki" aria-label="Sonraki ay">›</button></div>
  <div class="kartlar">
    ${kart('Yapılan dersler', tl(kazanc), ders.length + ' ders')}
    ${kart('Tahsil edilen', tl(elden + iban), `Elden ${tl(elden)} · IBAN ${tl(iban)}`, 'yesil')}
    ${kart('Şu anki toplam alacak', tl(al.toplam), al.liste.length + ' öğrenci', al.toplam ? 'kirmizi' : '')}
    ${kart('Peşin alınmış', tl(pesin.reduce((a, x) => a + x.b, 0)), 'henüz yapılmamış dersler için')}
  </div>`;

  if (al.liste.length) h += `<h3 class="bolum">Alacaklar</h3><div class="liste">${al.liste.map(x => ogrSatiri(x.o)).join('')}</div>`;

  const satirlar = db.ogrenciler.map(o => {
    const dd = ders.filter(d => d.ogrenciId === o.id), pp = od.filter(p => p.ogrenciId === o.id);
    return { o, n: dd.length, t: dd.reduce((a, d) => a + d.ucret, 0), p: pp.reduce((a, p) => a + p.tutar, 0) };
  }).filter(r => r.n || r.p).sort((a, b) => adSirala(a.o, b.o));
  if (satirlar.length) h += `<h3 class="bolum">Öğrenci bazında</h3><table class="tablo">
    <thead><tr><th>Öğrenci</th><th>Ders</th><th>Tutar</th><th>Ödenen</th></tr></thead>
    <tbody>${satirlar.map(r => `<tr data-ogr="${r.o.id}"><td>${esc(r.o.ad)}</td><td>${r.n}</td><td>${tl(r.t)}</td><td>${tl(r.p)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td>Toplam</td><td>${ders.length}</td><td>${tl(kazanc)}</td><td>${tl(elden + iban)}</td></tr></tfoot></table>`;

  h += `<h3 class="bolum">Bu ayki ödemeler</h3>` + (od.length ? `<div class="liste">${od.map(p => odemeSatiri(p)).join('')}</div>` : '<div class="bos">Bu ay ödeme kaydı yok.</div>');
  h += `<button class="btn ana genis" data-act="odeme-yeni" style="margin-top:18px"><span class="arti">+</span>Ödeme kaydet</button>`;
  h += `<a class="btn genis" href="arsiv.html" style="text-decoration:none">📋 Genel arşiv: tüm kayıtlar tek sayfada</a>`;
  return { baslik: 'Kasa', html: h, sag: '<a class="ust-btn" href="arsiv.html" style="text-decoration:none">Arşiv</a>' };
}

function sAyarlar() {
  const a = db.ayarlar;
  const s = a.sonYedek ? new Date(a.sonYedek) : null;
  const h = `<h3 class="bolum">Genel arşiv</h3>
  <a class="btn genis" href="arsiv.html" style="text-decoration:none;margin-top:0">📋 Tüm kayıtları tek sayfada gör</a>
  <p class="kucuk-yazi">Bütün öğrenciler, dersler ve ödemeler; aylık özet ve öğrenci dosyaları. Sadece görüntüler, hiçbir şeyi değiştirmez.</p>
  <h3 class="bolum">Yedek</h3>
  <div class="bilgi"><div><span>Son yedek</span><b>${s ? `${s.getDate()} ${AY[s.getMonth()]} ${s.getFullYear()}` : 'Hiç alınmadı'}</b></div>
  <div><span>Kayıtlar</span><b>${db.ogrenciler.length} öğrenci · ${db.dersler.length} ders · ${db.odemeler.length} ödeme</b></div></div>
  <p class="kucuk-yazi">Veriler sadece bu telefonda durur. Haftada bir yedek alıp "Dosyalar"a (iCloud Drive) kaydet ya da kendine WhatsApp'tan gönder. Telefon değişirse yedek dosyası yeni telefonda "Yedekten geri yükle" ile açılır.</p>
  <button class="btn ana genis" data-act="yedek-al">Yedek al (dosya olarak paylaş)</button>
  <button class="btn genis" data-act="yedek-kopyala">Yedeği metin olarak kopyala</button>
  <button class="btn genis" data-act="ice-aktar-dosya">Dosyadan yükle (yedek ya da eski kayıtlar)</button>
  <button class="btn genis" data-act="ice-aktar-metin">Yedekten geri yükle (metin yapıştır)</button>

  <h3 class="bolum">Diğer</h3>
  <button class="btn tehlike genis" data-act="tum-sil">Tüm verileri sil</button>
  <p class="kucuk-yazi" style="text-align:center;margin-top:20px">Ders Takip · sürüm 2.8</p>`;
  return { baslik: 'Ayarlar', html: h };
}

function karsilama() {
  $('#alt').hidden = true;
  $('#baslik').textContent = 'Ders Takip';
  $('#geri').hidden = true; $('#ust-sag').innerHTML = '';
  $('#icerik').innerHTML = `<div class="karsilama">
    <img src="icon-180.png" alt="">
    <h2>Ders Takip'e hoş geldin</h2>
    <p>Öğrencilerin, haftalık programın ve ödemeler tek yerde. Kurulum dosyan varsa onu seçerek başla.</p>
    <button class="btn ana" data-act="ice-aktar-dosya">Kurulum / yedek dosyasını seç</button>
    <button class="btn" data-act="ice-aktar-metin">Kurulum metnini yapıştır</button>
    <button class="btn hafif" data-act="bos-basla">Boş başla</button></div>`;
}

/* ---------- alt sayfa (sheet) ---------- */
function sheet(baslik, html, bagla) {
  $('#sheet-baslik').textContent = baslik;
  const g = $('#sheet-govde'); g.innerHTML = html; g.scrollTop = 0;
  $('#perde').hidden = false; $('#sheet').classList.add('acik');
  bagla && bagla(g);
}
function kapat() { $('#sheet').classList.remove('acik'); $('#perde').hidden = true; document.activeElement?.blur?.(); }

let toastZ;
function toast(msg, geri) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${geri ? '<button>Geri al</button>' : ''}`;
  t.classList.add('gor');
  if (geri) t.querySelector('button').onclick = () => { t.classList.remove('gor'); geri(); };
  clearTimeout(toastZ); toastZ = setTimeout(() => t.classList.remove('gor'), geri ? 5000 : 2500);
}
function degistir(fn, msg) {
  const once = JSON.stringify(db);
  fn(); kaydet(); render();
  toast(msg, () => { db = JSON.parse(once); kaydet(); render(); toast('Geri alındı'); });
}

/* Ders detayı */
function dersSheet(id) {
  const d = dersBul(id); if (!d) return;
  const o = ogr(d.ogrenciId), h = H(o.id), bl = h.blok.get(d.id);
  let x = `<div class="bilgi">
    <div><span>Saat</span><b>${d.bas}–${d.bit}</b></div>
    <div><span>Ücret</span><b>${d.ucret === 0 ? 'Ücretsiz' : tl(d.ucret)}</b></div>
    <div><span>Durum</span><b>${DURUM[d.durum]}</b></div>
    ${(d.durum === 'yapildi' || d.durum === 'planlandi') && d.ucret > 0 ? `<div><span>Ödeme</span><b>${odendiMi(d) ? (d.durum === 'yapildi' ? 'Ödendi ✓' : 'Peşin ödendi ✓') : 'Ödenmedi'}</b></div>` : ''}
    ${bl ? `<div><span>Önden ödeme</span><b>${bl.k}/${bl.N} · ${bl.yapildi} yapıldı, ${bl.N - bl.yapildi} kaldı<br><small style="font-weight:400;color:var(--soluk)">${tarihYaz(bl.odeme.tarih, false)} · ${tl(bl.odeme.tutar)} ${YONTEM[bl.odeme.yontem]}</small></b></div>` : ''}
    ${d.not ? `<div><span>Not</span><b>${esc(d.not)}</b></div>` : ''}</div>`;
  if (d.durum === 'planlandi') x += `<div class="aksiyonlar"><button class="btn yesil" data-s="yapildi">✓ Yapıldı</button><button class="btn" data-s="iptal">İptal</button><button class="btn" data-s="ertele">Ertele</button></div>`;
  else if (d.durum === 'ertelendi') x += `<div class="aksiyonlar"><button class="btn" data-s="ertele-geri">Ertelemeyi geri al</button></div>`;
  else x += `<div class="aksiyonlar"><button class="btn" data-s="planlandi">İşareti kaldır (planlandı yap)</button></div>`;
  const deg = d.tur === 'degerlendirme';
  if ((d.durum === 'yapildi' || d.durum === 'planlandi') && !deg) x += `<button class="btn ana genis" data-s="odeme">₺ Ödeme kaydet</button>`;
  x += `<details class="duzenle"><summary>Saat, ücret, tür veya not değiştir</summary>
    <div class="iki"><label>Başlangıç${saatAlani('bas', d.bas)}</label><label>Bitiş${saatAlani('bit', d.bit)}</label></div>
    <label class="onay"><input type="checkbox" name="degerlendirme" ${deg ? 'checked' : ''}> Değerlendirme dersi (ücretsiz)</label>
    <label>Ücret (TL)<input type="number" inputmode="numeric" name="ucret" value="${d.ucret}" ${deg ? 'disabled' : ''}></label>
    <label>Not<input name="not" value="${esc(d.not || '')}" placeholder="İsteğe bağlı"></label>
    <button class="btn ana genis" data-s="kaydet">Kaydet</button></details>`;
  if (!d.sanal && d.kaynak !== 'program') x += `<button class="btn tehlike genis" data-s="sil">Bu dersi sil</button>`;
  x += `<button class="btn hafif genis" data-s="ogrenci">${esc(o.ad)} sayfasına git ›</button>`;

  sheet(`${o.ad} · ${tarihYaz(d.tarih)}`, x, g => {
    const degK = $('[name=degerlendirme]', g), ucK = $('[name=ucret]', g);
    degK.onchange = () => {
      ucK.disabled = degK.checked;
      ucK.value = degK.checked ? 0 : (d.ucret || ogr(d.ogrenciId).program.find(s => s.id === d.slotId)?.ucret || H(d.ogrenciId).birim || '');
    };
    $$('[data-s]', g).forEach(btn => btn.onclick = () => {
      const s = btn.dataset.s;
      if (s === 'yapildi' || s === 'iptal' || s === 'planlandi') {
        kapat(); degistir(() => { gercekle(d).durum = s; }, `${o.ad} · ${tarihYaz(d.tarih, false)} · ${DURUM[s].toLocaleLowerCase('tr')}`);
      } else if (s === 'ertele') erteleSheet(d, o);
      else if (s === 'ertele-geri') {
        const y = db.dersler.find(z => z.id === d.ertelemeId);
        if (y && y.durum !== 'planlandi') return toast('Telafi dersi işaretlenmiş; önce onun işaretini kaldır');
        kapat(); degistir(() => {
          db.dersler = db.dersler.filter(z => z.id !== d.ertelemeId);
          const a = db.dersler.find(z => z.id === d.id); a.durum = 'planlandi'; delete a.ertelemeId;
        }, 'Erteleme geri alındı');
      } else if (s === 'odeme') odemeSheet({ ogrenciId: o.id });
      else if (s === 'kaydet') {
        const bas = $('[name=bas]', g).value, bit = $('[name=bit]', g).value, ucret = sayi($('[name=ucret]', g).value);
        if (!bas || !bit || dk(bit) <= dk(bas)) return toast('Bitiş saati başlangıçtan sonra olmalı');
        if (!(ucret >= 0)) return toast('Ücret geçerli bir sayı olmalı');
        const not = $('[name=not]', g).value.trim(), dg = degK.checked;
        kapat(); degistir(() => {
          const a = gercekle(d);
          Object.assign(a, { bas, bit, ucret: dg ? 0 : ucret, not });
          if (dg) a.tur = 'degerlendirme'; else delete a.tur;
        }, dg ? 'Değerlendirme dersi olarak kaydedildi' : 'Ders güncellendi');
      } else if (s === 'sil') {
        kapat(); degistir(() => {
          db.dersler = db.dersler.filter(z => z.id !== d.id);
          const kay = db.dersler.find(z => z.ertelemeId === d.id);
          if (kay) { kay.durum = 'iptal'; delete kay.ertelemeId; }
        }, 'Ders silindi');
      } else if (s === 'ogrenci') { kapat(); E.sekme = 'ogrenciler'; E.ogrenci = o.id; E.tumGecmis = false; render(); scrollTo(0, 0); }
    });
  });
}

function erteleSheet(d, o) {
  const sure = dk(d.bit) - dk(d.bas);
  sheet(`${o.ad} · dersi ertele`, `
    <p class="ipucu" style="margin:4px 0 0">${tarihYaz(d.tarih)} ${d.bas} dersi yeni güne taşınır. Eski ders "ertelendi", yenisi "telafi" olarak görünür.</p>
    <label>Yeni tarih<input type="date" name="tarih" value="${addDays(d.tarih, 1)}"><span class="tarih-yazi">${tarihYaz(addDays(d.tarih, 1))}</span></label>
    <div class="iki"><label>Başlangıç${saatAlani('bas', d.bas)}</label><label>Bitiş${saatAlani('bit', d.bit)}</label></div>
    <button class="btn ana genis" data-s="tamam">Ertele</button>`, g => {
    const bas = $('[name=bas]', g), bit = $('[name=bit]', g);
    bas.onchange = () => { if (bas.value) saatYaz(bit, saat(dk(bas.value) + sure)); };
    $('[data-s=tamam]', g).onclick = () => {
      const t = $('[name=tarih]', g).value;
      if (!t || !bas.value || !bit.value) return toast('Tarih ve saat seç');
      if (dk(bit.value) <= dk(bas.value)) return toast('Bitiş saati başlangıçtan sonra olmalı');
      kapat();
      degistir(() => {
        const a = gercekle(d);
        const y = { id: uid(), ogrenciId: a.ogrenciId, tarih: t, bas: bas.value, bit: bit.value, ucret: a.ucret, durum: 'planlandi', kaynak: 'erteleme', not: `${tarihYaz(a.tarih, false)} dersinin telafisi` };
        db.dersler.push(y); a.durum = 'ertelendi'; a.ertelemeId = y.id;
      }, `${o.ad} · ${tarihYaz(t)} ${bas.value} saatine ertelendi`);
    };
  });
}

/* Ekstra ders */
function dersYeniSheet(ogrenciId = null) {
  const akt = db.ogrenciler.filter(o => o.aktif !== false || o.id === ogrenciId).sort(adSirala);
  if (!akt.length) return toast('Önce öğrenci ekle');
  const sec = ogrenciId || akt[0].id;
  sheet('Ekstra ders ekle', `
    <label>Öğrenci<select name="ogr">${akt.map(o => `<option value="${o.id}" ${o.id === sec ? 'selected' : ''}>${esc(o.ad)}</option>`).join('')}</select></label>
    <label>Tarih<input type="date" name="tarih" value="${bugun()}"><span class="tarih-yazi">${tarihYaz(bugun())}</span></label>
    <div class="iki"><label>Başlangıç${saatAlani('bas', '17:00')}</label><label>Bitiş${saatAlani('bit', '18:00')}</label></div>
    <label class="onay"><input type="checkbox" name="degerlendirme"> Değerlendirme dersi (ücretsiz)</label>
    <label>Ücret (TL)<input type="number" inputmode="numeric" name="ucret"></label>
    <label>Not<input name="not" placeholder="Örn. sınav öncesi ek ders"></label>
    <label class="onay"><input type="checkbox" name="yapildi"> Ders yapıldı olarak işaretle</label>
    <button class="btn ana genis" data-s="tamam">Dersi ekle</button>`, g => {
    const s = $('[name=ogr]', g), bas = $('[name=bas]', g), bit = $('[name=bit]', g), uc = $('[name=ucret]', g), tr = $('[name=tarih]', g), yp = $('[name=yapildi]', g);
    const dg = $('[name=degerlendirme]', g);
    const doldur = () => { const o = ogr(s.value), sl = o.program[0]; saatYaz(bas, sl?.bas || '17:00'); saatYaz(bit, sl?.bit || '18:00'); uc.value = dg.checked ? 0 : (H(o.id).birim || ''); };
    dg.onchange = () => { uc.disabled = dg.checked; uc.value = dg.checked ? 0 : (H(s.value).birim || ''); };
    bas.onchange = () => { const sl = ogr(s.value).program[0], sure = sl ? dk(sl.bit) - dk(sl.bas) : 60; saatYaz(bit, saat(dk(bas.value) + sure)); };
    s.onchange = doldur; doldur();
    tr.onchange = () => { yp.checked = tr.value < bugun(); };
    $('[data-s=tamam]', g).onclick = () => {
      const ucret = dg.checked ? 0 : sayi(uc.value);
      if (!tr.value || !bas.value || !bit.value || dk(bit.value) <= dk(bas.value)) return toast('Tarih ve saatleri kontrol et');
      if (!(ucret >= 0)) return toast('Ücret gir');
      const o = ogr(s.value); kapat();
      const yeni = { id: uid(), ogrenciId: o.id, tarih: tr.value, bas: bas.value, bit: bit.value, ucret, durum: yp.checked ? 'yapildi' : 'planlandi', kaynak: 'ekstra', not: $('[name=not]', g).value.trim() };
      if (dg.checked) { yeni.tur = 'degerlendirme'; yeni.not ||= 'Değerlendirme dersi'; }
      degistir(() => db.dersler.push(yeni), `${o.ad} · ${dg.checked ? 'değerlendirme dersi' : 'ekstra ders'} eklendi`);
    };
  });
}

/* Ödeme */
function odemeSheet({ ogrenciId = null, odemeId = null } = {}) {
  const mevcut = odemeId ? db.odemeler.find(p => p.id === odemeId) : null;
  const oid = mevcut?.ogrenciId || ogrenciId;
  const liste = db.ogrenciler.filter(o => o.aktif !== false || o.id === oid).sort(adSirala);
  if (!liste.length) return toast('Önce öğrenci ekle');
  sheet(mevcut ? 'Ödemeyi düzenle' : 'Ödeme kaydet', `
    <label>Öğrenci<select name="ogr">${oid ? '' : '<option value="">Seç…</option>'}${liste.map(o => `<option value="${o.id}" ${o.id === oid ? 'selected' : ''}>${esc(o.ad)}</option>`).join('')}</select></label>
    <div class="durum-bilgi" id="od-bilgi"></div>
    <label>Tutar (TL)<input type="number" inputmode="numeric" name="tutar" value="${mevcut?.tutar ?? ''}"></label>
    <div class="cipler" id="od-cip"></div>
    <label>Ödeme yöntemi</label><div class="segment" id="od-yon"><button data-v="elden">Elden</button><button data-v="iban">IBAN</button></div>
    <label>Tarih<input type="date" name="tarih" value="${mevcut?.tarih || bugun()}"><span class="tarih-yazi">${tarihYaz(mevcut?.tarih || bugun())}</span></label>
    <label class="onay"><input type="checkbox" name="paket" ${mevcut?.paketDers ? 'checked' : ''}> Paket ödemesi: <input type="number" inputmode="numeric" class="mini" name="paketDers" value="${mevcut?.paketDers || 8}"> ders</label>
    <label>Not<input name="not" value="${esc(mevcut?.not || '')}" placeholder="İsteğe bağlı"></label>
    <button class="btn ana genis" data-s="kaydet">${mevcut ? 'Kaydet' : 'Ödemeyi kaydet'}</button>
    ${mevcut ? '<button class="btn tehlike genis" data-s="sil">Ödemeyi sil</button>' : ''}`, g => {
    const sel = $('[name=ogr]', g), tut = $('[name=tutar]', g), pk = $('[name=paket]', g), pkn = $('[name=paketDers]', g);
    let yon = mevcut?.yontem || ogr(oid)?.yontem || 'elden';
    const seg = () => $$('#od-yon button', g).forEach(b => b.classList.toggle('secili', b.dataset.v === yon));
    $$('#od-yon button', g).forEach(b => b.onclick = () => { yon = b.dataset.v; seg(); });
    const guncelle = (varsayilan) => {
      const o = ogr(sel.value);
      if (!o) { $('#od-bilgi', g).textContent = ''; $('#od-cip', g).innerHTML = ''; return; }
      const h = H(o.id), N = o.paketDers || 8;
      $('#od-bilgi', g).innerHTML = h.bakiye < 0 ? `Şu an <b style="color:var(--kirmizi)">${tl(-h.bakiye)} alacak</b> var.` : h.bakiye > 0 ? `Şu an ${tl(h.bakiye)} peşin bakiyesi var.` : 'Şu an borcu yok.';
      const cip = [];
      if (h.bakiye < 0) cip.push({ l: `Borcun tamamı ${tl(-h.bakiye)}`, v: -h.bakiye });
      if (o.odemeDuzeni === 'paket') cip.push({ l: `${N} ders paketi ${tl(N * h.birim)}`, v: N * h.birim, p: N });
      if (h.haftalik && h.haftalik !== h.birim) cip.push({ l: `Haftalık ${tl(h.haftalik)}`, v: h.haftalik });
      if (h.birim) cip.push({ l: `1 ders ${tl(h.birim)}`, v: h.birim });
      $('#od-cip', g).innerHTML = cip.map((c, i) => `<button class="cip" data-i="${i}">${c.l}</button>`).join('');
      $$('#od-cip .cip', g).forEach(b => b.onclick = () => {
        const c = cip[b.dataset.i]; tut.value = c.v; pk.checked = !!c.p; if (c.p) pkn.value = c.p;
        $$('#od-cip .cip', g).forEach(z => z.classList.toggle('secili', z === b));
      });
      if (varsayilan) {
        yon = o.yontem; seg();
        const v = o.odemeDuzeni === 'paket' ? cip.find(c => c.p) : cip[0];
        if (v) { tut.value = v.v; pk.checked = !!v.p; if (v.p) pkn.value = v.p; $$('#od-cip .cip', g)[cip.indexOf(v)]?.classList.add('secili'); }
      }
    };
    sel.onchange = () => guncelle(true);
    guncelle(!mevcut); seg();
    $('[data-s=kaydet]', g).onclick = () => {
      const o = ogr(sel.value); if (!o) return toast('Öğrenci seç');
      const tutar = sayi(tut.value); if (!(tutar > 0)) return toast('Tutar gir');
      const tarih = $('[name=tarih]', g).value || bugun();
      const paketDers = pk.checked ? Math.max(1, Math.round(sayi(pkn.value)) || 8) : null;
      const not = $('[name=not]', g).value.trim();
      kapat();
      degistir(() => {
        if (mevcut) Object.assign(db.odemeler.find(p => p.id === mevcut.id), { ogrenciId: o.id, tutar, yontem: yon, tarih, paketDers, not });
        else db.odemeler.push({ id: uid(), ogrenciId: o.id, tutar, yontem: yon, tarih, paketDers, not });
      }, `${o.ad} · ${tl(tutar)} ödeme ${mevcut ? 'güncellendi' : 'kaydedildi'}`);
    };
    const sil = $('[data-s=sil]', g);
    if (sil) sil.onclick = () => { kapat(); degistir(() => { db.odemeler = db.odemeler.filter(p => p.id !== mevcut.id); }, 'Ödeme silindi'); };
  });
}

/* Öğrenci ekle / düzenle */
function slotHtml(s = {}) {
  return `<div class="slot" data-id="${s.id || ''}">
    <select name="gun" aria-label="Gün">${GUN.slice(1).map((g, i) => `<option value="${i + 1}" ${s.gun === i + 1 ? 'selected' : ''}>${g}</option>`).join('')}</select>
    <input type="number" inputmode="numeric" name="ucret" value="${s.ucret ?? ''}" placeholder="Ücret TL" aria-label="Ücret">
    <button class="sil-x" aria-label="Sil">×</button>
    <div class="slot-saat">${saatAlani('bas', s.bas || '17:00')}<span class="tire">–</span>${saatAlani('bit', s.bit || '18:00')}</div></div>`;
}
function ogrSheet(id = null) {
  const o = id ? ogr(id) : null;
  const v = o || { ad: '', veliAd: '', telefon: '', odemeDuzeni: 'haftalik', paketDers: 8, yontem: 'elden', baslangic: bugun(), program: [], not: '', aktif: true };
  sheet(o ? `${o.ad} · düzenle` : 'Yeni öğrenci', `
    <label>Öğrenci adı<input name="ad" value="${esc(v.ad)}" placeholder="Öğrencinin adı"></label>
    <div class="iki"><label>Veli adı<input name="veliAd" value="${esc(v.veliAd)}"></label><label>Veli telefonu<input type="tel" name="telefon" value="${esc(v.telefon)}" placeholder="05xx…"></label></div>
    <label>Ödeme düzeni<select name="duzen">${Object.entries(DUZEN).map(([k, l]) => `<option value="${k}" ${v.odemeDuzeni === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label id="pk-satir" ${v.odemeDuzeni === 'paket' ? '' : 'hidden'}>Paketteki ders sayısı<input type="number" inputmode="numeric" name="paketDers" value="${v.paketDers}"></label>
    <label>Ödeme yöntemi</label><div class="segment" id="og-yon"><button data-v="elden">Elden</button><button data-v="iban">IBAN</button></div>
    <h3 class="bolum" style="margin-top:20px">Haftalık ders saatleri</h3>
    <div id="slotlar">${v.program.map(slotHtml).join('')}</div>
    <button class="btn genis" data-s="slot-ekle"><span class="arti">+</span>Ders saati ekle</button>
    <label>Programın başladığı tarih<input type="date" name="baslangic" value="${v.baslangic || bugun()}"><span class="tarih-yazi">${tarihYaz(v.baslangic || bugun())}</span></label>
    <label>Not<input name="not" value="${esc(v.not || '')}" placeholder="Örn. 8. sınıf, matematik"></label>
    <button class="btn ana genis" data-s="kaydet">${o ? 'Kaydet' : 'Öğrenciyi ekle'}</button>
    ${o && o.aktif !== false ? '<button class="btn genis" data-s="arsivle">Ders almayı bıraktı → arşive kaldır</button><p class="kucuk-yazi">Arşive kaldırılan öğrenci programdan çıkar; tüm dersleri, ödemeleri ve notları arşivde saklanır. İstediğin zaman geri alınabilir.</p>' : ''}
    ${o && kayitSayisi(o.id) === 0 ? '<button class="btn tehlike genis" data-s="sil">Öğrenciyi sil (hiç kaydı yok)</button>' : ''}`, g => {
    let yon = v.yontem;
    const seg = () => $$('#og-yon button', g).forEach(b => b.classList.toggle('secili', b.dataset.v === yon));
    $$('#og-yon button', g).forEach(b => b.onclick = () => { yon = b.dataset.v; seg(); }); seg();
    $('[name=duzen]', g).onchange = e => { $('#pk-satir', g).hidden = e.target.value !== 'paket'; };
    const slotlar = $('#slotlar', g);
    slotlar.onclick = e => { if (e.target.classList.contains('sil-x')) e.target.closest('.slot').remove(); };
    $('[data-s=slot-ekle]', g).onclick = () => {
      const son = $$('.slot', slotlar).at(-1);
      slotlar.insertAdjacentHTML('beforeend', slotHtml(son ? { gun: Math.min(7, +$('[name=gun]', son).value + 1), bas: $('[name=bas]', son).value, bit: $('[name=bit]', son).value, ucret: $('[name=ucret]', son).value } : {}));
    };
    $('[data-s=kaydet]', g).onclick = () => {
      const ad = $('[name=ad]', g).value.trim(); if (!ad) return toast('Öğrenci adını yaz');
      const program = [];
      for (const el of $$('.slot', slotlar)) {
        const s = { id: el.dataset.id || uid(), gun: +$('[name=gun]', el).value, bas: $('[name=bas]', el).value, bit: $('[name=bit]', el).value, ucret: sayi($('[name=ucret]', el).value) };
        if (!s.bas || !s.bit || dk(s.bit) <= dk(s.bas)) return toast(`${GUN[s.gun]}: bitiş saati başlangıçtan sonra olmalı`);
        if (!(s.ucret >= 0) || $('[name=ucret]', el).value === '') return toast(`${GUN[s.gun]}: ders ücretini yaz`);
        program.push(s);
      }
      const yeni = {
        ad, veliAd: $('[name=veliAd]', g).value.trim(), telefon: $('[name=telefon]', g).value.trim(),
        odemeDuzeni: $('[name=duzen]', g).value, paketDers: Math.max(1, Math.round(sayi($('[name=paketDers]', g).value)) || 8),
        yontem: yon, baslangic: $('[name=baslangic]', g).value || bugun(), not: $('[name=not]', g).value.trim(), program
      };
      if (!o) yeni.aktif = true;
      kapat();
      degistir(() => { if (o) Object.assign(ogr(o.id), yeni); else db.ogrenciler.push({ id: uid(), ...yeni }); }, o ? `${ad} güncellendi` : `${ad} eklendi`);
    };
    const ars = $('[data-s=arsivle]', g);
    if (ars) ars.onclick = () => {
      if (!confirm(`${o.ad} arşive kaldırılsın mı?\n\nBugünden sonraki dersleri programdan çıkar. Geçmiş dersleri, ödemeleri ve notları silinmez, arşivde saklanır.`)) return;
      kapat(); arsivle(o.id, true);
    };
    const sil = $('[data-s=sil]', g);
    if (sil) sil.onclick = () => {
      if (!confirm(`${o.ad} silinsin mi? Bu öğrencinin hiç ders veya ödeme kaydı yok.`)) return;
      kapat(); E.ogrenci = null;
      degistir(() => { db.ogrenciler = db.ogrenciler.filter(x => x.id !== o.id); }, `${o.ad} silindi`);
    };
  });
}

/* Arşiv: öğrenci silinmez, programdan çıkar; tüm geçmişi saklanır */
const kayitSayisi = oid => db.dersler.filter(d => d.ogrenciId === oid).length + db.odemeler.filter(p => p.ogrenciId === oid).length;
function arsivle(oid, arsive) {
  const o = ogr(oid), b = bugun();
  degistir(() => {
    const x = ogr(oid);
    if (arsive) {
      x.aktif = false; x.ayrilis = b;
      // bugünden sonraki, henüz işaretlenmemiş telafi/ekstra dersler kaldırılır; geçmiş kayıtlar kalır
      db.dersler = db.dersler.filter(d => !(d.ogrenciId === oid && d.durum === 'planlandi' && d.tarih >= b && d.kaynak !== 'program'));
    } else {
      x.aktif = true; delete x.ayrilis;
      if (!x.baslangic || x.baslangic < b) x.baslangic = b;
    }
  }, arsive ? `${o.ad} arşive kaldırıldı — geçmişi saklandı` : `${o.ad} arşivden çıkarıldı, programa geri döndü`);
}

/* ---------- yedek ---------- */
function yedekAlindi() { db.ayarlar.sonYedek = new Date().toISOString(); kaydet(); render(); }
async function yedekAl() {
  const ad = `ders-takip-yedek-${bugun()}.json`;
  const file = new File([JSON.stringify(db)], ad, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Ders Takip yedeği' }); yedekAlindi(); toast('Yedek paylaşıldı'); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = ad;
  document.body.appendChild(a); a.click(); a.remove();
  yedekAlindi(); toast('Yedek dosyası indirildi');
}
async function yedekKopyala() {
  try { await navigator.clipboard.writeText(JSON.stringify(db)); yedekAlindi(); toast('Yedek metni kopyalandı — Notlar\'a veya WhatsApp\'a yapıştırabilirsin'); }
  catch { toast('Kopyalanamadı'); }
}
function iceAktarDosya() {
  const i = document.createElement('input');
  i.type = 'file'; i.accept = '.json,application/json,text/plain'; i.style.display = 'none';
  i.onchange = async () => { const f = i.files[0]; i.remove(); if (f) iceAktar(await f.text()); };
  document.body.appendChild(i); i.click();
}
function iceAktar(txt) {
  let x;
  try { x = JSON.parse(String(txt).trim()); } catch { return toast('Okunamadı: geçerli bir yedek değil'); }
  if (!x || !Array.isArray(x.ogrenciler) || !Array.isArray(x.dersler) || !Array.isArray(x.odemeler)) return toast('Bu bir Ders Takip yedeği değil');
  if (x.tur === 'ekleme') return birlestir(x);
  if (db && (db.ogrenciler.length || db.odemeler.length) && !confirm(`Bu telefondaki mevcut veriler silinecek, yerine yedekteki ${x.ogrenciler.length} öğrenci yüklenecek. Devam edilsin mi?`)) return;
  db = gocEt(x); kaydet(); kapat(); E.sekme = 'bugun'; E.ogrenci = null; render();
  toast(`${x.ogrenciler.length} öğrenci yüklendi`);
}
/* Eski kayıtları ekle: mevcut veriler silinmez.
   - Öğrenci zaten varsa dokunulmaz, yoksa eklenir.
   - Aynı öğrencinin aynı gündeki dersi zaten varsa o ders (ve ona bağlı ödeme) atlanır.
   - Bağlı olmayan ödeme, aynı öğrenci + tarih + tutar varsa atlanır.
   Eklemeden önce mevcut hali ayrıca saklanır; "Geri al" ile dönülebilir. */
function birlestir(x) {
  if (!db) db = gocEt(bosDb());
  const varOgr = new Set(db.ogrenciler.map(o => o.id));
  const gunAnahtar = new Set(db.dersler.map(d => d.ogrenciId + '|' + d.tarih));
  const idVar = new Set([...db.dersler.map(d => d.id), ...db.odemeler.map(p => p.id)]);
  const yeniOgr = x.ogrenciler.filter(o => !varOgr.has(o.id) && !o.sadeceVeli);
  // Mevcut öğrencide sadece boş veli adı doldurulur, başka bilgiye dokunulmaz
  const veliDoldur = x.ogrenciler.filter(o => varOgr.has(o.id) && o.veliAd && !ogr(o.id).veliAd);
  const atlananDers = new Set();
  const yeniDers = x.dersler.filter(d => {
    if (idVar.has(d.id) || gunAnahtar.has(d.ogrenciId + '|' + d.tarih)) { atlananDers.add(d.id); return false; }
    return true;
  });
  const yeniOdeme = x.odemeler.filter(p => {
    if (idVar.has(p.id)) return false;
    if (p.dersId) return !atlananDers.has(p.dersId);
    return !db.odemeler.some(q => q.ogrenciId === p.ogrenciId && q.tarih === p.tarih && q.tutar === p.tutar);
  });
  const adlar = yeniOgr.map(o => o.ad).join(', ');
  if (!confirm(`Eski kayıtlar eklenecek:\n\n• ${yeniOgr.length} yeni öğrenci${adlar ? ' (' + adlar + ')' : ''}\n• ${yeniDers.length} ders\n• ${yeniOdeme.length} ödeme${veliDoldur.length ? `\n• ${veliDoldur.length} öğrenciye veli adı` : ''}\n\n${atlananDers.size ? atlananDers.size + ' ders zaten kayıtlı olduğu için atlanacak.\n' : ''}Mevcut kayıtların hiçbiri silinmez. Devam edilsin mi?`)) return;
  localStorage.setItem(KEY + '.eklemeOncesi', JSON.stringify(db));
  kapat();
  degistir(() => {
    for (const o of yeniOgr) db.ogrenciler.push(gocEt({ ogrenciler: [o] }).ogrenciler[0]);
    for (const o of veliDoldur) { const m = ogr(o.id); if (!m.veliAd) m.veliAd = o.veliAd; }
    db.dersler.push(...yeniDers);
    db.odemeler.push(...yeniOdeme);
  }, `${yeniDers.length} eski ders ve ${yeniOdeme.length} ödeme eklendi`);
}
function metinSheet() {
  sheet('Metinden yükle', `<p class="ipucu" style="margin:4px 0 0">Kurulum veya yedek metnini aşağıya yapıştır.</p>
    <textarea rows="10" name="metin" placeholder='{"surum":1, …}'></textarea>
    <button class="btn ana genis" data-s="yukle">Yükle</button>`, g => {
    $('[data-s=yukle]', g).onclick = () => iceAktar($('[name=metin]', g).value);
  });
}

/* ---------- olaylar ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-hizli],[data-ders],[data-odeme],[data-ogr],[data-git],[data-act],[data-sekme]');
  if (!t || t.closest('#sheet')) return;
  if (t.dataset.hizli) {
    const d = dersBul(t.dataset.id); if (!d) return;
    const o = ogr(d.ogrenciId), gun = tarihYaz(d.tarih, false);
    if (t.dataset.hizli === 'ders') {
      const yeni = d.durum === 'yapildi' ? 'planlandi' : 'yapildi';
      degistir(() => { gercekle(d).durum = yeni; }, `${o.ad} · ${gun} · ${yeni === 'yapildi' ? 'ders yapıldı' : '"yapıldı" işareti kaldırıldı'}`);
    } else if (odendiMi(d)) {
      const bagli = db.odemeler.filter(p => p.dersId === d.id);
      if (!bagli.length) return toast(`Bu ders önceden alınan ödemeyle karşılanıyor. Değiştirmek için ${o.ad} sayfasındaki ödemeye dokun.`);
      degistir(() => { db.odemeler = db.odemeler.filter(p => p.dersId !== d.id); }, `${o.ad} · ${gun} · ödeme kaldırıldı`);
    } else if (o.odemeDuzeni === 'paket') odemeSheet({ ogrenciId: o.id });
    else {
      const h = H(o.id), tutar = h.kalan.get(d.id) ?? d.ucret;
      const tarih = d.tarih < bugun() ? d.tarih : bugun();
      degistir(() => {
        const a = gercekle(d);
        db.odemeler.push({ id: uid(), ogrenciId: o.id, tutar, yontem: o.yontem, tarih, paketDers: null, not: '', dersId: a.id });
      }, `${o.ad} · ${gun} · ${tl(tutar)} ödendi (${YONTEM[o.yontem]})`);
    }
    return;
  }
  if (t.dataset.ders) return dersSheet(t.dataset.ders);
  if (t.dataset.odeme) return odemeSheet({ odemeId: t.dataset.odeme });
  if (t.dataset.ogr) { E.sekme = 'ogrenciler'; E.ogrenci = t.dataset.ogr; E.tumGecmis = false; render(); scrollTo(0, 0); return; }
  if (t.dataset.sekme) { E.sekme = t.dataset.sekme; E.ogrenci = null; render(); scrollTo(0, 0); return; }
  if (t.dataset.git) { E.sekme = t.dataset.git; E.ogrenci = null; render(); scrollTo(0, 0); return; }
  const o = E.ogrenci && ogr(E.ogrenci);
  switch (t.dataset.act) {
    case 'hafta-onceki': E.hafta = addDays(E.hafta, -7); render(); break;
    case 'hafta-sonraki': E.hafta = addDays(E.hafta, 7); render(); break;
    case 'hafta-bu': E.hafta = pazartesi(bugun()); render(); break;
    case 'hafta-detay': haftaDetay(t.dataset.tur); break;
    case 'ay-onceki': case 'ay-sonraki': {
      const [y, m] = E.ay.split('-').map(Number), d = new Date(y, m - 1 + (t.dataset.act === 'ay-onceki' ? -1 : 1), 1);
      E.ay = ymd(d).slice(0, 7); render(); break;
    }
    case 'odeme-yeni': odemeSheet(); break;
    case 'ders-yeni': dersYeniSheet(); break;
    case 'odeme-ogr': odemeSheet({ ogrenciId: o.id }); break;
    case 'ders-ogr': dersYeniSheet(o.id); break;
    case 'ogr-duzenle': ogrSheet(o.id); break;
    case 'ogr-yeni': ogrSheet(); break;
    case 'tum-gecmis': E.tumGecmis = true; render(); break;
    case 'arsivden-cikar': arsivle(o.id, false); break;
    case 'yedek-al': yedekAl(); break;
    case 'yedek-kopyala': yedekKopyala(); break;
    case 'ice-aktar-dosya': iceAktarDosya(); break;
    case 'ice-aktar-metin': metinSheet(); break;
    case 'bos-basla': db = bosDb(); kaydet(); E.sekme = 'ogrenciler'; render(); break;
    case 'tum-sil':
      if (confirm('Tüm öğrenciler, dersler ve ödemeler bu telefondan silinecek. Emin misin?') && confirm('Bu işlem geri alınamaz. Önce yedek aldın mı? Silmek için Tamam\'a bas.')) {
        localStorage.removeItem(KEY); db = null; render();
      }
      break;
  }
});
$('#geri').onclick = () => { E.ogrenci = null; render(); scrollTo(0, 0); };
$('#sheet-kapat').onclick = kapat;
$('#perde').onclick = kapat;
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !$('#sheet').classList.contains('acik')) render(); });

render();
navigator.storage?.persist?.();
/* Güncelleme: uygulama açıldığında / öne geldiğinde yeni sürümü kontrol et, gelince sayfayı kendiliğinden yenile */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  const vardi = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    reg.update();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update(); });
  });
  let yenilendi = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!vardi || yenilendi || $('#sheet').classList.contains('acik')) return;
    yenilendi = true; location.reload();
  });
}
