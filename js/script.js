(function () {
  'use strict';

  /* ---------- Product data ---------- */
  const products = [
    { id: 1, name: 'Royal Crimson Dhaka Topi', cat: 'topi', tag: 'Bestseller', weave: 'weave--1', price: 4500, old: null },
    { id: 2, name: 'Gilded Sunrise Topi', cat: 'topi', tag: 'New', weave: 'weave--2', price: 4200, old: null },
    { id: 3, name: 'Midnight Ink Topi', cat: 'topi', tag: null, weave: 'weave--4', price: 3900, old: 4600 },
    { id: 4, name: 'Heritage Weave — Cotton Yardage', cat: 'fabric', tag: 'Bestseller', weave: 'weave--2', price: 3200, old: null },
    { id: 5, name: 'Crimson Diamond Yardage, Silk Blend', cat: 'fabric', tag: 'Limited', weave: 'weave--3', price: 6800, old: null },
    { id: 6, name: 'Antique Gold Yardage', cat: 'fabric', tag: null, weave: 'weave--6', price: 3500, old: 4000 },
    { id: 7, name: 'Kathmandu Crimson Shawl', cat: 'shawl', tag: 'New', weave: 'weave--3', price: 8900, old: null },
    { id: 8, name: 'Gilded Zigzag Scarf', cat: 'shawl', tag: null, weave: 'weave--5', price: 5200, old: null },
    { id: 9, name: 'Ink & Gold Wrap Shawl', cat: 'shawl', tag: 'Limited', weave: 'weave--4', price: 9600, old: 11200 },
    { id: 10, name: 'Handwoven Clutch, Crimson', cat: 'accessory', tag: 'New', weave: 'weave--1', price: 5400, old: null },
    { id: 11, name: 'Dhaka-Weave Bow Tie', cat: 'accessory', tag: null, weave: 'weave--6', price: 2100, old: null },
    { id: 12, name: 'Woven Passport Sleeve', cat: 'accessory', tag: 'Bestseller', weave: 'weave--2', price: 2800, old: null },
  ];

  const formatNPR = (n) => 'NPR ' + n.toLocaleString('en-IN');

  /* ---------- Render product grid ---------- */
  const grid = document.getElementById('productGrid');

  function cardHTML(p) {
    return `
      <div class="product-card reveal is-visible" data-cat="${p.cat}" data-id="${p.id}">
        <div class="product-media">
          ${p.tag ? `<span class="product-tag">${p.tag}</span>` : ''}
          <button class="product-wish" aria-label="Wishlist">
            <svg viewBox="0 0 24 24" fill="none" stroke="#7a0c1f" stroke-width="1.6"><path d="M12 21s-7.5-4.6-10-9.3C.5 8 2.3 4.5 6 4c2.2-.3 4 .9 6 3 2-2.1 3.8-3.3 6-3 3.7.5 5.5 4 4 7.7C19.5 16.4 12 21 12 21z"/></svg>
          </button>
          <div class="weave ${p.weave}"></div>
          <button class="quick-add" data-add="${p.id}">+ Quick Add</button>
        </div>
        <div class="product-info">
          <div class="brandline">Dhaka Store</div>
          <h4>${p.name}</h4>
          <div class="price-row">
            ${p.old ? `<span class="price old">${formatNPR(p.old)}</span>` : ''}
            <span class="price new">${formatNPR(p.price)}</span>
          </div>
        </div>
      </div>`;
  }

  function renderGrid(filter) {
    const list = filter === 'all' ? products : products.filter(p => p.cat === filter);
    grid.innerHTML = list.map(cardHTML).join('');
  }
  renderGrid('all');

  /* ---------- Filters ---------- */
  document.querySelectorAll('.filter-row button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-row button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderGrid(btn.dataset.filter);
    });
  });

  /* ---------- Cart ---------- */
  let cart = [];
  const cartCount = document.getElementById('cartCount');
  const drawerBody = document.getElementById('drawerBody');
  const drawerFoot = document.getElementById('drawerFoot');
  const subtotalEl = document.getElementById('subtotal');

  function renderCart() {
    cartCount.textContent = cart.reduce((s, i) => s + i.qty, 0);
    if (!cart.length) {
      drawerBody.innerHTML = '<div class="drawer-empty">Your bag is empty. <br>Begin with something woven by hand.</div>';
      drawerFoot.style.display = 'none';
      return;
    }
    drawerFoot.style.display = 'block';
    drawerBody.innerHTML = cart.map(item => `
      <div class="drawer-item" data-id="${item.id}">
        <div class="weave ${item.weave}"></div>
        <div class="drawer-item-info">
          <h4>${item.name}</h4>
          <div class="qty">Qty ${item.qty}</div>
          <div class="price">${formatNPR(item.price * item.qty)}</div>
          <div class="drawer-remove" data-remove="${item.id}">Remove</div>
        </div>
      </div>`).join('');
    const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
    subtotalEl.textContent = formatNPR(subtotal);
  }

  function addToCart(id) {
    const p = products.find(x => x.id === Number(id));
    if (!p) return;
    const existing = cart.find(i => i.id === p.id);
    if (existing) existing.qty += 1;
    else cart.push({ ...p, qty: 1 });
    renderCart();
    openDrawer();
  }

  grid.addEventListener('click', (e) => {
    const addBtn = e.target.closest('[data-add]');
    if (addBtn) addToCart(addBtn.dataset.add);
  });

  drawerBody.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('[data-remove]');
    if (removeBtn) {
      cart = cart.filter(i => i.id !== Number(removeBtn.dataset.remove));
      renderCart();
    }
  });

  /* ---------- Drawer + overlay + mobile nav ---------- */
  const overlay = document.getElementById('overlay');
  const cartDrawer = document.getElementById('cartDrawer');
  const mobileNav = document.getElementById('mobileNav');

  function closeAllPanels() {
    cartDrawer.classList.remove('open');
    mobileNav.classList.remove('open');
    overlay.classList.remove('open');
  }
  function openDrawer() {
    cartDrawer.classList.add('open');
    overlay.classList.add('open');
  }
  function openMobileNav() {
    mobileNav.classList.add('open');
    overlay.classList.add('open');
  }

  document.getElementById('cartBtn').addEventListener('click', openDrawer);
  document.getElementById('drawerClose').addEventListener('click', closeAllPanels);
  document.getElementById('burgerBtn').addEventListener('click', openMobileNav);
  document.getElementById('mobileClose').addEventListener('click', closeAllPanels);
  overlay.addEventListener('click', closeAllPanels);
  mobileNav.querySelectorAll('a').forEach(a => a.addEventListener('click', closeAllPanels));

  /* ---------- Header shrink on scroll ---------- */
  const header = document.getElementById('siteHeader');
  window.addEventListener('scroll', () => {
    header.classList.toggle('shrink', window.scrollY > 40);
  }, { passive: true });

  /* ---------- Scroll reveal ---------- */
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));

  /* ---------- Newsletter ---------- */
  const newsletterForm = document.getElementById('newsletterForm');
  newsletterForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = newsletterForm.querySelector('input');
    const btn = newsletterForm.querySelector('button');
    const original = btn.textContent;
    btn.textContent = 'Subscribed ✓';
    input.value = '';
    setTimeout(() => { btn.textContent = original; }, 2400);
  });

  /* ---------- Footer year ---------- */
  document.getElementById('year').textContent = new Date().getFullYear();

})();
