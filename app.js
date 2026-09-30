// ============================================================
// Kira Teknik — app.js
// ============================================================

// ── Konfigurasi Supabase dibaca dari config.js (diisi sekali saja di file itu) ──
const _cfg = window.KIRA_CONFIG || {};
const SUPABASE_URL = _cfg.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = _cfg.SUPABASE_ANON_KEY || '';

const CONFIG_OK = Boolean(SUPABASE_URL) && Boolean(SUPABASE_ANON_KEY)
  && !SUPABASE_URL.includes('xxxx') && !SUPABASE_ANON_KEY.includes('xxxx');
let sb = null;
try {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (err) {
  console.error('Gagal membuat client Supabase:', err);
}

// Cek konfigurasi: pesan jelas jika URL/key belum diisi atau salah
function cekKonfigurasi() {
  if (!sb || !CONFIG_OK) {
    showToast('Konfigurasi Supabase belum benar. Isi SUPABASE_URL dan SUPABASE_ANON_KEY di config.js.', 'error');
    return false;
  }
  return true;
}

const BUCKET_FOTO = 'foto-mesin';

let currentProfile = null;
let cachedMesin = [];
let cachedSparepart = [];
let cachedProfiles = [];
let cachedMekanik = [];
let sparepartRowCount = 0;
let currentRekapMesinId = null;

// ── Helper: Loading Overlay ──
function showLoading() { document.getElementById('loading-overlay').classList.remove('d-none'); }
function hideLoading() { document.getElementById('loading-overlay').classList.add('d-none'); }

// ── Helper: Toast Notifikasi ──
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast-item toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// ── Helper: Wrapper Supabase Call ──
async function callSupabase(promise, successMessage) {
  showLoading();
  try {
    const { data, error } = await promise;
    if (error) throw error;
    if (successMessage) showToast(successMessage, 'success');
    return { success: true, data };
  } catch (error) {
    showToast(error.message || 'Terjadi kesalahan.', 'error');
    return { success: false, data: null, message: error.message };
  } finally {
    hideLoading();
  }
}

// ── Helper: Format Rupiah ──
function formatRupiah(angka) {
  const n = Number(angka) || 0;
  return 'Rp ' + n.toLocaleString('id-ID');
}

function rentangTanggal(preset) {
  const hariIni = new Date(); hariIni.setHours(0, 0, 0, 0);
  const d = (n) => { const x = new Date(hariIni); x.setDate(x.getDate() + n); return x; };
  const iso = (x) => x.toISOString().slice(0, 10);
  const hari = hariIni.getDay(); // 0=Minggu .. 6=Sabtu
  if (preset === 'minggu-ini') {
    const senin = d(hari === 0 ? -6 : 1 - hari);
    return { mulai: iso(senin), sampai: iso(d(hari === 0 ? -6 : 1 - hari + 5)) }; // Senin s/d Sabtu
  }
  if (preset === 'minggu-lalu') {
    const seninLalu = d((hari === 0 ? -6 : 1 - hari) - 7);
    const x = new Date(seninLalu); x.setDate(x.getDate() + 5);
    return { mulai: iso(seninLalu), sampai: iso(x) };
  }
  if (preset === 'bulan-ini') {
    const awal = new Date(hariIni.getFullYear(), hariIni.getMonth(), 1);
    const akhir = new Date(hariIni.getFullYear(), hariIni.getMonth() + 1, 0);
    return { mulai: iso(awal), sampai: iso(akhir) };
  }
  return null;
}

// ============================================================
// AUTH
// ============================================================
const NAMA_FUNGSI_AKUN = _cfg.FUNGSI_AKUN || 'kelola-akun';
const LOGIN_DOMAIN = _cfg.LOGIN_DOMAIN || 'kirateknik.app';
function usernameKeEmail(input) {
  const v = String(input || '').trim().toLowerCase();
  return v.includes('@') ? v : `${v}@${LOGIN_DOMAIN}`;
}

document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!cekKonfigurasi()) return;
  const email = usernameKeEmail(document.getElementById('login-email').value);
  const password = document.getElementById('login-password').value;
  await callSupabase(sb.auth.signInWithPassword({ email, password }));
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await sb.auth.signOut();
});

let initializedUserId = null;

if (sb && CONFIG_OK) {
  sb.auth.onAuthStateChange((event, session) => {
    if (session) {
      // Supabase memicu event ini lagi setiap halaman kembali aktif (mis. selesai memakai kamera).
      // Jika user-nya sama, abaikan agar halaman yang sedang dibuka tidak berpindah ke Dashboard.
      if (initializedUserId === session.user.id) return;
      initializedUserId = session.user.id;
      setTimeout(() => initAppForUser(session.user.id), 0);
    } else {
      initializedUserId = null;
      currentProfile = null;
      if (realtimeChannel) { sb.removeChannel(realtimeChannel); realtimeChannel = null; }
      document.getElementById('app-shell').classList.add('d-none');
      document.getElementById('section-login').classList.remove('d-none');
    }
  });
}

async function initAppForUser(userId) {
  const result = await callSupabase(sb.from('profiles').select('*').eq('id', userId).single());
  if (!result.success) return;

  currentProfile = result.data;
  const isOwner = currentProfile.role === 'owner';
  document.getElementById('section-login').classList.add('d-none');
  document.getElementById('app-shell').classList.remove('d-none');
  document.getElementById('user-info').textContent = `${currentProfile.username || currentProfile.nama} (${currentProfile.role})`;
  document.querySelectorAll('[data-owner-only]').forEach(el => el.classList.toggle('d-none', !isOwner));

  await loadAllReferenceData();

  let tersimpan = null;
  try { tersimpan = sessionStorage.getItem('kt_section'); } catch (_) {}
  const boleh = isOwner ? ['dashboard', 'mesin', 'tahap', 'sparepart', 'mekanik', 'akun'] : MEKANIK_SECTIONS;
  const tujuan = boleh.includes(tersimpan) ? tersimpan : (isOwner ? 'dashboard' : 'tahap');
  navigateTo(tujuan);
  if (tujuan === 'mesin' && restoreDraftMesin()) {
    showToast('Halaman sempat dimuat ulang oleh HP. Isian dipulihkan, silakan ambil fotonya lagi.', 'success');
  }
  setupRealtime();
}

// ============================================================
// SPA ROUTING
// ============================================================
document.querySelectorAll('.sidebar .nav-link').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo(link.dataset.section);
    closeSidebar();
  });
});

const SECTION_TITLES = {
  dashboard: 'Dashboard', mesin: 'Tambah Mesin', tahap: 'Tambah Tahap Restorasi',
  sparepart: 'Katalog Sparepart', rekap: 'Rekap Biaya Mesin', mekanik: 'Master Mekanik', akun: 'Kelola Akun',
};
const MEKANIK_SECTIONS = ['tahap', 'sparepart'];

function navigateTo(sectionId) {
  // Mekanik hanya boleh membuka halaman input
  if (currentProfile && currentProfile.role !== 'owner' && !MEKANIK_SECTIONS.includes(sectionId)) sectionId = 'tahap';
  try { sessionStorage.setItem('kt_section', sectionId); } catch (_) {}
  document.querySelectorAll('.app-content-section').forEach(el => el.classList.add('d-none'));
  document.getElementById(`section-${sectionId}`)?.classList.remove('d-none');
  document.querySelectorAll('.sidebar .nav-link').forEach(el => el.classList.remove('active'));
  document.querySelector(`.sidebar .nav-link[data-section="${sectionId}"]`)?.classList.add('active');
  document.getElementById('topbar-title').textContent = SECTION_TITLES[sectionId] || 'Kira Teknik';

  if (sectionId === 'dashboard') loadDashboardData();
  if (sectionId === 'mesin') resetFormMesin();
  if (sectionId === 'tahap') resetFormTahap();
  if (sectionId === 'sparepart') renderSparepartTable();
  if (sectionId === 'mekanik') renderMekanikTable();
  if (sectionId === 'akun') loadAkun();
}

// ── Sidebar mobile (off-canvas) ──
document.getElementById('btn-open-sidebar').addEventListener('click', () => {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-backdrop').classList.remove('d-none');
});
document.getElementById('sidebar-backdrop').addEventListener('click', closeSidebar);
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-backdrop').classList.add('d-none');
}

// ── Dark mode ──
document.getElementById('btn-dark-toggle').addEventListener('click', toggleDarkMode);
function toggleDarkMode() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  html.setAttribute('data-theme', isDark ? 'light' : 'dark');
  localStorage.setItem('theme', isDark ? 'light' : 'dark');
}
(function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
})();

// ============================================================
// REFERENCE DATA (mesin, sparepart, profiles/mekanik)
// ============================================================
async function loadAllReferenceData() {
  const [mesinRes, sparepartRes, mekanikRes] = await Promise.all([
    sb.from('v_mesin_dropdown').select('*').order('nama_mesin', { ascending: true }),
    sb.from('sparepart').select('*').order('nama_sparepart', { ascending: true }),
    sb.from('mekanik').select('*').order('nama', { ascending: true }),
  ]);
  cachedMesin = mesinRes.data || [];
  cachedSparepart = sparepartRes.data || [];
  cachedMekanik = mekanikRes.data || [];
}

// ============================================================
// DASHBOARD
// ============================================================
const STATUS_LABEL = { masuk: 'Mesin Masuk', restorasi: 'Dalam Restorasi', ready: 'Mesin Ready', terjual: 'Mesin Terjual' };
let dashboardRows = [];
let statusAktif = 'restorasi';

// Masuk/Dalam Restorasi otomatis dari ada-tidaknya tahap; Ready/Terjual ditandai manual oleh Owner
function statusMesin(r) {
  if (r.status_manual) return r.status_manual;
  return Number(r.jumlah_tahap) > 0 ? 'restorasi' : 'masuk';
}
function biayaRestorasi(r) { return Number(r.total_ongkos_kerja) + Number(r.total_sparepart); }

async function loadDashboardData() {
  const result = await callSupabase(sb.from('v_rekap_mesin').select('*').order('nama_mesin', { ascending: true }));
  if (!result.success) return;
  dashboardRows = result.data;

  document.getElementById('kpi-total-mesin').textContent = dashboardRows.length;
  document.getElementById('kpi-total-biaya').textContent = formatRupiah(dashboardRows.reduce((s, r) => s + biayaRestorasi(r), 0));
  document.getElementById('kpi-total-tahap').textContent = dashboardRows.reduce((s, r) => s + Number(r.jumlah_tahap), 0);

  const termahal = [...dashboardRows].sort((a, b) => biayaRestorasi(b) - biayaRestorasi(a))[0];
  document.getElementById('ai-insight').textContent = termahal
    ? `Mesin dengan biaya restorasi tertinggi saat ini: "${termahal.nama_mesin}" sebesar ${formatRupiah(biayaRestorasi(termahal))}.`
    : 'Belum ada data mesin untuk dianalisis.';
  renderMesinGrid();
}

renderLaporanMekanik();

function renderMesinGrid() {
  const hitung = { masuk: 0, restorasi: 0, ready: 0, terjual: 0 };
  dashboardRows.forEach(r => hitung[statusMesin(r)]++);
  const tabs = document.getElementById('status-tabs');
  tabs.innerHTML = Object.keys(STATUS_LABEL).map(k =>
    `<button type="button" class="status-tab ${k === statusAktif ? 'active' : ''}" data-status="${k}">${STATUS_LABEL[k]} <span class="status-count">${hitung[k]}</span></button>`).join('');
  tabs.querySelectorAll('.status-tab').forEach(b => b.addEventListener('click', () => { statusAktif = b.dataset.status; renderMesinGrid(); }));

  const keyword = (document.getElementById('filter-mesin').value || '').toLowerCase();
  const rows = dashboardRows.filter(r => statusMesin(r) === statusAktif && r.nama_mesin.toLowerCase().includes(keyword));
  const grid = document.getElementById('grid-mesin');
  grid.innerHTML = rows.map(r => {
    const restorasi = biayaRestorasi(r);
    const fotoEl = r.foto_url ? `<img src="${r.foto_url}" alt="${r.nama_mesin}" />` : `<div class="no-foto"><i class="bi bi-image"></i></div>`;
    return `
      <div class="mesin-card" data-id="${r.mesin_id}">
        ${fotoEl}
        <div class="mesin-card-body">
          <div class="mesin-card-name">${r.nama_mesin}</div>
          <div class="mesin-card-line"><span>Harga Beli</span><span>${formatRupiah(r.harga_beli)}</span></div>
          <div class="mesin-card-line"><span>Total Restorasi</span><span>${formatRupiah(restorasi)}</span></div>
          <div class="mesin-card-line hpp"><span>Total HPP</span><span>${formatRupiah(Number(r.harga_beli) + restorasi)}</span></div>
        </div>
      </div>`;
  }).join('') || '<p class="text-muted">Tidak ada mesin di kelompok ini.</p>';
  grid.querySelectorAll('.mesin-card').forEach(card => card.addEventListener('click', () => openRekapMesin(card.dataset.id)));
}
document.getElementById('filter-mesin').addEventListener('input', renderMesinGrid);

// ============================================================
// LAPORAN ONGKOS PER MEKANIK
// ============================================================
document.querySelectorAll('.laporan-preset').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.laporan-preset').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const r = rentangTanggal(btn.dataset.preset);
  if (r) { document.getElementById('laporan-mulai').value = r.mulai; document.getElementById('laporan-sampai').value = r.sampai; }
  renderLaporanMekanik();
}));
['laporan-mulai', 'laporan-sampai'].forEach(id => document.getElementById(id).addEventListener('change', () => {
  document.querySelectorAll('.laporan-preset').forEach(b => b.classList.remove('active'));
  renderLaporanMekanik();
}));

async function renderLaporanMekanik() {
  const mulai = document.getElementById('laporan-mulai').value;
  const sampai = document.getElementById('laporan-sampai').value;
  let q = sb.from('tahap_restorasi').select('id, tanggal_pengerjaan, tahap_mekanik(mekanik_id, ongkos)');
  if (mulai) q = q.gte('tanggal_pengerjaan', mulai);
  if (sampai) q = q.lte('tanggal_pengerjaan', sampai);
  const { data, error } = await q;
  const tbody = document.getElementById('tbody-laporan-mekanik');
  if (error) { tbody.innerHTML = `<tr><td colspan="3" class="text-danger">${error.message}</td></tr>`; return; }

  const rekap = {};
  (data || []).forEach(t => (t.tahap_mekanik || []).forEach(tm => {
    if (!rekap[tm.mekanik_id]) rekap[tm.mekanik_id] = { tahap: new Set(), total: 0 };
    rekap[tm.mekanik_id].tahap.add(t.id);
    rekap[tm.mekanik_id].total += Number(tm.ongkos);
  }));
  const baris = Object.entries(rekap).map(([id, v]) => ({
    nama: (cachedMekanik.find(m => m.id === id) || {}).nama || '(mekanik tidak dikenal)',
    jumlahTahap: v.tahap.size, total: v.total,
  })).sort((a, b) => b.total - a.total);

  tbody.innerHTML = baris.map(b => `<tr><td>${b.nama}</td><td class="text-center">${b.jumlahTahap}</td><td class="text-end">${formatRupiah(b.total)}</td></tr>`).join('')
    || '<tr><td colspan="3" class="text-muted">Tidak ada data pada rentang ini.</td></tr>';
  document.getElementById('laporan-grand-total').textContent = formatRupiah(baris.reduce((s, b) => s + b.total, 0));
}



// ============================================================
// FORM: TAMBAH MESIN
// ============================================================
let fotoTerpilih = null;
const DRAFT_KEY = 'kt_draft_mesin';

function resetFormMesin() {
  document.getElementById('form-mesin').reset();
  setFotoMesin(null);
  document.getElementById('mesin-tanggal').value = new Date().toISOString().slice(0, 10);
}

// Menampilkan / menghapus foto yang dipilih (dari kamera maupun galeri)
function setFotoMesin(file) {
  fotoTerpilih = file;
  const preview = document.getElementById('mesin-foto-preview');
  const btnHapus = document.getElementById('btn-foto-hapus');
  if (preview.dataset.url) URL.revokeObjectURL(preview.dataset.url);
  if (file) {
    const url = URL.createObjectURL(file);
    preview.src = url;
    preview.dataset.url = url;
    preview.classList.remove('d-none');
    btnHapus.classList.remove('d-none');
  } else {
    preview.removeAttribute('src');
    preview.dataset.url = '';
    preview.classList.add('d-none');
    btnHapus.classList.add('d-none');
    document.getElementById('mesin-foto-kamera').value = '';
    document.getElementById('mesin-foto-galeri').value = '';
  }
}

document.getElementById('btn-foto-kamera').addEventListener('click', () => document.getElementById('mesin-foto-kamera').click());
document.getElementById('btn-foto-galeri').addEventListener('click', () => document.getElementById('mesin-foto-galeri').click());
document.getElementById('btn-foto-hapus').addEventListener('click', () => setFotoMesin(null));
['mesin-foto-kamera', 'mesin-foto-galeri'].forEach(id => {
  document.getElementById(id).addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) setFotoMesin(file);
  });
});

// Draft isian teks: berjaga-jaga jika HP memuat ulang halaman saat kamera dibuka
function simpanDraftMesin() {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
      nama: document.getElementById('mesin-nama').value,
      harga: document.getElementById('mesin-harga').value,
      tanggal: document.getElementById('mesin-tanggal').value,
    }));
  } catch (_) {}
}
function restoreDraftMesin() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    document.getElementById('mesin-nama').value = d.nama || '';
    document.getElementById('mesin-harga').value = d.harga || '';
    if (d.tanggal) document.getElementById('mesin-tanggal').value = d.tanggal;
    return Boolean(d.nama || d.harga);
  } catch (_) { return false; }
}
['mesin-nama', 'mesin-harga', 'mesin-tanggal'].forEach(id =>
  document.getElementById(id).addEventListener('input', simpanDraftMesin));

document.getElementById('form-mesin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const namaMesin = document.getElementById('mesin-nama').value;
  const hargaBeli = document.getElementById('mesin-harga').value;
  const tanggalBeli = document.getElementById('mesin-tanggal').value;
  const fotoFile = fotoTerpilih;

  let fotoUrl = null;
  if (fotoFile) {
    const namaAman = (fotoFile.name || 'foto.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${currentProfile.id}/${Date.now()}_${namaAman}`;
    const uploadResult = await callSupabase(sb.storage.from(BUCKET_FOTO).upload(path, fotoFile));
    if (!uploadResult.success) return;
    fotoUrl = sb.storage.from(BUCKET_FOTO).getPublicUrl(path).data.publicUrl;
  }

  const result = await callSupabase(
    sb.from('mesin').insert({
      nama_mesin: namaMesin,
      harga_beli: hargaBeli,
      tanggal_pembelian: tanggalBeli,
      foto_url: fotoUrl,
      dibuat_oleh: currentProfile.id,
    }),
    'Mesin berhasil ditambahkan.'
  );
  if (result.success) {
    try { sessionStorage.removeItem(DRAFT_KEY); } catch (_) {}
    await loadAllReferenceData();
    resetFormMesin();
    navigateTo('dashboard');
  }
});

// ============================================================
// FORM: TAMBAH TAHAP RESTORASI
// ============================================================
function resetFormTahap() {
  editTahapId = null;
  const batal = document.getElementById('btn-batal-edit-tahap');
  if (batal) batal.classList.add('d-none');
  const tombolSimpan = document.querySelector('#form-tahap button[type=submit]');
  if (tombolSimpan) tombolSimpan.textContent = 'Simpan Tahap Restorasi';
  document.getElementById('form-tahap').reset();
  document.getElementById('tahap-tanggal').value = new Date().toISOString().slice(0, 10);
  document.getElementById('tahap-mesin').innerHTML = '<option value="">-- Pilih mesin --</option>'
    + cachedMesin.map(m => `<option value="${m.id}">${m.nama_mesin}</option>`).join('');
  tampilkanFotoMesinTahap();
  document.getElementById('btn-pilih-mesin-tahap').onclick = () => tampilkanFotoMesinTahap();

  document.getElementById('list-mekanik-tahap').innerHTML = '';
  addMekanikRow(true);
  document.getElementById('list-sparepart-tahap').innerHTML = '';
  sparepartRowCount = 0;
  addSparepartRow();
  updateTahapTotalPreview();
}

function tampilkanFotoMesinTahap() {
  const id = document.getElementById('tahap-mesin').value;
  const box = document.getElementById('foto-mesin-tahap');
  const mesin = cachedMesin.find(m => m.id === id);
  if (!mesin) { box.classList.add('d-none'); box.innerHTML = ''; return; }
  box.classList.remove('d-none');
  box.innerHTML = mesin.foto_url
    ? `<img src="${mesin.foto_url}" alt="${mesin.nama_mesin}" />`
    : `<div class="no-foto-tahap">Mesin ini belum punya foto</div>`;
}

document.getElementById('btn-tambah-mekanik-row').addEventListener('click', () => addMekanikRow(false));
document.getElementById('btn-tambah-sparepart-row').addEventListener('click', () => addSparepartRow());

function addMekanikRow(pilihDiriSendiri) {
  const aktif = cachedMekanik.filter(m => m.aktif);
  const row = document.createElement('div');
  row.className = 'sparepart-row';
  row.innerHTML = `
    <select class="form-select form-select-sm mk-select">
      <option value="">-- Pilih mekanik --</option>
      ${aktif.map(m => `<option value="${m.id}">${m.nama}</option>`).join('')}
      <option value="__baru__">+ Mekanik baru (ketik nama)</option>
    </select>
    <input type="text" class="form-control form-control-sm mk-baru d-none" placeholder="Nama mekanik baru" />
    <input type="number" min="0" step="1000" class="form-control form-control-sm mk-ongkos" placeholder="Ongkos (Rp)" />
    <button type="button" class="btn btn-outline-danger btn-sm btn-remove-row"><i class="bi bi-x-lg"></i></button>`;
  document.getElementById('list-mekanik-tahap').appendChild(row);
  const select = row.querySelector('.mk-select');
  const baru = row.querySelector('.mk-baru');
  if (pilihDiriSendiri) {
    const saya = aktif.find(m => m.user_id === currentProfile.id);
    if (saya) select.value = saya.id;
  }
  select.addEventListener('change', () => {
    baru.classList.toggle('d-none', select.value !== '__baru__');
    if (select.value === '__baru__') baru.focus();
  });
  row.querySelector('.mk-ongkos').addEventListener('input', updateTahapTotalPreview);
  row.querySelector('.btn-remove-row').addEventListener('click', () => { row.remove(); updateTahapTotalPreview(); });
}

function addSparepartRow() {
  sparepartRowCount++;
  const wrapper = document.createElement('div');
  wrapper.className = 'sparepart-row';
  wrapper.id = `sp-row-${sparepartRowCount}`;
  wrapper.innerHTML = `
    <select class="form-select form-select-sm sp-select">
      <option value="">-- Pilih sparepart --</option>
      ${cachedSparepart.map(s => `<option value="${s.id}" data-harga="${s.harga}">${s.nama_sparepart} (${formatRupiah(s.harga)})</option>`).join('')}
      <option value="__manual__">Tidak ada di katalog (isi catatan)</option>
    </select>
    <input type="text" class="form-control form-control-sm sp-catatan d-none" placeholder="Catatan: tulis nama sparepart" />
    <input type="number" min="0" step="500" class="form-control form-control-sm sp-harga" placeholder="Harga (Rp)" readonly />
    <button type="button" class="btn btn-outline-danger btn-sm btn-remove-row"><i class="bi bi-x-lg"></i></button>
  `;
  document.getElementById('list-sparepart-tahap').appendChild(wrapper);

  const select = wrapper.querySelector('.sp-select');
  const catatanInput = wrapper.querySelector('.sp-catatan');
  const hargaInput = wrapper.querySelector('.sp-harga');

  select.addEventListener('change', () => {
    if (select.value === '') {
      // belum memilih
      catatanInput.classList.add('d-none');
      hargaInput.value = '';
      hargaInput.readOnly = true;
    } else if (select.value === '__manual__') {
      // tidak ada di katalog: mekanik menulis nama di catatan dan mengisi harga sendiri
      catatanInput.classList.remove('d-none');
      hargaInput.value = '';
      hargaInput.readOnly = false;
      catatanInput.focus();
    } else {
      // dari katalog: harga terisi otomatis
      catatanInput.classList.add('d-none');
      hargaInput.value = select.selectedOptions[0].dataset.harga;
      hargaInput.readOnly = true;
    }
    updateTahapTotalPreview();
  });
  hargaInput.addEventListener('input', updateTahapTotalPreview);
  wrapper.querySelector('.btn-remove-row').addEventListener('click', () => {
    wrapper.remove();
    updateTahapTotalPreview();
  });
}

function updateTahapTotalPreview() {
  let total = 0;
  document.querySelectorAll('#list-mekanik-tahap .mk-ongkos, #list-sparepart-tahap .sp-harga')
    .forEach(el => { total += Number(el.value) || 0; });
  document.getElementById('tahap-total-preview').textContent = formatRupiah(total);
}

document.getElementById('form-tahap').addEventListener('submit', async (e) => {
  e.preventDefault();
  const mesinId = document.getElementById('tahap-mesin').value;
  const tanggal = document.getElementById('tahap-tanggal').value;
  const deskripsi = document.getElementById('tahap-deskripsi').value;
  if (!mesinId) { showToast('Pilih mesin terlebih dahulu.', 'error'); return; }

  // Kumpulkan & validasi semua baris dulu sebelum menyimpan apa pun
  let pesanError = null;
  const mekanikRows = [];
  document.querySelectorAll('#list-mekanik-tahap .sparepart-row').forEach(row => {
    const pilihan = row.querySelector('.mk-select').value;
    const namaBaru = row.querySelector('.mk-baru').value.trim();
    const ongkos = Number(row.querySelector('.mk-ongkos').value) || 0;
    if (pilihan === '') return;
    if (pilihan === '__baru__' && !namaBaru) { pesanError = 'Isi nama mekanik baru.'; return; }
    mekanikRows.push({ pilihan, namaBaru, ongkos });
  });
  const sparepartRows = [];
  document.querySelectorAll('#list-sparepart-tahap .sparepart-row').forEach(row => {
    const pilihan = row.querySelector('.sp-select').value;
    const catatan = row.querySelector('.sp-catatan').value.trim();
    const harga = Number(row.querySelector('.sp-harga').value) || 0;
    if (pilihan === '') return;
    if (pilihan === '__manual__') {
      if (!catatan) { pesanError = 'Isi catatan (nama sparepart) untuk sparepart yang tidak ada di katalog.'; return; }
      sparepartRows.push({ sparepart_id: null, nama_manual: catatan, harga_manual: harga, harga_terpakai: harga });
    } else {
      sparepartRows.push({ sparepart_id: pilihan, nama_manual: null, harga_manual: null, harga_terpakai: harga });
    }
  });
  if (pesanError) { showToast(pesanError, 'error'); return; }
  if (mekanikRows.length === 0) { showToast('Pilih minimal satu mekanik.', 'error'); return; }

  // Mekanik baru dimasukkan ke master data lebih dulu
  for (const r of mekanikRows) {
    if (r.pilihan === '__baru__') {
      const m = await callSupabase(sb.from('mekanik').insert({ nama: r.namaBaru }).select().single());
      if (!m.success) return;
      r.mekanikId = m.data.id;
    } else {
      r.mekanikId = r.pilihan;
    }
  }

  const totalOngkos = mekanikRows.reduce((s, r) => s + r.ongkos, 0);
  const sedangEdit = Boolean(editTahapId);
  let tahapId = editTahapId;

  if (sedangEdit) {
    const up = await callSupabase(sb.from('tahap_restorasi').update({ mesin_id: mesinId, tanggal_pengerjaan: tanggal, deskripsi, ongkos_kerja: totalOngkos }).eq('id', tahapId));
    if (!up.success) return;
    // Cara paling aman untuk baris turunan: hapus semua lalu tulis ulang sesuai isian form saat ini
    await sb.from('tahap_mekanik').delete().eq('tahap_id', tahapId);
    await sb.from('tahap_sparepart').delete().eq('tahap_id', tahapId);
  } else {
    const tahapResult = await callSupabase(
      sb.from('tahap_restorasi').insert({ mesin_id: mesinId, tanggal_pengerjaan: tanggal, deskripsi, ongkos_kerja: totalOngkos }).select().single()
    );
    if (!tahapResult.success) return;
    tahapId = tahapResult.data.id;
  }

  const mk = await callSupabase(sb.from('tahap_mekanik').insert(
    mekanikRows.map(r => ({ tahap_id: tahapId, mekanik_id: r.mekanikId, ongkos: r.ongkos }))));
  if (!mk.success) return;

  if (sparepartRows.length > 0) {
    const sp = await callSupabase(sb.from('tahap_sparepart').insert(sparepartRows.map(r => ({ ...r, tahap_id: tahapId }))));
    if (!sp.success) return;
  }

  showToast(sedangEdit ? 'Perubahan tahap berhasil disimpan.' : 'Tahap restorasi berhasil disimpan.', 'success');
  const kembaliKe = sedangEdit ? 'rekap' : (currentProfile.role === 'owner' ? 'dashboard' : 'tahap');
  editTahapId = null;
  await loadAllReferenceData();
  if (kembaliKe === 'rekap') { navigateTo('rekap'); loadRekapMesin(mesinId); } else { navigateTo(kembaliKe); }
});

// ============================================================
// MASTER MEKANIK & KELOLA AKUN (Owner)
// ============================================================
function renderMekanikTable() {
  document.getElementById('tbody-mekanik').innerHTML = cachedMekanik.map(m => `
    <tr>
      <td class="nama-mekanik-cell">
        <span class="nama-mekanik-teks">${m.nama}</span>
        <input type="text" class="form-control form-control-sm nama-mekanik-input d-none" value="${m.nama}" />
        ${m.user_id ? ' <i class="bi bi-person-check text-muted" title="Punya akun login"></i>' : ''}
      </td>
      <td>${m.aktif ? 'Aktif' : 'Nonaktif'}</td>
      <td class="text-end text-nowrap">
        <button class="btn btn-outline-secondary btn-sm" data-edit-mekanik="${m.id}"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-outline-danger btn-sm" data-hapus-mekanik="${m.id}"><i class="bi bi-trash"></i></button>
        <button class="btn btn-outline-secondary btn-sm" data-toggle-mekanik="${m.id}">${m.aktif ? 'Nonaktifkan' : 'Aktifkan'}</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="3" class="text-muted">Belum ada mekanik.</td></tr>';

  document.querySelectorAll('[data-toggle-mekanik]').forEach(btn => btn.addEventListener('click', async () => {
    const m = cachedMekanik.find(x => x.id === btn.dataset.toggleMekanik);
    const r = await callSupabase(sb.from('mekanik').update({ aktif: !m.aktif }).eq('id', m.id));
    if (r.success) { await loadAllReferenceData(); renderMekanikTable(); }
  }));

  document.querySelectorAll('[data-edit-mekanik]').forEach(btn => btn.addEventListener('click', () => {
    const baris = btn.closest('tr');
    const teks = baris.querySelector('.nama-mekanik-teks');
    const input = baris.querySelector('.nama-mekanik-input');
    const sedangEdit = !input.classList.contains('d-none');
    if (sedangEdit) {
      simpanNamaMekanik(btn.dataset.editMekanik, input.value.trim());
    } else {
      teks.classList.add('d-none'); input.classList.remove('d-none'); input.focus();
      btn.innerHTML = '<i class="bi bi-check-lg"></i>';
    }
  }));

  document.querySelectorAll('[data-hapus-mekanik]').forEach(btn => btn.addEventListener('click', async () => {
    const m = cachedMekanik.find(x => x.id === btn.dataset.hapusMekanik);
    if (!confirm(`Hapus mekanik "${m.nama}"? Mekanik yang sudah pernah dicatat di suatu tahap restorasi tidak bisa dihapus, nonaktifkan saja.`)) return;
    const r = await callSupabase(sb.from('mekanik').delete().eq('id', m.id), 'Mekanik dihapus.');
    if (r.success) { await loadAllReferenceData(); renderMekanikTable(); }
  }));
}

async function simpanNamaMekanik(id, namaBaru) {
  if (!namaBaru) { showToast('Nama tidak boleh kosong.', 'error'); renderMekanikTable(); return; }
  const r = await callSupabase(sb.from('mekanik').update({ nama: namaBaru }).eq('id', id), 'Nama mekanik diperbarui.');
  await loadAllReferenceData();
  renderMekanikTable();
}

document.getElementById('form-mekanik-baru').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nama = document.getElementById('mekanik-nama').value.trim();
  if (!nama) return;
  const r = await callSupabase(sb.from('mekanik').insert({ nama }), 'Mekanik ditambahkan.');
  if (r.success) { e.target.reset(); await loadAllReferenceData(); renderMekanikTable(); }
});

async function panggilKelolaAkun(body, pesanSukses) {
  showLoading();
  try {
    const { data, error } = await sb.functions.invoke(NAMA_FUNGSI_AKUN, { body });
    if (error) {
      let msg = error.message;
      if (error.name === 'FunctionsFetchError') msg = `Edge Function "${NAMA_FUNGSI_AKUN}" tidak bisa dihubungi. Pastikan sudah di-deploy dan Verify JWT dimatikan.`;
      try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (_) {}
      throw new Error(msg);
    }
    if (data && data.error) throw new Error(data.error);
    if (pesanSukses) showToast(pesanSukses, 'success');
    return { success: true };
  } catch (err) {
    showToast(err.message || 'Gagal memproses akun.', 'error');
    return { success: false };
  } finally {
    hideLoading();
  }
}

async function loadAkun() {
  document.getElementById('akun-mekanik').innerHTML = '<option value="">-- Buat mekanik baru dengan nama ini --</option>'
    + cachedMekanik.filter(m => !m.user_id).map(m => `<option value="${m.id}">${m.nama}</option>`).join('');
  const r = await callSupabase(sb.from('profiles').select('*').order('nama', { ascending: true }));
  if (!r.success) return;
  document.getElementById('list-akun').innerHTML = r.data.map(p => `
    <div class="rekap-tahap-item d-flex justify-content-between align-items-center">
      <div><strong>${p.nama}</strong><div class="text-muted small">${p.username || '(login dengan email)'} &bull; ${p.role}</div></div>
      ${p.id === currentProfile.id ? '' : `<button class="btn btn-outline-secondary btn-sm" data-reset-akun="${p.id}">Reset sandi</button>`}
    </div>`).join('');
  document.querySelectorAll('[data-reset-akun]').forEach(btn => btn.addEventListener('click', async () => {
    const password = prompt('Kata sandi baru (minimal 6 karakter):');
    if (password) await panggilKelolaAkun({ aksi: 'reset', user_id: btn.dataset.resetAkun, password }, 'Kata sandi diganti.');
  }));
}

document.getElementById('form-akun-baru').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nama = document.getElementById('akun-nama').value.trim();
  const username = document.getElementById('akun-username').value.trim().toLowerCase();
  const password = document.getElementById('akun-password').value;
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
    showToast('Username hanya huruf kecil, angka, titik, atau strip (3-30 karakter), tanpa @.', 'error');
    return;
  }
  if (password.length < 6) { showToast('Kata sandi minimal 6 karakter.', 'error'); return; }

  let mekanikId = document.getElementById('akun-mekanik').value || null;
  let barudibuat = false;
  if (!mekanikId) {
    const m = await callSupabase(sb.from('mekanik').insert({ nama }).select().single());
    if (!m.success) return;
    mekanikId = m.data.id;
    barudibuat = true;
  }
  const r = await panggilKelolaAkun({ aksi: 'buat', username, nama, password, mekanik_id: mekanikId }, 'Akun berhasil dibuat.');
  if (!r.success) {
    // batalkan mekanik yang baru dibuat agar tidak menumpuk saat akun gagal dibuat
    if (barudibuat) await sb.from('mekanik').delete().eq('id', mekanikId);
    return;
  }
  e.target.reset();
  await loadAllReferenceData();
  loadAkun();
});

// ============================================================
// KATALOG SPAREPART
// ============================================================
document.getElementById('form-sparepart-baru').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nama = document.getElementById('sparepart-nama').value;
  const harga = document.getElementById('sparepart-harga').value;
  const result = await callSupabase(
    sb.from('sparepart').insert({ nama_sparepart: nama, harga }),
    'Sparepart berhasil ditambahkan.'
  );
  if (result.success) {
    document.getElementById('form-sparepart-baru').reset();
    await loadAllReferenceData();
    renderSparepartTable();
  }
});

function renderSparepartTable() {
  const keyword = (document.getElementById('filter-sparepart').value || '').toLowerCase();
  const rows = cachedSparepart.filter(s => s.nama_sparepart.toLowerCase().includes(keyword));
  document.getElementById('tbody-sparepart').innerHTML = rows.map(s => `
    <tr><td>${s.nama_sparepart}</td><td class="text-end">${formatRupiah(s.harga)}</td></tr>
  `).join('') || '<tr><td colspan="2" class="text-muted">Belum ada sparepart.</td></tr>';
}
document.getElementById('filter-sparepart').addEventListener('input', renderSparepartTable);

// ============================================================
// REKAP BIAYA PER MESIN
// ============================================================
let editTahapId = null;

async function openRekapMesin(mesinId) {
  currentRekapMesinId = mesinId;
  navigateTo('rekap');
  await loadRekapMesin(mesinId);
}
document.getElementById('btn-kembali-dashboard').addEventListener('click', () => navigateTo('dashboard'));

async function loadRekapMesin(mesinId) {
  const [mesinRes, tahapRes] = await Promise.all([
    sb.from('mesin').select('*').eq('id', mesinId).single(),
    sb.from('tahap_restorasi')
      .select('*, tahap_sparepart(*), tahap_mekanik(*)')
      .eq('mesin_id', mesinId)
      .order('tanggal_pengerjaan', { ascending: false }),
  ]);

  if (mesinRes.error || tahapRes.error) {
    showToast('Gagal memuat data rekap.', 'error');
    return;
  }

  const mesin = mesinRes.data;
  const tahapList = tahapRes.data || [];

  const fotoEl = mesin.foto_url ? `<img src="${mesin.foto_url}" alt="${mesin.nama_mesin}" style="cursor:pointer" onclick="openFotoModal('${mesin.foto_url}')" />` : '';
  document.getElementById('rekap-header').innerHTML = `
    ${fotoEl}
    <div>
      <h2 class="section-title mb-1">${mesin.nama_mesin}</h2>
      <div class="text-muted small">Dibeli ${formatRupiah(mesin.harga_beli)} pada ${mesin.tanggal_pembelian}</div>
    </div>
  `;

  let totalBiaya = 0;
  const rowsHtml = tahapList.map(t => {
    const totalSparepartTahap = (t.tahap_sparepart || []).reduce((s, sp) => s + Number(sp.harga_terpakai), 0);
    const totalTahap = Number(t.ongkos_kerja) + totalSparepartTahap;
    totalBiaya += totalTahap;
    const mekanikNama = (t.tahap_mekanik || []).map(tm => (cachedMekanik.find(m => m.id === tm.mekanik_id) || {}).nama || '-').join(', ') || '-';
    const sparepartHtml = (t.tahap_sparepart || []).map(sp => {
      const nama = sp.sparepart_id
        ? (cachedSparepart.find(s => s.id === sp.sparepart_id) || {}).nama_sparepart || '-'
        : `${sp.nama_manual} (catatan)`;
      return `<li>${nama} — ${formatRupiah(sp.harga_terpakai)}</li>`;
    }).join('');
    return `
      <div class="rekap-tahap-item" data-nama="${(t.deskripsi || '') + mekanikNama}">
        <div class="d-flex justify-content-between">
          <strong>${t.tanggal_pengerjaan} — ${mekanikNama}</strong>
          <span class="tahap-total">${formatRupiah(totalTahap)}</span>
        </div>
        <div class="text-muted small mb-1">${t.deskripsi || '-'}</div>
        <div class="small">Ongkos kerja: ${formatRupiah(t.ongkos_kerja)}</div>
        ${sparepartHtml ? `<ul class="small mb-0 mt-1">${sparepartHtml}</ul>` : ''}
        <div class="d-flex gap-2 mt-2">
          <button class="btn btn-outline-secondary btn-sm" data-edit-tahap="${t.id}"><i class="bi bi-pencil"></i> Edit</button>
          <button class="btn btn-outline-danger btn-sm" data-hapus-tahap="${t.id}"><i class="bi bi-trash"></i> Hapus</button>
        </div>
      </div>
    `;
  }).join('') || '<p class="text-muted">Belum ada tahap restorasi untuk mesin ini.</p>';

  document.querySelectorAll('[data-edit-tahap]').forEach(b => b.addEventListener('click', () => bukaEditTahap(b.dataset.editTahap, tahapList)));
  document.querySelectorAll('[data-hapus-tahap]').forEach(b => b.addEventListener('click', () => hapusTahap(b.dataset.hapusTahap, mesinId)));

  document.getElementById('rekap-total').textContent = formatRupiah(totalBiaya);
  document.getElementById('rekap-hpp').textContent = formatRupiah(Number(mesin.harga_beli) + totalBiaya);

  const statusSekarang = mesin.status_manual || (tahapList.length > 0 ? 'restorasi' : 'masuk');
  const tombol = ['ready', 'terjual'].filter(s => s !== mesin.status_manual)
    .map(s => `<button class="btn btn-outline-primary btn-sm" data-set-status="${s}">Tandai ${STATUS_LABEL[s].replace('Mesin ', '')}</button>`);
  if (mesin.status_manual) tombol.push('<button class="btn btn-outline-secondary btn-sm" data-set-status="">Kembalikan ke otomatis</button>');
  document.getElementById('rekap-status').innerHTML =
    `<div class="mb-2">Status: <strong>${STATUS_LABEL[statusSekarang]}</strong></div><div class="d-flex flex-wrap gap-2">${tombol.join('')}<button class="btn btn-outline-danger btn-sm" id="btn-hapus-mesin"><i class="bi bi-trash"></i> Hapus Mesin</button></div>`;
  document.querySelectorAll('[data-set-status]').forEach(b => b.addEventListener('click', async () => {
    const r = await callSupabase(sb.from('mesin').update({ status_manual: b.dataset.setStatus || null }).eq('id', mesinId), 'Status mesin diperbarui.');
    if (r.success) loadRekapMesin(mesinId);
  }));
  document.getElementById('btn-hapus-mesin').addEventListener('click', () => hapusMesin(mesinId, mesin.nama_mesin));
  document.getElementById('rekap-jumlah-tahap').textContent = tahapList.length;
  document.getElementById('rekap-tahap-list').innerHTML = rowsHtml;
}

async function hapusMesin(mesinId, namaMesin) {
  if (!confirm(`Hapus mesin "${namaMesin}"? Semua tahap restorasi, sparepart, dan ongkos mekanik yang tercatat untuk mesin ini akan ikut terhapus permanen.`)) return;
  const r = await callSupabase(sb.from('mesin').delete().eq('id', mesinId), 'Mesin berhasil dihapus.');
  if (r.success) { await loadAllReferenceData(); navigateTo('dashboard'); }
}

async function hapusTahap(tahapId, mesinId) {
  if (!confirm('Hapus tahap ini? Sparepart dan ongkos mekanik di dalamnya ikut terhapus.')) return;
  const r = await callSupabase(sb.from('tahap_restorasi').delete().eq('id', tahapId), 'Tahap berhasil dihapus.');
  if (r.success) { await loadAllReferenceData(); loadRekapMesin(mesinId); }
}

function bukaEditTahap(tahapId, tahapList) {
  const t = tahapList.find(x => x.id === tahapId);
  if (!t) return;
  editTahapId = tahapId;
  navigateTo('tahap');
  document.getElementById('tahap-mesin').value = t.mesin_id;
  tampilkanFotoMesinTahap();
  document.getElementById('tahap-tanggal').value = t.tanggal_pengerjaan;
  document.getElementById('tahap-deskripsi').value = t.deskripsi || '';

  document.getElementById('list-mekanik-tahap').innerHTML = '';
  (t.tahap_mekanik && t.tahap_mekanik.length ? t.tahap_mekanik : [{}]).forEach(tm => {
    addMekanikRow(false);
    const row = document.getElementById('list-mekanik-tahap').lastElementChild;
    if (tm.mekanik_id) { row.querySelector('.mk-select').value = tm.mekanik_id; row.querySelector('.mk-ongkos').value = tm.ongkos; }
  });

  document.getElementById('list-sparepart-tahap').innerHTML = '';
  sparepartRowCount = 0;
  (t.tahap_sparepart && t.tahap_sparepart.length ? t.tahap_sparepart : [{}]).forEach(sp => {
    addSparepartRow();
    const row = document.getElementById('list-sparepart-tahap').lastElementChild;
    if (sp.sparepart_id) { row.querySelector('.sp-select').value = sp.sparepart_id; row.querySelector('.sp-select').dispatchEvent(new Event('change')); }
    else if (sp.nama_manual) {
      row.querySelector('.sp-select').value = '__manual__'; row.querySelector('.sp-select').dispatchEvent(new Event('change'));
      row.querySelector('.sp-catatan').value = sp.nama_manual;
    }
    if (sp.harga_terpakai != null) row.querySelector('.sp-harga').value = sp.harga_terpakai;
  });
  updateTahapTotalPreview();

  const form = document.getElementById('form-tahap');
  form.querySelector('button[type=submit]').textContent = 'Simpan Perubahan';
  let batal = document.getElementById('btn-batal-edit-tahap');
  if (!batal) {
    batal = document.createElement('button');
    batal.type = 'button'; batal.id = 'btn-batal-edit-tahap';
    batal.className = 'btn btn-outline-secondary w-100 mt-2';
    batal.textContent = 'Batal Edit';
    batal.addEventListener('click', () => { editTahapId = null; resetFormTahap(); batal.classList.add('d-none'); form.querySelector('button[type=submit]').textContent = 'Simpan Tahap Restorasi'; });
    form.appendChild(batal);
  }
  batal.classList.remove('d-none');
  showToast('Mengedit tahap. Ubah data lalu klik Simpan Perubahan.', 'success');
}

document.getElementById('filter-rekap').addEventListener('input', (e) => {
  const keyword = e.target.value.toLowerCase();
  document.querySelectorAll('#rekap-tahap-list .rekap-tahap-item').forEach(item => {
    item.classList.toggle('d-none', !item.dataset.nama.toLowerCase().includes(keyword));
  });
});

// ============================================================
// MODAL PREVIEW FOTO (selalu via modal, tidak pernah tab baru)
// ============================================================
function openFotoModal(url) {
  document.getElementById('modal-preview-img').src = url;
  document.getElementById('modal-preview-download').href = url;
  new bootstrap.Modal(document.getElementById('modal-preview-foto')).show();
}
window.openFotoModal = openFotoModal;

// ============================================================
// REALTIME — Owner langsung melihat update tanpa reload
// ============================================================
let realtimeChannel = null;

function setupRealtime() {
  if (realtimeChannel) sb.removeChannel(realtimeChannel);
  realtimeChannel = sb
    .channel('realtime:kira-teknik')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tahap_restorasi' }, handleRealtimeChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tahap_sparepart' }, handleRealtimeChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'mesin' }, handleRealtimeChange)
    .subscribe();
}

function handleRealtimeChange() {
  loadAllReferenceData().then(() => {
    const activeSection = document.querySelector('.app-content-section:not(.d-none)')?.id;
    if (activeSection === 'section-dashboard') loadDashboardData();
    if (activeSection === 'section-rekap' && currentRekapMesinId) loadRekapMesin(currentRekapMesinId);
  });
}
