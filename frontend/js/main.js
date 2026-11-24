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

// Formatea fecha y hora en una línea (Ej: 17-11-2026 - 02:00 p. m.)
function formatearFechaHora(str) {
    if (!str) return 'Pendiente de registro';
    const d = new Date(str);
    if (isNaN(d.getTime())) return 'Pendiente de registro';

    const fecha = d.toLocaleDateString('es-CL');
    const hora = d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
    return `${fecha} - ${hora}`;
}

// Formatea hora corta (HH:MM) para el rango en la tabla de estadías
function formatearHoraCorta(str) {
    if (!str) return '--:--';
    const d = new Date(str);
    if (isNaN(d.getTime())) return '--:--';
    return d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}

// Formatea minutos totales a "Xh YYm"
function formatearDuracion(totalMinutos) {
    const horas = Math.floor(totalMinutos / 60);
    const minutos = totalMinutos % 60;
    return `${horas}h ${String(minutos).padStart(2, '0')}m`;
}

// Calcula la estadía en cualquier punto (Origen, Planta o Destino)
function calcularEstadiaPunto(llegadaStr, salidaStr, { aplica = true, viajeFinalizado = false } = {}) {
    if (!aplica) {
        return { texto: 'N/A', rango: '', minutos: null, enCurso: false, esNA: true, alerta: false };
    }

    if (!llegadaStr) {
        return {
            texto: viajeFinalizado ? 'Sin registro' : 'Pendiente',
            rango: '',
            minutos: null,
            enCurso: false,
            esNA: false,
            alerta: false
        };
    }

    const llegada = new Date(llegadaStr);
    if (isNaN(llegada.getTime())) {
        return { texto: 'Sin registro', rango: '', minutos: null, enCurso: false, esNA: false, alerta: false };
    }

    const horaEntrada = formatearHoraCorta(llegadaStr);
    let fin;
    let enCurso = false;

    if (salidaStr) {
        fin = new Date(salidaStr);
        if (isNaN(fin.getTime())) {
            return {
                texto: 'Sin registro',
                rango: `Entrada: ${horaEntrada}`,
                minutos: null,
                enCurso: false,
                esNA: false,
                alerta: false
            };
        }
    } else if (!viajeFinalizado) {
        fin = new Date();
        enCurso = true;
    } else {
        return {
            texto: 'Sin salida reg.',
            rango: `Entrada: ${horaEntrada}`,
            minutos: null,
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
            minutos: null,
            enCurso: false,
            esNA: false,
            alerta: !enCurso
        };
    }

    const formato = formatearDuracion(diffMin);

    return {
        texto: enCurso ? `En curso (${formato})` : formato,
        rango,
        minutos: diffMin,
        enCurso,
        esNA: false,
        alerta: false
    };
}

// Calcula la suma total de estadías válidas (Origen + Planta + Destino)
function calcularEstadiaTotal(estadias, viajeFinalizado) {
    const puntos = [estadias.origen, estadias.planta, estadias.destino].filter(p => !p.esNA);

    let totalMinutos = 0;
    let puntosContabilizados = 0;
    let algunoEnCurso = false;

    puntos.forEach(p => {
        if (typeof p.minutos === 'number' && p.minutos >= 0) {
            totalMinutos += p.minutos;
            puntosContabilizados += 1;
            if (p.enCurso) algunoEnCurso = true;
        }
    });

    if (puntosContabilizados === 0) {
        return {
            texto: viajeFinalizado ? 'Sin registro' : 'Pendiente',
            subtexto: '',
            enCurso: false,
            sinDatos: true
        };
    }

    const formato = formatearDuracion(totalMinutos);
    const subtexto = `${puntosContabilizados} ${puntosContabilizados === 1 ? 'punto reg.' : 'puntos reg.'}`;

    return {
        texto: algunoEnCurso ? `En curso (${formato})` : formato,
        subtexto,
        enCurso: algunoEnCurso,
        sinDatos: false
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
            trazabilidadGlobal = Array.isArray(datos.trazabilidad) ? datos.trazabilidad : [];

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

                // Buscar el registro exacto en traceability (por container_id o container)
                const traceCont = trazabilidadGlobal.find(t =>
                    (t.container_id && tramoActual.container_id && String(t.container_id) === String(tramoActual.container_id)) ||
                    (t.container && tramoActual.container && normalizarTexto(t.container) === normalizarTexto(tramoActual.container))
                ) || (trazabilidadGlobal.length === 1 ? trazabilidadGlobal[0] : {});

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

                // Validar si existen fechas reales registradas en el viaje
                const tieneFechasViaje = Boolean(
                    llegadaOrigen || salidaOrigen ||
                    llegadaPlanta || salidaPlanta ||
                    llegadaDestino || salidaDestino
                );

                // Estado obtenido ESTRICTAMENTE desde traceability (sin usar el estado de la ODS/movimiento)
                // Si no hay fechas agregadas al viaje, debe mostrarse como "Pendiente"
                const estadoTrace = traceCont.status_label || '';
                const estadoLabel = !tieneFechasViaje
                    ? 'Pendiente'
                    : (estadoTrace || 'Pendiente');

                const viajeFinalizado = tieneFechasViaje && (
                    normalizarTexto(traceCont.status) === 'FINALIZADO' ||
                    normalizarTexto(traceCont.status_label) === 'FINALIZADO'
                );

                // Calcular las 3 estadías y su total
                const estadiaOrigen = calcularEstadiaPunto(llegadaOrigen, salidaOrigen, { aplica: true, viajeFinalizado });
                const estadiaPlanta = calcularEstadiaPunto(llegadaPlanta, salidaPlanta, { aplica: tienePlanta, viajeFinalizado });
                const estadiaDestino = calcularEstadiaPunto(llegadaDestino, salidaDestino, { aplica: true, viajeFinalizado });
                const estadiaTotal = calcularEstadiaTotal(
                    { origen: estadiaOrigen, planta: estadiaPlanta, destino: estadiaDestino },
                    viajeFinalizado
                );

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
                        destino: estadiaDestino,
                        total: estadiaTotal
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
// 4. TRAZABILIDAD (TARJETAS CONECTADAS), ESTADÍAS (CON TOTAL) Y GPS
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
            ? `<p class="text-[11px] text-slate-400 mt-1 truncate max-w-[180px]" title="${nombreLugar}">${nombreLugar}</p>`
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

    const total = mov._estadias.total;
    const totalValorHtml = total.sinDatos
        ? `<span class="text-sm font-medium text-slate-400">${total.texto}</span>`
        : total.enCurso
            ? `<span class="text-base font-bold text-amber-600">${total.texto}</span>`
            : `<span class="text-base font-bold text-sae-blue">${total.texto}</span>`;

    const totalSubHtml = total.subtexto
        ? `<p class="text-[11px] text-slate-500 mt-0.5">${total.subtexto}</p>`
        : '';

    document.getElementById('tablaEstadiasBody').innerHTML = `
        <tr>
            ${renderCelda(mov._estadias.origen, mov._ruta.origen)}
            ${renderCelda(mov._estadias.planta, mov._ruta.planta)}
            ${renderCelda(mov._estadias.destino, mov._ruta.destino)}
            <td class="px-4 py-4 align-top text-right bg-slate-50/70 border-l border-slate-100">
                ${totalValorHtml}
                ${totalSubHtml}
            </td>
        </tr>
    `;
}

function generarTimeline(mov) {
    const tramos = mov._tramos || [mov];
    const tienePlanta = Boolean(mov._ruta?.planta) && tramos.length >= 2;
    const h = mov._hitos || {};

    // Construir 2 o 3 secciones según si el viaje pasa por Planta
    const secciones = [
        {
            titulo: 'Origen',
            lugar: mov._ruta?.origen,
            llegada: h.llegadaOrigen,
            salida: h.salidaOrigen
        }
    ];

    if (tienePlanta) {
        secciones.push({
            titulo: 'Planta',
            lugar: mov._ruta?.planta,
            llegada: h.llegadaPlanta,
            salida: h.salidaPlanta
        });
    }

    secciones.push({
        titulo: 'Destino',
        lugar: mov._ruta?.destino,
        llegada: h.llegadaDestino,
        salida: h.salidaDestino
    });

    // Renderiza el círculo tipo radio-button (doble aro azul cuando tiene registro)
    const renderNodo = (tieneDato, esActual) => {
        if (tieneDato && esActual) {
            return `
                <span class="relative z-10 w-4 h-4 rounded-full bg-white border-2 border-sae-blue ring-4 ring-blue-100 flex items-center justify-center shrink-0">
                    <span class="w-2 h-2 rounded-full bg-sae-blue"></span>
                </span>
            `;
        }
        if (tieneDato) {
            return `
                <span class="relative z-10 w-4 h-4 rounded-full bg-white border-2 border-sae-blue flex items-center justify-center shrink-0">
                    <span class="w-2 h-2 rounded-full bg-sae-blue"></span>
                </span>
            `;
        }
        return `
            <span class="relative z-10 w-4 h-4 rounded-full bg-white border-2 border-slate-300 flex items-center justify-center shrink-0">
                <span class="w-2 h-2 rounded-full bg-slate-200"></span>
            </span>
        `;
    };

    const tarjetasHtml = secciones.map(sec => {
        const tieneLlegada = Boolean(sec.llegada);
        const tieneSalida = Boolean(sec.salida);
        const llegadaEnCurso = tieneLlegada && !tieneSalida && !mov._finalizado;

        const lugarHtml = (sec.lugar && sec.lugar !== '-')
            ? `<p class="text-[11px] text-slate-500 uppercase truncate mt-0.5" title="${sec.lugar}">${sec.lugar}</p>`
            : '';

        return `
            <div class="relative rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                <!-- Título de la sección centrado, más grande y en azul marino -->
                <h4 class="text-base font-extrabold text-center text-[#06152d] tracking-wide leading-tight mb-2.5">
                    ${sec.titulo}
                </h4>

                <!-- Bloque Llegada -->
                <div class="flex items-start">
                    <div class="w-7 flex flex-col items-center shrink-0 pt-0.5">
                        ${renderNodo(tieneLlegada, llegadaEnCurso)}
                    </div>
                    <div class="flex-1 min-w-0 pl-2.5">
                        <p class="text-sm font-medium text-slate-800 leading-snug">Llegada</p>
                        ${lugarHtml}
                        <p class="text-xs ${tieneLlegada ? 'text-slate-700 font-medium' : 'text-slate-400'} mt-1">
                            ${formatearFechaHora(sec.llegada)}
                        </p>
                    </div>
                </div>

                <!-- Separador horizontal interno entre Llegada y Salida -->
                <div class="ml-9 border-t border-slate-200 my-3"></div>

                <!-- Bloque Salida -->
                <div class="flex items-start">
                    <div class="w-7 flex flex-col items-center shrink-0 pt-0.5">
                        ${renderNodo(tieneSalida, false)}
                    </div>
                    <div class="flex-1 min-w-0 pl-2.5">
                        <p class="text-sm font-medium text-slate-800 leading-snug">Salida</p>
                        <p class="text-xs ${tieneSalida ? 'text-slate-700 font-medium' : 'text-slate-400'} mt-1">
                            ${formatearFechaHora(sec.salida)}
                        </p>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Línea vertical continua que atraviesa todas las tarjetas
    document.getElementById('contenedorTimeline').innerHTML = `
        <div class="pointer-events-none absolute left-[29px] top-14 bottom-11 w-[2px] bg-slate-200 z-0"></div>
        ${tarjetasHtml}
    `;
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