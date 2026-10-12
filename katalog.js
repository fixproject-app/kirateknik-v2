// ============================================================
// Kira Teknik — katalog.js  (dimuat SETELAH app.js dan fitur.js)
// Katalog publik tanpa login: hero slider, cari/filter, kartu mesin dengan slider foto
// (auto-slide 3 detik), badge, tombol WhatsApp, dan footer (medsos + tombol login).
// ============================================================

const MODE_KATALOG = new URLSearchParams(location.search).has('katalog');
let katData = [];
let katSudahMuat = false;
let katTimers = [];
let katModalTimers = [];
let katHeroTimers = [];

function bersihkanNomor(n) {
  let d = String(n || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '62' + d.slice(1);
  return d;
}
function linkWa(namaMesin) {
  const nomor = bersihkanNomor(pengaturan.wa_nomor);
  if (!nomor) return '';
  const pesan = (pengaturan.wa_pesan || 'Halo, saya tertarik dengan mesin: ') + (namaMesin || '');
  return `https://wa.me/${nomor}?text=${encodeURIComponent(namaMesin ? pesan : (pengaturan.wa_pesan || 'Halo, saya ingin bertanya tentang mesin.'))}`;
}

// Slider sederhana: geser otomatis, titik penanda, geser jari (swipe)
function aktifkanSlider(el, intervalMs, daftarTimer) {
  const track = el.querySelector('.sl-track');
  const n = track ? track.children.length : 0;
  const dots = el.querySelectorAll('.sl-dot');
  let idx = 0;
  const pergi = (i) => {
    idx = (i + n) % n;
    track.style.transform = `translateX(-${idx * 100}%)`;
    dots.forEach((d, k) => d.classList.toggle('active', k === idx));
  };
  if (n < 2) return;
  let timer = setInterval(() => { if (!document.hidden) pergi(idx + 1); }, intervalMs);
  daftarTimer.push(() => clearInterval(timer));
  const ulang = () => { clearInterval(timer); timer = setInterval(() => { if (!document.hidden) pergi(idx + 1); }, intervalMs); };
  dots.forEach((d, k) => d.addEventListener('click', (e) => { e.stopPropagation(); pergi(k); ulang(); }));
  let x0 = null;
  el.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 40) { pergi(idx + (dx < 0 ? 1 : -1)); ulang(); }
    x0 = null;
  });
}
function sliderHtml(urls, alt, kelas = '') {
  if (!urls.length) return `<div class="kat-nofoto"><i class="bi bi-image"></i></div>`;
  return `<div class="sl ${kelas}">
    <div class="sl-track">${urls.map((u, i) => `<img src="${esc(u)}" alt="${esc(alt)} ${i + 1}" loading="${i === 0 ? 'eager' : 'lazy'}" />`).join('')}</div>
    ${urls.length > 1 ? `<div class="sl-dots">${urls.map((_, i) => `<span class="sl-dot ${i === 0 ? 'active' : ''}"></span>`).join('')}</div>` : ''}
  </div>`;
}
function badgeHtml(keys) {
  const list = (keys || []).map(k => BADGES.find(b => b.key === k)).filter(Boolean);
  if (!list.length) return '';
  return `<div class="kat-badges">${list.map(b => `<span class="kat-badge"><i class="bi ${b.icon}"></i> ${b.label}</span>`).join('')}</div>`;
}

function renderHero() {
  let slides = [];
  try { slides = JSON.parse(pengaturan.hero_slides || '[]'); } catch (_) {}
  const hero = document.getElementById('kat-hero');
  const track = document.getElementById('kat-hero-track');
  hero.classList.toggle('kat-hero-polos', slides.length === 0);
  track.innerHTML = slides.map((u, i) => `<img src="${esc(u)}" alt="Banner ${i + 1}" />`).join('');
  track.className = 'sl-track kat-hero-track';
  document.getElementById('kat-hero-dots').innerHTML = slides.length > 1
    ? slides.map((_, i) => `<span class="sl-dot ${i === 0 ? 'active' : ''}"></span>`).join('') : '';
  document.getElementById('kat-hero-dots').className = 'sl-dots kat-hero-dots';
  document.getElementById('kat-hero-judul').textContent = pengaturan.hero_judul || 'Mesin Produksi Hasil Restorasi Berkualitas';
  document.getElementById('kat-hero-sub').textContent = pengaturan.hero_subjudul || '';
  hero.classList.add('sl');
  const baru = hero.cloneNode(true); hero.replaceWith(baru);
  // slider hero memakai wadah #kat-hero sendiri
  katHeroTimers.forEach(f => f()); katHeroTimers = [];
  aktifkanSlider(document.getElementById('kat-hero'), 5000, katHeroTimers);
}

function renderFooter() {
  const sosmed = [
    ['medsos_instagram', 'bi-instagram', 'Instagram'], ['medsos_facebook', 'bi-facebook', 'Facebook'],
    ['medsos_tiktok', 'bi-tiktok', 'TikTok'], ['medsos_youtube', 'bi-youtube', 'YouTube'],
    ['medsos_website', 'bi-globe', 'Website'], ['medsos_maps', 'bi-geo-alt-fill', 'Lokasi'],
  ].filter(([k]) => pengaturan[k]).map(([k, ic, nm]) =>
    `<a href="${esc(pengaturan[k])}" target="_blank" rel="noopener" title="${nm}" aria-label="${nm}"><i class="bi ${ic}"></i></a>`);
  const wa = linkWa('');
  if (wa) sosmed.unshift(`<a href="${esc(wa)}" target="_blank" rel="noopener" title="WhatsApp" aria-label="WhatsApp"><i class="bi bi-whatsapp"></i></a>`);
  document.getElementById('kat-sosmed').innerHTML = sosmed.join('');
  document.getElementById('kat-footer-nama').textContent = namaUsaha();
  document.getElementById('kat-footer-alamat').textContent = pengaturan.alamat || '';
}

function renderKatalog() {
  katTimers.forEach(f => f());
  katTimers = [];
  const q = document.getElementById('kat-cari').value.trim().toLowerCase();
  const kat = document.getElementById('kat-kategori').value;
  const urut = document.getElementById('kat-urut').value;
  let list = katData.filter(m =>
    (!kat || m.kategori === kat) &&
    (!q || (m.nama_mesin + ' ' + (m.deskripsi || '') + ' ' + (m.kategori || '')).toLowerCase().includes(q)));
  if (urut === 'terbaru') list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (urut === 'terlama') list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  if (urut === 'nama') list.sort((a, b) => a.nama_mesin.localeCompare(b.nama_mesin, 'id'));

  document.getElementById('kat-info').textContent = katData.length
    ? `${list.length} mesin ditemukan` : '';
  const grid = document.getElementById('kat-grid');
  grid.innerHTML = list.map(m => {
    const fotos = Array.isArray(m.fotos) ? m.fotos : [];
    const wa = linkWa(m.nama_mesin);
    return `
      <article class="kat-card" data-id="${m.id}">
        <div class="kat-media">${sliderHtml(fotos, m.nama_mesin)}${badgeHtml(m.badges)}</div>
        <div class="kat-card-body">
          ${m.kategori ? `<span class="kat-kategori">${esc(m.kategori)}</span>` : ''}
          <h3 class="kat-nama">${esc(m.nama_mesin)}</h3>
          ${m.deskripsi ? `<p class="kat-desk">${esc(m.deskripsi)}</p>` : ''}
          <div class="kat-aksi">
            <button type="button" class="btn btn-outline-secondary btn-sm kat-detail" data-id="${m.id}">Detail</button>
            ${wa ? `<a class="btn btn-primary btn-sm" href="${esc(wa)}" target="_blank" rel="noopener"><i class="bi bi-whatsapp"></i> Tanya Harga</a>` : ''}
          </div>
        </div>
      </article>`;
  }).join('') || `<div class="kat-kosong"><i class="bi bi-search"></i><p>${katData.length ? 'Tidak ada mesin yang cocok dengan pencarian.' : 'Belum ada mesin yang tersedia saat ini.'}</p></div>`;

  grid.querySelectorAll('.kat-media .sl').forEach(el => aktifkanSlider(el, 3000, katTimers));
  grid.querySelectorAll('.kat-detail').forEach(b => b.addEventListener('click', () => bukaDetailKatalog(b.dataset.id)));
  grid.querySelectorAll('.kat-media').forEach(el => el.addEventListener('click', () => bukaDetailKatalog(el.closest('.kat-card').dataset.id)));
}

function bukaDetailKatalog(id) {
  const m = katData.find(x => x.id === id);
  if (!m) return;
  const fotos = Array.isArray(m.fotos) ? m.fotos : [];
  document.getElementById('kd-judul').textContent = m.nama_mesin;
  document.getElementById('kd-body').innerHTML = `
    <div class="kat-media">${sliderHtml(fotos, m.nama_mesin)}${badgeHtml(m.badges)}</div>
    ${m.kategori ? `<span class="kat-kategori mt-3">${esc(m.kategori)}</span>` : ''}
    <p class="kat-desk-penuh mt-2">${m.deskripsi ? esc(m.deskripsi).replace(/\n/g, '<br>') : 'Belum ada deskripsi.'}</p>`;
  const wa = linkWa(m.nama_mesin);
  const tombol = document.getElementById('kd-wa');
  tombol.classList.toggle('d-none', !wa);
  if (wa) tombol.href = wa;
  const modalEl = document.getElementById('modal-katalog-detail');
  katModalTimers.forEach(f => f()); katModalTimers = [];
  modalEl.querySelectorAll('.sl').forEach(el => aktifkanSlider(el, 3000, katModalTimers));
  modalEl.addEventListener('hidden.bs.modal', () => { katModalTimers.forEach(f => f()); katModalTimers = []; }, { once: true });
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

async function tampilkanKatalog() {
  document.getElementById('app-shell').classList.add('d-none');
  document.getElementById('section-login').classList.add('d-none');
  document.getElementById('section-katalog').classList.remove('d-none');
  if (katSudahMuat) { hideLoading(); return; }
  katSudahMuat = true;
  try {
    const [, res] = await Promise.all([
      loadPengaturan(),
      sb.from('v_katalog').select('*'),
    ]);
    if (res.error) throw res.error;
    katData = res.data || [];
  } catch (err) {
    katData = [];
    showToast('Katalog belum bisa dimuat: ' + (err.message || err), 'error');
    katSudahMuat = false;
  }
  hideLoading();

  document.title = namaUsaha() + ' — Katalog Mesin';
  document.getElementById('kat-nama').textContent = namaUsaha();
  terapkanLogo(logoEfektif());
  const waTop = linkWa('');
  const btnWa = document.getElementById('kat-wa-top');
  btnWa.classList.toggle('d-none', !waTop);
  if (waTop) btnWa.href = waTop;

  const kategori = [...new Set(katData.map(m => m.kategori).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id'));
  document.getElementById('kat-kategori').innerHTML = '<option value="">Semua kategori</option>'
    + kategori.map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join('');
  renderFooter();
  renderHero();
  renderKatalog();
}

['kat-cari'].forEach(id => document.getElementById(id).addEventListener('input', renderKatalog));
['kat-kategori', 'kat-urut'].forEach(id => document.getElementById(id).addEventListener('change', renderKatalog));

// Navigasi katalog <-> login
document.getElementById('btn-ke-login').addEventListener('click', async () => {
  if (MODE_KATALOG) {
    const { data } = await sb.auth.getSession();
    if (data.session) { location.href = location.pathname; return; }
  }
  document.getElementById('section-katalog').classList.add('d-none');
  document.getElementById('section-login').classList.remove('d-none');
  window.scrollTo(0, 0);
});
document.getElementById('btn-ke-katalog').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('section-login').classList.add('d-none');
  document.getElementById('section-katalog').classList.remove('d-none');
});
