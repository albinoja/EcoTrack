const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const nodemailer = require("nodemailer");
const pool = require("./lib/db");

const cors = require("cors"); // Importar cors
require("dotenv").config();

const app = express();
const port = 3000;

app.use(express.json());

// Configuración de CORS para permitir solicitudes desde tu frontend
const corsOptions = {
  origin: "http://localhost:5173", // Permitir solicitudes solo desde el frontend local
  methods: ["GET", "POST", "PUT", "DELETE"], // Métodos permitidos
  allowedHeaders: ["Content-Type", "Authorization"], // Cabeceras permitidas
};

app.use(cors(corsOptions)); // Habilitar CORS con las opciones configuradas

// Método para enviar el correo de verificación
async function sendVerificationEmail(email, name, token) {
  // Configuración de nodemailer
  const transporter = nodemailer.createTransport({
    service: "gmail", // Puedes usar otro proveedor de correo
    auth: {
      user: process.env.EMAIL_USER, // Tu correo electrónico
      pass: process.env.EMAIL_PASS, // Tu contraseña de correo
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Verificación de cuenta",
    html: `<p>Hola: ${name}, confirma tu cuenta</p>
              <p>Tu cuenta esta casi lista, solo debes confirmarla en el siguiente enlace:</p>
              <a href="${process.env.FRONTEND_URL}/auth/confirmar-cuenta/${token}">Confirmar cuenta</a>
              <p>Si no creaste esta cuenta, puedes ignorar este mensaje.</p>`,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("Correo enviado");
  } catch (err) {
    console.error("Error al enviar correo:", err);
  }
}

// Endpoint para registrar un nuevo usuario
app.post("/api/auth/register", async (req, res) => {
  const { email, password, name } = req.body;

  // Validar que todos los campos estén presentes
  if (!email || !password || !name) {
    return res.status(400).json({ msg: "Todos los campos son obligatorios" });
  }

  // Evitar registros duplicados
  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    if (result.rows.length > 0) {
      return res.status(400).json({ msg: "Usuario ya registrado" });
    }
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ msg: "Error al verificar el usuario en la base de datos" });
  }

  // Validar la extensión del password
  const MIN_PASSWORD_LENGTH = 8;
  if (password.trim().length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({
      msg: `El password debe contener al menos ${MIN_PASSWORD_LENGTH} caracteres`,
    });
  }

  try {
    // Hashear la contraseña antes de guardarla
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generar token de verificación
    const token = crypto.randomBytes(5).toString("hex"); // 5 bytes generan 10 caracteres hexadecimales

    // Insertar el usuario en la base de datos
    const newUser = await pool.query(
      "INSERT INTO users (email, password, name, verified, admin, token) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email, name, verified, admin, token",
      [email, hashedPassword, name, false, false, token] // Los valores por defecto para verified y admin son 'false'
    );

    // Enviar correo con el token de verificación
    await sendVerificationEmail(email, name, token);

    res.status(201).json({
      msg: "El usuario se creó correctamente, revisa tu email para verificar tu cuenta.",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Error registrando el usuario" });
  }
});

app.get("/api/auth/verify/:token", async (req, res) => {
  const { token } = req.params;

  try {
    // Consulta SQL para buscar el usuario con el token
    const result = await pool.query("SELECT * FROM users WHERE token = $1", [
      token,
    ]);

    // Verificar si el usuario existe
    if (result.rows.length === 0) {
      return res.status(401).json({ msg: "Hubo un error, token no válido" });
    }

    const user = result.rows[0]; // Obtener el primer usuario que coincida con el token

    // Confirmar la cuenta y actualizar el usuario
    const updateResult = await pool.query(
      "UPDATE users SET verified = $1, token = $2 WHERE id = $3",
      [true, "", user.id] // Actualizar el estado de verificación y eliminar el token
    );

    res.json({ msg: "Usuario Confirmado Correctamente" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ msg: "Hubo un error al confirmar la cuenta" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  // Validar que los campos estén presentes
  if (!email || !password) {
    return res
      .status(400)
      .json({ msg: "El email y la contraseña son obligatorios" });
  }

  try {
    // Buscar al usuario en la base de datos
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    if (result.rows.length === 0) {
      return res.status(401).json({ msg: "El Usuario no existe" });
    }

    const user = result.rows[0];

    // Revisar si el usuario ha confirmado su cuenta
    if (!user.verified) {
      return res
        .status(401)
        .json({ msg: "Tu cuenta no ha sido confirmado aún" });
    }

    // Verificar la contraseña
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ msg: "El password es incorrecto" });
    }

    // Generar el token JWT
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: "1h", // El token expirará en 1 hora, puedes ajustar este valor
    });

    // Responder con el token
    return res.json({
      token,
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ msg: "Error al procesar la solicitud de inicio de sesión" });
  }
});

// Middleware para validar el token JWT
const authenticateToken = (req, res, next) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ msg: "Acceso no autorizado" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ msg: "Token inválido o expirado" });
    }

    // Almacenar la información del usuario decodificado en el objeto req
    req.user = decoded;
    next();
  });
};

// Endpoint para obtener la información del usuario autenticado
app.get("/api/auth/user", authenticateToken, async (req, res) => {
  const { userId } = req.user;

  try {
    // Consultar la base de datos para obtener el usuario por su ID
    const result = await pool.query(
      "SELECT id, name, email, admin FROM users WHERE id = $1",
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ msg: "Usuario no encontrado" });
    }

    const user = result.rows[0];

    // Formatear la respuesta
    res.json({
      _id: user.id, // Cambiar 'id' por '_id'
      name: user.name,
      email: user.email,
      admin: user.admin,
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ msg: "Error al obtener los datos del usuario" });
  }
});

app.listen(port, () => {
  console.log(`Servidor escuchando en http://localhost:${port}`);
});
