// public/master.js - Completo con ajustes globales y específicos respaldo
console.log('🖥️ Master UI cargada');

const API_BASE = '/api';

// ---------- Variables globales ----------
let grupos = [];
let propietarios = [];
let deudasGlobal = [];
let recibos = [];
let grupoSeleccionado = null;
let propiedadSeleccionada = null;
let currentTasaBCV = null;
let currentFechaTasa = null;
let editandoReciboId = null;

// ---------- Configuración predeterminada de alícuotas ----------
let alicuotasPredeterminadas = [];

// ---------- Helpers ----------
function formatearFecha(fechaString) {
  if (!fechaString) return '—';
  const fecha = new Date(fechaString);
  return fecha.toLocaleDateString('es-ES', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function parseJSONField(field) {
  if (typeof field === 'string') {
    try { return JSON.parse(field); } catch (e) { console.error('Error parseando JSON:', e); return []; }
  }
  return field || [];
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m]);
}

// ---------- Comunicación con API ----------
async function fetchAPI(endpoint, method = 'GET', body = null) {
  const token = localStorage.getItem('token');
  const options = {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
  };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${endpoint}`, options);
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem('token');
      localStorage.removeItem('rol');
      window.location.href = '/login.html';
      throw new Error('Sesión expirada o no autorizado');
    }
    let msg = `Error ${res.status}`;
    try { const e = await res.json(); msg = e.error || msg; } catch (_) {}
    throw new Error(msg);
  }
  return res.json();
}

const api = {
  getGrupos: () => fetchAPI('/grupos'),
  getPropietarios: () => fetchAPI('/propietarios'),
  getPropietariosConSaldo: () => fetchAPI('/propietarios/saldo'),
  getPropietarioById: (id) => fetchAPI(`/propietarios/${id}`),
  addRecibo: (recibo) => fetchAPI('/recibos', 'POST', recibo),
  updateRecibo: (id, recibo) => fetchAPI(`/recibos/${id}`, 'PUT', recibo),
  getRecibos: (grupoId) => fetchAPI('/recibos' + (grupoId ? `?grupoId=${grupoId}` : '')),
  getReciboById: (id) => fetchAPI(`/recibos/${id}`),
  addDeuda: (deuda) => fetchAPI('/deudas', 'POST', deuda),
  getDeudasByPropietario: (propId) => fetchAPI(`/propietarios/${propId}/deudas`),
  deleteDeuda: (id) => fetchAPI(`/deudas/${id}`, 'DELETE'),
  getPagosPendientes: () => fetchAPI('/pagos/pendientes'),
  verificarPago: (pagoId) => fetchAPI(`/pagos/${pagoId}/verificar`, 'POST'),
  getTasaBCV: () => fetchAPI('/tasa-bcv')
};

// ==================== TASA BCV Y GASTOS ====================
async function obtenerTasaBCV() {
  try {
    const data = await api.getTasaBCV();
    currentTasaBCV = data.tasa;
    currentFechaTasa = data.fecha;
    document.getElementById('tasaBCV').value = currentTasaBCV;
    const fechaSpan = document.getElementById('fechaTasa');
    if (fechaSpan) {
      fechaSpan.innerText = `Actualizada: ${new Date(currentFechaTasa).toLocaleDateString('es-ES')}`;
    }
    calcularTotalGastos();
    actualizarUSDEnGastosEspecificos();
    recalcularTodo();
    return currentTasaBCV;
  } catch (err) {
    console.error('Error obteniendo tasa BCV:', err);
    alert('No se pudo obtener la tasa BCV automáticamente. Puedes ingresarla manualmente.');
    return null;
  }
}

function actualizarUSDEnGastosEspecificos() {
  if (!currentTasaBCV || currentTasaBCV <= 0) return;
  document.querySelectorAll('#gastosEspecificosContainer .gasto-especifico-row').forEach(row => {
    const montoVESInput = row.querySelector('.gasto-especifico-monto-ves');
    const usdSpan = row.querySelector('.gasto-especifico-usd');
    if (montoVESInput && usdSpan) {
      const montoVES = parseFloat(montoVESInput.value);
      if (!isNaN(montoVES) && montoVES > 0) {
        usdSpan.innerText = (montoVES / currentTasaBCV).toFixed(2) + ' USD';
      } else {
        usdSpan.innerText = '0.00 USD';
      }
    }
  });
}

// esta funcion es agregar una fila de gasto general ///
function agregarFilaGasto(descripcion = '', montoVES = 0) {
  const container = document.getElementById('gastosContainer');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'gasto-row';
  row.innerHTML = `
    <input type="text" class="gasto-desc" placeholder="Descripción" value="${escapeHtml(descripcion)}">
    <input type="number" class="gasto-monto" placeholder="Monto VES" step="any" value="${montoVES}">
    <span class="gasto-usd">0.00 USD</span>
    <button type="button" class="btn-eliminar-gasto">✖</button>
  `;
  row.querySelector('.btn-eliminar-gasto').addEventListener('click', () => {
    row.remove();
    calcularTotalGastos();
    recalcularTodo();
  });
  row.querySelector('.gasto-monto').addEventListener('input', () => {
    calcularTotalGastos();
    recalcularTodo();
  });
  container.appendChild(row);
  calcularTotalGastos();
}

function calcularTotalGastos() {
  if (!currentTasaBCV || currentTasaBCV <= 0) {
    document.getElementById('totalGastosUSD').innerText = '0.00';
    calcularNetoTotal();
    return 0;
  }
  let totalUSD = 0;
  document.querySelectorAll('#gastosContainer .gasto-row').forEach(fila => {
    const montoInput = fila.querySelector('.gasto-monto');
    const usdSpan = fila.querySelector('.gasto-usd');
    if (montoInput && usdSpan) {
      const montoVES = parseFloat(montoInput.value) || 0;
      const usd = montoVES > 0 ? montoVES / currentTasaBCV : 0;
      usdSpan.innerText = usd.toFixed(2) + ' USD';
      totalUSD += usd;
    }
  });
  document.getElementById('totalGastosUSD').innerText = totalUSD.toFixed(2);
  calcularNetoTotal();
  return totalUSD;
}

// ==================== AJUSTES GLOBALES ====================

// esta funcion es agregar una fila de ajuste global (crédito/reverso) ///
function agregarFilaAjuste(tipo = 'credito', descripcion = '', montoUSD = 0) {
  const container = document.getElementById('ajustesContainer');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'ajuste-row';
  const color = tipo === 'credito' ? 'green' : 'red';
  row.innerHTML = `
    <select class="ajuste-tipo">
      <option value="credito" ${tipo === 'credito' ? 'selected' : ''}>Crédito</option>
      <option value="reverso" ${tipo === 'reverso' ? 'selected' : ''}>Reverso</option>
    </select>
    <input type="text" class="ajuste-desc" placeholder="Descripción" value="${escapeHtml(descripcion)}">
    <input type="number" step="any" class="ajuste-monto" placeholder="Monto USD" value="${montoUSD}">
    <span class="ajuste-usd" style="color:${color};">${montoUSD.toFixed(2)} USD</span>
    <button type="button" class="btn-eliminar-ajuste">✖</button>
  `;

  const select = row.querySelector('.ajuste-tipo');
  const montoInput = row.querySelector('.ajuste-monto');
  const usdSpan = row.querySelector('.ajuste-usd');

  const actualizarVisual = () => {
    const t = select.value;
    const val = parseFloat(montoInput.value) || 0;
    usdSpan.style.color = t === 'credito' ? 'green' : 'red';
    usdSpan.innerText = val.toFixed(2) + ' USD';
    calcularNetoTotal();
    recalcularTodo();
  };

  row.querySelector('.btn-eliminar-ajuste').addEventListener('click', () => {
    row.remove();
    calcularNetoTotal();
    recalcularTodo();
  });
  select.addEventListener('change', actualizarVisual);
  montoInput.addEventListener('input', actualizarVisual);

  container.appendChild(row);
}

// esta funcion es calcular el neto a distribuir (gastos + ajustes globales) ///
function calcularNetoTotal() {
  const totalGastos = parseFloat(document.getElementById('totalGastosUSD')?.innerText) || 0;
  let totalAjustes = 0;
  document.querySelectorAll('#ajustesContainer .ajuste-row').forEach(row => {
    const tipo = row.querySelector('.ajuste-tipo').value;
    const monto = parseFloat(row.querySelector('.ajuste-monto').value) || 0;
    if (tipo === 'credito') totalAjustes -= monto;
    else totalAjustes += monto;
  });
  const neto = totalGastos + totalAjustes;
  document.getElementById('totalNetoUSD').innerText = neto.toFixed(2);
  document.getElementById('detalleNeto').innerText =
    `(Gastos: ${totalGastos.toFixed(2)} + Ajustes netos: ${totalAjustes.toFixed(2)})`;
  return neto;
}

// ==================== ALÍCUOTAS ====================
function agregarGrupoAlicuota(grupoId = '', porcentaje = '') {
  const container = document.getElementById('gruposAlicuotasContainer');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'grupo-alicuota-row';
  const select = document.createElement('select');
  select.innerHTML = '<option value="">Seleccione grupo</option>' +
    grupos.map(g => `<option value="${g.id}" ${grupoId == g.id ? 'selected' : ''}>${g.nombre}</option>`).join('');
  const inputPorc = document.createElement('input');
  inputPorc.type = 'number'; inputPorc.step = '0.001'; inputPorc.placeholder = '%';
  inputPorc.value = porcentaje;
  const btnEliminar = document.createElement('button');
  btnEliminar.textContent = '✖'; btnEliminar.style.backgroundColor = '#dc3545';
  btnEliminar.addEventListener('click', () => { row.remove(); recalcularTodo(); validarSumaAlicuotas(); });
  select.addEventListener('change', () => { recalcularTodo(); validarSumaAlicuotas(); });
  inputPorc.addEventListener('input', () => { recalcularTodo(); validarSumaAlicuotas(); });
  row.appendChild(select); row.appendChild(inputPorc); row.appendChild(btnEliminar);
  container.appendChild(row);
}

function validarSumaAlicuotas() {
  let suma = 0;
  document.querySelectorAll('#gruposAlicuotasContainer input[type="number"]').forEach(inp => suma += parseFloat(inp.value) || 0);
  const msg = document.getElementById('sumaAlicuotasMsg');
  if (!msg) return false;
  if (Math.abs(suma - 100) > 0.001) {
    msg.innerHTML = `⚠️ La suma de alícuotas es ${suma.toFixed(3)}%. Debe ser 100% para continuar.`;
    msg.style.color = 'orange';
    return false;
  } else {
    msg.innerHTML = `✅ Suma correcta: 100%`;
    msg.style.color = 'green';
    return true;
  }
}

// ==================== GASTOS ESPECÍFICOS ====================
function agregarGastoEspecifico() {
  const container = document.getElementById('gastosEspecificosContainer');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'gasto-especifico-row';
  row.style.display = 'flex'; row.style.gap = '10px'; row.style.alignItems = 'center';
  row.style.marginBottom = '8px'; row.style.backgroundColor = '#e9ecef';
  row.style.padding = '8px'; row.style.borderRadius = '4px'; row.style.flexWrap = 'wrap';

  const selectTipo = document.createElement('select');
  selectTipo.innerHTML = '<option value="grupo">Afecta a un grupo (reparto equitativo)</option><option value="propietario">Afecta a un propietario específico</option>';
  selectTipo.style.flex = '1';
  const selectDestino = document.createElement('select');
  selectDestino.innerHTML = '<option value="">Seleccione...</option>';
  selectDestino.style.flex = '1';
  const inputDescripcion = document.createElement('input');
  inputDescripcion.type = 'text'; inputDescripcion.placeholder = 'Descripción del gasto'; inputDescripcion.style.flex = '1.5';
  const inputMontoVES = document.createElement('input');
  inputMontoVES.type = 'number'; inputMontoVES.step = 'any'; inputMontoVES.placeholder = 'Monto VES';
  inputMontoVES.className = 'gasto-especifico-monto-ves'; inputMontoVES.style.flex = '1';
  const usdSpan = document.createElement('span');
  usdSpan.className = 'gasto-especifico-usd'; usdSpan.innerText = '0.00 USD'; usdSpan.style.flex = '0.8';
  const btnEliminar = document.createElement('button');
  btnEliminar.textContent = '✖'; btnEliminar.style.backgroundColor = '#dc3545'; btnEliminar.style.padding = '5px 10px';
  btnEliminar.addEventListener('click', () => { row.remove(); recalcularTodo(); });

  async function cargarDestinos() {
    if (selectTipo.value === 'grupo') {
      const gruposList = await api.getGrupos();
      selectDestino.innerHTML = '<option value="">Seleccione grupo</option>' +
        gruposList.map(g => `<option value="grupo_${g.id}">${g.nombre}</option>`).join('');
    } else {
      const props = await api.getPropietarios();
      selectDestino.innerHTML = '<option value="">Seleccione propietario</option>' +
        props.map(p => `<option value="prop_${p.id}">${p.nombre} (${p.apartamento})</option>`).join('');
    }
  }
  function actualizarUSD() {
    if (!currentTasaBCV || currentTasaBCV <= 0) return;
    const montoVES = parseFloat(inputMontoVES.value);
    if (!isNaN(montoVES) && montoVES > 0) {
      usdSpan.innerText = (montoVES / currentTasaBCV).toFixed(2) + ' USD';
    } else {
      usdSpan.innerText = '0.00 USD';
    }
  }
  selectTipo.addEventListener('change', cargarDestinos);
  cargarDestinos();
  inputMontoVES.addEventListener('input', () => { actualizarUSD(); recalcularTodo(); });
  inputDescripcion.addEventListener('input', () => recalcularTodo());
  selectDestino.addEventListener('change', () => recalcularTodo());

  row.appendChild(selectTipo); row.appendChild(selectDestino); row.appendChild(inputDescripcion);
  row.appendChild(inputMontoVES); row.appendChild(usdSpan); row.appendChild(btnEliminar);
  container.appendChild(row);
}

// ==================== AJUSTES ESPECÍFICOS ====================
function agregarFilaAjusteEspecifico(datos = {}) {
  const container = document.getElementById('ajustesEspecificosContainer');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'ajuste-especifico-row';
  row.style.display = 'flex'; row.style.gap = '10px'; row.style.alignItems = 'center';
  row.style.marginBottom = '8px'; row.style.backgroundColor = '#e9ecef';
  row.style.padding = '8px'; row.style.borderRadius = '4px'; row.style.flexWrap = 'wrap';

  const selectTipoAjuste = document.createElement('select');
  selectTipoAjuste.innerHTML = `<option value="credito" ${datos.tipo === 'credito' ? 'selected' : ''}>Crédito</option>
                                <option value="reverso" ${datos.tipo === 'reverso' ? 'selected' : ''}>Reverso</option>`;
  selectTipoAjuste.style.flex = '1';

  const selectDestinoTipo = document.createElement('select');
  selectDestinoTipo.innerHTML = `<option value="grupo" ${datos.destino_tipo === 'grupo' ? 'selected' : ''}>Afecta a un grupo</option>
                                 <option value="propietario" ${datos.destino_tipo === 'propietario' ? 'selected' : ''}>Afecta a un propietario</option>`;
  selectDestinoTipo.style.flex = '1';

  const selectDestino = document.createElement('select');
  selectDestino.style.flex = '1';

  const inputDesc = document.createElement('input');
  inputDesc.type = 'text'; inputDesc.placeholder = 'Descripción'; inputDesc.value = datos.descripcion || '';
  inputDesc.style.flex = '1.5';

  const inputMonto = document.createElement('input');
  inputMonto.type = 'number'; inputMonto.step = 'any'; inputMonto.placeholder = 'Monto USD';
  inputMonto.className = 'ajuste-especifico-monto';
  inputMonto.value = datos.monto_usd || '';
  inputMonto.style.flex = '1';

  const btnEliminar = document.createElement('button');
  btnEliminar.textContent = '✖'; btnEliminar.style.backgroundColor = '#dc3545'; btnEliminar.style.padding = '5px 10px';
  btnEliminar.addEventListener('click', () => { row.remove(); recalcularTodo(); });

  async function cargarDestinosAjuste() {
    if (selectDestinoTipo.value === 'grupo') {
      const gs = await api.getGrupos();
      selectDestino.innerHTML = '<option value="">Seleccione grupo</option>' +
        gs.map(g => `<option value="grupo_${g.id}" ${datos.destino_id == g.id && datos.destino_tipo === 'grupo' ? 'selected' : ''}>${g.nombre}</option>`).join('');
    } else {
      const ps = await api.getPropietarios();
      selectDestino.innerHTML = '<option value="">Seleccione propietario</option>' +
        ps.map(p => `<option value="prop_${p.id}" ${datos.destino_id == p.id && datos.destino_tipo === 'propietario' ? 'selected' : ''}>${p.nombre} (${p.apartamento})</option>`).join('');
    }
  }

  selectDestinoTipo.addEventListener('change', cargarDestinosAjuste);
  cargarDestinosAjuste();

  selectTipoAjuste.addEventListener('change', recalcularTodo);
  selectDestino.addEventListener('change', recalcularTodo);
  inputDesc.addEventListener('input', recalcularTodo);
  inputMonto.addEventListener('input', recalcularTodo);

  row.appendChild(selectTipoAjuste);
  row.appendChild(selectDestinoTipo);
  row.appendChild(selectDestino);
  row.appendChild(inputDesc);
  row.appendChild(inputMonto);
  row.appendChild(btnEliminar);
  container.appendChild(row);
}

// ==================== CÁLCULO Y RESUMEN ====================
async function recalcularTodo() {
  const totalNeto = calcularNetoTotal();
  if (totalNeto === 0) return;

  const alicuotasGrupo = [];
  document.querySelectorAll('#gruposAlicuotasContainer .grupo-alicuota-row').forEach(row => {
    const select = row.querySelector('select');
    const input = row.querySelector('input[type="number"]');
    if (select && select.value && input && input.value) {
      alicuotasGrupo.push({ grupoId: parseInt(select.value), porcentaje: parseFloat(input.value) });
    }
  });
  if (!validarSumaAlicuotas()) return;

  const gastosEsp = [];
  document.querySelectorAll('#gastosEspecificosContainer .gasto-especifico-row').forEach(row => {
    const tipo = row.querySelector('select:first-child')?.value;
    const destinoSelect = row.querySelector('select:nth-child(2)');
    const descripcion = row.querySelector('input[type="text"]')?.value;
    const montoVES = parseFloat(row.querySelector('.gasto-especifico-monto-ves')?.value);
    if (destinoSelect && destinoSelect.value && !isNaN(montoVES) && montoVES > 0 && currentTasaBCV > 0) {
      const [tipoDest, id] = destinoSelect.value.split('_');
      gastosEsp.push({ tipo: tipoDest, id: parseInt(id), monto: montoVES / currentTasaBCV, descripcion: descripcion || 'Gasto específico' });
    }
  });

  const ajustesEsp = [];
  document.querySelectorAll('#ajustesEspecificosContainer .ajuste-especifico-row').forEach(row => {
    const tipoAjuste = row.querySelector('select:first-child')?.value;
    const destinoTipo = row.querySelector('select:nth-child(2)')?.value;
    const destinoSelect = row.querySelector('select:nth-child(3)');
    const descripcion = row.querySelector('input[type="text"]')?.value;
    const montoUSD = parseFloat(row.querySelector('.ajuste-especifico-monto')?.value);
    if (destinoSelect?.value && !isNaN(montoUSD) && montoUSD > 0) {
      const [tipoDest, id] = destinoSelect.value.split('_');
      ajustesEsp.push({
        tipo: tipoAjuste,
        destino_tipo: tipoDest,
        destino_id: parseInt(id),
        monto: montoUSD,
        descripcion: descripcion || 'Ajuste específico'
      });
    }
  });

  const todosPropietarios = await api.getPropietarios();
  const propietariosPorGrupo = {};
  todosPropietarios.forEach(p => {
    if (!propietariosPorGrupo[p.grupo_id]) propietariosPorGrupo[p.grupo_id] = [];
    propietariosPorGrupo[p.grupo_id].push(p);
  });

  const montoPorPropietario = new Map();
  for (const ag of alicuotasGrupo) {
    const montoGrupo = totalNeto * (ag.porcentaje / 100);
    const props = propietariosPorGrupo[ag.grupoId] || [];
    if (props.length === 0) continue;
    const montoPorProp = montoGrupo / props.length;
    props.forEach(p => {
      if (!montoPorPropietario.has(p.id)) montoPorPropietario.set(p.id, { base: 0, adicional: 0 });
      montoPorPropietario.get(p.id).base += montoPorProp;
    });
  }
  for (const ge of gastosEsp) {
    if (ge.tipo === 'grupo') {
      const props = propietariosPorGrupo[ge.id] || [];
      if (props.length === 0) continue;
      const montoAdicional = ge.monto / props.length;
      props.forEach(p => {
        if (!montoPorPropietario.has(p.id)) montoPorPropietario.set(p.id, { base: 0, adicional: 0 });
        montoPorPropietario.get(p.id).adicional += montoAdicional;
      });
    } else if (ge.tipo === 'prop') {
      if (!montoPorPropietario.has(ge.id)) montoPorPropietario.set(ge.id, { base: 0, adicional: 0 });
      montoPorPropietario.get(ge.id).adicional += ge.monto;
    }
  }
  for (const ae of ajustesEsp) {
    const factor = ae.tipo === 'credito' ? -1 : 1;
    if (ae.destino_tipo === 'grupo') {
      const props = propietariosPorGrupo[ae.destino_id] || [];
      if (props.length === 0) continue;
      const montoIndividual = (ae.monto * factor) / props.length;
      props.forEach(p => {
        if (!montoPorPropietario.has(p.id)) montoPorPropietario.set(p.id, { base: 0, adicional: 0 });
        montoPorPropietario.get(p.id).adicional += montoIndividual;
      });
    } else {
      if (!montoPorPropietario.has(ae.destino_id)) montoPorPropietario.set(ae.destino_id, { base: 0, adicional: 0 });
      montoPorPropietario.get(ae.destino_id).adicional += ae.monto * factor;
    }
  }

  const tbody = document.querySelector('#tablaResumenPropietarios tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  for (const [propId, montos] of montoPorPropietario.entries()) {
    const prop = todosPropietarios.find(p => p.id === propId);
    if (!prop) continue;
    const grupoNombre = grupos.find(g => g.id === prop.grupo_id)?.nombre || 'Sin grupo';
    const total = montos.base + montos.adicional;
    const row = tbody.insertRow();
    row.insertCell(0).innerText = prop.nombre;
    row.insertCell(1).innerText = prop.apartamento;
    row.insertCell(2).innerText = grupoNombre;
    row.insertCell(3).innerText = montos.base.toFixed(2);
    row.insertCell(4).innerText = montos.adicional.toFixed(2);
    row.insertCell(5).innerText = total.toFixed(2);
  }
}

// ==================== ENVÍO DEL FORMULARIO ====================
let isSubmitting = false;
document.getElementById('formRecibo')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (isSubmitting) return;
  const submitBtn = document.querySelector('#formRecibo button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = '⏳ Procesando...';
  isSubmitting = true;

  try {
    const periodo = document.getElementById('periodoRecibo').value;
    if (!/^\d{2}\/\d{4}$/.test(periodo)) throw new Error('Período inválido (MM/AAAA)');
    if (!currentTasaBCV || currentTasaBCV <= 0) throw new Error('Obtenga la tasa BCV primero');

    const gastos = [];
    document.querySelectorAll('#gastosContainer .gasto-row').forEach(f => {
      const desc = f.querySelector('.gasto-desc')?.value;
      const montoVES = parseFloat(f.querySelector('.gasto-monto')?.value);
      if (desc && !isNaN(montoVES) && montoVES > 0) {
        gastos.push({ descripcion: desc, monto_ves: montoVES, monto_usd: montoVES / currentTasaBCV });
      }
    });
    if (!gastos.length) throw new Error('Agregue al menos un gasto general');

    const creditos = [];
    const reversos = [];
    document.querySelectorAll('#ajustesContainer .ajuste-row').forEach(row => {
      const tipo = row.querySelector('.ajuste-tipo').value;
      const desc = row.querySelector('.ajuste-desc')?.value.trim();
      const monto = parseFloat(row.querySelector('.ajuste-monto')?.value);
      if (desc && !isNaN(monto) && monto > 0) {
        if (tipo === 'credito') creditos.push({ descripcion: desc, monto_usd: monto });
        else reversos.push({ descripcion: desc, monto_usd: monto });
      }
    });

    const alicuotas = [];
    document.querySelectorAll('#gruposAlicuotasContainer .grupo-alicuota-row').forEach(row => {
      const select = row.querySelector('select');
      const input = row.querySelector('input[type="number"]');
      if (select?.value && input?.value) alicuotas.push({ grupoId: parseInt(select.value), porcentaje: parseFloat(input.value) });
    });
    if (!validarSumaAlicuotas()) throw new Error('La suma de alícuotas debe ser 100%');

    const especificos = [];
    const gruposEnUso = new Set(alicuotas.map(a => a.grupoId));
    document.querySelectorAll('#gastosEspecificosContainer .gasto-especifico-row').forEach(row => {
      const tipo = row.querySelector('select:first-child')?.value;
      const destino = row.querySelector('select:nth-child(2)');
      const desc = row.querySelector('input[type="text"]')?.value;
      const montoVES = parseFloat(row.querySelector('.gasto-especifico-monto-ves')?.value);
      if (destino?.value && !isNaN(montoVES) && montoVES > 0) {
        const [tipoDest, id] = destino.value.split('_');
        if (tipoDest === 'grupo' && !gruposEnUso.has(parseInt(id))) {
          throw new Error(`El grupo seleccionado no está en las alícuotas.`);
        }
        especificos.push({ tipo: tipoDest, id: parseInt(id), monto: montoVES / currentTasaBCV, descripcion: desc || 'Gasto específico' });
      }
    });

    const ajustesEspecificos = [];
    document.querySelectorAll('#ajustesEspecificosContainer .ajuste-especifico-row').forEach(row => {
      const tipoAjuste = row.querySelector('select:first-child')?.value;
      const destinoTipo = row.querySelector('select:nth-child(2)')?.value;
      const destinoSelect = row.querySelector('select:nth-child(3)');
      const descripcion = row.querySelector('input[type="text"]')?.value;
      const montoUSD = parseFloat(row.querySelector('.ajuste-especifico-monto')?.value);
      if (destinoSelect?.value && !isNaN(montoUSD) && montoUSD > 0) {
        const [tipoDest, id] = destinoSelect.value.split('_');
        ajustesEspecificos.push({
          tipo: tipoAjuste,
          destino_tipo: tipoDest,
          destino_id: parseInt(id),
          monto: montoUSD,
          descripcion: descripcion || 'Ajuste específico'
        });
      }
    });

    const totalNeto = calcularNetoTotal();
    const reciboData = {
      periodo,
      monto_usd: totalNeto,
      gastos_generales: JSON.stringify(gastos),
      alicuotas_grupo: JSON.stringify(alicuotas),
      gastos_especificos: JSON.stringify(especificos),
      creditos: JSON.stringify(creditos),
      reversos: JSON.stringify(reversos),
      ajustes_especificos: JSON.stringify(ajustesEspecificos),
      tasa_bcv: currentTasaBCV,
      fecha_tasa: currentFechaTasa || new Date().toISOString()
    };

    if (editandoReciboId) {
      await api.updateRecibo(editandoReciboId, reciboData);
      alert('✅ Recibo actualizado correctamente.');
    } else {
      const reciboCreado = await api.addRecibo(reciboData);
      const reciboId = reciboCreado.id;

      const todosPropietarios = await api.getPropietarios();
      const propietariosPorGrupo = {};
      todosPropietarios.forEach(p => {
        if (!propietariosPorGrupo[p.grupo_id]) propietariosPorGrupo[p.grupo_id] = [];
        propietariosPorGrupo[p.grupo_id].push(p);
      });

      const montoPorPropietario = new Map();
      for (const ag of alicuotas) {
        const montoGrupo = totalNeto * (ag.porcentaje / 100);
        const props = propietariosPorGrupo[ag.grupoId] || [];
        if (props.length === 0) continue;
        const montoPorProp = montoGrupo / props.length;
        props.forEach(p => montoPorPropietario.set(p.id, (montoPorPropietario.get(p.id) || 0) + montoPorProp));
      }
      for (const ge of especificos) {
        if (ge.tipo === 'grupo') {
          const props = propietariosPorGrupo[ge.id] || [];
          if (props.length === 0) continue;
          const montoAdicional = ge.monto / props.length;
          props.forEach(p => montoPorPropietario.set(p.id, (montoPorPropietario.get(p.id) || 0) + montoAdicional));
        } else {
          montoPorPropietario.set(ge.id, (montoPorPropietario.get(ge.id) || 0) + ge.monto);
        }
      }
      for (const ae of ajustesEspecificos) {
        const factor = ae.tipo === 'credito' ? -1 : 1;
        if (ae.destino_tipo === 'grupo') {
          const props = propietariosPorGrupo[ae.destino_id] || [];
          if (props.length === 0) continue;
          const montoIndividual = (ae.monto * factor) / props.length;
          props.forEach(p => montoPorPropietario.set(p.id, (montoPorPropietario.get(p.id) || 0) + montoIndividual));
        } else {
          montoPorPropietario.set(ae.destino_id, (montoPorPropietario.get(ae.destino_id) || 0) + ae.monto * factor);
        }
      }

      let deudasCreadas = 0;
      for (const [propId, monto] of montoPorPropietario.entries()) {
        if (monto <= 0) continue;
        const montoRedondeado = Math.round(monto * 100) / 100;
        await api.addDeuda({
          propietario_id: propId,
          periodo,
          monto_usd: montoRedondeado,
          fecha_vencimiento: null,
          recibo_id: reciboId,
          porcentaje_alicuota: (montoRedondeado / totalNeto) * 100
        });
        deudasCreadas++;
      }
      alert(`✅ Recibo creado. Se generaron ${deudasCreadas} deudas.`);
    }

    editandoReciboId = null;
    document.getElementById('modalRecibo').style.display = 'none';
    cargarRecibos();
    if (propiedadSeleccionada) cargarDeudas(propiedadSeleccionada);
    cargarPagosPendientes();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    isSubmitting = false;
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
});

// ==================== EDICIÓN DE RECIBOS ====================
function limpiarModalRecibo() {
  document.getElementById('periodoRecibo').value = '';
  document.getElementById('tasaBCV').value = '';
  document.getElementById('gastosContainer').innerHTML = '';
  document.getElementById('ajustesContainer').innerHTML = '';
  document.getElementById('ajustesEspecificosContainer').innerHTML = '';
  document.getElementById('gruposAlicuotasContainer').innerHTML = '';
  document.getElementById('gastosEspecificosContainer').innerHTML = '';
  document.querySelector('#tablaResumenPropietarios tbody').innerHTML = '';
  document.getElementById('totalGastosUSD').innerText = '0.00';
  document.getElementById('totalNetoUSD').innerText = '0.00';
  document.getElementById('detalleNeto').innerText = '';
  document.getElementById('fechaTasa').innerText = '';
  editandoReciboId = null;
}

async function cargarYEditarRecibo(id) {
  const recibo = await api.getReciboById(id);
  recibo.gastos_generales = parseJSONField(recibo.gastos_generales);
  recibo.alicuotas_grupo = parseJSONField(recibo.alicuotas_grupo);
  recibo.gastos_especificos = parseJSONField(recibo.gastos_especificos);
  recibo.creditos = parseJSONField(recibo.creditos);
  recibo.reversos = parseJSONField(recibo.reversos);
  recibo.ajustes_especificos = parseJSONField(recibo.ajustes_especificos);
  abrirEdicionRecibo(recibo);
}

async function abrirEdicionRecibo(recibo) {
  limpiarModalRecibo();
  editandoReciboId = recibo.id;
  document.getElementById('periodoRecibo').value = recibo.periodo;
  document.getElementById('tasaBCV').value = recibo.tasa_bcv || '';
  currentTasaBCV = recibo.tasa_bcv;
  currentFechaTasa = recibo.fecha_tasa;
  if (recibo.fecha_tasa) {
    document.getElementById('fechaTasa').innerText = `Actualizada: ${new Date(recibo.fecha_tasa).toLocaleDateString('es-ES')}`;
  }
  grupos = await api.getGrupos();

  recibo.gastos_generales.forEach(g => agregarFilaGasto(g.descripcion, g.monto_ves));
  recibo.creditos.forEach(c => agregarFilaAjuste('credito', c.descripcion, c.monto_usd));
  recibo.reversos.forEach(r => agregarFilaAjuste('reverso', r.descripcion, r.monto_usd));
  if (recibo.ajustes_especificos && recibo.ajustes_especificos.length) {
    recibo.ajustes_especificos.forEach(ae => {
      agregarFilaAjusteEspecifico({
        tipo: ae.tipo,
        destino_tipo: ae.destino_tipo,
        destino_id: ae.destino_id,
        monto_usd: ae.monto,
        descripcion: ae.descripcion
      });
    });
  }
  recibo.alicuotas_grupo.forEach(a => agregarGrupoAlicuota(a.grupoId, a.porcentaje));
  recibo.gastos_especificos.forEach(ge => agregarGastoEspecificoPrecargado(ge));

  calcularTotalGastos();
  calcularNetoTotal();
  recalcularTodo();
  document.querySelector('#formRecibo button[type="submit"]').textContent = 'Actualizar Recibo';
  document.getElementById('modalRecibo').style.display = 'block';
}

function agregarGastoEspecificoPrecargado(datos) {
  const container = document.getElementById('gastosEspecificosContainer');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'gasto-especifico-row';
  row.style.display = 'flex'; row.style.gap = '10px'; row.style.alignItems = 'center';
  row.style.marginBottom = '8px'; row.style.backgroundColor = '#e9ecef';
  row.style.padding = '8px'; row.style.borderRadius = '4px'; row.style.flexWrap = 'wrap';

  const selectTipo = document.createElement('select');
  selectTipo.innerHTML = `<option value="grupo" ${datos.tipo === 'grupo' ? 'selected' : ''}>Afecta a un grupo</option>
                          <option value="propietario" ${datos.tipo === 'prop' ? 'selected' : ''}>Afecta a un propietario</option>`;
  const selectDestino = document.createElement('select');
  selectDestino.style.flex = '1';
  const inputDescripcion = document.createElement('input');
  inputDescripcion.type = 'text'; inputDescripcion.value = datos.descripcion || '';
  const inputMontoVES = document.createElement('input');
  inputMontoVES.type = 'number'; inputMontoVES.step = 'any';
  inputMontoVES.className = 'gasto-especifico-monto-ves';
  inputMontoVES.value = datos.monto ? (datos.monto * (currentTasaBCV || 1)).toFixed(2) : '';
  const usdSpan = document.createElement('span');
  usdSpan.className = 'gasto-especifico-usd';
  usdSpan.innerText = datos.monto ? datos.monto.toFixed(2) + ' USD' : '0.00 USD';
  const btnEliminar = document.createElement('button');
  btnEliminar.textContent = '✖'; btnEliminar.style.backgroundColor = '#dc3545';

  async function cargarDestinos() {
    if (selectTipo.value === 'grupo') {
      const gruposList = await api.getGrupos();
      selectDestino.innerHTML = '<option value="">Seleccione grupo</option>' +
        gruposList.map(g => `<option value="grupo_${g.id}" ${datos.tipo === 'grupo' && datos.id === g.id ? 'selected' : ''}>${g.nombre}</option>`).join('');
    } else {
      const props = await api.getPropietarios();
      selectDestino.innerHTML = '<option value="">Seleccione propietario</option>' +
        props.map(p => `<option value="prop_${p.id}" ${datos.tipo === 'prop' && datos.id === p.id ? 'selected' : ''}>${p.nombre} (${p.apartamento})</option>`).join('');
    }
  }
  function actualizarUSD() {
    if (!currentTasaBCV) return;
    const montoVES = parseFloat(inputMontoVES.value) || 0;
    usdSpan.innerText = montoVES > 0 ? (montoVES / currentTasaBCV).toFixed(2) + ' USD' : '0.00 USD';
  }
  selectTipo.addEventListener('change', cargarDestinos);
  cargarDestinos();
  inputMontoVES.addEventListener('input', () => { actualizarUSD(); recalcularTodo(); });
  inputDescripcion.addEventListener('input', () => recalcularTodo());
  selectDestino.addEventListener('change', () => recalcularTodo());
  btnEliminar.addEventListener('click', () => { row.remove(); recalcularTodo(); });

  row.appendChild(selectTipo); row.appendChild(selectDestino); row.appendChild(inputDescripcion);
  row.appendChild(inputMontoVES); row.appendChild(usdSpan); row.appendChild(btnEliminar);
  container.appendChild(row);
}

// ==================== BOTÓN AGREGAR RECIBO Y EVENTOS ====================
document.getElementById('btnAgregarRecibo').addEventListener('click', async () => {
  editandoReciboId = null;
  limpiarModalRecibo();
  agregarFilaGasto();
  try { grupos = await api.getGrupos(); } catch (err) { console.error(err); }
  if (alicuotasPredeterminadas.length > 0) {
    alicuotasPredeterminadas.forEach(item => agregarGrupoAlicuota(item.grupoId, item.porcentaje));
  } else {
    agregarGrupoAlicuota();
  }
  if (!currentTasaBCV) await obtenerTasaBCV();
  else {
    document.getElementById('tasaBCV').value = currentTasaBCV;
    if (currentFechaTasa) document.getElementById('fechaTasa').innerText = `Actualizada: ${new Date(currentFechaTasa).toLocaleDateString('es-ES')}`;
  }
  document.querySelector('#formRecibo button[type="submit"]').textContent = 'Crear Recibo y Deudas';
  document.getElementById('modalRecibo').style.display = 'block';
});

document.getElementById('btnActualizarTasa').addEventListener('click', obtenerTasaBCV);
document.getElementById('btnAgregarGasto').addEventListener('click', () => agregarFilaGasto());
document.getElementById('btnAgregarAjuste').addEventListener('click', () => agregarFilaAjuste());
document.getElementById('btnAgregarGrupoAlicuota').addEventListener('click', () => agregarGrupoAlicuota());
document.getElementById('btnAgregarGastoEspecifico').addEventListener('click', () => agregarGastoEspecifico());
document.getElementById('btnAgregarAjusteEspecifico').addEventListener('click', () => agregarFilaAjusteEspecifico());

// Cerrar modales
document.querySelectorAll('.modal .close').forEach(btn => btn.addEventListener('click', () => btn.closest('.modal').style.display = 'none'));
window.addEventListener('click', (e) => { if (e.target.classList.contains('modal')) e.target.style.display = 'none'; });

// Recalcular automáticamente
document.addEventListener('change', (e) => {
  if (e.target.closest('#gruposAlicuotasContainer, #gastosEspecificosContainer, #gastosContainer, #ajustesContainer, #ajustesEspecificosContainer')) recalcularTodo();
});
document.addEventListener('input', (e) => {
  if (e.target.closest('#gruposAlicuotasContainer, #gastosEspecificosContainer, #gastosContainer, #ajustesContainer, #ajustesEspecificosContainer')) recalcularTodo();
  if (e.target.id === 'tasaBCV' && !isNaN(parseFloat(e.target.value))) {
    currentTasaBCV = parseFloat(e.target.value);
    calcularTotalGastos();
    actualizarUSDEnGastosEspecificos();
    recalcularTodo();
  }
});

// ==================== MODAL VER RECIBO ====================
let modalVerRecibo = null;
function crearModalVerRecibo() {
  if (modalVerRecibo) return;
  modalVerRecibo = document.createElement('div');
  modalVerRecibo.id = 'modalVerRecibo';
  modalVerRecibo.className = 'modal';
  modalVerRecibo.innerHTML = `
    <div class="modal-content" style="width:700px; max-width:95%;">
      <span class="close">&times;</span>
      <h3>Detalles del Recibo</h3>
      <div id="verReciboContent" style="max-height:70vh; overflow-y:auto;"></div>
      <div style="text-align:center; margin-top:15px;">
        <button id="btnImprimirRecibo" style="background:#28a745; color:white; border:none; padding:8px 16px; border-radius:4px;">🖨️ Imprimir / PDF</button>
      </div>
    </div>`;
  document.body.appendChild(modalVerRecibo);
  modalVerRecibo.querySelector('.close').addEventListener('click', () => modalVerRecibo.style.display = 'none');
  window.addEventListener('click', (e) => { if (e.target === modalVerRecibo) modalVerRecibo.style.display = 'none'; });
  document.getElementById('btnImprimirRecibo').addEventListener('click', () => {
    const contenido = document.getElementById('verReciboContent').innerHTML;
    const ventana = window.open('', '_blank', 'width=800,height=600,toolbar=yes,scrollbars=yes');
    if (!ventana) {
      alert('Permite las ventanas emergentes para imprimir el recibo.');
      return;
    }
    ventana.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Recibo de Condominio</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; background: #f4f4f4; }
          .recibo { background: white; border: 1px solid #ccc; padding: 25px; border-radius: 8px; max-width: 800px; margin: auto; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
          .encabezado { text-align: center; margin-bottom: 20px; }
          .encabezado h2 { color: #2c3e50; margin: 0 0 5px 0; }
          .encabezado p { font-size: 14px; color: #555; margin: 3px 0; }
          .encabezado h4 { color: #28a745; margin-top: 10px; }
          h4 { margin-top: 20px; border-bottom: 1px solid #ddd; padding-bottom: 5px; color: #333; }
          table { width: 100%; border-collapse: collapse; margin: 10px 0; }
          th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; font-size: 13px; }
          th { background: #f2f2f2; }
          .footer { margin-top: 30px; font-size: 11px; text-align: center; color: gray; border-top: 1px solid #eee; padding-top: 10px; }
          button { display: block; margin: 20px auto 0; padding: 8px 20px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; }
          button:hover { background: #0056b3; }
          @media print {
            body { background: white; }
            .recibo { box-shadow: none; border: none; }
            button { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="recibo">
          <div class="encabezado">
            <h2>CONJUNTO RESIDENCIAL LA CASONA ETAPA I</h2>
            <p>RIF: J-50286741-4</p>
            <h4>Detalles del Recibo</h4>
          </div>
          ${contenido}
          <div class="footer">Generado el ${new Date().toLocaleString()}</div>
          <button onclick="window.print();">🖨️ Imprimir / Guardar PDF</button>
        </div>
      </body>
      </html>
    `);
    ventana.document.close();
  });
}

async function verRecibo(reciboId) {
  crearModalVerRecibo();
  const recibo = await api.getReciboById(reciboId);
  const gastosGen = parseJSONField(recibo.gastos_generales);
  const especificos = parseJSONField(recibo.gastos_especificos);
  const alicuotas = parseJSONField(recibo.alicuotas_grupo);
  const creditos = parseJSONField(recibo.creditos);
  const reversos = parseJSONField(recibo.reversos);

  let html = `<p><strong>Período:</strong> ${recibo.periodo}</p>
              <p><strong>Total neto:</strong> $${(recibo.monto_usd||0).toFixed(2)}</p>`;

  html += `<h4>📋 Gastos generales</h4>`;
  if (gastosGen.length) {
    html += `<table style="width:100%; border-collapse:collapse;"><tr style="background:#f2f2f2;"><th>Descripción</th><th>Monto Bs</th><th>Monto USD</th></tr>`;
    gastosGen.forEach(g => html += `<tr><td>${g.descripcion}</td><td>${(g.monto_ves||0).toFixed(2)}</td><td>$${(g.monto_usd||0).toFixed(2)}</td></tr>`);
    html += `</table>`;
  } else html += `<p>Sin desglose.</p>`;

  if (creditos.length) {
    html += `<h4>💰 Créditos globales</h4><table style="width:100%; border-collapse:collapse;"><tr style="background:#d4edda;"><th>Descripción</th><th>Monto USD</th></tr>`;
    creditos.forEach(c => html += `<tr><td>${c.descripcion}</td><td>$${(c.monto_usd||0).toFixed(2)}</td></tr>`);
    html += `</table>`;
  }
  if (reversos.length) {
    html += `<h4>↩️ Reversos globales</h4><table style="width:100%; border-collapse:collapse;"><tr style="background:#fff3cd;"><th>Descripción</th><th>Monto USD</th></tr>`;
    reversos.forEach(r => html += `<tr><td>${r.descripcion}</td><td>$${(r.monto_usd||0).toFixed(2)}</td></tr>`);
    html += `</table>`;
  }

  html += `<h4>🏢 Distribución por grupos</h4>`;
  if (alicuotas.length) {
    const totalNeto = recibo.monto_usd || 0;
    const porGrupo = new Map();
    especificos.forEach(ge => { if (ge.tipo==='grupo') porGrupo.set(ge.id, (porGrupo.get(ge.id)||0) + (ge.monto||0)); });
    html += `<table style="width:100%; border-collapse:collapse;"><tr style="background:#f2f2f2;"><th>Grupo</th><th>%</th><th>Monto base</th><th>Específicos</th><th>Total</th></tr>`;
    alicuotas.forEach(a => {
      const grupo = grupos.find(g => g.id === a.grupoId);
      const base = totalNeto * (a.porcentaje/100);
      const extra = porGrupo.get(a.grupoId) || 0;
      html += `<tr><td>${grupo?.nombre || a.grupoId}</td><td>${a.porcentaje.toFixed(3)}%</td><td>$${base.toFixed(2)}</td><td>$${extra.toFixed(2)}</td><td><strong>$${(base+extra).toFixed(2)}</strong></td></tr>`;
    });
    html += `</table>`;
  } else html += `<p>No hay distribución.</p>`;

  if (especificos.length) {
    html += `<h4>🎯 Gastos específicos</h4><table style="width:100%; border-collapse:collapse;"><tr style="background:#f2f2f2;"><th>Descripción</th><th>Afecta a</th><th>Monto USD</th></tr>`;
    especificos.forEach(ge => {
      let destino = ge.tipo==='grupo' ? `Grupo ${ge.id}` : `Propietario ${ge.id}`;
      html += `<tr><td>${ge.descripcion||'—'}</td><td>${destino}</td><td>$${(ge.monto||0).toFixed(2)}</td></tr>`;
    });
    html += `</table>`;
  }

  document.getElementById('verReciboContent').innerHTML = html;
  modalVerRecibo.style.display = 'block';
}

// ==================== CARGAR RECIBOS ====================
async function cargarRecibos() {
  const tbody = document.querySelector('#tablaRecibos tbody');
  if (!tbody) return;
  tbody.innerHTML = '<td colspan="4">Cargando...</td>';
  try {
    recibos = await api.getRecibos();
    tbody.innerHTML = '';
    for (const r of recibos) {
      const grupo = grupos.find(g => g.id === r.grupo_id);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${r.periodo}</td>
        <td>$${r.monto_usd.toFixed(2)}</td>
        <td>${grupo?.nombre || 'Todos'}</td>
        <td>
          <button onclick="verRecibo(${r.id})" style="background:#17a2b8;">Ver</button>
          <button onclick="cargarYEditarRecibo(${r.id})" style="background:#ffc107; margin-left:5px;">Editar</button>
        </td>`;
      tbody.appendChild(tr);
    }
  } catch (err) {
    tbody.innerHTML = `<td colspan="4">Error: ${err.message}</td>`;
  }
}
window.verRecibo = verRecibo;
window.cargarYEditarRecibo = cargarYEditarRecibo;

// ==================== DEUDAS POR PROPIEDAD ====================
async function cargarGruposParaDeudas() {
  const container = document.getElementById('gruposContainer');
  if (!container) return;
  const lista = await api.getGrupos();
  grupos = lista;
  container.innerHTML = '';
  const sinGrupo = document.createElement('div'); sinGrupo.className = 'group-tab';
  sinGrupo.style.backgroundColor = grupoSeleccionado === null ? '#007bff' : '#6c757d';
  const btnSG = document.createElement('button'); btnSG.textContent = 'Sin grupo'; btnSG.style.backgroundColor = 'transparent';
  btnSG.addEventListener('click', () => seleccionarGrupoDeuda(null));
  sinGrupo.appendChild(btnSG); container.appendChild(sinGrupo);
  lista.forEach(g => {
    const tab = document.createElement('div'); tab.className = 'group-tab';
    tab.style.backgroundColor = grupoSeleccionado === g.id ? '#007bff' : '#6c757d';
    const btn = document.createElement('button'); btn.textContent = g.nombre; btn.style.backgroundColor = 'transparent';
    btn.addEventListener('click', () => seleccionarGrupoDeuda(g.id));
    tab.appendChild(btn); container.appendChild(tab);
  });
  if (grupoSeleccionado === null) seleccionarGrupoDeuda(null);
}

async function seleccionarGrupoDeuda(grupoId) {
  grupoSeleccionado = grupoId;
  const lista = await api.getGrupos();
  document.querySelectorAll('#gruposContainer .group-tab').forEach(tab => {
    const btn = tab.querySelector('button');
    const isSinGrupo = btn.textContent === 'Sin grupo';
    if (isSinGrupo && grupoId === null) tab.style.backgroundColor = '#007bff';
    else if (!isSinGrupo) {
      const g = lista.find(g => g.nombre === btn.textContent);
      tab.style.backgroundColor = (g && g.id === grupoId) ? '#007bff' : '#6c757d';
    } else tab.style.backgroundColor = '#6c757d';
  });
  await cargarPropiedadesDeuda(grupoId);
}

async function cargarPropiedadesDeuda(grupoId) {
  const container = document.getElementById('propiedadesContainer');
  if (!container) return;
  container.innerHTML = '';
  const todos = await api.getPropietarios();
  propietarios = todos;
  const filtrados = grupoId === null ? todos.filter(p => p.grupo_id === null) : todos.filter(p => p.grupo_id === grupoId);
  if (!filtrados.length) {
    container.innerHTML = '<p>No hay propiedades en este grupo.</p>';
    document.getElementById('deudasTableContainer').style.display = 'none';
    return;
  }
  for (let i = 0; i < filtrados.length; i += 4) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:5px; margin-bottom:5px; flex-wrap:wrap;';
    filtrados.slice(i, i+4).forEach(prop => {
      const btn = document.createElement('button');
      btn.textContent = prop.apartamento;
      btn.style.backgroundColor = '#6c757d';
      btn.addEventListener('click', () => seleccionarPropiedadDeuda(prop.id));
      row.appendChild(btn);
    });
    container.appendChild(row);
  }
  if (propiedadSeleccionada && filtrados.some(p => p.id === propiedadSeleccionada)) {
    const prop = filtrados.find(p => p.id === propiedadSeleccionada);
    document.querySelectorAll('#propiedadesContainer button').forEach(b => {
      if (b.textContent === prop.apartamento) b.style.backgroundColor = '#007bff';
    });
  } else if (filtrados.length) {
    seleccionarPropiedadDeuda(filtrados[0].id);
  }
}

async function seleccionarPropiedadDeuda(propId) {
  propiedadSeleccionada = propId;
  document.querySelectorAll('#propiedadesContainer button').forEach(b => {
    b.style.backgroundColor = b.textContent === propietarios.find(p => p.id === propId)?.apartamento ? '#007bff' : '#6c757d';
  });
  await cargarDeudas(propId);
  await actualizarSaldoPropietario(propId);
  document.getElementById('deudasTableContainer').style.display = 'block';
}

async function cargarDeudas(propId) {
  const tbody = document.querySelector('#tablaDeudas tbody');
  if (!tbody) return;
  tbody.innerHTML = '<td colspan="6">Cargando...</td>';
  try {
    const deudas = await api.getDeudasByPropietario(propId);
    deudasGlobal = deudas;
    tbody.innerHTML = '';
    if (!deudas.length) {
      tbody.innerHTML = '<td colspan="6">No hay deudas registradas.</td>';
      return;
    }
    deudas.forEach(d => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${d.periodo}</td><td>$${d.monto_usd.toFixed(2)}</td>
        <td>${formatearFecha(d.fecha_vencimiento)}</td>
        <td class="${d.pagado ? 'verificado' : 'pendiente'}">${d.pagado ? 'Pagada' : 'Pendiente'}</td>
        <td>${formatearFecha(d.fecha_pago)}</td><td>${d.referencia_pago || '—'}</td>`;
      tbody.appendChild(tr);
    });
  } catch (e) { tbody.innerHTML = `<td colspan="6">Error: ${e.message}</td>`; }
}

async function actualizarSaldoPropietario(propId) {
  const prop = await api.getPropietarioById(propId);
  if (!prop) return;
  const deudas = await api.getDeudasByPropietario(propId);
  const totalDeuda = deudas.reduce((s, d) => s + (d.pagado ? 0 : d.monto_usd), 0);
  const saldoNeto = (prop.saldo_favor || 0) - totalDeuda;
  const el = document.getElementById('saldoNetoPropiedad');
  if (el) {
    el.textContent = saldoNeto >= 0 ? `$${saldoNeto.toFixed(2)} (Saldo a favor)` : `-$${Math.abs(saldoNeto).toFixed(2)} (Deuda)`;
    el.style.color = saldoNeto >= 0 ? 'green' : 'red';
  }
}

// Modal deuda (agregar manual)
const modalDeuda = document.getElementById('modalDeuda');
document.getElementById('btnAgregarDeuda').addEventListener('click', async () => {
  if (!propiedadSeleccionada) return alert('Seleccione una propiedad primero');
  const props = await api.getPropietarios();
  document.getElementById('propietarioSelect').innerHTML = '<option value="">Seleccionar</option>' +
    props.map(p => `<option value="${p.id}" ${p.id===propiedadSeleccionada?'selected':''}>${p.nombre} (${p.apartamento})</option>`).join('');
  document.getElementById('periodo').value = '';
  document.getElementById('montoUSD').value = '';
  document.getElementById('fechaVencimiento').value = '';
  modalDeuda.style.display = 'block';
});
document.querySelector('#modalDeuda .close').addEventListener('click', () => modalDeuda.style.display = 'none');
window.addEventListener('click', e => { if (e.target === modalDeuda) modalDeuda.style.display = 'none'; });
document.getElementById('formDeuda').addEventListener('submit', async (e) => {
  e.preventDefault();
  const prop_id = +document.getElementById('propietarioSelect').value;
  const periodo = document.getElementById('periodo').value;
  const monto = parseFloat(document.getElementById('montoUSD').value);
  const venc = document.getElementById('fechaVencimiento').value || null;
  if (!prop_id || !periodo || isNaN(monto) || monto <= 0) return alert('Datos inválidos');
  await api.addDeuda({ propietario_id: prop_id, periodo, monto_usd: monto, fecha_vencimiento: venc });
  modalDeuda.style.display = 'none';
  if (propiedadSeleccionada === prop_id) cargarDeudas(prop_id);
});

// ==================== PAGOS PENDIENTES ====================
async function cargarPagosPendientes() {
  const tbody = document.querySelector('#tablaPagos tbody');
  if (!tbody) return;
  tbody.innerHTML = '<td colspan="6">Cargando...</td>';
  try {
    const pagos = await api.getPagosPendientes();
    tbody.innerHTML = '';
    pagos.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${p.propietario_nombre} (${p.apartamento})</td>
        <td>${formatearFecha(p.fecha_pago)}</td><td>${(p.monto_bs||0).toFixed(2)}</td>
        <td>${p.referencia||'—'}</td><td>${(p.tasa_bcv||0).toFixed(2)}</td>
        <td><button class="btn-verificar" onclick="verificarPago(${p.id})">Verificar</button></td>`;
      tbody.appendChild(tr);
    });
  } catch (e) { tbody.innerHTML = `<td colspan="6">Error: ${e.message}</td>`; }
}
window.verificarPago = async (id) => {
  await api.verificarPago(id);
  alert('Pago verificado');
  cargarPagosPendientes();
  if (propiedadSeleccionada) cargarDeudas(propiedadSeleccionada);
};

// ==================== CONFIGURACIÓN PREDETERMINADA ====================
function cargarConfiguracionDesdeStorage() {
  const stored = localStorage.getItem('alicuotasPredeterminadas');
  alicuotasPredeterminadas = stored ? JSON.parse(stored) : [];
}
function guardarConfiguracionEnStorage(config) {
  localStorage.setItem('alicuotasPredeterminadas', JSON.stringify(config));
  alicuotasPredeterminadas = config;
}
async function renderizarModalConfigPredeterminadas() {
  const cont = document.getElementById('predetGruposContainer');
  if (!cont) return;
  if (!grupos.length) grupos = await api.getGrupos();
  cont.innerHTML = '';
  const datos = alicuotasPredeterminadas.length ? alicuotasPredeterminadas : [{ grupoId: '', porcentaje: '' }];
  datos.forEach(d => agregarFilaGrupoPredet(d.grupoId, d.porcentaje));
  validarSumaPredeterminadas();
}
function agregarFilaGrupoPredet(grupoId = '', porcentaje = '') {
  const cont = document.getElementById('predetGruposContainer');
  if (!cont) return;
  const row = document.createElement('div');
  row.className = 'grupo-alicuota-row';
  const select = document.createElement('select');
  select.innerHTML = '<option value="">Seleccione grupo</option>' +
    grupos.map(g => `<option value="${g.id}" ${grupoId==g.id?'selected':''}>${g.nombre}</option>`).join('');
  const input = document.createElement('input');
  input.type = 'number'; input.step = '0.001'; input.placeholder = '%'; input.value = porcentaje;
  input.addEventListener('input', validarSumaPredeterminadas);
  select.addEventListener('change', validarSumaPredeterminadas);
  const btnEliminar = document.createElement('button');
  btnEliminar.textContent = '✖'; btnEliminar.style.backgroundColor = '#dc3545';
  btnEliminar.addEventListener('click', () => { row.remove(); validarSumaPredeterminadas(); });
  row.appendChild(select); row.appendChild(input); row.appendChild(btnEliminar);
  cont.appendChild(row);
}
function validarSumaPredeterminadas() {
  let suma = 0;
  document.querySelectorAll('#predetGruposContainer input[type="number"]').forEach(inp => suma += parseFloat(inp.value) || 0);
  const msg = document.getElementById('sumaPredetMsg');
  if (!msg) return false;
  const ok = Math.abs(suma - 100) < 0.001;
  msg.innerHTML = ok ? `✅ Suma correcta: 100%` : `⚠️ La suma es ${suma.toFixed(3)}%. Debe ser 100%.`;
  msg.style.color = ok ? 'green' : 'orange';
  return ok;
}
function obtenerConfiguracionDesdeModal() {
  const config = [];
  document.querySelectorAll('#predetGruposContainer .grupo-alicuota-row').forEach(row => {
    const select = row.querySelector('select');
    const input = row.querySelector('input[type="number"]');
    if (select?.value && input?.value) config.push({ grupoId: +select.value, porcentaje: +input.value });
  });
  return config;
}
function aplicarAlícuotasPredeterminadas() {
  if (!alicuotasPredeterminadas.length) return alert('No hay predeterminadas guardadas.');
  document.getElementById('gruposAlicuotasContainer').innerHTML = '';
  alicuotasPredeterminadas.forEach(a => agregarGrupoAlicuota(a.grupoId, a.porcentaje));
  recalcularTodo();
  validarSumaAlicuotas();
}

// Eventos de configuración
document.getElementById('btnConfigurarPredeterminadas').addEventListener('click', async () => {
  await renderizarModalConfigPredeterminadas();
  document.getElementById('modalConfigPredeterminadas').style.display = 'block';
});
document.querySelector('#modalConfigPredeterminadas .close').addEventListener('click', () => {
  document.getElementById('modalConfigPredeterminadas').style.display = 'none';
});
document.getElementById('btnCerrarModalPredet').addEventListener('click', () => {
  document.getElementById('modalConfigPredeterminadas').style.display = 'none';
});
document.getElementById('btnAgregarGrupoPredet').addEventListener('click', () => agregarFilaGrupoPredet());
document.getElementById('btnGuardarPredeterminadas').addEventListener('click', () => {
  if (!validarSumaPredeterminadas()) return alert('La suma debe ser 100%');
  guardarConfiguracionEnStorage(obtenerConfiguracionDesdeModal());
  document.getElementById('modalConfigPredeterminadas').style.display = 'none';
  alert('Configuración guardada.');
});
document.getElementById('btnUsarPredeterminadas').addEventListener('click', aplicarAlícuotasPredeterminadas);

// ==================== INICIALIZACIÓN ====================
document.addEventListener('DOMContentLoaded', async () => {
  const token = localStorage.getItem('token');
  if (!token || localStorage.getItem('rol') !== 'master') {
    localStorage.clear();
    window.location.href = '/login.html';
    return;
  }
  try { await api.getGrupos(); } catch (e) { return; }
  cargarConfiguracionDesdeStorage();
  await cargarGruposParaDeudas();
  await cargarRecibos();
  cargarPagosPendientes();
  obtenerTasaBCV();
});

// Logout
document.getElementById('logout').addEventListener('click', () => {
  localStorage.clear();
  window.location.href = '/login.html';
});