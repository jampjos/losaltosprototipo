// server.js - Versión compatible con MariaDB y PostgreSQL
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { load } = require('cheerio');
const https = require('https');
const zlib = require('zlib');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'tu_secreto_muy_seguro_cambiar_en_produccion';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// ==========================================
// 🔧 CONFIGURACIÓN DE BASE DE DATOS
// ==========================================

const DB_TYPE = process.env.DB_TYPE || 'postgresql'; // 'mariadb' o 'postgresql'

const DB_CONFIG = {
  mariadb: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'TU_USUARIO_AQUI',
    password: process.env.DB_PASSWORD || 'TU_CONTRASEÑA_AQUI',
    database: process.env.DB_NAME || 'TU_BASE_DE_DATOS_AQUI',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  },
  postgresql: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'TU_USUARIO_AQUI',
    password: process.env.DB_PASSWORD || 'TU_CONTRASEÑA_AQUI',
    database: process.env.DB_NAME || 'TU_BASE_DE_DATOS_AQUI',
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  }
};

// ==========================================
// FIN DE LA CONFIGURACIÓN DE BASE DE DATOS
// ==========================================

let pool;
let db;

// Inicializar el pool según el tipo de base de datos
if (DB_TYPE === 'postgresql') {
  const { Pool } = require('pg');
  pool = new Pool(DB_CONFIG.postgresql);
  db = {
    query: async (text, params) => {
      const result = await pool.query(text, params);
      return result.rows;
    },
    execute: async (text, params) => {
      const result = await pool.query(text, params);
      return { rows: result.rows, rowCount: result.rowCount };
    }
  };
} else {
  const mysql = require('mysql2/promise');
  pool = mysql.createPool(DB_CONFIG.mariadb);
  db = {
    query: async (sql, params = []) => {
      const [rows] = await pool.execute(sql, params);
      return rows;
    },
    execute: async (sql, params = []) => {
      const [result] = await pool.execute(sql, params);
      return { rows: result, rowCount: result.affectedRows, insertId: result.insertId };
    }
  };
}

// Middleware
const allowedOrigins = [
  FRONTEND_URL,
  'https://losaltosprototipo.onrender.com',
  'https://condominio-app.onrender.com',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:8080',
  'http://127.0.0.1:8080'
];

app.use(cors({
  origin: function(origin, callback) {
    // Permitir requests sin origin (como mobile apps o curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Middleware de autenticación (solo valida token)
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido o expirado' });
    req.user = user;
    next();
  });
}

// Middleware de autorización: solo master
function authorizeMaster(req, res, next) {
  if (req.user.rol !== 'master') {
    return res.status(403).json({ error: 'Acceso denegado. Se requiere rol master.' });
  }
  next();
}

// ==========================================
// ✅ SERVIR ARCHIVOS ESTÁTICOS PRIMERO
// ==========================================
app.use(express.static(path.join(__dirname, 'public')));

// Redirección raíz
app.get('/', (req, res) => res.redirect('/login.html'));

// Proteger el panel master (solo master)
app.get('/master.html', authenticateToken, authorizeMaster, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'master.html'));
});

// Proteger el panel de propietario (cualquier autenticado)
app.get('/propietario.html', authenticateToken, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'propietario.html'));
});

// ==========================================
// FIN DE SERVICIO DE ARCHIVOS ESTÁTICOS
// ==========================================

// Función para obtener tasa BCV
async function obtenerTasaBCV() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.bcv.org.ve',
      port: 443,
      path: '/',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Encoding': 'gzip, deflate, br'
      },
      rejectUnauthorized: false
    };
    const req = https.request(options, res => {
      let chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        let buffer = Buffer.concat(chunks);
        const encoding = res.headers['content-encoding'];
        try {
          if (encoding === 'gzip') buffer = zlib.gunzipSync(buffer);
          else if (encoding === 'deflate') buffer = zlib.inflateSync(buffer);
          else if (encoding === 'br') buffer = zlib.brotliDecompressSync(buffer);
          const html = buffer.toString('utf8');
          const $ = load(html);
          const tasaText = $('#dolar strong').first().text().trim();
          const tasa = parseFloat(tasaText.replace(',', '.'));
          if (isNaN(tasa)) reject(new Error('No se pudo obtener la tasa del BCV'));
          else resolve({ tasa, fecha: new Date().toISOString() });
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ---------- Inicialización de tablas ----------
async function setupDatabase() {
  if (DB_TYPE === 'postgresql') {
    await setupPostgreSQL();
  } else {
    await setupMariaDB();
  }
}

async function setupMariaDB() {
  const connection = await pool.getConnection();
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS grupos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS propietarios (
        id INT AUTO_INCREMENT PRIMARY KEY,
        apartamento VARCHAR(255) NOT NULL UNIQUE,
        nombre VARCHAR(255) NOT NULL,
        telefono VARCHAR(50),
        email VARCHAR(255),
        grupo_id INT,
        saldo_favor FLOAT DEFAULT 0,
        FOREIGN KEY (grupo_id) REFERENCES grupos(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        rol VARCHAR(50) DEFAULT 'propietario',
        propietario_id INT,
        FOREIGN KEY (propietario_id) REFERENCES propietarios(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS deudas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        propietario_id INT,
        periodo VARCHAR(7) NOT NULL,
        monto_usd FLOAT NOT NULL,
        fecha_vencimiento DATE,
        pagado TINYINT(1) DEFAULT 0,
        fecha_pago DATE,
        referencia_pago VARCHAR(255),
        original_monto FLOAT,
        recibo_id INT,
        porcentaje_alicuota FLOAT,
        FOREIGN KEY (propietario_id) REFERENCES propietarios(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS pagos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        propietario_id INT,
        fecha_pago DATE NOT NULL,
        monto_bs FLOAT NOT NULL,
        tasa_bcv FLOAT NOT NULL,
        monto_usd FLOAT,
        referencia VARCHAR(255),
        imagen_ruta VARCHAR(500),
        estado VARCHAR(50) DEFAULT 'pendiente',
        fecha_verificacion DATETIME,
        fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (propietario_id) REFERENCES propietarios(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS recibos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        periodo VARCHAR(7) NOT NULL,
        monto_usd FLOAT NOT NULL,
        grupo_id INT,
        fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        gastos_generales JSON,
        alicuotas_grupo JSON,
        gastos_especificos JSON,
        tasa_bcv FLOAT,
        fecha_tasa DATE,
        creditos JSON,
        reversos JSON,
        ajustes_especificos JSON,
        FOREIGN KEY (grupo_id) REFERENCES grupos(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Crear usuario admin si no existe
    const [admin] = await connection.query("SELECT id FROM usuarios WHERE username = 'admin'");
    if (admin.length === 0) {
      const hash = bcrypt.hashSync('admin123', 10);
      await connection.query("INSERT INTO usuarios (username, password, rol) VALUES (?, ?, ?)", ['admin', hash, 'master']);
      console.log('✅ Usuario master creado: admin / admin123');
    }
  } finally {
    connection.release();
  }
}

async function setupPostgreSQL() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS grupos (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS propietarios (
        id SERIAL PRIMARY KEY,
        apartamento VARCHAR(255) NOT NULL UNIQUE,
        nombre VARCHAR(255) NOT NULL,
        telefono VARCHAR(50),
        email VARCHAR(255),
        grupo_id INT REFERENCES grupos(id) ON DELETE SET NULL,
        saldo_favor FLOAT DEFAULT 0
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        rol VARCHAR(50) DEFAULT 'propietario',
        propietario_id INT REFERENCES propietarios(id) ON DELETE CASCADE
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS deudas (
        id SERIAL PRIMARY KEY,
        propietario_id INT REFERENCES propietarios(id) ON DELETE CASCADE,
        periodo VARCHAR(7) NOT NULL,
        monto_usd FLOAT NOT NULL,
        fecha_vencimiento DATE,
        pagado BOOLEAN DEFAULT FALSE,
        fecha_pago DATE,
        referencia_pago VARCHAR(255),
        original_monto FLOAT,
        recibo_id INT,
        porcentaje_alicuota FLOAT
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS pagos (
        id SERIAL PRIMARY KEY,
        propietario_id INT REFERENCES propietarios(id) ON DELETE CASCADE,
        fecha_pago DATE NOT NULL,
        monto_bs FLOAT NOT NULL,
        tasa_bcv FLOAT NOT NULL,
        monto_usd FLOAT,
        referencia VARCHAR(255),
        imagen_ruta VARCHAR(500),
        estado VARCHAR(50) DEFAULT 'pendiente',
        fecha_verificacion TIMESTAMP,
        fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS recibos (
        id SERIAL PRIMARY KEY,
        periodo VARCHAR(7) NOT NULL,
        monto_usd FLOAT NOT NULL,
        grupo_id INT REFERENCES grupos(id) ON DELETE SET NULL,
        fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        gastos_generales JSONB,
        alicuotas_grupo JSONB,
        gastos_especificos JSONB,
        tasa_bcv FLOAT,
        fecha_tasa DATE,
        creditos JSONB,
        reversos JSONB,
        ajustes_especificos JSONB
      )
    `);

    const adminResult = await client.query("SELECT id FROM usuarios WHERE username = 'admin'");
    if (adminResult.rows.length === 0) {
      const hash = bcrypt.hashSync('admin123', 10);
      await client.query("INSERT INTO usuarios (username, password, rol) VALUES ($1, $2, $3)", ['admin', hash, 'master']);
      console.log('✅ Usuario master creado: admin / admin123');
    }

    await client.query('COMMIT');
    console.log('✅ Base de datos PostgreSQL inicializada correctamente');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Error al inicializar PostgreSQL:', e);
    throw e;
  } finally {
    client.release();
  }
}

// Función helper para manejar placeholders según la BD
function placeholder(index) {
  return DB_TYPE === 'postgresql' ? `$${index}` : '?';
}

// ---------- ENDPOINTS ----------

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const p1 = placeholder(1);
    const rows = await db.query(`SELECT * FROM usuarios WHERE username = ${p1}`, [username]);
    const user = rows[0];
    if (!user) return res.status(401).json({ success: false, message: 'Usuario no encontrado' });
    if (bcrypt.compareSync(password, user.password)) {
      const token = jwt.sign(
        { id: user.id, rol: user.rol, propietario_id: user.propietario_id, usuario_id: user.id },
        JWT_SECRET,
        { expiresIn: '1d' }
      );
      res.json({ success: true, token, rol: user.rol, propietario_id: user.propietario_id, usuario_id: user.id });
    } else {
      res.status(401).json({ success: false, message: 'Contraseña incorrecta' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => res.json({ success: true }));

// GET /api/tasa-bcv
app.get('/api/tasa-bcv', async (req, res) => {
  try {
    const tasa = await obtenerTasaBCV();
    res.json(tasa);
  } catch { res.status(500).json({ error: 'No se pudo obtener la tasa BCV' }); }
});

// ---------- RUTAS ACCESIBLES PARA PROPIETARIOS Y MASTER ----------

// GET /api/grupos
app.get('/api/grupos', authenticateToken, async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM grupos ORDER BY nombre');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/propietarios/:id
app.get('/api/propietarios/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  if (req.user.rol !== 'master' && req.user.propietario_id != id) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  try {
    const p1 = placeholder(1);
    const rows = await db.query(`SELECT * FROM propietarios WHERE id = ${p1}`, [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/recibos/:id
app.get('/api/recibos/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const p1 = placeholder(1);
    const rows = await db.query(`SELECT * FROM recibos WHERE id = ${p1}`, [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Recibo no encontrado' });
    let recibo = rows[0];
    
    const jsonFields = ['gastos_generales', 'alicuotas_grupo', 'gastos_especificos', 'creditos', 'reversos', 'ajustes_especificos'];
    for (const field of jsonFields) {
      if (recibo[field] && typeof recibo[field] === 'string') {
        recibo[field] = JSON.parse(recibo[field]);
      }
    }
    
    recibo.total_gastos_usd = recibo.monto_usd;
    res.json(recibo);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/usuarios/:id/password
app.put('/api/usuarios/:id/password', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { nuevaPassword } = req.body;
  if (req.user.rol !== 'master' && req.user.id != id) {
    return res.status(403).json({ error: 'No autorizado para cambiar esta contraseña' });
  }
  const hash = bcrypt.hashSync(nuevaPassword, 10);
  try {
    const p1 = placeholder(1);
    const p2 = placeholder(2);
    const result = await db.execute(`UPDATE usuarios SET password = ${p1} WHERE id = ${p2}`, [hash, id]);
    res.json({ changes: result.rowCount || result.affectedRows || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- RUTAS EXCLUSIVAS PARA MASTER ----------

// POST /api/grupos
app.post('/api/grupos', authenticateToken, authorizeMaster, async (req, res) => {
  const { nombre } = req.body;
  try {
    if (DB_TYPE === 'postgresql') {
      const result = await db.execute(
        'INSERT INTO grupos (nombre) VALUES ($1) RETURNING id',
        [nombre]
      );
      res.json({ id: result.rows[0].id });
    } else {
      const result = await db.execute(
        'INSERT INTO grupos (nombre) VALUES (?)',
        [nombre]
      );
      res.json({ id: result.insertId });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/grupos/:id
app.put('/api/grupos/:id', authenticateToken, authorizeMaster, async (req, res) => {
  const { id } = req.params;
  const { nombre } = req.body;
  try {
    const p1 = placeholder(1);
    const p2 = placeholder(2);
    const result = await db.execute(`UPDATE grupos SET nombre = ${p1} WHERE id = ${p2}`, [nombre, id]);
    res.json({ changes: result.rowCount || result.affectedRows || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/grupos/:id
app.delete('/api/grupos/:id', authenticateToken, authorizeMaster, async (req, res) => {
  const { id } = req.params;
  const client = await pool.getConnection ? await pool.getConnection() : await pool.connect();
  try {
    if (client.beginTransaction) await client.beginTransaction();
    else await client.query('BEGIN');
    
    const p1 = placeholder(1);
    await client.query(`UPDATE propietarios SET grupo_id = NULL WHERE grupo_id = ${p1}`, [id]);
    const result = await client.query(`DELETE FROM grupos WHERE id = ${p1}`, [id]);
    
    if (client.commit) await client.commit();
    else await client.query('COMMIT');
    
    res.json({ changes: result.rowCount || result.affectedRows || 0 });
  } catch (err) {
    if (client.rollback) await client.rollback();
    else await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    if (client.release) client.release();
  }
});

// POST /api/grupos/:id/asignar
app.post('/api/grupos/:id/asignar', authenticateToken, authorizeMaster, async (req, res) => {
  const { id } = req.params;
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Se requiere una lista de IDs de propietarios' });
  }
  const client = await pool.getConnection ? await pool.getConnection() : await pool.connect();
  try {
    if (client.beginTransaction) await client.beginTransaction();
    else await client.query('BEGIN');
    
    for (const propId of ids) {
      const p1 = placeholder(1);
      const p2 = placeholder(2);
      await client.query(`UPDATE propietarios SET grupo_id = ${p1} WHERE id = ${p2}`, [id, propId]);
    }
    
    if (client.commit) await client.commit();
    else await client.query('COMMIT');
    
    res.json({ changes: ids.length });
  } catch (err) {
    if (client.rollback) await client.rollback();
    else await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    if (client.release) client.release();
  }
});

// GET /api/propietarios
app.get('/api/propietarios', authenticateToken, authorizeMaster, async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM propietarios ORDER BY id');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/propietarios/saldo
app.get('/api/propietarios/saldo', authenticateToken, authorizeMaster, async (req, res) => {
  try {
    const pagadoCondition = DB_TYPE === 'postgresql' ? 'false' : '0';
    const rows = await db.query(`
      SELECT p.*,
        COALESCE((SELECT SUM(monto_usd) FROM deudas WHERE propietario_id = p.id AND pagado = ${pagadoCondition}), 0) as total_deuda,
        (p.saldo_favor - COALESCE((SELECT SUM(monto_usd) FROM deudas WHERE propietario_id = p.id AND pagado = ${pagadoCondition}), 0)) as saldo_neto
      FROM propietarios p ORDER BY p.id
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/propietarios
app.post('/api/propietarios', authenticateToken, authorizeMaster, async (req, res) => {
  const { apartamento, nombre, telefono, email, grupo_id } = req.body;
  try {
    if (DB_TYPE === 'postgresql') {
      const result = await db.execute(
        `INSERT INTO propietarios (apartamento, nombre, telefono, email, grupo_id, saldo_favor) 
         VALUES ($1, $2, $3, $4, $5, 0) RETURNING id`,
        [apartamento, nombre, telefono || null, email || null, grupo_id || null]
      );
      res.json({ id: result.rows[0].id });
    } else {
      const result = await db.execute(
        `INSERT INTO propietarios (apartamento, nombre, telefono, email, grupo_id, saldo_favor) 
         VALUES (?, ?, ?, ?, ?, 0)`,
        [apartamento, nombre, telefono || null, email || null, grupo_id || null]
      );
      res.json({ id: result.insertId });
    }
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY' || err.code === '23505') {
      return res.status(400).json({ error: 'El apartamento ya existe.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/propietarios/:id
app.put('/api/propietarios/:id', authenticateToken, authorizeMaster, async (req, res) => {
  const { id } = req.params;
  const { apartamento, nombre, telefono, email, grupo_id } = req.body;
  try {
    const params = [apartamento, nombre, telefono || null, email || null, grupo_id || null, id];
    if (DB_TYPE === 'postgresql') {
      const result = await db.execute(
        `UPDATE propietarios SET apartamento = $1, nombre = $2, telefono = $3, email = $4, grupo_id = $5 WHERE id = $6`,
        params
      );
      res.json({ changes: result.rowCount });
    } else {
      const result = await db.execute(
        `UPDATE propietarios SET apartamento = ?, nombre = ?, telefono = ?, email = ?, grupo_id = ? WHERE id = ?`,
        params
      );
      res.json({ changes: result.affectedRows });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/propietarios/:id
app.delete('/api/propietarios/:id', authenticateToken, authorizeMaster, async (req, res) => {
  const { id } = req.params;
  try {
    const p1 = placeholder(1);
    const result = await db.execute(`DELETE FROM propietarios WHERE id = ${p1}`, [id]);
    res.json({ changes: result.rowCount || result.affectedRows || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/propietarios/:id/usuario
app.get('/api/propietarios/:id/usuario', authenticateToken, authorizeMaster, async (req, res) => {
  const { id } = req.params;
  try {
    const p1 = placeholder(1);
    const rows = await db.query(`SELECT * FROM usuarios WHERE propietario_id = ${p1}`, [id]);
    res.json(rows[0] || null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/propietarios/:id/usuario
app.post('/api/propietarios/:id/usuario', authenticateToken, authorizeMaster, async (req, res) => {
  const { id } = req.params;
  const { username, password } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  try {
    if (DB_TYPE === 'postgresql') {
      const result = await db.execute(
        `INSERT INTO usuarios (username, password, rol, propietario_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [username, hash, 'propietario', id]
      );
      res.json({ id: result.rows[0].id });
    } else {
      const result = await db.execute(
        `INSERT INTO usuarios (username, password, rol, propietario_id) VALUES (?, ?, ?, ?)`,
        [username, hash, 'propietario', id]
      );
      res.json({ id: result.insertId });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/propietarios/:id/usuario
app.put('/api/propietarios/:id/usuario', authenticateToken, authorizeMaster, async (req, res) => {
  const { id } = req.params;
  const { username, password } = req.body;
  try {
    if (password) {
      const hash = bcrypt.hashSync(password, 10);
      const p1 = placeholder(1);
      const p2 = placeholder(2);
      const p3 = placeholder(3);
      await db.execute(`UPDATE usuarios SET username = ${p1}, password = ${p2} WHERE propietario_id = ${p3}`, [username, hash, id]);
    } else {
      const p1 = placeholder(1);
      const p2 = placeholder(2);
      await db.execute(`UPDATE usuarios SET username = ${p1} WHERE propietario_id = ${p2}`, [username, id]);
    }
    res.json({ changes: 1 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/recibos
app.get('/api/recibos', authenticateToken, authorizeMaster, async (req, res) => {
  const { grupoId } = req.query;
  try {
    let sql = 'SELECT * FROM recibos';
    const params = [];
    if (grupoId) {
      const p1 = placeholder(1);
      sql += ` WHERE grupo_id = ${p1}`;
      params.push(grupoId);
    }
    sql += ' ORDER BY periodo DESC';
    const rows = await db.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/recibos
app.post('/api/recibos', authenticateToken, authorizeMaster, async (req, res) => {
  const { periodo, monto_usd, grupo_id, gastos_generales, alicuotas_grupo, gastos_especificos, creditos, reversos, ajustes_especificos, tasa_bcv, fecha_tasa } = req.body;
  try {
    const params = [
      periodo, monto_usd, grupo_id || null,
      JSON.stringify(gastos_generales), JSON.stringify(alicuotas_grupo),
      JSON.stringify(gastos_especificos), JSON.stringify(creditos || []),
      JSON.stringify(reversos || []), JSON.stringify(ajustes_especificos || []),
      tasa_bcv, fecha_tasa
    ];
    
    if (DB_TYPE === 'postgresql') {
      const result = await db.execute(
        `INSERT INTO recibos (periodo, monto_usd, grupo_id, gastos_generales, alicuotas_grupo, gastos_especificos, creditos, reversos, ajustes_especificos, tasa_bcv, fecha_tasa)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        params
      );
      res.json({ id: result.rows[0].id });
    } else {
      const result = await db.execute(
        `INSERT INTO recibos (periodo, monto_usd, grupo_id, gastos_generales, alicuotas_grupo, gastos_especificos, creditos, reversos, ajustes_especificos, tasa_bcv, fecha_tasa)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params
      );
      res.json({ id: result.insertId });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/recibos/:id
app.put('/api/recibos/:id', authenticateToken, authorizeMaster, async (req, res) => {
  const { id } = req.params;
  const { periodo, monto_usd, grupo_id, gastos_generales, alicuotas_grupo, gastos_especificos, creditos, reversos, ajustes_especificos, tasa_bcv, fecha_tasa } = req.body;
  try {
    const params = [
      periodo, monto_usd, grupo_id || null,
      JSON.stringify(gastos_generales), JSON.stringify(alicuotas_grupo),
      JSON.stringify(gastos_especificos), JSON.stringify(creditos || []),
      JSON.stringify(reversos || []), JSON.stringify(ajustes_especificos || []),
      tasa_bcv, fecha_tasa, id
    ];
    
    if (DB_TYPE === 'postgresql') {
      const result = await db.execute(
        `UPDATE recibos SET periodo=$1, monto_usd=$2, grupo_id=$3, gastos_generales=$4, alicuotas_grupo=$5, gastos_especificos=$6, creditos=$7, reversos=$8, ajustes_especificos=$9, tasa_bcv=$10, fecha_tasa=$11 WHERE id=$12`,
        params
      );
      res.json({ changes: result.rowCount });
    } else {
      const result = await db.execute(
        `UPDATE recibos SET periodo=?, monto_usd=?, grupo_id=?, gastos_generales=?, alicuotas_grupo=?, gastos_especificos=?, creditos=?, reversos=?, ajustes_especificos=?, tasa_bcv=?, fecha_tasa=? WHERE id=?`,
        params
      );
      res.json({ changes: result.affectedRows });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/recibos/:id
app.delete('/api/recibos/:id', authenticateToken, authorizeMaster, async (req, res) => {
  const { id } = req.params;
  try {
    const p1 = placeholder(1);
    const pagadoCondition = DB_TYPE === 'postgresql' ? 'false' : '0';
    const pendientes = await db.query(`SELECT id FROM deudas WHERE recibo_id = ${p1} AND pagado = ${pagadoCondition}`, [id]);
    if (pendientes.length > 0) {
      return res.status(400).json({ error: 'No se puede eliminar el recibo porque tiene deudas pendientes asociadas.' });
    }
    const result = await db.execute(`DELETE FROM recibos WHERE id = ${p1}`, [id]);
    await db.execute(`UPDATE deudas SET recibo_id = NULL WHERE recibo_id = ${p1}`, [id]);
    res.json({ changes: result.rowCount || result.affectedRows || 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/deudas
app.get('/api/deudas', authenticateToken, authorizeMaster, async (req, res) => {
  const { propietarioId } = req.query;
  try {
    let sql = 'SELECT * FROM deudas';
    const params = [];
    if (propietarioId) {
      const p1 = placeholder(1);
      sql += ` WHERE propietario_id = ${p1}`;
      params.push(propietarioId);
    }
    sql += ' ORDER BY periodo DESC';
    const rows = await db.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/deudas
app.post('/api/deudas', authenticateToken, authorizeMaster, async (req, res) => {
  const { propietario_id, periodo, monto_usd, fecha_vencimiento, recibo_id, porcentaje_alicuota } = req.body;
  try {
    const params = [propietario_id, periodo, monto_usd, fecha_vencimiento || null, recibo_id || null, porcentaje_alicuota || null];
    
    if (DB_TYPE === 'postgresql') {
      const result = await db.execute(
        `INSERT INTO deudas (propietario_id, periodo, monto_usd, fecha_vencimiento, recibo_id, porcentaje_alicuota)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        params
      );
      res.json({ id: result.rows[0].id });
    } else {
      const result = await db.execute(
        `INSERT INTO deudas (propietario_id, periodo, monto_usd, fecha_vencimiento, recibo_id, porcentaje_alicuota)
         VALUES (?, ?, ?, ?, ?, ?)`,
        params
      );
      res.json({ id: result.insertId });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/deudas/:id
app.put('/api/deudas/:id', authenticateToken, authorizeMaster, async (req, res) => {
  const { id } = req.params;
  const { periodo, monto_usd, fecha_vencimiento, pagado } = req.body;
  try {
    const params = [periodo, monto_usd, fecha_vencimiento || null, pagado, id];
    const p1 = placeholder(1);
    const p2 = placeholder(2);
    const p3 = placeholder(3);
    const p4 = placeholder(4);
    const p5 = placeholder(5);
    const result = await db.execute(
      `UPDATE deudas SET periodo = ${p1}, monto_usd = ${p2}, fecha_vencimiento = ${p3}, pagado = ${p4} WHERE id = ${p5}`,
      params
    );
    res.json({ changes: result.rowCount || result.affectedRows || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/deudas/:id
app.delete('/api/deudas/:id', authenticateToken, authorizeMaster, async (req, res) => {
  const { id } = req.params;
  try {
    const p1 = placeholder(1);
    const result = await db.execute(`DELETE FROM deudas WHERE id = ${p1}`, [id]);
    res.json({ changes: result.rowCount || result.affectedRows || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/pagos/pendientes
app.get('/api/pagos/pendientes', authenticateToken, authorizeMaster, async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT p.*, pr.nombre as propietario_nombre, pr.apartamento
      FROM pagos p JOIN propietarios pr ON p.propietario_id = pr.id
      WHERE p.estado = 'pendiente' ORDER BY p.fecha_registro DESC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/pagos/:id/verificar
app.post('/api/pagos/:id/verificar', authenticateToken, authorizeMaster, async (req, res) => {
  const { id } = req.params;
  const client = await pool.getConnection ? await pool.getConnection() : await pool.connect();
  try {
    if (client.beginTransaction) await client.beginTransaction();
    else await client.query('BEGIN');
    
    const p1 = placeholder(1);
    const pagoResult = await client.query(`SELECT * FROM pagos WHERE id = ${p1}`, [id]);
    const pago = pagoResult.rows ? pagoResult.rows[0] : pagoResult[0];
    
    if (!pago) throw new Error('Pago no encontrado');
    if (pago.estado !== 'pendiente') throw new Error('Ya verificado');

    let montoUSD = pago.monto_usd;
    if (!montoUSD || montoUSD <= 0) {
      if (!pago.tasa_bcv || pago.tasa_bcv <= 0) throw new Error('Tasa BCV inválida');
      montoUSD = pago.monto_bs / pago.tasa_bcv;
    }
    if (montoUSD <= 0) throw new Error('Monto en USD no válido');

    const deudasResult = await client.query(
      `SELECT * FROM deudas 
       WHERE propietario_id = ${p1} AND pagado = ${DB_TYPE === 'postgresql' ? 'false' : '0'} 
       ORDER BY periodo`,
      [pago.propietario_id]
    );
    const deudasRows = deudasResult.rows || deudasResult;

    let restante = montoUSD;
    for (const deuda of deudasRows) {
      if (restante <= 0) break;
      const p2 = placeholder(2);
      const p3 = placeholder(3);
      const p4 = placeholder(4);
      
      if (restante >= deuda.monto_usd) {
        await client.query(
          `UPDATE deudas SET 
             pagado = ${DB_TYPE === 'postgresql' ? 'true' : '1'}, 
             fecha_pago = ${p2}, 
             referencia_pago = ${p3}, 
             original_monto = COALESCE(original_monto, monto_usd) 
           WHERE id = ${p4}`,
          [pago.fecha_pago, pago.referencia, deuda.id]
        );
        restante -= deuda.monto_usd;
      } else {
        await client.query(
          `UPDATE deudas SET 
             monto_usd = ${p2}, 
             fecha_pago = ${p3}, 
             referencia_pago = ${p4}, 
             original_monto = COALESCE(original_monto, monto_usd) 
           WHERE id = ${p1}`,
          [deuda.monto_usd - restante, pago.fecha_pago, pago.referencia, deuda.id]
        );
        restante = 0;
      }
    }

    if (restante > 0) {
      const p2 = placeholder(2);
      const p3 = placeholder(3);
      await client.query(`UPDATE propietarios SET saldo_favor = saldo_favor + ${p2} WHERE id = ${p3}`, [restante, pago.propietario_id]);
    }

    const p2 = placeholder(2);
    const p3 = placeholder(3);
    await client.query(
      `UPDATE pagos SET estado = ${p2}, fecha_verificacion = NOW(), monto_usd = ${p3} WHERE id = ${p1}`,
      ['verificado', montoUSD, id]
    );

    if (client.commit) await client.commit();
    else await client.query('COMMIT');
    
    res.json({ changes: 1, saldo_favor: restante });
  } catch (err) {
    if (client.rollback) await client.rollback();
    else await client.query('ROLLBACK');
    console.error('[VERIFICAR] Error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (client.release) client.release();
  }
});

// POST /api/pagos/:id/revertir
app.post('/api/pagos/:id/revertir', authenticateToken, authorizeMaster, async (req, res) => {
  const { id } = req.params;
  const client = await pool.getConnection ? await pool.getConnection() : await pool.connect();
  try {
    if (client.beginTransaction) await client.beginTransaction();
    else await client.query('BEGIN');
    
    const p1 = placeholder(1);
    const pagoResult = await client.query(`SELECT * FROM pagos WHERE id = ${p1}`, [id]);
    const pago = pagoResult.rows ? pagoResult.rows[0] : pagoResult[0];
    
    if (!pago || pago.estado !== 'verificado') throw new Error('No se puede revertir');
    
    const p2 = placeholder(2);
    const p3 = placeholder(3);
    const p4 = placeholder(4);
    const deudasResult = await client.query(
      `SELECT id, monto_usd, original_monto FROM deudas WHERE propietario_id = ${p2} AND fecha_pago = ${p3} AND referencia_pago = ${p4}`,
      [pago.propietario_id, pago.fecha_pago, pago.referencia]
    );
    const deudasRows = deudasResult.rows || deudasResult;
    
    for (const deuda of deudasRows) {
      const montoRest = deuda.original_monto || deuda.monto_usd;
      const p5 = placeholder(5);
      const p6 = placeholder(6);
      await client.query(
        `UPDATE deudas SET pagado = ${DB_TYPE === 'postgresql' ? 'false' : '0'}, monto_usd = ${p5}, fecha_pago = NULL, referencia_pago = NULL, original_monto = NULL WHERE id = ${p6}`,
        [montoRest, deuda.id]
      );
    }
    
    const p5 = placeholder(5);
    const p6 = placeholder(6);
    await client.query(`UPDATE propietarios SET saldo_favor = saldo_favor - ${p5} WHERE id = ${p6}`, [pago.monto_usd, pago.propietario_id]);
    await client.query(`UPDATE pagos SET estado = ${p5}, fecha_verificacion = NULL WHERE id = ${p6}`, ['pendiente', id]);
    
    if (client.commit) await client.commit();
    else await client.query('COMMIT');
    
    res.json({ changes: 1 });
  } catch (err) {
    if (client.rollback) await client.rollback();
    else await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    if (client.release) client.release();
  }
});

// GET /api/usuarios/existe
app.get('/api/usuarios/existe', authenticateToken, authorizeMaster, async (req, res) => {
  const { username } = req.query;
  try {
    const p1 = placeholder(1);
    const rows = await db.query(`SELECT id FROM usuarios WHERE username = ${p1}`, [username]);
    res.json({ exists: rows.length > 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/usuarios
app.get('/api/usuarios', authenticateToken, authorizeMaster, async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT u.id, u.username, u.rol, u.propietario_id,
             p.nombre as propietario_nombre, p.apartamento
      FROM usuarios u LEFT JOIN propietarios p ON u.propietario_id = p.id ORDER BY u.id
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/usuarios/:id
app.put('/api/usuarios/:id', authenticateToken, authorizeMaster, async (req, res) => {
  const { id } = req.params;
  const { username, password } = req.body;
  try {
    if (username && username.trim()) {
      const p1 = placeholder(1);
      const p2 = placeholder(2);
      const rows = await db.query(`SELECT id FROM usuarios WHERE username = ${p1} AND id != ${p2}`, [username, id]);
      if (rows.length > 0) return res.status(400).json({ error: 'Username ya existe' });
      
      if (password) {
        const hash = bcrypt.hashSync(password, 10);
        const p3 = placeholder(3);
        await db.execute(`UPDATE usuarios SET username = ${p1}, password = ${p3} WHERE id = ${p2}`, [username, hash, id]);
      } else {
        await db.execute(`UPDATE usuarios SET username = ${p1} WHERE id = ${p2}`, [username, id]);
      }
    } else if (password) {
      const hash = bcrypt.hashSync(password, 10);
      const p1 = placeholder(1);
      const p2 = placeholder(2);
      await db.execute(`UPDATE usuarios SET password = ${p1} WHERE id = ${p2}`, [hash, id]);
    }
    res.json({ changes: 1 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/usuarios/:id
app.delete('/api/usuarios/:id', authenticateToken, authorizeMaster, async (req, res) => {
  const { id } = req.params;
  try {
    const p1 = placeholder(1);
    const rows = await db.query(`SELECT username FROM usuarios WHERE id = ${p1}`, [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
    if (rows[0].username === 'admin') return res.status(403).json({ error: 'No se puede eliminar admin' });
    const result = await db.execute(`DELETE FROM usuarios WHERE id = ${p1}`, [id]);
    res.json({ changes: result.rowCount || result.affectedRows || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- RUTAS PARA PROPIETARIOS ----------

// GET /api/propietarios/:id/deudas
app.get('/api/propietarios/:id/deudas', authenticateToken, async (req, res) => {
  const { id } = req.params;
  if (req.user.rol !== 'master' && req.user.propietario_id != id) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  try {
    const p1 = placeholder(1);
    const rows = await db.query(`SELECT * FROM deudas WHERE propietario_id = ${p1} ORDER BY periodo DESC`, [id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/propietarios/:id/pagos
app.get('/api/propietarios/:id/pagos', authenticateToken, async (req, res) => {
  const { id } = req.params;
  if (req.user.rol !== 'master' && req.user.propietario_id != id) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  try {
    const p1 = placeholder(1);
    const rows = await db.query(`SELECT * FROM pagos WHERE propietario_id = ${p1} ORDER BY fecha_registro DESC`, [id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/pagos/propietario
app.post('/api/pagos/propietario', authenticateToken, async (req, res) => {
  const { propietario_id, fecha_pago, monto_bs, tasa_bcv, referencia } = req.body;
  if (req.user.rol !== 'master' && req.user.propietario_id != propietario_id) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  const monto_usd = monto_bs / tasa_bcv;
  try {
    const params = [propietario_id, fecha_pago, monto_bs, tasa_bcv, monto_usd, referencia];
    
    if (DB_TYPE === 'postgresql') {
      const result = await db.execute(
        `INSERT INTO pagos (propietario_id, fecha_pago, monto_bs, tasa_bcv, monto_usd, referencia, estado)
         VALUES ($1, $2, $3, $4, $5, $6, 'pendiente') RETURNING id`,
        params
      );
      res.json({ id: result.rows[0].id });
    } else {
      const result = await db.execute(
        `INSERT INTO pagos (propietario_id, fecha_pago, monto_bs, tasa_bcv, monto_usd, referencia, estado)
         VALUES (?, ?, ?, ?, ?, ?, 'pendiente')`,
        params
      );
      res.json({ id: result.insertId });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/pagos/propietario/:id
app.put('/api/pagos/propietario/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { fecha_pago, monto_bs, tasa_bcv, referencia } = req.body;
  const p1 = placeholder(1);
  const pagoResult = await db.query(`SELECT propietario_id FROM pagos WHERE id = ${p1}`, [id]);
  const pago = pagoResult[0];
  if (!pago) return res.status(404).json({ error: 'Pago no encontrado' });
  if (req.user.rol !== 'master' && req.user.propietario_id != pago.propietario_id) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  const monto_usd = monto_bs / tasa_bcv;
  try {
    const params = [fecha_pago, monto_bs, tasa_bcv, monto_usd, referencia, id];
    const p2 = placeholder(2);
    const p3 = placeholder(3);
    const p4 = placeholder(4);
    const p5 = placeholder(5);
    const p6 = placeholder(6);
    const result = await db.execute(
      `UPDATE pagos SET fecha_pago = ${p2}, monto_bs = ${p3}, tasa_bcv = ${p4}, monto_usd = ${p5}, referencia = ${p6} WHERE id = ${p1}`,
      params
    );
    res.json({ changes: result.rowCount || result.affectedRows || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/pagos/propietario/:id
app.delete('/api/pagos/propietario/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const p1 = placeholder(1);
  const pagoResult = await db.query(`SELECT propietario_id FROM pagos WHERE id = ${p1}`, [id]);
  const pago = pagoResult[0];
  if (!pago) return res.status(404).json({ error: 'Pago no encontrado' });
  if (req.user.rol !== 'master' && req.user.propietario_id != pago.propietario_id) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  try {
    const result = await db.execute(`DELETE FROM pagos WHERE id = ${p1}`, [id]);
    res.json({ changes: result.rowCount || result.affectedRows || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/propietario/mi-perfil
app.get('/api/propietario/mi-perfil', authenticateToken, async (req, res) => {
  if (req.user.rol !== 'propietario') return res.status(403).json({ error: 'Solo propietarios' });
  try {
    const p1 = placeholder(1);
    const rows = await db.query(`SELECT * FROM propietarios WHERE id = ${p1}`, [req.user.propietario_id]);
    if (rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- Iniciar servidor ----------
setupDatabase().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📦 Base de datos ${DB_TYPE.toUpperCase()} conectada`);
  });
}).catch(err => {
  console.error('❌ Error al inicializar la base de datos:', err);
  process.exit(1);
});
