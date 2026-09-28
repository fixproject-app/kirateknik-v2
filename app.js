// ============================================================
// Kira Teknik — app.js
// ============================================================

// ── Konfigurasi Supabase ──
// Isi dengan Project URL dan anon public key dari Supabase Dashboard > Project Settings > API
const SUPABASE_URL = 'https://potjecpcedeajvugbcla.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_j4V6keWo2jXsR25DAXj5-g_3V58y9qw';

const CONFIG_OK = !SUPABASE_URL.includes('xxxx') && !SUPABASE_ANON_KEY.includes('xxxx');
let sb = null;
try {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (err) {
  console.error('Gagal membuat client Supabase:', err);
}

// Cek konfigurasi: pesan jelas jika URL/key belum diisi atau salah
function cekKonfigurasi() {
  if (!sb || !CONFIG_OK) {
    showToast('Konfigurasi Supabase belum benar. Isi SUPABASE_URL dan SUPABASE_ANON_KEY di app.js.', 'error');
    return false;
  }
  return true;
}

const BUCKET_FOTO = 'foto-mesin';

let currentProfile = null;
let cachedMesin = [];
let cachedSparepart = [];
let cachedProfiles = [];
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

// ============================================================
// AUTH
// ============================================================
document.querySelectorAll('#auth-tabs .nav-link').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('#auth-tabs .nav-link').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.tab;
    document.getElementById('form-login').classList.toggle('d-none', target !== 'login');
    document.getElementById('form-signup').classList.toggle('d-none', target !== 'signup');
  });
});

document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!cekKonfigurasi()) return;
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  await callSupabase(sb.auth.signInWithPassword({ email, password }));
});

document.getElementById('form-signup').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!cekKonfigurasi()) return;
  const nama = document.getElementById('signup-nama').value;
  const email = document.getElementById('signup-email').value;
  const password = document.getElementById('signup-password').value;
  const result = await callSupabase(
    sb.auth.signUp({ email, password, options: { data: { nama } } }),
    'Pendaftaran berhasil! Jika diminta verifikasi, cek email dulu, lalu masuk.'
  );
  if (result.success) {
    document.querySelector('#auth-tabs .nav-link[data-tab="login"]').click();
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await sb.auth.signOut();
});

if (sb && CONFIG_OK) {
  sb.auth.onAuthStateChange((event, session) => {
    if (session) {
      initAppForUser(session.user.id);
    } else {
      currentProfile = null;
      document.getElementById('app-shell').classList.add('d-none');
      document.getElementById('section-login').classList.remove('d-none');
    }
  });
}

async function initAppForUser(userId) {
  const result = await callSupabase(
    sb.from('profiles').select('*').eq('id', userId).single()
  );
  if (!result.success) return;

  currentProfile = result.data;
  document.getElementById('section-login').classList.add('d-none');
  document.getElementById('app-shell').classList.remove('d-none');
  document.getElementById('user-info').textContent = `${currentProfile.nama} (${currentProfile.role})`;

  await loadAllReferenceData();
  navigateTo('dashboard');
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
  dashboard: 'Dashboard',
  mesin: 'Tambah Mesin',
  tahap: 'Tambah Tahap Restorasi',
  sparepart: 'Katalog Sparepart',
  rekap: 'Rekap Biaya Mesin',
};

function navigateTo(sectionId) {
  document.querySelectorAll('.app-content-section').forEach(el => el.classList.add('d-none'));
  document.getElementById(`section-${sectionId}`)?.classList.remove('d-none');
  document.querySelectorAll('.sidebar .nav-link').forEach(el => el.classList.remove('active'));
  document.querySelector(`.sidebar .nav-link[data-section="${sectionId}"]`)?.classList.add('active');
  document.getElementById('topbar-title').textContent = SECTION_TITLES[sectionId] || 'Kira Teknik';

  if (sectionId === 'dashboard') loadDashboardData();
  if (sectionId === 'mesin') resetFormMesin();
  if (sectionId === 'tahap') resetFormTahap();
  if (sectionId === 'sparepart') renderSparepartTable();
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
  const [mesinRes, sparepartRes, profilesRes] = await Promise.all([
    sb.from('mesin').select('*').order('created_at', { ascending: false }),
    sb.from('sparepart').select('*').order('nama_sparepart', { ascending: true }),
    sb.from('profiles').select('*').order('nama', { ascending: true }),
  ]);
  cachedMesin = mesinRes.data || [];
  cachedSparepart = sparepartRes.data || [];
  cachedProfiles = profilesRes.data || [];
}

// ============================================================
// DASHBOARD
// ============================================================
async function loadDashboardData() {
  const result = await callSupabase(
    sb.from('v_rekap_mesin').select('*').order('nama_mesin', { ascending: true })
  );
  if (!result.success) return;

  const rows = result.data;
  const totalMesin = rows.length;
  const totalBiaya = rows.reduce((s, r) => s + Number(r.total_ongkos_kerja) + Number(r.total_sparepart), 0);
  const totalTahap = rows.reduce((s, r) => s + Number(r.jumlah_tahap), 0);

  document.getElementById('kpi-total-mesin').textContent = totalMesin;
  document.getElementById('kpi-total-biaya').textContent = formatRupiah(totalBiaya);
  document.getElementById('kpi-total-tahap').textContent = totalTahap;

  const termahal = [...rows].sort((a, b) =>
    (Number(b.total_ongkos_kerja) + Number(b.total_sparepart)) - (Number(a.total_ongkos_kerja) + Number(a.total_sparepart))
  )[0];
  document.getElementById('ai-insight').textContent = termahal
    ? `Mesin dengan biaya restorasi tertinggi saat ini: "${termahal.nama_mesin}" sebesar ${formatRupiah(Number(termahal.total_ongkos_kerja) + Number(termahal.total_sparepart))}.`
    : 'Belum ada data mesin untuk dianalisis.';

  renderMesinGrid(rows);
}

function renderMesinGrid(rows) {
  const grid = document.getElementById('grid-mesin');
  const keyword = (document.getElementById('filter-mesin').value || '').toLowerCase();
  const filtered = rows.filter(r => r.nama_mesin.toLowerCase().includes(keyword));

  grid.innerHTML = filtered.map(r => {
    const total = Number(r.total_ongkos_kerja) + Number(r.total_sparepart);
    const fotoEl = r.foto_url
      ? `<img src="${r.foto_url}" alt="${r.nama_mesin}" />`
      : `<div class="no-foto"><i class="bi bi-image"></i></div>`;
    return `
      <div class="mesin-card" data-id="${r.mesin_id}">
        ${fotoEl}
        <div class="mesin-card-body">
          <div class="mesin-card-name">${r.nama_mesin}</div>
          <div class="mesin-card-total">${formatRupiah(total)}</div>
        </div>
      </div>`;
  }).join('') || '<p class="text-muted">Belum ada mesin.</p>';

  grid.querySelectorAll('.mesin-card').forEach(card => {
    card.addEventListener('click', () => openRekapMesin(card.dataset.id));
  });
}
document.getElementById('filter-mesin').addEventListener('input', () => loadDashboardData());

// ============================================================
// FORM: TAMBAH MESIN
// ============================================================
function resetFormMesin() {
  document.getElementById('form-mesin').reset();
  document.getElementById('mesin-foto-preview').classList.add('d-none');
  document.getElementById('mesin-tanggal').value = new Date().toISOString().slice(0, 10);
}

document.getElementById('mesin-foto').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const preview = document.getElementById('mesin-foto-preview');
  preview.src = URL.createObjectURL(file);
  preview.classList.remove('d-none');
});

document.getElementById('form-mesin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const namaMesin = document.getElementById('mesin-nama').value;
  const hargaBeli = document.getElementById('mesin-harga').value;
  const tanggalBeli = document.getElementById('mesin-tanggal').value;
  const fotoFile = document.getElementById('mesin-foto').files[0];

  let fotoUrl = null;
  if (fotoFile) {
    const path = `${currentProfile.id}/${Date.now()}_${fotoFile.name}`;
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
    await loadAllReferenceData();
    resetFormMesin();
    navigateTo('dashboard');
  }
});

// ============================================================
// FORM: TAMBAH TAHAP RESTORASI
// ============================================================
function resetFormTahap() {
  document.getElementById('form-tahap').reset();
  document.getElementById('tahap-tanggal').value = new Date().toISOString().slice(0, 10);

  const mesinSelect = document.getElementById('tahap-mesin');
  mesinSelect.innerHTML = cachedMesin.map(m => `<option value="${m.id}">${m.nama_mesin}</option>`).join('');

  const mekanikSelect = document.getElementById('tahap-mekanik');
  mekanikSelect.innerHTML = cachedProfiles.map(p =>
    `<option value="${p.id}" ${p.id === currentProfile.id ? 'selected' : ''}>${p.nama} (${p.role})</option>`
  ).join('');
  // Mekanik biasa hanya boleh mengisi tahap atas namanya sendiri (ditegakkan juga oleh RLS)
  if (currentProfile.role !== 'owner') {
    mekanikSelect.value = currentProfile.id;
    mekanikSelect.disabled = true;
  } else {
    mekanikSelect.disabled = false;
  }

  document.getElementById('list-sparepart-tahap').innerHTML = '';
  sparepartRowCount = 0;
  addSparepartRow();
  updateTahapTotalPreview();
}

document.getElementById('btn-tambah-sparepart-row').addEventListener('click', () => addSparepartRow());

function addSparepartRow() {
  sparepartRowCount++;
  const rowId = `sp-row-${sparepartRowCount}`;
  const wrapper = document.createElement('div');
  wrapper.className = 'sparepart-row';
  wrapper.id = rowId;
  wrapper.innerHTML = `
    <select class="form-select form-select-sm sp-select" style="flex:2">
      <option value="">-- Manual / Tidak ada di katalog --</option>
      ${cachedSparepart.map(s => `<option value="${s.id}" data-harga="${s.harga}">${s.nama_sparepart} (${formatRupiah(s.harga)})</option>`).join('')}
    </select>
    <input type="text" class="form-control form-control-sm sp-nama-manual d-none" placeholder="Nama sparepart" style="flex:1.5" />
    <input type="number" min="0" step="500" class="form-control form-control-sm sp-harga" placeholder="Harga" style="flex:1" />
    <button type="button" class="btn btn-outline-danger btn-sm btn-remove-row"><i class="bi bi-x-lg"></i></button>
  `;
  document.getElementById('list-sparepart-tahap').appendChild(wrapper);

  const select = wrapper.querySelector('.sp-select');
  const manualInput = wrapper.querySelector('.sp-nama-manual');
  const hargaInput = wrapper.querySelector('.sp-harga');

  select.addEventListener('change', () => {
    const opt = select.selectedOptions[0];
    if (select.value === '') {
      manualInput.classList.remove('d-none');
      hargaInput.value = '';
      hargaInput.readOnly = false;
    } else {
      manualInput.classList.add('d-none');
      hargaInput.value = opt.dataset.harga;
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

document.getElementById('tahap-ongkos').addEventListener('input', updateTahapTotalPreview);

function updateTahapTotalPreview() {
  const ongkos = Number(document.getElementById('tahap-ongkos').value) || 0;
  let totalSparepart = 0;
  document.querySelectorAll('#list-sparepart-tahap .sparepart-row').forEach(row => {
    totalSparepart += Number(row.querySelector('.sp-harga').value) || 0;
  });
  document.getElementById('tahap-total-preview').textContent = formatRupiah(ongkos + totalSparepart);
}

document.getElementById('form-tahap').addEventListener('submit', async (e) => {
  e.preventDefault();
  const mesinId = document.getElementById('tahap-mesin').value;
  const mekanikId = document.getElementById('tahap-mekanik').value;
  const tanggal = document.getElementById('tahap-tanggal').value;
  const deskripsi = document.getElementById('tahap-deskripsi').value;
  const ongkos = document.getElementById('tahap-ongkos').value;

  if (!mesinId) { showToast('Pilih mesin terlebih dahulu.', 'error'); return; }

  const tahapResult = await callSupabase(
    sb.from('tahap_restorasi').insert({
      mesin_id: mesinId,
      mekanik_id: mekanikId,
      tanggal_pengerjaan: tanggal,
      deskripsi,
      ongkos_kerja: ongkos,
    }).select().single()
  );
  if (!tahapResult.success) return;

  const tahapId = tahapResult.data.id;
  const sparepartRows = [];
  document.querySelectorAll('#list-sparepart-tahap .sparepart-row').forEach(row => {
    const select = row.querySelector('.sp-select');
    const manualInput = row.querySelector('.sp-nama-manual');
    const hargaInput = row.querySelector('.sp-harga');
    const harga = Number(hargaInput.value) || 0;
    if (!select.value && !manualInput.value) return; // baris kosong, lewati
    sparepartRows.push({
      tahap_id: tahapId,
      sparepart_id: select.value || null,
      nama_manual: select.value ? null : manualInput.value,
      harga_manual: select.value ? null : harga,
      harga_terpakai: harga,
    });
  });

  if (sparepartRows.length > 0) {
    const spResult = await callSupabase(sb.from('tahap_sparepart').insert(sparepartRows));
    if (!spResult.success) return;
  }

  showToast('Tahap restorasi berhasil disimpan.', 'success');
  resetFormTahap();
  navigateTo('dashboard');
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
      .select('*, tahap_sparepart(*)')
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
    const mekanikNama = (cachedProfiles.find(p => p.id === t.mekanik_id) || {}).nama || '-';
    const sparepartHtml = (t.tahap_sparepart || []).map(sp => {
      const nama = sp.sparepart_id
        ? (cachedSparepart.find(s => s.id === sp.sparepart_id) || {}).nama_sparepart || '-'
        : sp.nama_manual;
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
      </div>
    `;
  }).join('') || '<p class="text-muted">Belum ada tahap restorasi untuk mesin ini.</p>';

  document.getElementById('rekap-total').textContent = formatRupiah(totalBiaya);
  document.getElementById('rekap-jumlah-tahap').textContent = tahapList.length;
  document.getElementById('rekap-tahap-list').innerHTML = rowsHtml;
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
function setupRealtime() {
  sb
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
