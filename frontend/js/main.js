// ============================================================================
// SAETracker - Lógica Principal (frontend/js/main.js)
// ============================================================================

// URL del backend (Producción en Render)
// Para desarrollo local, cambia esta línea por: 'http://localhost:3000/api'
const API_BASE_URL = 'https://saetracker.onrender.com/api';

// ============================================================================
// 1. ESTADO GLOBAL
// ============================================================================
let equipoSeleccionado = '';
let movimientosGlobales = [];
let trazabilidadGlobal = [];
let ultimaReferencia = '';
let contenedorSeleccionado = null;

// ============================================================================
// 2. UTILIDADES (HELPERS)
// ============================================================================

// Lee fechas tanto si vienen como string (trazabilidad) o como objeto { at } (movimientos)
const getAt = (val) => (val && typeof val === 'object') ? val.at : (val || null);

// Normaliza textos para comparaciones seguras de lugares
const normalizarTexto = (txt) => (txt || '').trim().toUpperCase();

// Formatea fecha y hora para los hitos del Timeline
function formatearFechaHora(str) {
    if (!str) return 'Pendiente de registro';
    const d = new Date(str);
    if (isNaN(d.getTime())) return 'Pendiente de registro';

    const fecha = d.toLocaleDateString('es-CL');
    const hora = d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
    return `<span class="text-slate-800 font-medium">${fecha}</span> - ${hora}`;
}

// Calcula la estadía en planta desde la llegada hasta la salida (o en curso)
function calcularEstadiaPlanta(llegadaStr, salidaStr, tienePlanta) {
    if (!tienePlanta) return { texto: 'N/A', enCurso: false, esNA: true };
    if (!llegadaStr) return { texto: 'Pendiente', enCurso: false, esNA: false };

    const llegada = new Date(llegadaStr);
    if (isNaN(llegada.getTime())) return { texto: 'Pendiente', enCurso: false, esNA: false };

    let fin;
    let enCurso = false;

    if (salidaStr) {
        fin = new Date(salidaStr);
        if (isNaN(fin.getTime())) return { texto: 'Pendiente', enCurso: false, esNA: false };
    } else {
        // Si llegó a planta pero aún no registra salida, calcula el tiempo acumulado actual
        fin = new Date();
        enCurso = true;
    }

    const diffMin = Math.floor((fin - llegada) / 60000);
    if (diffMin < 0) {
        return { texto: enCurso ? 'Pendiente' : 'Revisar fechas', enCurso: false, esNA: false };
    }

    const horas = Math.floor(diffMin / 60);
    const minutos = diffMin % 60;
    const formato = `${horas}h ${String(minutos).padStart(2, '0')}m`;

    return {
        texto: enCurso ? `En curso (${formato})` : formato,
        enCurso,
        esNA: false
    };
}

// ============================================================================
// 3. CONSULTA A GOTRUCK Y RECARGA DE DATOS
// ============================================================================

async function buscarReserva(referenciaForzada = null, esRecarga = false) {
    const input = (referenciaForzada ?? document.getElementById('bookingInput').value).trim();
    if (input === '') {
        return alert('Por favor ingrese un número de reserva o servicio.');
    }

    const btn = document.getElementById('btnSearch');
    const btnRecargar = document.getElementById('btnRecargar');
    const iconoRecargar = document.getElementById('iconoRecargar');

    // Recordar si el usuario tenía abierto el tracking y el mapa antes de recargar
    const trackingEstabaAbierto = esRecarga && !document.getElementById('trackingSection').classList.contains('hidden');
    const mapaEstabaAbierto = trackingEstabaAbierto && !document.getElementById('mapSection').classList.contains('hidden');

    if (esRecarga && btnRecargar) {
        btnRecargar.disabled = true;
        iconoRecargar?.classList.add('animate-spin');
    } else {
        btn.innerHTML = `
            <svg class="animate-spin h-5 w-5 mx-auto text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>`;
        btn.disabled = true;
    }

    try {
        const respuesta = await fetch(`${API_BASE_URL}/gotruck?referencia=${encodeURIComponent(input)}`);
        const datos = await respuesta.json();

        if (respuesta.ok && datos.existe) {
            ultimaReferencia = input;

            document.getElementById('searchSection').classList.add('hidden');
            document.getElementById('resultsSection').classList.remove('hidden');
            if (!trackingEstabaAbierto) {
                document.getElementById('trackingSection').classList.add('hidden');
            }

            const cabecera = datos.cabecera || {};
            const infoContenedor = datos.contenedor || {};
            document.getElementById('displayBooking').innerText = cabecera.shipment || input.toUpperCase();

            // Mostrar hora de última actualización
            const horaAct = new Date().toLocaleTimeString('es-CL', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            const lblAct = document.getElementById('ultimaActualizacion');
            if (lblAct) lblAct.innerText = `• Actualizado a las ${horaAct}`;

            const tbody = document.getElementById('tablaPatentes');
            tbody.innerHTML = '';

            // Agrupar movimientos por contenedor y por etapa (filtro anti-enroques)
            const contenedoresMap = {};
            (datos.movimientos || []).forEach(mov => {
                const claveCont = (mov.container && mov.container !== 'N/D')
                    ? mov.container.trim()
                    : `SIN_CONT_${mov.movement_id}`;

                if (!contenedoresMap[claveCont]) {
                    contenedoresMap[claveCont] = {};
                }

                const claveEtapa = mov.status_id || mov.status_label || mov.movement_id;
                if (!contenedoresMap[claveCont][claveEtapa] || mov.movement_id > contenedoresMap[claveCont][claveEtapa].movement_id) {
                    contenedoresMap[claveCont][claveEtapa] = mov;
                }
            });

            // Construir 1 registro consolidado por contenedor
            movimientosGlobales = Object.values(contenedoresMap).map(etapasObj => {
                const tramos = Object.values(etapasObj).sort((a, b) => a.movement_id - b.movement_id);
                const tramoInicial = tramos[0];
                const tramoActual = tramos[tramos.length - 1];

                const esMismoCont = infoContenedor.container === tramoActual.container;
                const pickupPlace = esMismoCont ? infoContenedor.pickup?.place : null;
                const deliveryPlace = esMismoCont ? infoContenedor.delivery?.place : null;
                const returnPlace = esMismoCont ? infoContenedor.return?.place : null;

                const origen = pickupPlace || tramoInicial.origin?.name || '-';
                const destino = returnPlace || tramoActual.destination?.name || deliveryPlace || '-';

                // Detectar si existe realmente una parada intermedia (planta)
                let planta = null;
                if (tramos.length >= 2) {
                    const candidata = deliveryPlace || tramoInicial.destination?.name;
                    if (candidata && normalizarTexto(candidata) !== normalizarTexto(origen) && normalizarTexto(candidata) !== normalizarTexto(destino)) {
                        planta = candidata;
                    }
                } else if (deliveryPlace && returnPlace && normalizarTexto(deliveryPlace) !== normalizarTexto(origen) && normalizarTexto(deliveryPlace) !== normalizarTexto(destino)) {
                    planta = deliveryPlace;
                }

                // Extraer hitos de planta evitando fechas inconsistentes del tramo 1
                const tienePlanta = Boolean(planta) && tramos.length >= 2;
                let llegadaPlanta = null;
                let salidaPlanta = null;

                if (tienePlanta) {
                    const t1m = tramos[0].milestones || {};
                    const t2m = tramos[tramos.length - 1].milestones || {};
                    llegadaPlanta = getAt(t2m.arrival_origin) || getAt(t1m.arrival_destination);

                    const salT2 = getAt(t2m.departure_origin);
                    const salT1 = getAt(t1m.departure_destination);
                    if (salT2) {
                        salidaPlanta = salT2;
                    } else if (salT1 && (!llegadaPlanta || new Date(salT1) >= new Date(llegadaPlanta))) {
                        salidaPlanta = salT1;
                    }
                }

                const estadia = calcularEstadiaPlanta(llegadaPlanta, salidaPlanta, tienePlanta);

                return {
                    ...tramoActual,
                    _clave: tramoActual.container || String(tramoActual.movement_id),
                    _tramos: tramos,
                    _ruta: { origen, planta, destino },
                    _hitosPlanta: { llegada: llegadaPlanta, salida: salidaPlanta },
                    _estadia: estadia
                };
            });

            trazabilidadGlobal = datos.trazabilidad || [];

            let filaARestaurar = null;

            movimientosGlobales.forEach((mov, index) => {
                let fechaRetiro = '-';
                const rawDate = infoContenedor.pickup?.scheduled_at
                    || infoContenedor.pickup_at
                    || mov._tramos[0]?.start_at
                    || cabecera.containers?.[0]?.pickup_at;

                if (rawDate) {
                    fechaRetiro = new Date(rawDate).toLocaleDateString('es-CL');
                }

                const traceTabla = trazabilidadGlobal.find(t => t.container === mov.container) || trazabilidadGlobal[0] || {};
                const estadoLabel = traceTabla.status_label || mov.state_label || 'Pendiente';

                const estadiaHtml = mov._estadia.esNA
                    ? `<span class="text-slate-400">N/A</span>`
                    : mov._estadia.enCurso
                        ? `<span class="text-amber-600 font-semibold">${mov._estadia.texto}</span>`
                        : `<span class="font-semibold text-slate-800">${mov._estadia.texto}</span>`;

                const tr = document.createElement('tr');
                tr.className = 'hover:bg-slate-50 cursor-pointer transition-colors';
                tr.onclick = function () {
                    mostrarTracking(index, mov.truck || 'N/D', mov.ramp || 'N/D', this);
                };

                tr.innerHTML = `
                    <td class="px-4 py-4 text-slate-400 font-medium">${index + 1}</td>
                    <td class="px-4 py-4 font-medium text-slate-800">${mov.service_id || cabecera.service_id || '-'}</td>
                    <td class="px-4 py-4">${fechaRetiro}</td>
                    <td class="px-4 py-4">${mov._ruta.origen}</td>
                    <td class="px-4 py-4">${mov._ruta.planta || '<span class="text-slate-400">N/A</span>'}</td>
                    <td class="px-4 py-4">${estadiaHtml}</td>
                    <td class="px-4 py-4">${mov._ruta.destino}</td>
                    <td class="px-4 py-4">${mov.driver?.name || 'SIN ASIGNAR'}</td>
                    <td class="px-4 py-4 font-medium">${mov.truck || '-'}</td>
                    <td class="px-4 py-4 text-slate-500">${mov.ramp || '-'}</td>
                    <td class="px-4 py-4 text-slate-500">${mov.container || infoContenedor.container || '-'}</td>
                    <td class="px-4 py-4 text-right text-sae-blue font-medium">${estadoLabel}</td>
                `;
                tbody.appendChild(tr);

                if (trackingEstabaAbierto && contenedorSeleccionado && mov._clave === contenedorSeleccionado) {
                    filaARestaurar = { index, mov, tr };
                }
            });

            // Si estaba viendo el tracking de una unidad, actualizarlo automáticamente tras recargar
            if (filaARestaurar) {
                mostrarTracking(
                    filaARestaurar.index,
                    filaARestaurar.mov.truck || 'N/D',
                    filaARestaurar.mov.ramp || 'N/D',
                    filaARestaurar.tr,
                    true
                );
                if (mapaEstabaAbierto) {
                    mostrarMapa();
                }
            }
        } else {
            alert(datos.error ? `Error: ${datos.error}` : 'No se encontraron registros activos para esta reserva.');
        }
    } catch (error) {
        console.error('Error consultando GoTruck:', error);
        alert('Fallo de conexión.');
    } finally {
        if (esRecarga && btnRecargar) {
            btnRecargar.disabled = false;
            iconoRecargar?.classList.remove('animate-spin');
        } else {
            btn.innerText = 'Buscar';
            btn.disabled = false;
        }
    }
}

async function recargarDatos() {
    if (!ultimaReferencia) return;
    await buscarReserva(ultimaReferencia, true);
}

// ============================================================================
// 4. TRAZABILIDAD (TIMELINE)
// ============================================================================

function mostrarTracking(index, patenteCamion, patenteEquipo, elemento, silencioso = false) {
    const mov = movimientosGlobales[index];
    if (!mov) return;

    document.querySelectorAll('#tablaPatentes tr').forEach(f => f.classList.remove('table-row-active'));
    elemento.classList.add('table-row-active');

    contenedorSeleccionado = mov._clave;
    equipoSeleccionado = patenteEquipo;

    document.getElementById('displayPlate').innerText = `Camión: ${patenteCamion} | Equipo: ${patenteEquipo}`;

    generarTimeline(mov);

    document.getElementById('trackingSection').classList.remove('hidden');

    // Resetear estado del mapa al cambiar de fila
    const mapSection = document.getElementById('mapSection');
    mapSection.classList.add('hidden');
    mapSection.innerHTML = '';

    if (!silencioso) {
        document.getElementById('trackingSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function generarTimeline(mov) {
    const trace = trazabilidadGlobal.find(t => t.container === mov.container) || trazabilidadGlobal[0] || {};
    const tramos = mov._tramos || [mov];
    const tienePlanta = Boolean(mov._ruta?.planta) && tramos.length >= 2;

    let pasos = [];

    if (tienePlanta) {
        const t1 = tramos[0].milestones || {};
        const t2 = tramos[tramos.length - 1].milestones || {};
        const tm = trace.milestones || {};

        pasos = [
            {
                titulo: 'Llegada a Origen',
                lugar: mov._ruta?.origen,
                fecha: getAt(t1.arrival_origin) || getAt(tm.arrival_origin)
            },
            {
                titulo: 'Salida de Origen',
                lugar: '',
                fecha: getAt(t1.departure_origin) || getAt(tm.departure_origin)
            },
            {
                titulo: 'Llegada a Planta',
                lugar: mov._ruta?.planta,
                fecha: mov._hitosPlanta?.llegada || getAt(t2.arrival_origin) || getAt(t1.arrival_destination)
            },
            {
                titulo: 'Salida de Planta',
                lugar: '',
                fecha: mov._hitosPlanta?.salida || getAt(t2.departure_origin),
                mostrarEstadia: true
            },
            {
                titulo: 'Llegada a Destino',
                lugar: mov._ruta?.destino,
                fecha: getAt(t2.arrival_destination) || getAt(tm.arrival_destination)
            },
            {
                titulo: 'Salida de Destino',
                lugar: '',
                fecha: getAt(t2.departure_destination) || getAt(tm.departure_destination)
            }
        ];
    } else {
        const tm = trace.milestones || {};
        const m = mov.milestones || {};

        pasos = [
            {
                titulo: 'Llegada a Origen',
                lugar: mov._ruta?.origen,
                fecha: getAt(tm.arrival_origin) || getAt(m.arrival_origin)
            },
            {
                titulo: 'Salida de Origen',
                lugar: '',
                fecha: getAt(tm.departure_origin) || getAt(m.departure_origin)
            },
            {
                titulo: 'Llegada a Destino',
                lugar: mov._ruta?.destino,
                fecha: getAt(tm.arrival_destination) || getAt(m.arrival_destination)
            },
            {
                titulo: 'Salida de Destino',
                lugar: '',
                fecha: getAt(tm.departure_destination) || getAt(m.departure_destination)
            }
        ];
    }

    const terminado = trace.status === 'finalizado' || Boolean(pasos[pasos.length - 1].fecha);

    document.getElementById('contenedorTimeline').innerHTML = pasos.map((paso, i) => {
        const esUltimo = i === pasos.length - 1;
        const completado = esUltimo
            ? terminado
            : Boolean(paso.fecha) && (Boolean(pasos[i + 1].fecha) || terminado);
        const actual = !completado && Boolean(paso.fecha);
        const clase = completado ? 'completed' : (actual ? 'current' : '');

        const badgeEstadia = (paso.mostrarEstadia && mov._estadia && !mov._estadia.esNA)
            ? `<span class="inline-block mt-1.5 px-2.5 py-0.5 text-[11px] font-semibold rounded-full ${
                mov._estadia.enCurso
                    ? 'bg-amber-50 text-amber-700 border border-amber-200'
                    : 'bg-blue-50 text-sae-blue border border-blue-100'
              }">⏱️ Estadía en planta: ${mov._estadia.texto}</span>`
            : '';

        return `
            <div class="timeline-step relative pl-10 ${esUltimo ? 'mb-2' : 'mb-7'} ${clase}">
                <p class="text-sm font-bold text-slate-700 m-0">${paso.titulo}</p>
                ${paso.lugar && paso.lugar !== '-' ? `<p class="text-[11px] text-slate-400 mt-0.5 truncate" title="${paso.lugar}">${paso.lugar}</p>` : ''}
                <p class="text-xs text-slate-500 mt-1">${formatearFechaHora(paso.fecha)}</p>
                ${badgeEstadia}
            </div>
        `;
    }).join('');
}

// ============================================================================
// 5. POSICIONAMIENTO GPS (THK TRACKING)
// ============================================================================

async function mostrarMapa() {
    const mapSec = document.getElementById('mapSection');
    mapSec.classList.remove('hidden');

    if (!equipoSeleccionado || equipoSeleccionado === 'N/D' || equipoSeleccionado === '-') {
        mapSec.innerHTML = `<div class="w-full py-12 text-center bg-slate-50 rounded-xl text-slate-500 text-sm font-medium">No hay Patente de Equipos asignada para consultar GPS.</div>`;
        return;
    }

    mapSec.innerHTML = `<div class="w-full py-12 text-center bg-slate-50 rounded-xl text-sae-blue text-sm font-medium animate-pulse">Obteniendo coordenadas satelitales para ${equipoSeleccionado}...</div>`;

    try {
        const res = await fetch(`${API_BASE_URL}/thk?name=${encodeURIComponent(equipoSeleccionado)}`);
        const data = await res.json();

        if (res.ok && data.lat && data.lng) {
            const f = data.fecha ? new Date(data.fecha) : null;
            const fechaTxt = (f && !isNaN(f))
                ? `${f.toLocaleDateString('es-CL')} - ${f.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}`
                : 'Reciente';

            mapSec.innerHTML = `
                <div class="rounded-xl overflow-hidden border border-slate-200 mt-4">
                    <div class="bg-slate-50 border-b border-slate-200 p-3 flex justify-between items-center text-xs">
                        <span class="font-bold text-slate-700">📍 ${data.name}</span>
                        <span class="text-slate-500">Última lectura: ${fechaTxt}</span>
                    </div>
                    <iframe
                        width="100%"
                        height="350"
                        frameborder="0"
                        src="https://maps.google.com/maps?q=${data.lat},${data.lng}&hl=es&z=15&output=embed">
                    </iframe>
                </div>
            `;
        } else {
            mapSec.innerHTML = `<div class="w-full py-12 text-center bg-red-50 rounded-xl text-red-500 text-sm font-medium">No se encontró señal GPS activa para el equipo ${equipoSeleccionado}.</div>`;
        }
    } catch (error) {
        console.error('Error consultando THK:', error);
        mapSec.innerHTML = `<div class="w-full py-12 text-center bg-red-50 rounded-xl text-red-500 text-sm font-medium">Error de conexión con el proveedor GPS.</div>`;
    }
}

// ============================================================================
// 6. NAVEGACIÓN Y PORTAPAPELES
// ============================================================================

function volverInicio() {
    document.getElementById('resultsSection').classList.add('hidden');
    document.getElementById('trackingSection').classList.add('hidden');
    document.getElementById('mapSection').classList.add('hidden');
    document.getElementById('searchSection').classList.remove('hidden');

    document.getElementById('bookingInput').value = '';
    const lblAct = document.getElementById('ultimaActualizacion');
    if (lblAct) lblAct.innerText = '';

    ultimaReferencia = '';
    contenedorSeleccionado = null;
    equipoSeleccionado = '';
}

function volverPatentes() {
    document.getElementById('trackingSection').classList.add('hidden');
    document.getElementById('mapSection').classList.add('hidden');
    document.querySelectorAll('#tablaPatentes tr').forEach(f => f.classList.remove('table-row-active'));

    contenedorSeleccionado = null;
    equipoSeleccionado = '';
}

function copiarTablaParaCorreo() {
    const tabla = document.getElementById('tablaResultados');
    const btnCopiar = document.getElementById('btnCopiar');
    const originalHTML = btnCopiar.innerHTML;

    const range = document.createRange();
    range.selectNode(tabla);

    const windowSelection = window.getSelection();
    windowSelection.removeAllRanges();
    windowSelection.addRange(range);

    try {
        document.execCommand('copy');

        btnCopiar.classList.remove('bg-slate-100', 'text-slate-700', 'border-slate-300');
        btnCopiar.classList.add('bg-green-500', 'text-white', 'border-green-600');
        btnCopiar.innerHTML = `
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
            </svg>
            <span>¡Copiado al portapapeles!</span>
        `;

        setTimeout(() => {
            btnCopiar.classList.remove('bg-green-500', 'text-white', 'border-green-600');
            btnCopiar.classList.add('bg-slate-100', 'text-slate-700', 'border-slate-300');
            btnCopiar.innerHTML = originalHTML;
        }, 2000);
    } catch (err) {
        console.error('Error al copiar:', err);
        alert('Hubo un problema al copiar la tabla.');
    }

    windowSelection.removeAllRanges();
}

// ============================================================================
// 7. EVENTOS INICIALES
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    const bookingInput = document.getElementById('bookingInput');
    if (bookingInput) {
        bookingInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                buscarReserva();
            }
        });
    }
});
