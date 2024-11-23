const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const pool = require("./lib/db");
const cors = require("cors"); // Importar cors
require("dotenv").config();

const app = express();
const port = 4000;

app.use(express.json());

// Configuración de CORS para permitir solicitudes desde tu frontend
const corsOptions = {
  origin: "http://localhost:5173", // Permitir solicitudes solo desde el frontend local
  methods: ["GET", "POST", "PUT", "DELETE"], // Métodos permitidos
  allowedHeaders: ["Content-Type", "Authorization"], // Cabeceras permitidas
};

app.use(cors(corsOptions)); // Habilitar CORS con las opciones configuradas

// Configurar el transportador de correo
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Ruta de registro
app.post("/api/auth/register", async (req, res) => {
  const { email, password, name } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (email, password, name) VALUES ($1, $2, $3) RETURNING *",
      [email, hashedPassword, name]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error registrando el usuario" });
  }
});

// Ruta de inicio de sesión
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    const user = result.rows[0];
    if (!user) {
      return res.status(400).json({ message: "Usuario no encontrado" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Contraseña incorrecta" });
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });
    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error al iniciar sesión" });
  }
});

// Ruta para recuperar contraseña
app.post("/api/auth/forgot-password", async (req, res) => {
  const { email } = req.body;
  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    const user = result.rows[0];
    if (!user) {
      return res.status(400).json({ message: "Usuario no encontrado" });
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: "15m",
    });
    await pool.query(
      "INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)",
      [user.id, token, new Date(Date.now() + 15 * 60 * 1000)] // Token expira en 15 minutos
    );

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Restablecer contraseña",
      text: `Haz clic en el siguiente enlace para restablecer tu contraseña: http://localhost:4000/api/auth/reset-password/${token}`,
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        return res.status(500).json({ message: "Error al enviar el correo" });
      }
      res.status(200).json({ message: "Correo de restablecimiento enviado" });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error al procesar la solicitud" });
  }
});

// Ruta para verificar el token de restablecimiento
app.get("/api/auth/forgot-password/:token", async (req, res) => {
  const { token } = req.params;
  try {
    const result = await pool.query(
      "SELECT * FROM password_reset_tokens WHERE token = $1 AND expires_at > NOW()",
      [token]
    );

    if (result.rowCount === 0) {
      // Si no se encuentra el token o está expirado
      return res.status(400).json({ message: "Token inválido o expirado" });
    }

    // Si el token es válido
    res.status(200).json({ message: "Token válido" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error al verificar el token" });
  }
});

// Ruta para actualizar la contraseña
app.post("/api/auth/forgot-password/:token", async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query("UPDATE users SET password = $1 WHERE id = $2", [
      hashedPassword,
      decoded.userId,
    ]);
    res.status(200).json({ message: "Contraseña actualizada correctamente" });
  } catch (err) {
    res.status(400).json({ message: "Token inválido o expirado" });
  }
});

// Actualizar contraseña con token
app.post("/auth/forgot-password/:token", async (req, res) => {
  const { token } = req.params;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const result = await pool.query(
      "SELECT * FROM password_reset_tokens WHERE token = $1 AND expires_at > NOW()",
      [token]
    );

    if (result.rowCount === 0) {
      return res.status(400).json({ message: "Token inválido o expirado" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query("UPDATE users SET password = $1 WHERE id = $2", [
      hashedPassword,
      decoded.userId,
    ]);
    await pool.query("DELETE FROM password_reset_tokens WHERE token = $1", [
      token,
    ]);

    res.status(200).json({ message: "Contraseña actualizada correctamente" });
  } catch (err) {
    console.error(err);
    if (err.name === "TokenExpiredError") {
      return res.status(400).json({ message: "El token ha expirado" });
    }
    res.status(400).json({ message: "Token inválido o expirado" });
  }
});

// Endpoint para obtener la información del usuario autenticado
app.get("/api/auth/user", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1]; // Obtener el token de la cabecera Authorization
  if (!token) {
    return res.status(401).json({ message: "Token no proporcionado" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await pool.query(
      "SELECT id, email, name FROM users WHERE id = $1",
      [decoded.userId]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }
    4;
    res.json(user); // Devolver la información del usuario
  } catch (err) {
    res.status(401).json({ message: "Token inválido o expirado" });
  }
});

// Iniciar el servidor
app.listen(port, () => {
  console.log(`Servidor escuchando en http://localhost:${port}`);
});
