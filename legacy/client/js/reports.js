// reports.js — month/year picker + occupancy & rent collection summaries.
// The bar chart is hand-rolled canvas drawing (no chart library, §11.8).
(function () {
  requireAuth();
  markActiveNav('reports');
  document.getElementById('logout-link').addEventListener('click', handleLogout);

  const monthSelect = document.getElementById('month-select');
  const yearSelect = document.getElementById('year-select');

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  MONTHS.forEach((m, i) => {
    const opt = document.createElement('option');
    opt.value = String(i + 1);
    opt.textContent = m;
    monthSelect.appendChild(opt);
  });
  const now = new Date();
  for (let y = now.getFullYear(); y >= now.getFullYear() - 5; y--) {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = String(y);
    yearSelect.appendChild(opt);
  }
  monthSelect.value = String(now.getMonth() + 1);
  yearSelect.value = String(now.getFullYear());

  async function load() {
    const month = monthSelect.value;
    const year = yearSelect.value;
    try {
      const [occupancy, rent] = await Promise.all([
        api.get(`/reports/occupancy?month=${month}&year=${year}`),
        api.get(`/reports/rent-collection?month=${month}&year=${year}`),
      ]);
      const label = `${MONTHS[Number(month) - 1]} ${year}`;
      document.getElementById('occupancy-period').textContent = label;
      document.getElementById('rent-period').textContent = label;
      document.getElementById('byunit-period').textContent = label;

      document.getElementById('occ-rate').textContent = `${occupancy.occupancyRate}%`;
      document.getElementById('occ-occupied').textContent = String(occupancy.occupiedUnits);
      document.getElementById('occ-vacant').textContent = String(occupancy.vacantUnits);
      document.getElementById('occ-maint').textContent = String(occupancy.maintenanceUnits);

      document.getElementById('rent-billed').textContent = formatMoney(rent.totalBilled);
      document.getElementById('rent-collected').textContent = formatMoney(rent.totalCollected);
      document.getElementById('rent-outstanding').textContent = formatMoney(rent.outstandingBalance);
      document.getElementById('rent-rate').textContent = `${rent.collectionRate}%`;

      renderChart(rent.byUnit);
      renderByUnit(rent.byUnit);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function renderByUnit(byUnit) {
    const tbody = document.getElementById('byunit-body');
    tbody.innerHTML = byUnit.length === 0
      ? '<tr><td colspan="4" class="empty-state">No units on lease this month.</td></tr>'
      : byUnit.map((u) => `
          <tr>
            <td>${escapeHtml(u.unitNumber)}</td>
            <td>${formatMoney(u.billed)}</td>
            <td>${formatMoney(u.collected)}</td>
            <td style="color:${Number(u.outstanding) > 0 ? 'var(--color-danger)' : 'var(--color-success)'}">${formatMoney(u.outstanding)}</td>
          </tr>`).join('');
  }

  // Hand-rolled grouped bar chart: billed vs collected per unit.
  function renderChart(byUnit) {
    const canvas = document.getElementById('rent-chart');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const units = byUnit.filter((u) => Number(u.billed) > 0);
    if (units.length === 0) {
      ctx.fillStyle = '#999';
      ctx.font = '13px system-ui';
      ctx.fillText('No billed units this month', (rect.width - 150) / 2, rect.height / 2);
      return;
    }

    const max = Math.max(...units.map((u) => Number(u.billed)), 1) * 1.15;
    const pad = { top: 24, right: 12, bottom: 28, left: 46 };
    const chartW = rect.width - pad.left - pad.right;
    const chartH = rect.height - pad.top - pad.bottom;
    const groupW = chartW / units.length;
    const barW = Math.min(18, groupW / 3.2);

    // Y axis
    ctx.font = '10px system-ui';
    ctx.fillStyle = '#999';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const val = (max / 4) * i;
      const y = pad.top + chartH - (val / max) * chartH;
      ctx.strokeStyle = '#eee';
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(rect.width - pad.right, y);
      ctx.stroke();
      ctx.fillStyle = '#999';
      ctx.fillText(`$${Math.round(val)}`, pad.left - 5, y + 3);
    }

    units.forEach((u, i) => {
      const x = pad.left + groupW * i + groupW / 2;
      const billed = Number(u.billed);
      const collected = Number(u.collected);
      // Billed bar (primary), collected bar (success) side by side.
      bar(x - barW - 1.5, pad.top + chartH, barW, (billed / max) * chartH, '#2e5395');
      bar(x + 1.5, pad.top + chartH, barW, (collected / max) * chartH, '#2e7d32');
      ctx.fillStyle = '#666';
      ctx.textAlign = 'center';
      ctx.font = '10px system-ui';
      ctx.fillText(u.unitNumber, x, rect.height - 8);
    });

    // Legend
    ctx.textAlign = 'left';
    ctx.font = '10px system-ui';
    ctx.fillStyle = '#2e5395';
    ctx.fillRect(pad.left, 10, 10, 10);
    ctx.fillStyle = '#666';
    ctx.fillText('Billed', pad.left + 14, 19);
    ctx.fillStyle = '#2e7d32';
    ctx.fillRect(pad.left + 70, 10, 10, 10);
    ctx.fillStyle = '#666';
    ctx.fillText('Collected', pad.left + 84, 19);

    function bar(x, baseY, w, h, color) {
      if (h <= 0) return;
      ctx.fillStyle = color;
      ctx.fillRect(x, baseY - h, w, h);
    }
  }

  document.getElementById('refresh-btn').addEventListener('click', load);
  monthSelect.addEventListener('change', load);
  yearSelect.addEventListener('change', load);

  load();
})();