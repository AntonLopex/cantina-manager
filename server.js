const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = process.env.PORT || 5000;
const ADMIN_PIN = "calo";

const DATA_DIR = path.join(__dirname, "data");
const UPLOADS_DIR = path.join(__dirname, "static", "uploads");
const DB_FILE = path.join(DATA_DIR, "cantina.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Datos Iniciais por defecto en Galego
const INITIAL_CONSUMICIONS = [
  {
    id: 1,
    nombre: "Caña / Cervexa",
    precio_unitario: 2,
    imagen_url: "",
    activo: true,
    created_at: new Date().toISOString(),
  },
  {
    id: 2,
    nombre: "Auga",
    precio_unitario: 1,
    imagen_url: "",
    activo: true,
    created_at: new Date().toISOString(),
  },
  {
    id: 3,
    nombre: "Refresco",
    precio_unitario: 2,
    imagen_url: "",
    activo: true,
    created_at: new Date().toISOString(),
  },
  {
    id: 4,
    nombre: "Copa / Combinado",
    precio_unitario: 5,
    imagen_url: "",
    activo: true,
    created_at: new Date().toISOString(),
  },
  {
    id: 5,
    nombre: "Calimotxo",
    precio_unitario: 3,
    imagen_url: "",
    activo: true,
    created_at: new Date().toISOString(),
  },
];

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const defaultData = {
      consumiciones: INITIAL_CONSUMICIONS,
      pedidos: [],
      nextConsumicionId: 9,
      nextPedidoId: 1,
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2));
    return defaultData;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    const defaultData = {
      consumiciones: INITIAL_CONSUMICIONS,
      pedidos: [],
      nextConsumicionId: 9,
      nextPedidoId: 1,
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2));
    return defaultData;
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

function parseBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk.toString()));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        resolve(body);
      }
    });
  });
}

function checkPin(req) {
  const headerPin = req.headers["x-admin-pin"];
  return headerPin === ADMIN_PIN;
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Servir ficheiros estáticos
  if (pathname === "/") {
    const html = fs.readFileSync(
      path.join(__dirname, "templates", "index.html"),
      "utf8",
    );
    res.writeHead(200, { "Content-Type": MIME_TYPES[".html"] });
    return res.end(html);
  }

  if (pathname.startsWith("/static/")) {
    const filePath = path.join(__dirname, pathname);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime });
      return fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Ficheiro non atopado" }));
    }
  }

  // Helper JSON Response
  const sendJSON = (statusCode, payload) => {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  };

  // API ROUTING

  // 1. Verify PIN
  if (pathname === "/api/verify-pin" && method === "POST") {
    const body = await parseBody(req);
    if (body.pin === ADMIN_PIN) {
      return sendJSON(200, { success: true, message: "Contrasinal correcto" });
    }
    return sendJSON(401, { success: false, message: "Contrasinal incorrecto" });
  }

  // 2. Get Consumicións
  if (pathname === "/api/consumiciones" && method === "GET") {
    const db = loadDB();
    const includeInactive = parsedUrl.query.include_inactive === "true";

    if (includeInactive && !checkPin(req)) {
      return sendJSON(401, { error: "Acceso non autorizado" });
    }

    let items = db.consumiciones;
    if (!includeInactive) {
      items = items.filter((c) => c.activo);
    }
    items.sort((a, b) => a.nombre.localeCompare(b.nombre));
    return sendJSON(200, items);
  }

  // 3. Add Consumición
  if (pathname === "/api/consumiciones" && method === "POST") {
    if (!checkPin(req))
      return sendJSON(401, { error: "Acceso non autorizado" });
    const body = await parseBody(req);

    // Support multipart file uploads or JSON payload
    let nombre = body.nombre ? body.nombre.trim() : "";
    let precio = parseFloat(body.precio_unitario || 0);
    let imagen_url = body.imagen_url ? body.imagen_url.trim() : "";

    if (!nombre) return sendJSON(400, { error: "O nome é obrigatorio" });
    if (isNaN(precio) || precio <= 0)
      return sendJSON(400, { error: "O prezo debe ser maior que cero" });

    const db = loadDB();
    const newItem = {
      id: db.nextConsumicionId++,
      nombre,
      precio_unitario: Math.round(precio * 100) / 100,
      imagen_url: imagen_url || null,
      activo: true,
      created_at: new Date().toISOString(),
    };

    db.consumiciones.push(newItem);
    saveDB(db);
    return sendJSON(201, newItem);
  }

  // 4. Edit / Soft Delete Consumición
  if (
    pathname.startsWith("/api/consumiciones/") &&
    (method === "PUT" || method === "DELETE")
  ) {
    if (!checkPin(req))
      return sendJSON(401, { error: "Acceso non autorizado" });
    const id = parseInt(pathname.split("/")[3]);
    const db = loadDB();
    const item = db.consumiciones.find((c) => c.id === id);

    if (!item) return sendJSON(404, { error: "Consumición non atopada" });

    if (method === "DELETE") {
      item.activo = false; // Soft delete
      saveDB(db);
      return sendJSON(200, {
        success: true,
        message: "Consumición desactivada correctamente",
      });
    }

    if (method === "PUT") {
      const body = await parseBody(req);
      if (body.nombre) item.nombre = body.nombre.trim();
      if (body.precio_unitario)
        item.precio_unitario =
          Math.round(parseFloat(body.precio_unitario) * 100) / 100;
      if (body.activo !== undefined)
        item.activo = body.activo === true || body.activo === "true";
      if (body.imagen_url !== undefined)
        item.imagen_url = body.imagen_url.trim() || null;

      saveDB(db);
      return sendJSON(200, item);
    }
  }

  // 5. Create Pedido (Atomic SQL / Transaction Simulation)
  if (pathname === "/api/pedidos" && method === "POST") {
    const body = await parseBody(req);
    const itemsDraft = body.items || [];
    const camarero = body.camarero || "Camarero 1";

    if (!Array.isArray(itemsDraft) || itemsDraft.length === 0) {
      return sendJSON(400, { error: "O pedido está baleiro" });
    }

    const db = loadDB();
    let totalPedido = 0;
    const lineas = [];

    for (const draft of itemsDraft) {
      const cid = parseInt(draft.id);
      const cantidad = parseInt(draft.cantidad);

      if (isNaN(cantidad) || cantidad <= 0) continue;

      const itemDB = db.consumiciones.find((c) => c.id === cid);
      if (!itemDB) continue;

      const subtotal = cantidad * itemDB.precio_unitario;
      totalPedido += subtotal;

      lineas.push({
        consumicion_id: itemDB.id,
        nombre_consumicion: itemDB.nombre,
        cantidad: cantidad,
        precio_unitario_en_el_momento: itemDB.precio_unitario,
        subtotal: Math.round(subtotal * 100) / 100,
      });
    }

    if (lineas.length === 0) {
      return sendJSON(400, { error: "Ningún elemento válido no pedido" });
    }

    const nuevoPedido = {
      id: db.nextPedidoId++,
      fecha_hora: new Date().toISOString(),
      total_pedido: Math.round(totalPedido * 100) / 100,
      camarero: camarero,
      lineas: lineas,
    };

    db.pedidos.push(nuevoPedido);
    saveDB(db);

    return sendJSON(201, {
      success: true,
      pedido_id: nuevoPedido.id,
      total_pedido: nuevoPedido.total_pedido,
      message: `Pedido gardado correctamente: ${nuevoPedido.total_pedido.toFixed(2)} €`,
    });
  }

  // 6. Get Resultados (Analytics)
  if (pathname === "/api/resultados" && method === "GET") {
    if (!checkPin(req))
      return sendJSON(401, { error: "Acceso non autorizado" });

    const db = loadDB();
    const facturacionTotal = db.pedidos.reduce(
      (sum, p) => sum + p.total_pedido,
      0,
    );
    const totalPedidosCount = db.pedidos.length;

    // Acumular ventas por consumicion_id
    const statsMap = {};
    db.pedidos.forEach((p) => {
      p.lineas.forEach((l) => {
        if (!statsMap[l.consumicion_id]) {
          statsMap[l.consumicion_id] = { unidades: 0, importe: 0 };
        }
        statsMap[l.consumicion_id].unidades += l.cantidad;
        statsMap[l.consumicion_id].importe +=
          l.cantidad * l.precio_unitario_en_el_momento;
      });
    });

    const productosStats = db.consumiciones.map((c) => {
      const st = statsMap[c.id] || { unidades: 0, importe: 0 };
      const pct =
        facturacionTotal > 0 ? (st.importe / facturacionTotal) * 100 : 0;
      return {
        id: c.id,
        nombre: c.nombre,
        precio_actual: Math.round(c.precio_unitario * 100) / 100,
        activo: c.activo,
        unidades_vendidas: st.unidades,
        importe_facturado: Math.round(st.importe * 100) / 100,
        porcentaje_facturacion: Math.round(pct * 10) / 10,
      };
    });

    productosStats.sort((a, b) => b.importe_facturado - a.importe_facturado);

    return sendJSON(200, {
      facturacion_total: Math.round(facturacionTotal * 100) / 100,
      total_pedidos: totalPedidosCount,
      productos: productosStats,
    });
  }

  // 7. Reset Caja
  if (pathname === "/api/reset-caja" && method === "POST") {
    if (!checkPin(req))
      return sendJSON(401, { error: "Acceso non autorizado" });
    const db = loadDB();
    db.pedidos = [];
    db.nextPedidoId = 1;
    saveDB(db);
    return sendJSON(200, {
      success: true,
      message: "Cesta e historial de ventas reiniciados con éxito",
    });
  }

  // 404 Default
  sendJSON(404, { error: "Ruta non atopada" });
});

server.listen(PORT, () => {
  console.log(`\n🍹 Cantina Manager executándose en http://localhost:${PORT}`);
  console.log(` `);
});
