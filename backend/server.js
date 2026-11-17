import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import https from 'https';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.static('public')); // Sirve el index.html y SAETracker_GPS_Logo.png

// Agente para ignorar SSL (replicando CURLOPT_SSL_VERIFYPEER = false)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Configuración base Axios para GoTruck
const gotruckApi = axios.create({
    baseURL: 'https://sae.grupodtg.com/api/sae_ai/v1',
    httpsAgent,
    headers: {
        'Authorization': `Bearer ${process.env.GOTRUCK_API_KEY}`,
        'Accept': 'application/json'
    }
});

// Configuración base Axios para THK
const thkApi = axios.create({
    baseURL: 'https://legacy.thktracking.cl/api',
    httpsAgent,
    headers: {
        'Authorization': process.env.THK_AUTH_HEADER,
        'Accept': 'application/json'
    }
});

// --- ENDPOINT: GoTruck ---
app.get('/api/gotruck', async (req, res) => {
    const referencia = req.query.referencia?.trim();
    if (!referencia) return res.status(400).json({ existe: false, error: "Parámetro vacío" });

    try {
        let serviceId = null;

        // 1. Obtener Service ID
        if (/^\d{1,6}$/.test(referencia)) {
            serviceId = referencia;
        } else {
            const srvRes = await gotruckApi.get(`/services?shipment=${encodeURIComponent(referencia)}`);
            const datos = srvRes.data;
            if (datos?.data?.length > 0) {
                serviceId = datos.data[0].service_id || datos.data.service_id;
            }
        }

        if (!serviceId) return res.json({ existe: false });

        // 2. Ejecutar consultas paralelas (Optimizado vs el PHP original secuencial)
        const [movRes, cabRes, traceRes] = await Promise.all([
            gotruckApi.get(`/movements?service_id=${serviceId}`).catch(() => ({ data: {} })),
            gotruckApi.get(`/services/${serviceId}`).catch(() => ({ data: {} })),
            gotruckApi.get(`/services/${serviceId}/traceability`).catch(() => ({ data: {} }))
        ]);

        const movimientos = movRes.data?.data || null;
        const cabecera = cabRes.data?.data || null;
        const trazabilidad = traceRes.data?.data || [];

        // 3. Buscar contenedor si existe
        let contenedor = null;
        if (cabecera?.containers?.[0]?.container_id) {
            try {
                const contRes = await gotruckApi.get(`/containers/${cabecera.containers[0].container_id}`);
                contenedor = contRes.data?.data || null;
            } catch (err) {
                console.error("Error obteniendo contenedor:", err.message);
            }
        }

        if (movimientos) {
            return res.json({
                existe: true,
                cabecera,
                movimientos,
                contenedor,
                trazabilidad
            });
        }
        return res.json({ existe: false });

    } catch (error) {
        console.error(error);
        res.status(500).json({ existe: false, error: error.message });
    }
});

// --- ENDPOINT: THK GPS ---
app.get('/api/thk', async (req, res) => {
    const objetivo = req.query.name?.trim();
    if (!objetivo) return res.status(400).json({ error: "Parámetro 'name' no proporcionado" });

    const limpiarAlfanumerico = (txt) => String(txt).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const objetivoLimpio = limpiarAlfanumerico(objetivo);
    const variantes = [objetivoLimpio];

    if (objetivoLimpio.length === 6) {
        const match24 = objetivoLimpio.match(/^([A-Z]{2})(\d{4})$/);
        const match42 = objetivoLimpio.match(/^([A-Z]{4})(\d{2})$/);
        
        if (match24) variantes.push(`${match24[1]}-${match24[2]}`);
        else if (match42) variantes.push(`${match42[1]}-${match42[2]}`);
        else {
            variantes.push(`${objetivoLimpio.substring(0, 2)}-${objetivoLimpio.substring(2)}`);
            variantes.push(`${objetivoLimpio.substring(0, 4)}-${objetivoLimpio.substring(4)}`);
        }
    }

    try {
        // 1. Consultar dispositivos
        const devRes = await thkApi.get('/devices');
        const devices = devRes.data;
        
        let deviceId = null;
        let dispositivoEncontrado = null;

        for (const dev of devices) {
            const nombreTHK = (dev.name || '').toUpperCase().trim();
            const nombreTHKLimpio = limpiarAlfanumerico(nombreTHK);

            if (nombreTHKLimpio === objetivoLimpio) {
                deviceId = dev.id;
                dispositivoEncontrado = dev;
                break;
            }
            if (variantes.some(v => nombreTHK === v || nombreTHK.includes(v))) {
                deviceId = dev.id;
                dispositivoEncontrado = dev;
                break;
            }
        }

        if (!deviceId) {
            return res.status(404).json({ error: `Dispositivo '${objetivo}' no encontrado en THK`, variantes_probadas: variantes });
        }

        // 2. Consultar posición
        const posRes = await thkApi.get(`/positions?deviceId=${deviceId}`);
        const positions = posRes.data;

        if (positions && positions.length > 0) {
            const ultimaPos = positions[0];
            return res.json({
                name: dispositivoEncontrado.name || objetivo,
                deviceId,
                lat: ultimaPos.latitude || null,
                lng: ultimaPos.longitude || null,
                velocidad: ultimaPos.speed || 0,
                fecha: ultimaPos.fixTime || ultimaPos.serverTime || null,
                dispositivo: dispositivoEncontrado
            });
        } else {
            return res.status(404).json({ error: `Sin lecturas GPS recientes`, deviceId });
        }

    } catch (error) {
        console.error(error);
        res.status(502).json({ error: "Error de conexión con THK" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SAETracker API corriendo en puerto ${PORT}`));