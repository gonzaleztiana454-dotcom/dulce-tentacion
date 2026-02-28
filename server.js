const session = require('express-session');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));


app.use(session({
    secret: 'secreto-super-seguro',
    resave: false,
    saveUninitialized: true
}));

function verificarLogin(req, res, next) {
    if (!req.session.userId) {
        return res.redirect('/login.html');
    }
    next();
}

function verificarAdmin(req, res, next) {
    if (!req.session.userId || req.session.rol !== 'admin') {
        return res.send("Acceso denegado");
    }
    next();
}

app.get('/inicio', verificarLogin, (req, res) => {
    res.sendFile(__dirname + '/public/inicio.html');
});

app.get('/usuario', verificarLogin, (req, res) => {
    res.json({ nombre: req.session.nombre });
} )

app.get('/productos', verificarLogin, (req, res) => {
    db.all("SELECT * FROM productos", [], (err, rows) => {
        if(err) return res.send("Error");
        res.json(rows);
    });
});



// Base de datos
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error("Error al conectar la base de datos");
    } else {
        console.log("Base de datos conectada");

        db.serialize(() => {

            db.run(`
                CREATE TABLE IF NOT EXISTS usuarios (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    nombre TEXT,
                    email TEXT UNIQUE,
                    password TEXT
                )
            `);

            db.run(`
                CREATE TABLE IF NOT EXISTS productos (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    nombre TEXT,
                    precio REAL
                )
            `);

            db.run(`
                CREATE TABLE IF NOT EXISTS pedidos (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    usuario_id INTEGER,
                    producto_id INTEGER,
                    cantidad INTEGER,
                    fecha_entrega TEXT,
                    estado TEXT DEFAULT 'pendiente',
                    FOREIGN KEY(usuario_id) REFERENCES usuarios(id),
                    FOREIGN KEY(producto_id) REFERENCES productos(id)
                )
            `);

            db.run("INSERT OR IGNORE INTO productos (id, nombre, precio) VALUES (1, 'Torta Chocolinas', 4500)");
            db.run("INSERT OR IGNORE INTO productos (id, nombre, precio) VALUES (2, 'Cheesecake', 5200)");
            db.run("INSERT OR IGNORE INTO productos (id, nombre, precio) VALUES (3, 'Brownies', 3000)");

        });
    }
});

// Crear tabla pedidos
db.run(`
    CREATE TABLE IF NOT EXISTS pedidos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER,
        producto_id INTEGER,
        cantidad INTEGER,
        fecha_entrega TEXT,
        estado TEXT DEFAULT 'pendiente',
        FOREIGN KEY(usuario_id) REFERENCES usuarios(id),
        FOREIGN KEY(producto_id) REFERENCES productos(id)
    )
`);

app.post('/registro', (req, res) => {
    const { nombre, email, password } = req.body;

    db.run(
        "INSERT INTO usuarios (nombre, email, password) VALUES (?, ?, ?)",
        [nombre, email, password],
        function(err) {
            if (err) {
                return res.send("El usuario ya existe");
            }
            res.redirect('/login.html?registro=ok');
        }
    );
});

app.post('/hacer-pedido', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login.html');
    }

    const { producto_id, cantidad, fecha_entrega } = req.body;
    const usuario_id = req.session.userId;

    db.run(
        `INSERT INTO pedidos (usuario_id, producto_id, cantidad, fecha_entrega)
         VALUES (?, ?, ?, ?)`,
        [usuario_id, producto_id, cantidad, fecha_entrega],
        function(err) {
            if (err) {
                return res.send("Error al guardar pedido");
            }
            res.send("Pedido realizado correctamente");
        }
    );
});

app.get('/admin-pedidos', verificarAdmin, (req, res) => {
    const estado = req.query.estado;

    let query = `
        SELECT pedidos.id, usuarios.nombre, productos.nombre AS producto,
               pedidos.cantidad, pedidos.fecha_entrega, pedidos.estado
        FROM pedidos
        JOIN usuarios ON pedidos.usuario_id = usuarios.id
        JOIN productos ON pedidos.producto_id = productos.id
    `;

    if (estado) {
        query += " WHERE pedidos.estado = ?";
        db.all(query, [estado], (err, rows) => {
            if (err) return res.send("Error");
            res.json(rows);
        });
    } else {
        db.all(query, [], (err, rows) => {
            if (err) return res.send("Error");
            res.json(rows);
        });
    }
});

app.post('/marcar-entregado/:id', (req, res) => {
    const id = req.params.id;

    db.run(
        "UPDATE pedidos SET estado = 'entregado' WHERE id = ?",
        [id],
        function(err) {
            if (err) {
                return res.send("Error al actualizar pedido");
            }
            res.send("Pedido actualizado");
        }
    );
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;

    db.get(
        "SELECT * FROM usuarios WHERE email = ? AND password = ?",
        [email, password],
        (err, user) => {
            if (user) {
                req.session.userId = user.id;
                req.session.nombre = user.nombre;
                req.session.rol = user.rol; 

                res.redirect('/inicio');
            
            } else {
                res.send("Usuario o contraseña incorrectos");
            }
        }
    );
});

app.post('/eliminar-pedido/:id', verificarLogin, (req, res) => {
    const id = req.params.id;

    db.run("DELETE FROM pedidos WHERE id = ?", [id], function(err) {
        if (err) {
            return res.send("Error al eliminar");
        }
        res.send("Pedido eliminado");
    });
});

app.get('/admin-estadisticas', verificarAdmin, (req, res) => {
    db.all(`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN estado = 'pendiente' THEN 1 ELSE 0 END) as pendientes,
            SUM(CASE WHEN estado = 'entregado' THEN 1 ELSE 0 END) as entregados
        FROM pedidos
    `, [], (err, rows) => {
        if (err) return res.send("Error");
        res.json(rows[0]);
    });
});

app.get('/admin-ventas', verificarAdmin, (req, res) => {
    db.get(`
        SELECT SUM(pedidos.cantidad * productos.precio) as totalVentas
        FROM pedidos
        JOIN productos ON pedidos.producto_id = productos.id
        WHERE pedidos.estado = 'entregado'
    `, [], (err, row) => {
        if (err) return res.send("Error");
        res.json(row);
    });
});

app.get('/login', (req, res) => {
    if (req.session.userId) {
        return res.redirect('/inicio');
    }
    res.sendFile(__dirname + '/public/login.html');
});

app.get('/registro', (req, res) => {
    if (req.session.userId) {
        return res.redirect('/inicio');
    }
    res.sendFile(__dirname + '/public/index.html');
});

app.get('/pedidos', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }

    res.sendFile(__dirname + '/public/pedidos.html');
});

app.post('/agregar-carrito', (req, res) => {

    const { producto_id, cantidad } = req.body;

    if (!req.session.carrito) {
        req.session.carrito = [];
    }

    // Buscar si el producto ya está en el carrito
    const productoExistente = req.session.carrito.find(
        item => item.producto_id == producto_id
    );

    if (productoExistente) {
        // Si ya existe → sumamos cantidad
        productoExistente.cantidad += Number(cantidad);
    } else {
        // Si no existe → lo agregamos
        req.session.carrito.push({
            producto_id,
            cantidad: Number(cantidad)
        });
    }

    res.json({ mensaje: "Producto agregado al carrito" });
});

app.get('/carrito', (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }

    res.sendFile(__dirname + '/public/carrito.html');
});

app.get('/api/carrito', (req, res) => {
    res.json(req.session.carrito || []);
});

app.post('/confirmar-compra', (req, res) => {

    const carrito = req.session.carrito;
    const usuario_id = req.session.userId;

    if (!carrito || carrito.length === 0) {
        return res.json({ mensaje: "El carrito está vacío" });
    }

    const fechaEntrega = new Date().toISOString().split('T')[0];

    carrito.forEach(item => {
        db.run(
            `INSERT INTO pedidos (usuario_id, producto_id, cantidad, fecha_entrega, estado)
             VALUES (?, ?, ?, ?, ?)`,
            [usuario_id, item.producto_id, item.cantidad, fechaEntrega, 'pendiente']
        );
    });

    req.session.carrito = [];

    res.json({ mensaje: "Compra realizada con éxito" });
});

app.post('/eliminar-del-carrito', (req, res) => {

    const { producto_id } = req.body;

    if (!req.session.carrito) {
        return res.json({ mensaje: "Carrito vacío" });
    }

    req.session.carrito = req.session.carrito.filter(
        item => item.producto_id != producto_id
    );

    res.json({ mensaje: "Producto eliminado" });
});

app.get("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.log("Error al cerrar sesión:", err);
            return res.redirect("/");
        }

        res.clearCookie("connect.sid"); // elimina la cookie
        res.redirect("/login"); // redirige al login
    });
});

app.get("/pago", (req, res) => {
    if (!req.session.userId) {
        return res.redirect("/login");
    }

    res.send(`
        <h2>Medio de Pago</h2>

        <form action="/pagar" method="POST">
            <input type="text" name="nombre" placeholder="Nombre en la tarjeta" required><br><br>
            <input type="text" name="numero" placeholder="Número de tarjeta" required><br><br>
            <input type="text" name="vencimiento" placeholder="MM/AA" required><br><br>
            <input type="text" name="cvv" placeholder="CVV" required><br><br>

            <button type="submit">Confirmar Pago</button>
        </form>
    `);
});

app.post("/pagar", (req, res) => {
    if (!req.session.userId) {
        return res.redirect("/login");
    }

    const { nombre, numero, vencimiento, cvv } = req.body;

    if (!nombre || !numero || !vencimiento || !cvv) {
        return res.send("Todos los campos son obligatorios.");
    }

    // Simulación básica: aprobar siempre
    req.session.carrito = [];

    res.send(`
        <h2>Pago aprobado ✅</h2>
        <p>Gracias por tu compra.</p>
        <a href="/inicio">Volver al inicio</a>
    `);
});

app.get("/perfil", (req, res) => {
    if (!req.session.userId) {
        return res.redirect("/login.html");
    }

    res.sendFile(__dirname + "/public/perfil.html");
});

app.get("/api/perfil", (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: "No autorizado" });
    }

    db.get(
        "SELECT nombre, email FROM usuarios WHERE id = ?",
        [req.session.userId],
        (err, usuario) => {

            if (err || !usuario) {
                return res.status(500).json({ error: "Error al obtener usuario" });
            }

            res.json(usuario);
        }
    );
});



app.listen(PORT, () => {
    console.log("Servidor corriendo en puerto " + PORT);
});