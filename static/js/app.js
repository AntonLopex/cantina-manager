document.addEventListener('DOMContentLoaded', () => {
  // Estado Global
  let catalog = [];
  let draftOrder = {}; // { item_id: cantidad }
  let filterQuery = '';
  let activeTab = 'pedidos';
  let adminPin = sessionStorage.getItem('cantina_admin_pin') || '';
  let pollingInterval = null;

  // Elementos DOM
  const searchInput = document.getElementById('search-input');
  const itemsGrid = document.getElementById('items-grid');
  const orderBar = document.getElementById('order-bar');
  const totalCountEl = document.getElementById('total-count');
  const totalPriceEl = document.getElementById('total-price');
  const btnFinalize = document.getElementById('btn-finalize');

  // Modal Confirmación
  const modalConfirmation = document.getElementById('modal-confirmation');
  const modalOrderList = document.getElementById('modal-order-list');
  const modalTotalPrice = document.getElementById('modal-total-price');
  const warningContainer = document.getElementById('warning-container');
  const btnConfirmSave = document.getElementById('btn-confirm-save');
  const btnCancelModal = document.getElementById('btn-cancel-modal');
  const btnCloseModal = document.getElementById('btn-close-modal');

  // PIN Overlay & Protection
  const pinModal = document.getElementById('pin-modal');
  const pinInput = document.getElementById('pin-input');
  const btnPinSubmit = document.getElementById('btn-pin-submit');
  const pinError = document.getElementById('pin-error');
  let pendingProtectedTab = null;

  // Tabs
  const navTabs = document.querySelectorAll('.nav-tab');
  const tabPanes = document.querySelectorAll('.tab-pane');

  // Cargar Catálogo Inicial
  fetchCatalog();

  // Escuchadores de Eventos Navegación
  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      if (target === 'resultados' || target === 'axustes') {
        if (!adminPin) {
          pendingProtectedTab = target;
          openPinModal();
          return;
        }
      }
      switchTab(target);
    });
  });

  function switchTab(tabId) {
    activeTab = tabId;
    navTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
    tabPanes.forEach(p => p.classList.toggle('active', p.id === `tab-${tabId}`));

    if (tabId === 'pedidos') {
      orderBar.style.display = 'flex';
      stopPolling();
    } else {
      orderBar.style.display = 'none';
      if (tabId === 'resultados') {
        loadResultados();
        startPolling();
      } else if (tabId === 'axustes') {
        loadAxustes();
        stopPolling();
      }
    }
  }

  // Cargar catálogo de consumicións
  async function fetchCatalog() {
    try {
      const res = await fetch('/api/consumiciones');
      if (res.ok) {
        catalog = await res.json();
        renderGrid();
      }
    } catch (err) {
      showToast('Erro ao cargar o catálogo', 'error');
    }
  }

  // Buscador en tempo real
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      filterQuery = e.target.value.toLowerCase().trim();
      renderGrid();
    });
  }

  // Renderizado do Grid de Consumicións
  function renderGrid() {
    if (!itemsGrid) return;
    itemsGrid.innerHTML = '';

    const filtered = catalog.filter(item => item.nombre.toLowerCase().includes(filterQuery));

    if (filtered.length === 0) {
      itemsGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--color-text-muted);">
          <p style="font-size: 1.2rem; font-weight: 600;">Non se atoparon consumicións</p>
        </div>
      `;
      return;
    }

    filtered.forEach(item => {
      const qty = draftOrder[item.id] || 0;
      const card = document.createElement('div');
      card.className = `item-card ${qty > 0 ? 'has-selected' : ''}`;
      card.dataset.id = item.id;

      const imgContent = item.imagen_url 
        ? `<img src="${item.imagen_url}" alt="${item.nombre}" class="item-image" loading="lazy">`
        : `<div class="item-image-placeholder">🍹</div>`;

      card.innerHTML = `
        <div class="item-image-wrapper">
          ${imgContent}
        </div>
        <div class="item-details">
          <div>
            <div class="item-title">${escapeHtml(item.nombre)}</div>
            <div class="item-price">${formatCurrency(item.precio_unitario)}</div>
          </div>
          <div class="item-counter-overlay">
            <button class="btn-counter btn-minus" data-action="minus" ${qty === 0 ? 'disabled' : ''}>−</button>
            <span class="counter-badge">${qty}</span>
            <button class="btn-counter btn-plus" data-action="plus">+</button>
          </div>
        </div>
      `;

      // Eventos clic tarjeta e botóns + / -
      card.addEventListener('click', (e) => {
        const btnMinus = e.target.closest('[data-action="minus"]');
        const btnPlus = e.target.closest('[data-action="plus"]');

        if (btnMinus) {
          e.stopPropagation();
          updateQty(item.id, -1);
        } else if (btnPlus) {
          e.stopPropagation();
          updateQty(item.id, 1);
        } else {
          // Clic directo na tarxeta suma 1
          updateQty(item.id, 1);
        }
      });

      itemsGrid.appendChild(card);
    });

    updateOrderSummaryBar();
  }

  // Actualizar cantidade no borrador (Optimistic UI)
  function updateQty(itemId, delta) {
    const current = draftOrder[itemId] || 0;
    const next = Math.max(0, current + delta);
    if (next === 0) {
      delete draftOrder[itemId];
    } else {
      draftOrder[itemId] = next;
    }
    renderGrid();
  }

  // Actualizar Barra Inferior Fixa
  function updateOrderSummaryBar() {
    let totalItems = 0;
    let totalPrice = 0;

    Object.keys(draftOrder).forEach(id => {
      const qty = draftOrder[id];
      const item = catalog.find(c => c.id === parseInt(id));
      if (item && qty > 0) {
        totalItems += qty;
        totalPrice += qty * item.precio_unitario;
      }
    });

    if (totalCountEl) totalCountEl.textContent = `${totalItems} ${totalItems === 1 ? 'artigo' : 'artigos'}`;
    if (totalPriceEl) totalPriceEl.textContent = formatCurrency(totalPrice);
    if (btnFinalize) btnFinalize.disabled = totalItems === 0;
  }

  // Abrir Modal de Confirmación
  if (btnFinalize) {
    btnFinalize.addEventListener('click', () => {
      openConfirmationModal();
    });
  }

  function openConfirmationModal() {
    modalOrderList.innerHTML = '';
    warningContainer.innerHTML = '';

    let grandTotal = 0;
    let highQtyWarnings = [];

    Object.keys(draftOrder).forEach(id => {
      const qty = draftOrder[id];
      const item = catalog.find(c => c.id === parseInt(id));
      if (!item || qty <= 0) return;

      const subtotal = qty * item.precio_unitario;
      grandTotal += subtotal;

      if (qty > 10) {
        highQtyWarnings.push(`⚠️ Seguro que son ${qty} de "${item.nombre}"?`);
      }

      const row = document.createElement('div');
      row.className = 'modal-order-row';
      row.innerHTML = `
        <div class="modal-row-info">
          <div class="modal-row-title">${escapeHtml(item.nombre)}</div>
          <div class="modal-row-sub">${formatCurrency(item.precio_unitario)} / un.</div>
        </div>
        <div class="modal-row-controls">
          <button class="btn-counter btn-minus" data-id="${item.id}" data-action="modal-minus">−</button>
          <span class="counter-badge" style="background:#E2E8F0;">${qty}</span>
          <button class="btn-counter btn-plus" data-id="${item.id}" data-action="modal-plus">+</button>
        </div>
        <div class="modal-row-total">${formatCurrency(subtotal)}</div>
        <button class="btn-remove-row" data-id="${item.id}" title="Eliminar del pedido">✕</button>
      `;

      modalOrderList.appendChild(row);
    });

    if (highQtyWarnings.length > 0) {
      warningContainer.innerHTML = highQtyWarnings.map(w => `<div class="soft-warning-banner">${escapeHtml(w)}</div>`).join('');
    }

    modalTotalPrice.textContent = formatCurrency(grandTotal);
    modalConfirmation.classList.add('show');
  }

  // Eventos dentro do Modal de Confirmación
  modalOrderList.addEventListener('click', (e) => {
    const btnMinus = e.target.closest('[data-action="modal-minus"]');
    const btnPlus = e.target.closest('[data-action="modal-plus"]');
    const btnRemove = e.target.closest('.btn-remove-row');

    if (btnMinus) {
      const id = parseInt(btnMinus.dataset.id);
      updateQty(id, -1);
      if (hasItemsInDraft()) openConfirmationModal(); else closeModal();
    } else if (btnPlus) {
      const id = parseInt(btnPlus.dataset.id);
      updateQty(id, 1);
      openConfirmationModal();
    } else if (btnRemove) {
      const id = parseInt(btnRemove.dataset.id);
      delete draftOrder[id];
      renderGrid();
      if (hasItemsInDraft()) openConfirmationModal(); else closeModal();
    }
  });

  function hasItemsInDraft() {
    return Object.keys(draftOrder).some(id => draftOrder[id] > 0);
  }

  function closeModal() {
    modalConfirmation.classList.remove('show');
  }

  if (btnCancelModal) btnCancelModal.addEventListener('click', closeModal);
  if (btnCloseModal) btnCloseModal.addEventListener('click', closeModal);

  // Confirmar e Gardar o Pedido no Backend
  if (btnConfirmSave) {
    btnConfirmSave.addEventListener('click', async () => {
      const items = Object.keys(draftOrder)
        .filter(id => draftOrder[id] > 0)
        .map(id => ({ id: parseInt(id), cantidad: draftOrder[id] }));

      if (items.length === 0) return;

      btnConfirmSave.disabled = true;
      btnConfirmSave.textContent = 'Gardando...';

      try {
        const res = await fetch('/api/pedidos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items, camarero: 'Camarero 1' })
        });

        const data = await res.json();

        if (res.ok) {
          draftOrder = {};
          renderGrid();
          closeModal();
          showToast(`✅ Pedido gardado: ${formatCurrency(data.total_pedido)}`);
        } else {
          showToast(`❌ ${data.error || 'Erro ao gardar pedido'}`, 'error');
        }
      } catch (err) {
        showToast('❌ Erro de conexión co servidor', 'error');
      } finally {
        btnConfirmSave.disabled = false;
        btnConfirmSave.textContent = 'Confirmar e gardar';
      }
    });
  }

  // Control do PIN de Seguridade
  function openPinModal() {
    pinInput.value = '';
    pinError.style.display = 'none';
    pinModal.classList.add('show');
    pinInput.focus();
  }

  function closePinModal() {
    pinModal.classList.remove('show');
  }

  if (btnPinSubmit) {
    btnPinSubmit.addEventListener('click', handlePinVerification);
  }

  if (pinInput) {
    pinInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handlePinVerification();
    });
  }

  async function handlePinVerification() {
    const pin = pinInput.value.trim();
    if (!pin) return;

    try {
      const res = await fetch('/api/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        adminPin = pin;
        sessionStorage.setItem('cantina_admin_pin', pin);
        closePinModal();
        if (pendingProtectedTab) {
          switchTab(pendingProtectedTab);
          pendingProtectedTab = null;
        }
      } else {
        pinError.style.display = 'block';
        pinError.textContent = 'Contrasinal incorrecto. Proba de novo.';
      }
    } catch (err) {
      pinError.style.display = 'block';
      pinError.textContent = 'Erro ao verificar o contrasinal.';
    }
  }

  // Pestaña Resultados (Analytics)
  async function loadResultados() {
    const container = document.getElementById('resultados-content');
    if (!container) return;

    try {
      const res = await fetch('/api/resultados', {
        headers: { 'X-Admin-PIN': adminPin }
      });

      if (!res.ok) {
        if (res.status === 401) {
          sessionStorage.removeItem('cantina_admin_pin');
          adminPin = '';
          openPinModal();
        }
        return;
      }

      const data = await res.json();
      renderResultadosUI(data);

    } catch (err) {
      showToast('Erro ao cargar os resultados', 'error');
    }
  }

  function renderResultadosUI(data) {
    const container = document.getElementById('resultados-content');
    const maxUnits = Math.max(...data.productos.map(p => p.unidades_vendidas), 1);
    const maxImporte = Math.max(...data.productos.map(p => p.importe_facturado), 1);

    const palette = ['#32D9C8', '#F2C12E', '#F2A413', '#F26A1B', '#23b7a8', '#f59e0b', '#ef4444'];

    container.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">Facturación Total do Evento</div>
          <div class="kpi-value">${formatCurrency(data.facturacion_total)}</div>
        </div>
        <div class="kpi-card" style="border-top-color: var(--color-primary);">
          <div class="kpi-label">Total de Pedidos Confirmados</div>
          <div class="kpi-value" style="color: #0F172A;">${data.total_pedidos}</div>
        </div>
      </div>

      <div class="charts-section">
        <div class="chart-card">
          <div class="chart-card-title">Unidades Vendidas por Consumición</div>
          <div class="chart-container">
            ${data.productos.map((p, idx) => {
              const pct = (p.unidades_vendidas / maxUnits) * 100;
              const color = palette[idx % palette.length];
              return `
                <div class="bar-chart-row">
                  <div class="bar-chart-info">
                    <span>${escapeHtml(p.nombre)}</span>
                    <span><strong>${p.unidades_vendidas}</strong> un.</span>
                  </div>
                  <div class="bar-chart-track">
                    <div class="bar-chart-fill" style="width: ${pct}%; background: ${color};"></div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="chart-card">
          <div class="chart-card-title">Facturación (€) por Consumición</div>
          <div class="chart-container">
            ${data.productos.map((p, idx) => {
              const pct = (p.importe_facturado / maxImporte) * 100;
              const color = palette[(idx + 2) % palette.length];
              return `
                <div class="bar-chart-row">
                  <div class="bar-chart-info">
                    <span>${escapeHtml(p.nombre)}</span>
                    <span><strong>${formatCurrency(p.importe_facturado)}</strong> (${p.porcentaje_facturacion}%)</span>
                  </div>
                  <div class="bar-chart-track">
                    <div class="bar-chart-fill" style="width: ${pct}%; background: ${color};"></div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>

      <div class="table-card">
        <div class="table-header">
          <h3 style="font-size: 1.1rem; font-weight: 700;">Táboa Detallada de Vendas</h3>
          <button class="btn-action btn-secondary" id="btn-refresh-stats">🔄 Actualizar datos</button>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Consumición</th>
                <th>Estado</th>
                <th>Prezo Actual</th>
                <th>Unidades Vendidas</th>
                <th>Facturación Total</th>
                <th>% Facturación</th>
              </tr>
            </thead>
            <tbody>
              ${data.productos.map(p => `
                <tr>
                  <td><strong>${escapeHtml(p.nombre)}</strong></td>
                  <td><span class="badge-status ${p.activo ? 'badge-active' : 'badge-inactive'}">${p.activo ? 'Activo' : 'Inactivo'}</span></td>
                  <td>${formatCurrency(p.precio_actual)}</td>
                  <td><strong>${p.unidades_vendidas}</strong></td>
                  <td><strong>${formatCurrency(p.importe_facturado)}</strong></td>
                  <td>${p.porcentaje_facturacion}%</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('btn-refresh-stats')?.addEventListener('click', loadResultados);
  }

  // Polling para multi-camarero
  function startPolling() {
    stopPolling();
    pollingInterval = setInterval(() => {
      if (activeTab === 'resultados') loadResultados();
    }, 10000);
  }

  function stopPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
  }

  // Pestaña Axustes (Xestión do Catálogo)
  async function loadAxustes() {
    const container = document.getElementById('axustes-content');
    if (!container) return;

    try {
      const res = await fetch('/api/consumiciones?include_inactive=true', {
        headers: { 'X-Admin-PIN': adminPin }
      });

      if (!res.ok) {
        if (res.status === 401) {
          sessionStorage.removeItem('cantina_admin_pin');
          adminPin = '';
          openPinModal();
        }
        return;
      }

      const items = await res.json();
      renderAxustesUI(items);

    } catch (err) {
      showToast('Erro ao cargar a xestión do catálogo', 'error');
    }
  }

  function renderAxustesUI(items) {
    const container = document.getElementById('axustes-content');
    container.innerHTML = `
      <div class="table-card" style="margin-bottom: 24px;">
        <div class="table-header">
          <h3 style="font-size: 1.1rem; font-weight: 700;">Engadir Nova Consumición</h3>
        </div>
        <div style="padding: 20px;">
          <form id="form-add-item" enctype="multipart/form-data">
            <div class="form-grid">
              <div class="form-group">
                <label class="form-label">Nome da Consumición *</label>
                <input type="text" name="nombre" class="form-control" placeholder="ex. Caña de cerveza" required>
              </div>
              <div class="form-group">
                <label class="form-label">Prezo Unitario (€) *</label>
                <input type="number" step="0.10" min="0.10" name="precio_unitario" class="form-control" placeholder="ex. 2.50" required>
              </div>
              <div class="form-group">
                <label class="form-label">Subir Imaxe (Máx 2MB)</label>
                <input type="file" name="imagen_file" accept="image/*" class="form-control">
              </div>
              <div class="form-group">
                <label class="form-label">Ou URL de Imaxe (opcional)</label>
                <input type="url" name="imagen_url" class="form-control" placeholder="https://...">
              </div>
            </div>
            <button type="submit" class="btn-action btn-primary" style="padding: 12px 24px;">➕ Crear Consumición</button>
          </form>
        </div>
      </div>

      <div class="table-card">
        <div class="table-header">
          <h3 style="font-size: 1.1rem; font-weight: 700;">Catálogo Existente</h3>
          <button class="btn-action btn-danger" id="btn-reset-caja" style="font-size: 0.85rem;">⚠️ Peche de Caixa / Resetear Vendas</button>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Imaxe</th>
                <th>Nome</th>
                <th>Prezo</th>
                <th>Estado</th>
                <th>Accións</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(item => `
                <tr>
                  <td>
                    ${item.imagen_url 
                      ? `<img src="${item.imagen_url}" style="width: 40px; height: 40px; border-radius: 8px; object-fit: cover;">`
                      : `<div style="width: 40px; height: 40px; border-radius: 8px; background: #e2e8f0; display: flex; align-items: center; justify-content: center;">🍹</div>`}
                  </td>
                  <td><strong>${escapeHtml(item.nombre)}</strong></td>
                  <td>${formatCurrency(item.precio_unitario)}</td>
                  <td><span class="badge-status ${item.activo ? 'badge-active' : 'badge-inactive'}">${item.activo ? 'Activo' : 'Inactivo'}</span></td>
                  <td>
                    <div style="display: flex; gap: 8px;">
                      <button class="btn-action btn-secondary btn-edit-item" data-id="${item.id}" style="padding: 6px 12px; font-size: 0.85rem;">✏️ Editar</button>
                      ${item.activo 
                        ? `<button class="btn-action btn-danger btn-delete-item" data-id="${item.id}" style="padding: 6px 12px; font-size: 0.85rem;">🗑️ Desactivar</button>`
                        : `<button class="btn-action btn-primary btn-activate-item" data-id="${item.id}" style="padding: 6px 12px; font-size: 0.85rem;">✅ Activar</button>`}
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Form Submisón Nova Consumición
    const formAdd = document.getElementById('form-add-item');
    if (formAdd) {
      formAdd.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(formAdd);

        // Validar tamaño de imaxe se se seleccionou ficheiro
        const fileInput = formAdd.querySelector('input[type="file"]');
        if (fileInput.files.length > 0 && fileInput.files[0].size > 2 * 1024 * 1024) {
          showToast('O arquivo de imaxe supera o límite de 2 MB', 'error');
          return;
        }

        try {
          const res = await fetch('/api/consumiciones', {
            method: 'POST',
            headers: { 'X-Admin-PIN': adminPin },
            body: formData
          });

          if (res.ok) {
            showToast('✅ Consumición creada con éxito');
            fetchCatalog();
            loadAxustes();
          } else {
            const err = await res.json();
            showToast(`❌ ${err.error || 'Erro ao crear consumición'}`, 'error');
          }
        } catch (err) {
          showToast('Erro de conexión', 'error');
        }
      });
    }

    // Eventos Desactivar / Activar / Editar
    container.querySelectorAll('.btn-delete-item').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (confirm('Seguro que queres desactivar esta consumición? Non aparecerá na toma de pedidos pero conservaranse os seus datos históricos.')) {
          await fetch(`/api/consumiciones/${id}`, {
            method: 'DELETE',
            headers: { 'X-Admin-PIN': adminPin }
          });
          fetchCatalog();
          loadAxustes();
        }
      });
    });

    container.querySelectorAll('.btn-activate-item').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const bodyData = new FormData();
        bodyData.append('activo', 'true');
        await fetch(`/api/consumiciones/${id}`, {
          method: 'PUT',
          headers: { 'X-Admin-PIN': adminPin },
          body: bodyData
        });
        fetchCatalog();
        loadAxustes();
      });
    });

    // Resetear Caixa
    document.getElementById('btn-reset-caja')?.addEventListener('click', async () => {
      if (confirm('⚠️ ATENCIÓN: Seguro que queres pechar caixa e reiniciar os contadores do evento? Esta acción borrará os pedidos actuais.')) {
        const res = await fetch('/api/reset-caja', {
          method: 'POST',
          headers: { 'X-Admin-PIN': adminPin }
        });
        if (res.ok) {
          showToast('✅ Peche de caixa realizado correctamente');
          loadAxustes();
          fetchCatalog();
        }
      }
    });
  }

  // Utilidades
  function formatCurrency(val) {
    return new Intl.NumberFormat('gl-ES', { style: 'currency', currency: 'EUR' }).format(val);
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, function(m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
    });
  }

  function showToast(msg, type = 'success') {
    let toastContainer = document.querySelector('.toast-container');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.className = 'toast-container';
      document.body.appendChild(toastContainer);
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    if (type === 'error') toast.style.borderLeftColor = '#EF4444';
    toast.textContent = msg;

    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3500);
  }
});
