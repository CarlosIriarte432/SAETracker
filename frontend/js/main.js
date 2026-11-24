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

// Normaliza textos para comparaciones seguras
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

// Formatea hora corta (HH:MM) para mostrar el rango dentro de la tabla de estadías
function formatearHoraCorta(str) {
    if (!str) return '--:--';
    const d = new Date(str);
    if (isNaN(d.getTime())) return '--:--';
    return d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}

// Calcula la estadía en cualquier punto (Origen, Planta o Destino)
function calcularEstadiaPunto(llegadaStr, salidaStr, { aplica = true, viajeFinalizado = false } = {}) {
    if (!aplica) {
        return { texto: 'N/A', rango: '', enCurso: false, esNA: true, alerta: false };
    }

    if (!llegadaStr) {
        return {
            texto: viajeFinalizado ? 'Sin registro' : 'Pendiente',
            rango: '',
            enCurso: false,
            esNA: false,
            alerta: false
        };
    }

    const llegada = new Date(llegadaStr);
    if (isNaN(llegada.getTime())) {
        return { texto: 'Sin registro', rango: '', enCurso: false, esNA: false, alerta: false };
    }

    const horaEntrada = formatearHoraCorta(llegadaStr);
    let fin;
    let enCurso = false;

    if (salidaStr) {
        fin = new Date(salidaStr);
        if (isNaN(fin.getTime())) {
            return { texto: 'Sin registro', rango: `Entrada: ${horaEntrada}`, enCurso: false, esNA: false, alerta: false };
        }
    } else if (!viajeFinalizado) {
        // Si el viaje sigue activo y ya entró al punto, calcula el tiempo acumulado en vivo
        fin = new Date();
        enCurso = true;
    } else {
        return {
            texto: 'Sin salida reg.',
            rango: `Entrada: ${horaEntrada}`,
            enCurso: false,
            esNA: false,
            alerta: false
        };
    }

    const horaSalida = enCurso ? 'Actual' : formatearHoraCorta(salidaStr);
    const rango = `${horaEntrada} → ${horaSalida}`;
    const diffMin = Math.floor((fin - llegada) / 60000);

    if (diffMin < 0) {
        return {
            texto: enCurso ? 'Pendiente' : 'Revisar fechas',
            rango,
            enCurso: false,
            esNA: false,
            alerta: !enCurso
        };
    }

    const horas = Math.floor(diffMin / 60);
    const minutos = diffMin % 60;
    const formato = `${horas}h ${String(minutos).padStart(2, '0')}m`;

    return {
        texto: enCurso ? `En curso (${formato})` : formato,
        rango,
        enCurso,
        esNA: false,
        alerta: false
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
            trazabilidadGlobal = datos.trazabilidad || [];

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

                const traceCont = trazabilidadGlobal.find(t => t.container === tramoActual.container) || trazabilidadGlobal[0] || {};
                const tm = traceCont.milestones || {};
                const t1m = tramoInicial.milestones || {};
                const t2m = tramoActual.milestones || {};

                const esMismoCont = infoContenedor.container === tramoActual.container;
                const pickupPlace = esMismoCont ? infoContenedor.pickup?.place : null;
                const deliveryPlace = esMismoCont ? infoContenedor.delivery?.place : null;
                const returnPlace = esMismoCont ? infoContenedor.return?.place : null;

                const origen = pickupPlace || tramoInicial.origin?.name || '-';
                const destino = returnPlace || tramoActual.destination?.name || deliveryPlace || '-';

                // Detectar si existe parada intermedia (Planta)
                let planta = null;
                if (tramos.length >= 2) {
                    const candidata = deliveryPlace || tramoInicial.destination?.name;
                    if (candidata && normalizarTexto(candidata) !== normalizarTexto(origen) && normalizarTexto(candidata) !== normalizarTexto(destino)) {
                        planta = candidata;
                    }
                } else if (deliveryPlace && returnPlace && normalizarTexto(deliveryPlace) !== normalizarTexto(origen) && normalizarTexto(deliveryPlace) !== normalizarTexto(destino)) {
                    planta = deliveryPlace;
                }

                const tienePlanta = Boolean(planta) && tramos.length >= 2;

                // Hitos de Origen
                const llegadaOrigen = getAt(t1m.arrival_origin) || getAt(tm.arrival_origin);
                const salidaOrigen = getAt(t1m.departure_origin) || getAt(tm.departure_origin);

                // Hitos de Planta (si aplica)
                let llegadaPlanta = null;
                let salidaPlanta = null;
                if (tienePlanta) {
                    llegadaPlanta = getAt(t2m.arrival_origin) || getAt(t1m.arrival_destination);
                    const salT2 = getAt(t2m.departure_origin);
                    const salT1 = getAt(t1m.departure_destination);
                    if (salT2) {
                        salidaPlanta = salT2;
                    } else if (salT1 && (!llegadaPlanta || new Date(salT1) >= new Date(llegadaPlanta))) {
                        salidaPlanta = salT1;
                    }
                }

                // Hitos de Destino
                const llegadaDestino = getAt(t2m.arrival_destination) || getAt(tm.arrival_destination);
                const salidaDestino = getAt(t2m.departure_destination) || getAt(tm.departure_destination);

                // Determinar si el viaje está finalizado
                const estadoLabel = traceCont.status_label || tramoActual.state_label || 'Pendiente';
                const viajeFinalizado =
                    normalizarTexto(traceCont.status) === 'FINALIZADO' ||
                    normalizarTexto(estadoLabel) === 'FINALIZADO' ||
                    (normalizarTexto(tramoActual.state) === 'FINALIZADO' && (!tienePlanta || tramos.length >= 2));

                // Calcular las 3 estadías
                const estadiaOrigen = calcularEstadiaPunto(llegadaOrigen, salidaOrigen, { aplica: true, viajeFinalizado });
                const estadiaPlanta = calcularEstadiaPunto(llegadaPlanta, salidaPlanta, { aplica: tienePlanta, viajeFinalizado });
                const estadiaDestino = calcularEstadiaPunto(llegadaDestino, salidaDestino, { aplica: true, viajeFinalizado });

                return {
                    ...tramoActual,
                    _clave: tramoActual.container || String(tramoActual.movement_id),
                    _tramos: tramos,
                    _ruta: { origen, planta, destino },
                    _hitos: {
                        llegadaOrigen,
                        salidaOrigen,
                        llegadaPlanta,
                        salidaPlanta,
                        llegadaDestino,
                        salidaDestino
                    },
                    _estadias: {
                        origen: estadiaOrigen,
                        planta: estadiaPlanta,
                        destino: estadiaDestino
                    },
                    _estadoLabel: estadoLabel,
                    _finalizado: viajeFinalizado
                };
            });

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
                    <td class="px-4 py-4">${mov._ruta.destino}</td>
                    <td class="px-4 py-4">${mov.driver?.name || 'SIN ASIGNAR'}</td>
                    <td class="px-4 py-4 font-medium">${mov.truck || '-'}</td>
                    <td class="px-4 py-4 text-slate-500">${mov.ramp || '-'}</td>
                    <td class="px-4 py-4 text-slate-500">${mov.container || infoContenedor.container || '-'}</td>
                    <td class="px-4 py-4 text-right font-medium ${mov._finalizado ? 'text-emerald-600' : 'text-sae-blue'}">${mov._estadoLabel}</td>
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
                // Solo recargar GPS si el viaje NO pasó a finalizado
                if (mapaEstabaAbierto && !filaARestaurar.mov._finalizado) {
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
// 4. TRAZABILIDAD (TIMELINE), ESTADÍAS Y VISIBILIDAD GPS
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
    renderizarTablaEstadias(mov);

    // Regla de negocio: si el viaje está Finalizado, ocultar el GPS y mostrar solo estadías
    const mapParent = document.getElementById('mapSectionParent');
    const mapSection = document.getElementById('mapSection');

    mapSection.classList.add('hidden');
    mapSection.innerHTML = '';

    if (mov._finalizado) {
        mapParent.classList.add('hidden');
    } else {
        mapParent.classList.remove('hidden');
    }

    document.getElementById('trackingSection').classList.remove('hidden');

    if (!silencioso) {
        document.getElementById('trackingSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function renderizarTablaEstadias(mov) {
    const badge = document.getElementById('badgeEstadoViaje');
    if (badge) {
        if (mov._finalizado) {
            badge.className = 'px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200';
            badge.innerText = '✓ Servicio Finalizado';
        } else {
            badge.className = 'px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-sae-blue border border-blue-200';
            badge.innerText = `● ${mov._estadoLabel}`;
        }
    }

    const renderCelda = (estadia, nombreLugar) => {
        let valorHtml = '';
        if (estadia.esNA) {
            valorHtml = `<span class="text-base font-semibold text-slate-400">N/A</span>`;
        } else if (estadia.enCurso) {
            valorHtml = `<span class="text-base font-bold text-amber-600">${estadia.texto}</span>`;
        } else if (estadia.alerta) {
            valorHtml = `<span class="text-sm font-semibold text-rose-600">${estadia.texto}</span>`;
        } else if (estadia.texto === 'Sin registro' || estadia.texto === 'Pendiente' || estadia.texto === 'Sin salida reg.') {
            valorHtml = `<span class="text-sm font-medium text-slate-400">${estadia.texto}</span>`;
        } else {
            valorHtml = `<span class="text-base font-bold text-slate-800">${estadia.texto}</span>`;
        }

        const lugarHtml = (!estadia.esNA && nombreLugar && nombreLugar !== '-')
            ? `<p class="text-[11px] text-slate-400 mt-1 truncate max-w-[210px]" title="${nombreLugar}">${nombreLugar}</p>`
            : '';

        const rangoHtml = estadia.rango
            ? `<p class="text-[11px] text-slate-500 mt-0.5">${estadia.rango}</p>`
            : '';

        return `
            <td class="px-4 py-4 align-top">
                ${valorHtml}
                ${rangoHtml}
                ${lugarHtml}
            </td>
        `;
    };

    document.getElementById('tablaEstadiasBody').innerHTML = `
        <tr>
            ${renderCelda(mov._estadias.origen, mov._ruta.origen)}
            ${renderCelda(mov._estadias.planta, mov._ruta.planta)}
            ${renderCelda(mov._estadias.destino, mov._ruta.destino)}
        </tr>
    `;
}

function generarTimeline(mov) {
    const tramos = mov._tramos || [mov];
    const tienePlanta = Boolean(mov._ruta?.planta) && tramos.length >= 2;
    const h = mov._hitos || {};

    let pasos = [];

    if (tienePlanta) {
        pasos = [
            { titulo: 'Llegada a Origen', lugar: mov._ruta?.origen, fecha: h.llegadaOrigen },
            { titulo: 'Salida de Origen', lugar: '', fecha: h.salidaOrigen },
            { titulo: 'Llegada a Planta', lugar: mov._ruta?.planta, fecha: h.llegadaPlanta },
            { titulo: 'Salida de Planta', lugar: '', fecha: h.salidaPlanta },
            { titulo: 'Llegada a Destino', lugar: mov._ruta?.destino, fecha: h.llegadaDestino },
            { titulo: 'Salida de Destino', lugar: '', fecha: h.salidaDestino }
        ];
    } else {
        pasos = [
            { titulo: 'Llegada a Origen', lugar: mov._ruta?.origen, fecha: h.llegadaOrigen },
            { titulo: 'Salida de Origen', lugar: '', fecha: h.salidaOrigen },
            { titulo: 'Llegada a Destino', lugar: mov._ruta?.destino, fecha: h.llegadaDestino },
            { titulo: 'Salida de Destino', lugar: '', fecha: h.salidaDestino }
        ];
    }

    const terminado = mov._finalizado || Boolean(pasos[pasos.length - 1].fecha);

    document.getElementById('contenedorTimeline').innerHTML = pasos.map((paso, i) => {
        const esUltimo = i === pasos.length - 1;
        const completado = esUltimo
            ? terminado
            : Boolean(paso.fecha) && (Boolean(pasos[i + 1].fecha) || terminado);
        const actual = !completado && Boolean(paso.fecha);
        const clase = completado ? 'completed' : (actual ? 'current' : '');

        return `
            <div class="timeline-step relative pl-10 ${esUltimo ? 'mb-2' : 'mb-7'} ${clase}">
                <p class="text-sm font-bold text-slate-700 m-0">${paso.titulo}</p>
                ${paso.lugar && paso.lugar !== '-' ? `<p class="text-[11px] text-slate-400 mt-0.5 truncate" title="${paso.lugar}">${paso.lugar}</p>` : ''}
                <p class="text-xs text-slate-500 mt-1">${formatearFechaHora(paso.fecha)}</p>
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