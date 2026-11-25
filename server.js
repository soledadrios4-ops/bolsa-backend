require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Obtener estado inicial del mercado
app.get('/api/mercado', async (req, res) => {
  const activos = await pool.query('SELECT * FROM activos ORDER BY tipo, ticker');
  const noticias = await pool.query('SELECT * FROM noticias WHERE activa = TRUE ORDER BY id DESC LIMIT 5');
  res.json({ activos: activos.rows, noticias: noticias.rows });
});

// Motor de simulación cada 3 minutos (180.000 ms)
const INTERVALO_MS = 180000;

async function cicloDeMercado() {
  try {
    // 1. Elegir una noticia aleatoria para activar
    const resNoticias = await pool.query('SELECT * FROM noticias ORDER BY RANDOM() LIMIT 1');
    const noticiaActual = resNoticias.rows[0];
    
    if (noticiaActual) {
      await pool.query('UPDATE noticias SET activa = TRUE, creada_en = NOW() WHERE id = $1', [noticiaActual.id]);
    }

    // 2. Actualizar precios según volatilidad estadística + impacto de noticia
    const resActivos = await pool.query('SELECT * FROM activos');
    for (let activo of resActivos.rows) {
      // Variación aleatoria normal entre -volatilidad y +volatilidad
      const ruidoEstadistico = (Math.random() * 2 - 1) * parseFloat(activo.volatilidad);
      
      // Impacto de la noticia si coincide el ticker
      let impactoNoticia = 0;
      if (noticiaActual && noticiaActual.ticker_afectado === activo.ticker) {
        impactoNoticia = parseFloat(noticiaActual.impacto);
      }

      const variacionTotal = ruidoEstadistico + impactoNoticia;
      const nuevoPrecio = Math.max(1, parseFloat(activo.precio_actual) * (1 + variacionTotal)).toFixed(2);

      await pool.query(
        'UPDATE activos SET precio_anterior = precio_actual, precio_actual = $1 WHERE id = $2',
        [nuevoPrecio, activo.id]
      );
    }

    // 3. Enviar nuevos datos a todos los alumnos conectados en tiempo real
    const activosActualizados = await pool.query('SELECT * FROM activos ORDER BY tipo, ticker');
    const noticiasActivas = await pool.query('SELECT * FROM noticias WHERE activa = TRUE ORDER BY id DESC LIMIT 5');
    
    io.emit('actualizacion_mercado', {
      activos: activosActualizados.rows,
      noticias: noticiasActivas.rows,
      proximoCiclo: Date.now() + INTERVALO_MS
    });

    console.log('Ciclo de 3 minutos ejecutado correctamente.');
  } catch (err) {
    console.error('Error en ciclo de mercado:', err);
  }
}

setInterval(cicloDeMercado, INTERVALO_MS);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));