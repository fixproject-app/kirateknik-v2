// ============================================================
// Kira Teknik — fitur.js  (dimuat SETELAH app.js)
// Pengaturan, pengolah foto (crop 4:3, watermark, timestamp), form Mesin + Edit Mesin,
// foto Tahap Restorasi, Asset Part.
// ============================================================

let pengaturan = {};

const BADGES = [
  { key: 'qc', label: 'Quality Check', icon: 'bi-patch-check-fill' },
  { key: 'siap', label: 'Siap Pakai', icon: 'bi-lightning-charge-fill' },
  { key: 'garansi', label: 'Bergaransi', icon: 'bi-shield-check' },
  { key: 'restorasi', label: 'Restorasi Total', icon: 'bi-tools' },
];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Pengaturan (tabel app_config: baca publik, ubah hanya Owner) ──
async function loadPengaturan() {
  try {
    const { data } = await sb.from('app_config').select('key,value');
    pengaturan = {};
    (data || []).forEach(r => { pengaturan[r.key] = r.value; });
  } catch (_) { /* biarkan memakai nilai kosong */ }
  return pengaturan;
}
function logoEfektif() { return pengaturan.logoUrl || LOGO_URL || ''; }
function namaUsaha() { return pengaturan.nama_usaha || NAMA_USAHA; }
function alamatUsaha() { return pengaturan.alamat || ALAMAT_USAHA; }

function pathDariUrl(url) {
  const penanda = `/object/public/${BUCKET_FOTO}/`;
  const i = String(url || '').indexOf(penanda);
  return i === -1 ? null : decodeURIComponent(url.slice(i + penanda.length).split('?')[0]);
}
async function hapusFileStorage(urls) {
  const paths = urls.map(pathDariUrl).filter(Boolean);
  if (paths.length) { try { await sb.storage.from(BUCKET_FOTO).remove(paths); } catch (_) {} }
}

// ============================================================
// PENGOLAH FOTO
// ============================================================
function muatGambar(src, cors) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Gambar tidak bisa dimuat.'));
    img.src = src;
  });
}
async function bukaFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await muatGambar(url);
    return { img, bersihkan: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw new Error('File bukan gambar yang bisa dibaca. Coba foto lain (JPG/PNG).');
  }
}

// JPEG di bawah batas ukuran: turunkan kualitas dulu, kalau masih besar kecilkan dimensinya
async function kanvasKeBlob(canvas, maxBytes = 1000000) {
  let c = canvas;
  for (let putaran = 0; putaran < 4; putaran++) {
    for (let q = 0.88; q >= 0.4; q -= 0.08) {
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', q));
      if (!blob) throw new Error('Gagal membuat gambar.');
      if (blob.size <= maxBytes) return blob;
    }
    const kecil = document.createElement('canvas');
    kecil.width = Math.round(c.width * 0.8); kecil.height = Math.round(c.height * 0.8);
    kecil.getContext('2d').drawImage(c, 0, 0, kecil.width, kecil.height);
    c = kecil;
  }
  throw new Error('Foto tidak bisa diperkecil sampai di bawah 1 MB.');
}

// Crop tengah ke rasio tertentu
function hitungCrop(img, rasio) {
  let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
  if (sw / sh > rasio) { const w = sh * rasio; sx = (sw - w) / 2; sw = w; }
  else { const h = sw / rasio; sy = (sh - h) / 2; sh = h; }
  return { sx, sy, sw, sh };
}

let peringatanLogoSudah = false;
// Watermark: logo di tengah + teks di bawahnya, transparan 40%
async function gambarWatermark(ctx, W, H) {
  const teks = (pengaturan.wm_teks || '').trim();
  const logo = logoEfektif();
  let logoImg = null;
  if (logo) {
    try { logoImg = await muatGambar(logo, true); }
    catch (_) {
      if (!peringatanLogoSudah) { peringatanLogoSudah = true; showToast('Logo tidak bisa dimuat untuk watermark, hanya teks yang dipakai.', 'error'); }
    }
  }
  const baris = teks ? teks.split('\n').map(x => x.trim()).filter(Boolean) : [];
  if (!logoImg && baris.length === 0) return;

  ctx.save();
  ctx.globalAlpha = 0.4;
  let fs = Math.round(W * 0.05);
  const setFont = () => { ctx.font = `700 ${fs}px "Plus Jakarta Sans", Arial, sans-serif`; };
  setFont();
  const lebarMaks = () => Math.max(0, ...baris.map(b => ctx.measureText(b).width));
  while (baris.length && lebarMaks() > W * 0.8 && fs > 10) { fs -= 2; setFont(); }
  const lh = fs * 1.25;

  let lw = 0, lhgt = 0;
  if (logoImg) {
    const nw = logoImg.naturalWidth || 1, nh = logoImg.naturalHeight || 1;
    lw = W * 0.34; lhgt = lw * nh / nw;
    if (lhgt > H * 0.4) { lhgt = H * 0.4; lw = lhgt * nw / nh; }
  }
  const jarak = logoImg && baris.length ? fs * 0.5 : 0;
  let y = (H - (lhgt + jarak + baris.length * lh)) / 2;
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = Math.max(3, W * 0.005);
  if (logoImg) { ctx.drawImage(logoImg, (W - lw) / 2, y, lw, lhgt); y += lhgt + jarak; }
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  baris.forEach((b, i) => ctx.fillText(b, W / 2, y + i * lh));
  ctx.restore();
}

// Foto mesin: crop 4:3, maks 1200x900, watermark, JPEG <= 1 MB
async function prosesFotoMesin(file) {
  const { img, bersihkan } = await bukaFile(file);
  try {
    const { sx, sy, sw, sh } = hitungCrop(img, 4 / 3);
    const W = Math.min(1200, Math.round(sw)), H = Math.round(W * 3 / 4);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
    await gambarWatermark(ctx, W, H);
    return await kanvasKeBlob(c);
  } finally { bersihkan(); }
}

// Foto part: crop 1:1 (persegi), maks 800x800, tanpa watermark, JPEG <= 1 MB
async function prosesFotoPart(file) {
  const { img, bersihkan } = await bukaFile(file);
  try {
    const { sx, sy, sw, sh } = hitungCrop(img, 1);
    const W = Math.min(800, Math.round(sw));
    const c = document.createElement('canvas'); c.width = W; c.height = W;
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, W);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, W);
    return await kanvasKeBlob(c);
  } finally { bersihkan(); }
}

// Banner katalog: crop 16:7, lebar 1600
async function prosesFotoBanner(file) {
  const { img, bersihkan } = await bukaFile(file);
  try {
    const { sx, sy, sw, sh } = hitungCrop(img, 16 / 7);
    const W = Math.min(1600, Math.round(sw)), H = Math.round(W * 7 / 16);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
    return await kanvasKeBlob(c);
  } finally { bersihkan(); }
}

// Logo: tetap PNG supaya transparan, sisi terpanjang maks 600 px
async function prosesLogo(file) {
  const { img, bersihkan } = await bukaFile(file);
  try {
    const k = Math.min(1, 600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    if (!blob) throw new Error('Gagal memproses logo.');
    return blob;
  } finally { bersihkan(); }
}

function formatStempel(ms) {
  const d = new Date(ms);
  const tgl = d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const jam = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  return `${tgl}  •  ${jam}`;
}

// Foto tahap: rasio asli, sisi terpanjang maks 1280, cap hari-tanggal-jam di pojok kanan bawah
async function prosesFotoTahap(file) {
  const { img, bersihkan } = await bukaFile(file);
  try {
    const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
    const W = Math.round(img.naturalWidth * k), H = Math.round(img.naturalHeight * k);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, W, H);

    let ms = file.lastModified;
    if (!ms || ms < 946684800000 || ms > Date.now() + 60000) ms = Date.now();
    const teks = formatStempel(ms);
    const fs = Math.max(14, Math.round(Math.max(W, H) * 0.026));
    ctx.font = `600 ${fs}px "JetBrains Mono", "Courier New", monospace`;
    const pad = Math.round(fs * 0.55);
    const lebar = ctx.measureText(teks).width + pad * 2, tinggi = fs + pad * 2;
    const x = W - lebar - pad, y = H - tinggi - pad;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x, y, lebar, tinggi);
    ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(teks, x + pad, y + tinggi / 2 + 1);

    return { blob: await kanvasKeBlob(c), diambil: new Date(ms).toISOString() };
  } finally { bersihkan(); }
}

// ============================================================
// UPLOADER FOTO (dipakai: Tambah Mesin, Edit Mesin, Tahap, Banner)
// mode: 'mesin' | 'tahap' | 'banner'
// ============================================================
function buatUploader(wrap, { max = 4, mode = 'mesin' } = {}) {
  const st = { items: [], hapus: [], max, mode };
  wrap.innerHTML = `
    <div class="up-grid"></div>
    <div class="foto-actions">
      <button type="button" class="btn btn-outline-primary up-kamera"><i class="bi bi-camera"></i> Ambil Foto</button>
      <button type="button" class="btn btn-outline-secondary up-galeri"><i class="bi bi-images"></i> Pilih dari Galeri</button>
    </div>
    <input type="file" accept="image/*" capture="environment" class="d-none up-in-kamera" />
    <input type="file" accept="image/*" multiple class="d-none up-in-galeri" />
    <div class="form-text up-info"></div>`;
  const grid = wrap.querySelector('.up-grid');
  const inKamera = wrap.querySelector('.up-in-kamera');
  const inGaleri = wrap.querySelector('.up-in-galeri');
  if (max === 1) inGaleri.multiple = false;

  st.render = () => {
    grid.innerHTML = st.items.map((it, i) => `
      <div class="up-item">
        <img src="${esc(it.preview)}" alt="Foto ${i + 1}" />
        ${i === 0 && mode !== 'tahap' && mode !== 'part' ? `<span class="up-sampul">${mode === 'banner' ? 'Pertama' : 'Sampul'}</span>` : ''}
        <button type="button" class="up-x" data-aksi="hapus" data-i="${i}" title="Hapus"><i class="bi bi-x-lg"></i></button>
        ${i > 0 && mode !== 'tahap' && mode !== 'part' ? `<button type="button" class="up-utama" data-aksi="utama" data-i="${i}">Jadikan ${mode === 'banner' ? 'pertama' : 'sampul'}</button>` : ''}
      </div>`).join('');
    const penuh = st.items.length >= st.max;
    wrap.querySelector('.up-kamera').disabled = penuh;
    wrap.querySelector('.up-galeri').disabled = penuh;
    wrap.querySelector('.up-info').textContent = `${st.items.length} / ${st.max} foto`;
    wrap.classList.toggle('up-satu', st.max === 1);
  };

  grid.addEventListener('click', (e) => {
    const b = e.target.closest('[data-aksi]');
    if (!b) return;
    const i = Number(b.dataset.i);
    if (b.dataset.aksi === 'hapus') {
      const [it] = st.items.splice(i, 1);
      if (it.blob) URL.revokeObjectURL(it.preview); else st.hapus.push(it);
    } else if (b.dataset.aksi === 'utama') {
      const [it] = st.items.splice(i, 1);
      st.items.unshift(it);
    }
    st.render();
  });

  st.tambah = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const sisa = st.max - st.items.length;
    if (sisa <= 0) { showToast(`Maksimal ${st.max} foto.`, 'error'); return; }
    if (files.length > sisa) showToast(`Hanya ${sisa} foto lagi yang bisa ditambahkan.`, 'error');
    showLoading();
    try {
      for (const f of files.slice(0, sisa)) {
        try {
          if (mode === 'tahap') {
            const r = await prosesFotoTahap(f);
            st.items.push({ blob: r.blob, diambil: r.diambil, preview: URL.createObjectURL(r.blob) });
          } else {
            const blob = mode === 'banner' ? await prosesFotoBanner(f) : mode === 'part' ? await prosesFotoPart(f) : await prosesFotoMesin(f);
            st.items.push({ blob, preview: URL.createObjectURL(blob) });
          }
        } catch (err) { showToast(err.message || 'Foto gagal diproses.', 'error'); }
      }
    } finally { hideLoading(); }
    st.render();
  };

  st.setItems = (list) => {
    st.items.forEach(it => { if (it.blob) URL.revokeObjectURL(it.preview); });
    st.items = list.map(x => ({ ...x }));
    st.hapus = [];
    st.render();
  };
  st.reset = () => st.setItems([]);

  wrap.querySelector('.up-kamera').addEventListener('click', () => inKamera.click());
  wrap.querySelector('.up-galeri').addEventListener('click', () => inGaleri.click());
  [inKamera, inGaleri].forEach(inp => inp.addEventListener('change', async () => {
    const files = Array.from(inp.files || []);
    inp.value = '';
    await st.tambah(files);
  }));
  st.render();
  return st;
}

async function unggahBlob(path, blob, tipe = 'image/jpeg') {
  const up = await sb.storage.from(BUCKET_FOTO).upload(path, blob, { contentType: tipe });
  if (up.error) throw up.error;
  return sb.storage.from(BUCKET_FOTO).getPublicUrl(path).data.publicUrl;
}

// ============================================================
// FORM MESIN (Tambah) + MODAL EDIT MESIN
// ============================================================
function fieldsMesinHtml(p) {
  return `
    <div class="mb-3">
      <label class="form-label">Foto Mesin <span class="text-muted">(maks 4 &bull; otomatis 4:3 &bull; &le; 1 MB &bull; berwatermark)</span></label>
      <div id="${p}-fotos"></div>
    </div>
    <div class="mb-3">
      <label class="form-label">Nama Mesin</label>
      <input type="text" class="form-control" id="${p}-nama" required />
    </div>
    <div class="row">
      <div class="col-6 mb-3">
        <label class="form-label">Harga Beli (Rp)</label>
        <input type="number" min="0" step="1000" class="form-control" id="${p}-harga" required />
      </div>
      <div class="col-6 mb-3">
        <label class="form-label">Tanggal Pembelian</label>
        <input type="date" class="form-control" id="${p}-tanggal" required />
      </div>
    </div>
    <div class="mb-3">
      <label class="form-label">Kategori <span class="text-muted">(untuk katalog)</span></label>
      <input type="text" list="${p}-kategori-list" class="form-control" id="${p}-kategori" autocomplete="off" />
      <datalist id="${p}-kategori-list"></datalist>
    </div>
    <div class="mb-3">
      <label class="form-label">Deskripsi Produk</label>
      <textarea class="form-control" id="${p}-deskripsi" rows="3"></textarea>
    </div>
    <div class="mb-3">
      <label class="form-label">Badge pada foto</label>
      <div class="badge-opsi">
        ${BADGES.map(b => `<label class="badge-opsi-item"><input type="checkbox" class="form-check-input ${p}-badge" value="${b.key}" /> <i class="bi ${b.icon}"></i> ${b.label}</label>`).join('')}
      </div>
    </div>
    <div class="form-check mb-3">
      <input type="checkbox" class="form-check-input" id="${p}-tampil" checked />
      <label class="form-check-label" for="${p}-tampil">Tampilkan di katalog publik (saat status Ready)</label>
    </div>`;
}

function bacaFormMesin(p) {
  return {
    nama_mesin: document.getElementById(`${p}-nama`).value.trim(),
    harga_beli: Number(document.getElementById(`${p}-harga`).value) || 0,
    tanggal_pembelian: document.getElementById(`${p}-tanggal`).value,
    kategori: document.getElementById(`${p}-kategori`).value.trim() || null,
    deskripsi: document.getElementById(`${p}-deskripsi`).value.trim() || null,
    badges: Array.from(document.querySelectorAll(`.${p}-badge:checked`)).map(c => c.value),
    tampil_katalog: document.getElementById(`${p}-tampil`).checked,
  };
}
function isiFormMesin(p, m) {
  document.getElementById(`${p}-nama`).value = m.nama_mesin || '';
  document.getElementById(`${p}-harga`).value = m.harga_beli != null ? Number(m.harga_beli) : '';
  document.getElementById(`${p}-tanggal`).value = m.tanggal_pembelian || tanggalLokal();
  document.getElementById(`${p}-kategori`).value = m.kategori || '';
  document.getElementById(`${p}-deskripsi`).value = m.deskripsi || '';
  document.querySelectorAll(`.${p}-badge`).forEach(c => { c.checked = (m.badges || []).includes(c.value); });
  document.getElementById(`${p}-tampil`).checked = m.tampil_katalog !== false;
}

async function muatDaftarKategori() {
  const { data } = await sb.from('mesin').select('kategori');
  const unik = [...new Set((data || []).map(r => r.kategori).filter(Boolean))].sort();
  ['mesin', 'em'].forEach(p => {
    const dl = document.getElementById(`${p}-kategori-list`);
    if (dl) dl.innerHTML = unik.map(k => `<option value="${esc(k)}"></option>`).join('');
  });
}

document.getElementById('form-mesin-fields').innerHTML = fieldsMesinHtml('mesin');
document.getElementById('edit-mesin-fields').innerHTML = fieldsMesinHtml('em');
const uploaderMesin = buatUploader(document.getElementById('mesin-fotos'), { max: 4, mode: 'mesin' });
const uploaderEdit = buatUploader(document.getElementById('em-fotos'), { max: 4, mode: 'mesin' });
let uploaderTahap = buatUploader(document.getElementById('tahap-foto-wrap'), { max: 4, mode: 'tahap' });
let editMesinId = null;

const DRAFT_KEY = 'kt_draft_mesin';
const KOLOM_DRAFT = ['nama', 'harga', 'tanggal', 'kategori', 'deskripsi'];

function resetFormMesin() {
  uploaderMesin.reset();
  isiFormMesin('mesin', {});
  muatDaftarKategori();
}
function simpanDraftMesin() {
  try {
    const d = {};
    KOLOM_DRAFT.forEach(k => { d[k] = document.getElementById(`mesin-${k}`).value; });
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch (_) {}
}
function restoreDraftMesin() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    KOLOM_DRAFT.forEach(k => { if (d[k]) document.getElementById(`mesin-${k}`).value = d[k]; });
    return Boolean(d.nama || d.harga);
  } catch (_) { return false; }
}
KOLOM_DRAFT.forEach(k => document.getElementById(`mesin-${k}`).addEventListener('input', simpanDraftMesin));

// Simpan perubahan foto mesin: hapus yang dibuang, unggah yang baru, atur urutan, set foto sampul
async function simpanFotoMesin(mesinId, st) {
  showLoading();
  try {
    for (const it of st.hapus) {
      const { error } = await sb.from('mesin_foto').delete().eq('id', it.id);
      if (error) throw error;
    }
    await hapusFileStorage(st.hapus.map(it => it.url));

    const akhir = [];
    let n = 0;
    for (let i = 0; i < st.items.length; i++) {
      const it = st.items[i];
      if (it.blob) {
        const url = await unggahBlob(`mesin/${mesinId}/${Date.now()}_${n++}.jpg`, it.blob);
        const { data, error } = await sb.from('mesin_foto').insert({ mesin_id: mesinId, url, urutan: i }).select().single();
        if (error) throw error;
        akhir.push({ id: data.id, url });
      } else {
        const { error } = await sb.from('mesin_foto').update({ urutan: i }).eq('id', it.id);
        if (error) throw error;
        akhir.push({ id: it.id, url: it.url });
      }
    }
    const { error } = await sb.from('mesin').update({ foto_url: akhir[0] ? akhir[0].url : null }).eq('id', mesinId);
    if (error) throw error;
    return true;
  } catch (err) {
    showToast('Foto gagal disimpan: ' + (err.message || err), 'error');
    return false;
  } finally { hideLoading(); }
}

document.getElementById('form-mesin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = bacaFormMesin('mesin');
  const ins = await callSupabase(sb.from('mesin').insert({ ...v, dibuat_oleh: currentProfile.id }).select().single());
  if (!ins.success) return;
  const okFoto = await simpanFotoMesin(ins.data.id, uploaderMesin);
  showToast(okFoto ? 'Mesin berhasil ditambahkan.' : 'Mesin tersimpan, tetapi foto belum berhasil. Buka Edit Mesin untuk mengulang.', okFoto ? 'success' : 'error');
  try { sessionStorage.removeItem(DRAFT_KEY); } catch (_) {}
  await loadAllReferenceData();
  resetFormMesin();
  navigateTo('dashboard');
});

async function bukaEditMesin(mesinId) {
  showLoading();
  let m, f;
  try {
    [m, f] = await Promise.all([
      sb.from('mesin').select('*').eq('id', mesinId).single(),
      sb.from('mesin_foto').select('*').eq('mesin_id', mesinId).order('urutan', { ascending: true }).order('created_at', { ascending: true }),
    ]);
  } finally { hideLoading(); }
  if (m.error || f.error) { showToast('Gagal memuat data mesin.', 'error'); return; }
  let fotos = f.data || [];
  // Mesin lama yang fotonya baru ada di kolom foto_url
  if (!fotos.length && m.data.foto_url) {
    const ins = await sb.from('mesin_foto').insert({ mesin_id: mesinId, url: m.data.foto_url, urutan: 0 }).select().single();
    if (!ins.error) fotos = [ins.data];
  }
  editMesinId = mesinId;
  await muatDaftarKategori();
  isiFormMesin('em', m.data);
  uploaderEdit.setItems(fotos.map(x => ({ id: x.id, url: x.url, preview: x.url })));
  bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-edit-mesin')).show();
}

document.getElementById('btn-simpan-edit-mesin').addEventListener('click', async () => {
  if (!editMesinId) return;
  const v = bacaFormMesin('em');
  if (!v.nama_mesin || !v.tanggal_pembelian) { showToast('Nama dan tanggal pembelian wajib diisi.', 'error'); return; }
  const up = await callSupabase(sb.from('mesin').update(v).eq('id', editMesinId));
  if (!up.success) return;
  const okFoto = await simpanFotoMesin(editMesinId, uploaderEdit);
  if (okFoto) showToast('Mesin berhasil diperbarui.', 'success');
  bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-edit-mesin')).hide();
  await loadAllReferenceData();
  const aktif = document.querySelector('.app-content-section:not(.d-none)')?.id;
  if (aktif === 'section-dashboard') loadDashboardData();
  if (aktif === 'section-rekap') loadRekapMesin(editMesinId);
});

// ============================================================
// FOTO TAHAP RESTORASI
// ============================================================
async function simpanFotoTahap(tahapId) {
  const st = uploaderTahap;
  if (!st.items.length && !st.hapus.length) return true;
  showLoading();
  try {
    for (const it of st.hapus) {
      const { error } = await sb.from('tahap_foto').delete().eq('id', it.id);
      if (error) throw error;
    }
    await hapusFileStorage(st.hapus.map(it => it.url));
    let n = 0;
    for (const it of st.items) {
      if (!it.blob) continue;
      const url = await unggahBlob(`tahap/${tahapId}/${Date.now()}_${n++}.jpg`, it.blob);
      const { error } = await sb.from('tahap_foto').insert({ tahap_id: tahapId, url, diambil_pada: it.diambil });
      if (error) throw error;
    }
    return true;
  } catch (err) {
    showToast('Foto tahap gagal disimpan: ' + (err.message || err), 'error');
    return false;
  } finally { hideLoading(); }
}

function fotoTahapHtml(t) {
  const f = t.tahap_foto || [];
  if (!f.length) return '';
  return `<div class="tahap-foto-strip">${f.map(x => `<img src="${esc(x.url)}" alt="Foto pengerjaan" loading="lazy" onclick="openFotoModal('${esc(x.url)}')" />`).join('')}</div>`;
}

// ============================================================
// PENGATURAN (Owner)
// ============================================================
const KUNCI_PENGATURAN = ['nama_usaha', 'alamat', 'hero_judul', 'hero_subjudul', 'wa_nomor', 'wa_pesan',
  'medsos_instagram', 'medsos_facebook', 'medsos_tiktok', 'medsos_youtube', 'medsos_website', 'medsos_maps', 'wm_teks'];
const uploaderBanner = buatUploader(document.getElementById('pg-slides-wrap'), { max: 5, mode: 'banner' });
let pgLogoUrl = '';
let pgLogoBaru = null;

function tampilkanLogoPengaturan() {
  const img = document.getElementById('pg-logo-preview');
  const src = pgLogoBaru ? img.dataset.blobUrl : pgLogoUrl;
  img.classList.toggle('d-none', !src);
  if (src) img.src = src;
  document.getElementById('btn-pg-logo-hapus').classList.toggle('d-none', !src);
}

async function isiFormPengaturan() {
  await loadPengaturan();
  KUNCI_PENGATURAN.forEach(k => { document.getElementById(`pg-${k}`).value = pengaturan[k] || ''; });
  if (!pengaturan.nama_usaha) document.getElementById('pg-nama_usaha').value = NAMA_USAHA;
  if (!pengaturan.alamat && ALAMAT_USAHA && !ALAMAT_USAHA.includes('Isi alamat')) document.getElementById('pg-alamat').value = ALAMAT_USAHA;
  if (!pengaturan.wm_teks) document.getElementById('pg-wm_teks').value = NAMA_USAHA;
  let slides = [];
  try { slides = JSON.parse(pengaturan.hero_slides || '[]'); } catch (_) {}
  uploaderBanner.setItems(slides.map(u => ({ url: u, preview: u })));
  pgLogoUrl = pengaturan.logoUrl || '';
  pgLogoBaru = null;
  tampilkanLogoPengaturan();
}

document.getElementById('btn-pg-logo').addEventListener('click', () => document.getElementById('pg-logo-file').click());
document.getElementById('pg-logo-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  showLoading();
  try {
    pgLogoBaru = await prosesLogo(file);
    const img = document.getElementById('pg-logo-preview');
    if (img.dataset.blobUrl) URL.revokeObjectURL(img.dataset.blobUrl);
    img.dataset.blobUrl = URL.createObjectURL(pgLogoBaru);
    tampilkanLogoPengaturan();
  } catch (err) { showToast(err.message, 'error'); } finally { hideLoading(); }
});
document.getElementById('btn-pg-logo-hapus').addEventListener('click', () => {
  pgLogoBaru = null; pgLogoUrl = ''; tampilkanLogoPengaturan();
});

document.getElementById('form-pengaturan').addEventListener('submit', async (e) => {
  e.preventDefault();
  showLoading();
  try {
    const baris = KUNCI_PENGATURAN.map(k => ({ key: k, value: document.getElementById(`pg-${k}`).value.trim() }));
    baris.forEach(b => { if (b.key === 'wa_nomor') b.value = b.value.replace(/\D/g, '').replace(/^0/, '62'); });

    // Banner
    await hapusFileStorage(uploaderBanner.hapus.map(it => it.url));
    const urls = [];
    let n = 0;
    for (const it of uploaderBanner.items) {
      urls.push(it.blob ? await unggahBlob(`banner/${Date.now()}_${n++}.jpg`, it.blob) : it.url);
    }
    baris.push({ key: 'hero_slides', value: JSON.stringify(urls) });

    // Logo
    let logoFinal = pgLogoUrl;
    if (pgLogoBaru) logoFinal = await unggahBlob(`logo/${Date.now()}.png`, pgLogoBaru, 'image/png');
    if (pengaturan.logoUrl && pengaturan.logoUrl !== logoFinal) await hapusFileStorage([pengaturan.logoUrl]);
    baris.push({ key: 'logoUrl', value: logoFinal });

    const { error } = await sb.from('app_config').upsert(baris, { onConflict: 'key' });
    if (error) throw error;
    showToast('Pengaturan disimpan.', 'success');
    await isiFormPengaturan();
    terapkanLogo(logoEfektif());
  } catch (err) {
    showToast('Gagal menyimpan pengaturan: ' + (err.message || err), 'error');
  } finally { hideLoading(); }
});

// ============================================================
// ASSET PART (Owner)
// ============================================================
let cachedAsset = [];
let cachedAssetRiwayat = [];
let asetTab = 'stok';

async function muatKpiAset() {
  if (!currentProfile || currentProfile.role !== 'owner') return;
  const { data } = await sb.from('asset_part').select('*').order('nama_part', { ascending: true });
  cachedAsset = data || [];
  const total = cachedAsset.reduce((s, p) => s + p.qty * Number(p.harga), 0);
  document.getElementById('kpi-aset-part').textContent = formatRupiah(total);
}

document.getElementById('btn-detail-aset').addEventListener('click', async () => {
  await muatKpiAset();
  const baris = cachedAsset.filter(p => p.qty > 0);
  document.getElementById('tbody-aset-detail').innerHTML = baris.map(p => `
    <tr><td><div class="d-flex align-items-center gap-2">${thumbPartHtml(p)}<div>${esc(p.nama_part)}<div class="text-muted small">${formatRupiah(p.harga)} / unit</div></div></div></td>
    <td class="text-center">${p.qty}</td><td class="text-end">${formatRupiah(p.qty * Number(p.harga))}</td></tr>`).join('')
    || '<tr><td colspan="3" class="text-muted">Belum ada part di stok.</td></tr>';
  document.getElementById('aset-detail-total').textContent = formatRupiah(baris.reduce((s, p) => s + p.qty * Number(p.harga), 0));
  bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-aset-detail')).show();
});
document.getElementById('btn-aset-ke-halaman').addEventListener('click', () => navigateTo('asset'));

async function loadAsset() {
  const [p, r] = await Promise.all([
    sb.from('asset_part').select('*').order('nama_part', { ascending: true }),
    sb.from('asset_part_riwayat').select('*').order('tanggal', { ascending: false }).order('created_at', { ascending: false }).limit(300),
  ]);
  if (p.error || r.error) { showToast((p.error || r.error).message, 'error'); return; }
  cachedAsset = p.data || [];
  cachedAssetRiwayat = r.data || [];
  const hariIni = tanggalLokal();
  ['am-tanggal', 'ak-tanggal'].forEach(id => { const el = document.getElementById(id); if (!el.value) el.value = hariIni; });
  renderAsset();
}

document.querySelectorAll('#asset-tabs .status-tab').forEach(b => b.addEventListener('click', () => { asetTab = b.dataset.tab; renderAsset(); }));

const JENIS_LABEL = { masuk: 'Masuk', keluar: 'Keluar', koreksi: 'Koreksi', hapus: 'Dihapus' };

function renderAsset() {
  document.querySelectorAll('#asset-tabs .status-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === asetTab));
  ['stok', 'masuk', 'keluar', 'riwayat'].forEach(t => document.getElementById(`asset-tab-${t}`).classList.toggle('d-none', t !== asetTab));
  if (asetTab === 'stok') renderAsetStok();
  if (asetTab === 'masuk') renderAsetMasuk();
  if (asetTab === 'keluar') renderAsetKeluar();
  if (asetTab === 'riwayat') renderAsetRiwayat();
}

const uploaderPart = buatUploader(document.getElementById('ep-foto'), { max: 1, mode: 'part' });
const uploaderPartBaru = buatUploader(document.getElementById('am-foto'), { max: 1, mode: 'part' });
let editPartId = null;

function thumbPartHtml(p) {
  return p.foto_url
    ? `<img class="part-thumb" src="${esc(p.foto_url)}" alt="${esc(p.nama_part)}" loading="lazy" onclick="openFotoModal('${esc(p.foto_url)}')" />`
    : `<div class="part-thumb part-thumb-kosong"><i class="bi bi-image"></i></div>`;
}

// Unggah foto part (1:1). Hasil: url baru, null jika dihapus, undefined jika tidak berubah.
async function simpanFotoPart(partId, st, urlLama) {
  const baru = st.items.find(it => it.blob);
  if (baru) {
    const url = await unggahBlob(`part/${partId}/${Date.now()}.jpg`, baru.blob);
    if (urlLama) await hapusFileStorage([urlLama]);
    return url;
  }
  if (!st.items.length && st.hapus.length) {
    if (urlLama) await hapusFileStorage([urlLama]);
    return null;
  }
  return undefined;
}

function renderAsetStok() {
  const kw = (document.getElementById('asset-cari').value || '').toLowerCase();
  const rows = cachedAsset.filter(p => p.nama_part.toLowerCase().includes(kw));
  document.getElementById('tbody-asset-stok').innerHTML = rows.map(p => `
    <tr data-id="${p.id}">
      <td>${thumbPartHtml(p)}</td>
      <td>${esc(p.nama_part)}</td>
      <td class="text-center">${p.qty}</td>
      <td class="text-end">${formatRupiah(p.harga)}</td>
      <td class="text-end">${formatRupiah(p.qty * Number(p.harga))}</td>
      <td class="text-end text-nowrap">
        <button class="btn btn-outline-secondary btn-sm" data-edit-part="${p.id}"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-outline-danger btn-sm" data-hapus-part="${p.id}"><i class="bi bi-trash"></i></button>
      </td>
    </tr>`).join('') || '<tr><td colspan="6" class="text-muted">Belum ada part. Tambahkan lewat tab Part Masuk.</td></tr>';
  document.getElementById('asset-grand-total').textContent = formatRupiah(cachedAsset.reduce((s, p) => s + p.qty * Number(p.harga), 0));

  document.querySelectorAll('[data-edit-part]').forEach(btn => btn.addEventListener('click', () => bukaEditPart(btn.dataset.editPart)));

  document.querySelectorAll('[data-hapus-part]').forEach(btn => btn.addEventListener('click', async () => {
    const p = cachedAsset.find(x => x.id === btn.dataset.hapusPart);
    if (!confirm(`Hapus part "${p.nama_part}" (stok ${p.qty})? Riwayat transaksinya tetap tersimpan.`)) return;
    await sb.from('asset_part_riwayat').insert({ part_id: null, nama_part: p.nama_part, jenis: 'hapus', qty: p.qty, harga: p.harga, keterangan: 'Part dihapus dari stok' });
    const r = await callSupabase(sb.from('asset_part').delete().eq('id', p.id), 'Part dihapus.');
    if (r.success) { if (p.foto_url) await hapusFileStorage([p.foto_url]); loadAsset(); }
  }));
}

function bukaEditPart(id) {
  const p = cachedAsset.find(x => x.id === id);
  if (!p) return;
  editPartId = id;
  document.getElementById('ep-nama').value = p.nama_part;
  document.getElementById('ep-qty').value = p.qty;
  document.getElementById('ep-harga').value = Number(p.harga);
  uploaderPart.setItems(p.foto_url ? [{ url: p.foto_url, preview: p.foto_url }] : []);
  bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-edit-part')).show();
}

document.getElementById('btn-simpan-edit-part').addEventListener('click', async () => {
  const lama = cachedAsset.find(x => x.id === editPartId);
  if (!lama) return;
  const nama = document.getElementById('ep-nama').value.trim();
  const qty = parseInt(document.getElementById('ep-qty').value, 10);
  const harga = Number(document.getElementById('ep-harga').value) || 0;
  if (!nama) { showToast('Nama part tidak boleh kosong.', 'error'); return; }
  if (!(qty >= 0)) { showToast('Qty tidak valid.', 'error'); return; }

  const perubahan = { nama_part: nama, qty, harga };
  showLoading();
  try {
    const fotoBaru = await simpanFotoPart(lama.id, uploaderPart, lama.foto_url);
    if (fotoBaru !== undefined) perubahan.foto_url = fotoBaru;
  } catch (err) {
    hideLoading(); showToast('Foto gagal disimpan: ' + (err.message || err), 'error'); return;
  }
  hideLoading();

  const r = await callSupabase(sb.from('asset_part').update(perubahan).eq('id', lama.id), 'Part diperbarui.');
  if (!r.success) return;
  const ubah = [];
  if (nama !== lama.nama_part) ubah.push(`nama "${lama.nama_part}" → "${nama}"`);
  if (qty !== lama.qty) ubah.push(`qty ${lama.qty} → ${qty}`);
  if (harga !== Number(lama.harga)) ubah.push(`harga ${formatRupiah(lama.harga)} → ${formatRupiah(harga)}`);
  if (ubah.length) {
    await sb.from('asset_part_riwayat').insert({ part_id: lama.id, nama_part: nama, jenis: 'koreksi', qty, harga, keterangan: 'Edit: ' + ubah.join(', ') });
  }
  bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-edit-part')).hide();
  loadAsset();
});
document.getElementById('asset-cari').addEventListener('input', renderAsetStok);

function renderAsetMasuk() {
  const sel = document.getElementById('am-part');
  const nilai = sel.value;
  sel.innerHTML = '<option value="">+ Part baru (ketik nama)</option>'
    + cachedAsset.map(p => `<option value="${p.id}">${esc(p.nama_part)} (stok ${p.qty})</option>`).join('');
  sel.value = cachedAsset.some(p => p.id === nilai) ? nilai : '';
  document.getElementById('am-nama-wrap').classList.toggle('d-none', sel.value !== '');
  document.getElementById('am-foto-wrap').classList.toggle('d-none', sel.value !== '');
  renderDaftarTransaksi('masuk', 'list-asset-masuk');
}
document.getElementById('am-part').addEventListener('change', (e) => {
  const p = cachedAsset.find(x => x.id === e.target.value);
  document.getElementById('am-nama-wrap').classList.toggle('d-none', Boolean(p));
  document.getElementById('am-foto-wrap').classList.toggle('d-none', Boolean(p));
  document.getElementById('am-harga').value = p ? Number(p.harga) : '';
});
document.getElementById('form-asset-masuk').addEventListener('submit', async (e) => {
  e.preventDefault();
  const partId = document.getElementById('am-part').value || null;
  const nama = document.getElementById('am-nama').value.trim();
  const hargaTeks = document.getElementById('am-harga').value;
  const r = await callSupabase(sb.rpc('asset_part_masuk', {
    p_part_id: partId, p_nama: nama, p_qty: parseInt(document.getElementById('am-qty').value, 10),
    p_harga: hargaTeks === '' ? null : Number(hargaTeks),
    p_ket: document.getElementById('am-ket').value.trim() || null,
    p_tanggal: document.getElementById('am-tanggal').value || null,
  }), 'Part masuk tersimpan.');
  if (r.success) {
    // Part baru + ada foto: unggah lalu simpan alamatnya
    if (!partId && r.data && uploaderPartBaru.items.length) {
      try {
        const url = await simpanFotoPart(r.data, uploaderPartBaru, null);
        if (url) await sb.from('asset_part').update({ foto_url: url }).eq('id', r.data);
      } catch (err) { showToast('Part tersimpan, tetapi foto gagal: ' + (err.message || err), 'error'); }
    }
    uploaderPartBaru.reset();
    e.target.reset(); document.getElementById('am-tanggal').value = tanggalLokal(); loadAsset();
  }
});

function renderAsetKeluar() {
  const sel = document.getElementById('ak-part');
  const nilai = sel.value;
  sel.innerHTML = '<option value="">-- Pilih part --</option>'
    + cachedAsset.filter(p => p.qty > 0).map(p => `<option value="${p.id}">${esc(p.nama_part)} (stok ${p.qty})</option>`).join('');
  sel.value = nilai;
  perbaruiHintStok();
  renderDaftarTransaksi('keluar', 'list-asset-keluar');
}
function perbaruiHintStok() {
  const p = cachedAsset.find(x => x.id === document.getElementById('ak-part').value);
  document.getElementById('ak-stok').textContent = p ? `(stok ${p.qty})` : '';
  document.getElementById('ak-qty').max = p ? p.qty : '';
}
document.getElementById('ak-part').addEventListener('change', perbaruiHintStok);
document.getElementById('form-asset-keluar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await callSupabase(sb.rpc('asset_part_keluar', {
    p_part_id: document.getElementById('ak-part').value,
    p_qty: parseInt(document.getElementById('ak-qty').value, 10),
    p_ket: document.getElementById('ak-ket').value.trim() || null,
    p_tanggal: document.getElementById('ak-tanggal').value || null,
  }), 'Part keluar tersimpan.');
  if (r.success) { e.target.reset(); document.getElementById('ak-tanggal').value = tanggalLokal(); loadAsset(); }
});

function renderDaftarTransaksi(jenis, elId) {
  const rows = cachedAssetRiwayat.filter(r => r.jenis === jenis).slice(0, 50);
  document.getElementById(elId).innerHTML = rows.map(r => `
    <div class="rekap-tahap-item d-flex justify-content-between align-items-center gap-2">
      <div>
        <strong>${esc(r.nama_part)}</strong> <span class="text-muted small">&times; ${r.qty}</span>
        <div class="text-muted small">${r.tanggal} &bull; ${formatRupiah(r.harga)} / unit &bull; ${formatRupiah(r.qty * Number(r.harga))}${r.keterangan ? ' &bull; ' + esc(r.keterangan) : ''}</div>
      </div>
      <button class="btn btn-outline-danger btn-sm flex-shrink-0" data-batal-trx="${r.id}" title="Batalkan transaksi"><i class="bi bi-trash"></i></button>
    </div>`).join('') || '<p class="text-muted small">Belum ada transaksi.</p>';
  document.querySelectorAll(`#${elId} [data-batal-trx]`).forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Batalkan transaksi ini? Stok akan dikembalikan seperti sebelum transaksi.')) return;
    const r = await callSupabase(sb.rpc('asset_part_hapus_transaksi', { p_id: btn.dataset.batalTrx }), 'Transaksi dibatalkan.');
    if (r.success) loadAsset();
  }));
}

function renderAsetRiwayat() {
  document.getElementById('tbody-asset-riwayat').innerHTML = cachedAssetRiwayat.map(r => `
    <tr><td class="text-nowrap">${r.tanggal}</td><td><span class="jenis-pill jenis-${r.jenis}">${JENIS_LABEL[r.jenis]}</span></td>
    <td>${esc(r.nama_part)}</td><td class="text-center">${r.qty}</td><td class="small">${esc(r.keterangan || '')}</td></tr>`).join('')
    || '<tr><td colspan="5" class="text-muted">Belum ada riwayat.</td></tr>';
}

// ============================================================
// MODAL AKTIF, TANDAI TERJUAL (harga jual & margin), REKAP BULANAN
// Rumus:  HPP = harga beli + biaya restorasi (ongkos mekanik + sparepart)
//         Margin = harga jual - HPP
//         Modal aktif = HPP semua mesin yang BELUM terjual
// ============================================================
function teksTanggal(iso) {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}
function kelasMargin(n) { return n < 0 ? 'teks-rugi' : ''; }

// ── Detail Modal Aktif ──
document.getElementById('btn-detail-modal').addEventListener('click', () => {
  const aktif = dashboardRows.filter(r => statusMesin(r) !== 'terjual').sort((a, b) => hppMesin(b) - hppMesin(a));
  document.getElementById('tbody-modal-aktif').innerHTML = aktif.map(r => `
    <tr><td>${esc(r.nama_mesin)}<div class="text-muted small">${STATUS_LABEL[statusMesin(r)]}</div></td>
    <td class="text-end">${formatRupiah(r.harga_beli)}</td><td class="text-end">${formatRupiah(biayaRestorasi(r))}</td>
    <td class="text-end">${formatRupiah(hppMesin(r))}</td></tr>`).join('')
    || '<tr><td colspan="4" class="text-muted">Tidak ada mesin aktif.</td></tr>';
  document.getElementById('ma-total-beli').textContent = formatRupiah(aktif.reduce((s, r) => s + Number(r.harga_beli), 0));
  document.getElementById('ma-total-resto').textContent = formatRupiah(aktif.reduce((s, r) => s + biayaRestorasi(r), 0));
  document.getElementById('ma-total').textContent = formatRupiah(aktif.reduce((s, r) => s + hppMesin(r), 0));
  bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-modal-aktif')).show();
});

// ── Tandai Terjual ──
let terjualCtx = null;
function bukaModalTerjual(ctx) {
  terjualCtx = ctx;
  document.getElementById('tj-nama').textContent = ctx.nama;
  document.getElementById('tj-harga').value = ctx.hargaJual != null ? Number(ctx.hargaJual) : '';
  document.getElementById('tj-tanggal').value = ctx.tanggal || tanggalLokal();
  document.getElementById('tj-hpp').textContent = formatRupiah(ctx.hpp);
  hitungMarginTerjual();
  bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-terjual')).show();
}
function hitungMarginTerjual() {
  const teks = document.getElementById('tj-harga').value;
  const el = document.getElementById('tj-margin');
  if (teks === '' || !terjualCtx) { el.textContent = '-'; el.classList.remove('teks-rugi'); return; }
  const margin = Number(teks) - terjualCtx.hpp;
  el.textContent = formatRupiah(margin);
  el.classList.toggle('teks-rugi', margin < 0);
}
document.getElementById('tj-harga').addEventListener('input', hitungMarginTerjual);
document.getElementById('btn-simpan-terjual').addEventListener('click', async () => {
  if (!terjualCtx) return;
  const teks = document.getElementById('tj-harga').value;
  const tanggal = document.getElementById('tj-tanggal').value;
  if (teks === '' || Number(teks) < 0) { showToast('Isi harga jual dengan benar.', 'error'); return; }
  if (!tanggal) { showToast('Isi tanggal terjual.', 'error'); return; }
  const r = await callSupabase(
    sb.from('mesin').update({ status_manual: 'terjual', harga_jual: Number(teks), tanggal_terjual: tanggal }).eq('id', terjualCtx.mesinId),
    'Mesin ditandai terjual.');
  if (!r.success) return;
  bootstrap.Modal.getOrCreateInstance(document.getElementById('modal-terjual')).hide();
  const setelah = terjualCtx.setelah;
  terjualCtx = null;
  if (setelah) setelah();
});

// ── Rekap Bulanan (tab pada halaman Rekap / Invoice) ──
function setTabInvoice(tab) {
  document.querySelectorAll('#invoice-tabs .status-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('invoice-tab-mesin').classList.toggle('d-none', tab !== 'mesin');
  document.getElementById('invoice-tab-bulanan').classList.toggle('d-none', tab !== 'bulanan');
  if (tab === 'bulanan') {
    if (!document.getElementById('rb-mulai').value) terapkanPresetRekap('bulan-ini');
    muatRekapBulanan();
  }
}
document.querySelectorAll('#invoice-tabs .status-tab').forEach(b => b.addEventListener('click', () => setTabInvoice(b.dataset.tab)));

function terapkanPresetRekap(preset) {
  const r = rentangTanggal(preset);
  document.getElementById('rb-mulai').value = r.mulai;
  document.getElementById('rb-sampai').value = r.sampai;
  document.querySelectorAll('.rb-preset').forEach(b => b.classList.toggle('active', b.dataset.preset === preset));
}
document.querySelectorAll('.rb-preset').forEach(b => b.addEventListener('click', () => { terapkanPresetRekap(b.dataset.preset); muatRekapBulanan(); }));
['rb-mulai', 'rb-sampai'].forEach(id => document.getElementById(id).addEventListener('change', () => {
  document.querySelectorAll('.rb-preset').forEach(b => b.classList.remove('active'));
  muatRekapBulanan();
}));
document.getElementById('btn-cetak-rekap').addEventListener('click', () => window.print());

async function muatRekapBulanan() {
  const mulai = document.getElementById('rb-mulai').value;
  const sampai = document.getElementById('rb-sampai').value;
  if (!mulai || !sampai) return;
  if (mulai > sampai) { showToast('Tanggal mulai tidak boleh setelah tanggal akhir.', 'error'); return; }

  showLoading();
  let mesinRes, tahapRes, asetRes, keluarRes;
  try {
    [mesinRes, tahapRes, asetRes, keluarRes] = await Promise.all([
      sb.from('v_rekap_mesin').select('*'),
      sb.from('tahap_restorasi').select('id, tanggal_pengerjaan, tahap_sparepart(harga_terpakai), tahap_mekanik(ongkos)')
        .gte('tanggal_pengerjaan', mulai).lte('tanggal_pengerjaan', sampai),
      sb.from('asset_part').select('qty, harga'),
      sb.from('asset_part_riwayat').select('*').eq('jenis', 'keluar').gte('tanggal', mulai).lte('tanggal', sampai).order('tanggal', { ascending: true }),
    ]);
  } finally { hideLoading(); }
  const gagal = [mesinRes, tahapRes, asetRes, keluarRes].find(x => x.error);
  if (gagal) { showToast('Gagal memuat rekap: ' + gagal.error.message, 'error'); return; }

  const mesin = mesinRes.data || [];
  const dalam = (t) => t && t >= mulai && t <= sampai;

  const dibeli = mesin.filter(r => dalam(r.tanggal_pembelian));
  const totalBeli = dibeli.reduce((s, r) => s + Number(r.harga_beli), 0);

  const tahap = tahapRes.data || [];
  const totalResto = tahap.reduce((s, t) =>
    s + (t.tahap_mekanik || []).reduce((a, m) => a + Number(m.ongkos), 0)
      + (t.tahap_sparepart || []).reduce((a, p) => a + Number(p.harga_terpakai), 0), 0);

  const terjual = mesin.filter(r => r.status_manual === 'terjual' && r.harga_jual != null && dalam(r.tanggal_terjual))
    .sort((a, b) => a.tanggal_terjual.localeCompare(b.tanggal_terjual));
  const omzet = terjual.reduce((s, r) => s + Number(r.harga_jual), 0);
  const hppTerjual = terjual.reduce((s, r) => s + hppMesin(r), 0);
  const untung = omzet - hppTerjual;
  const belumLengkap = mesin.filter(r => r.status_manual === 'terjual' && (r.harga_jual == null || !r.tanggal_terjual)).length;

  const nilaiAset = (asetRes.data || []).reduce((s, p) => s + p.qty * Number(p.harga), 0);
  const keluar = keluarRes.data || [];
  const nilaiKeluar = keluar.reduce((s, r) => s + r.qty * Number(r.harga), 0);

  document.getElementById('rb-sheet').classList.remove('d-none');
  document.getElementById('rb-nama-usaha').textContent = namaUsaha();
  document.getElementById('rb-alamat').textContent = alamatUsaha();
  if (logoEfektif()) document.getElementById('rb-logo').innerHTML = `<img src="${esc(logoEfektif())}" alt="Logo" style="width:100%;height:100%;object-fit:contain" />`;
  document.getElementById('rb-periode').textContent = `${teksTanggal(mulai)} s/d ${teksTanggal(sampai)}`;

  const peringatan = document.getElementById('rb-peringatan');
  peringatan.classList.toggle('d-none', belumLengkap === 0);
  peringatan.textContent = belumLengkap
    ? `${belumLengkap} mesin berstatus Terjual belum punya harga jual/tanggal terjual sehingga tidak ikut dihitung. Buka Rekap mesinnya lalu klik "Ubah Harga Jual".` : '';

  const baris = [
    ['Pembelian Mesin', `${dibeli.length} unit (berdasarkan tanggal beli)`, formatRupiah(totalBeli), ''],
    ['Biaya Restorasi', `${tahap.length} tahap (berdasarkan tanggal pengerjaan)`, formatRupiah(totalResto), ''],
    ['Mesin Terjual (Omzet)', `${terjual.length} unit`, formatRupiah(omzet), ''],
    ['HPP Mesin Terjual', 'Harga beli + seluruh biaya restorasi mesin tersebut', formatRupiah(hppTerjual), ''],
    ['Keuntungan Penjualan', 'Omzet - HPP', formatRupiah(untung), 'rb-total ' + kelasMargin(untung)],
    ['Total Stok Nilai Part Aset', 'Kondisi saat ini (bukan per akhir periode)', formatRupiah(nilaiAset), ''],
    ['Nilai Part Aset Keluar', `${keluar.length} transaksi dalam periode`, formatRupiah(nilaiKeluar), ''],
  ];
  document.getElementById('rb-ringkasan').innerHTML = baris.map(([a, b, c, k]) =>
    `<tr class="${k}"><td><strong>${a}</strong><div class="rb-ket">${b}</div></td><td class="text-end rb-nilai">${c}</td></tr>`).join('');

  document.getElementById('rb-terjual').innerHTML = terjual.map(r => {
    const m = Number(r.harga_jual) - hppMesin(r);
    return `<tr><td>${r.tanggal_terjual}</td><td>${esc(r.nama_mesin)}</td><td class="text-end">${formatRupiah(r.harga_jual)}</td>
      <td class="text-end">${formatRupiah(hppMesin(r))}</td><td class="text-end ${kelasMargin(m)}">${formatRupiah(m)}</td></tr>`;
  }).join('') || '<tr><td colspan="5" class="text-center text-muted">Tidak ada mesin terjual pada periode ini.</td></tr>';

  document.getElementById('rb-keluar').innerHTML = keluar.map(r => `
    <tr><td>${r.tanggal}</td><td>${esc(r.nama_part)}</td><td class="text-center">${r.qty}</td>
    <td class="text-end">${formatRupiah(r.harga)}</td><td class="text-end">${formatRupiah(r.qty * Number(r.harga))}</td></tr>`).join('')
    || '<tr><td colspan="5" class="text-center text-muted">Tidak ada part keluar pada periode ini.</td></tr>';
}
