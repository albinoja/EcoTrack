const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const nodemailer = require("nodemailer");
const { parse, isValid, formatISO, startOfDay, endOfDay } = require("date-fns");
const pool = require("./lib/db");

const cors = require("cors"); // Importar cors
const { Console } = require("console");
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

// Método para enviar el correo de verificación
async function sendEmailPasswordReset(email, name, token) {
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
    subject: "Reestablece tu password",
    text: "Reestablece tu password",
    html: `<p>Hola: ${name}, has solicitado reestablecer tu password</p>
            <p>Sigue el siguiente enlace para generar un nuevo password:</p>
            <a href="${process.env.FRONTEND_URL}/auth/olvide-password/${token}">Reestablecer Password</a>
            <p>Si tu no solicitaste esto, puedes ignorar este mensaje</p>
        `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("Correo enviado");
  } catch (err) {
    console.error("Error al enviar correo:", err);
  }
}

async function sendEmailNewAppointment(email, name) {
  try {
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
      to: email.email,
      subject: "Confirmación de cita médica CitasMedULS",
      html: `
        <p>Hola ${email.name},</p>
        <p>Gracias por agendar una cita en <strong>ULS MED</strong>.</p>
        <p>Tu cita ha sido confirmada. Te esperamos en la fecha y horario seleccionados.</p>
        <p>Si tienes alguna duda o necesitas cambiar la fecha, no dudes en contactarnos.</p>
        <br>
        <p>Saludos cordiales,</p>
        <p>El equipo de CitasMedULS</p>
      `,
    };

    // Enviar correo electrónico
    await transporter.sendMail(mailOptions);
    console.log("Correo enviado exitosamente");
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
      id: user.id,
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

// Endpoint para manejar solicitudes de restablecimiento de contraseña
app.post("/api/auth/forgot-password", async (req, res) => {
  const { email } = req.body;

  // Validar que se proporcione el email
  if (!email) {
    return res.status(400).json({ msg: "El email es obligatorio" });
  }

  try {
    // Verificar si el usuario existe en la base de datos
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ msg: "El usuario no existe" });
    }

    const user = result.rows[0];

    // Generar un token único para la recuperación de contraseña
    const token = crypto.randomBytes(5).toString("hex"); // 5 bytes generan 10 caracteres hexadecimales

    // Actualizar el token en la base de datos
    await pool.query("UPDATE users SET token = $1 WHERE email = $2", [
      token,
      email,
    ]);

    // Enviar el correo con el token de restablecimiento
    await sendEmailPasswordReset(email, user.name, token);

    res.json({
      msg: "Hemos enviado un email con las instrucciones",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Hubo un error al procesar la solicitud" });
  }
});

// Endpoint para manejar el restablecimiento de la contraseña
app.get("/api/auth/forgot-password/:token", async (req, res) => {
  const { token } = req.params;

  try {
    // Consulta SQL para buscar el usuario con el token
    const result = await pool.query("SELECT * FROM users WHERE token = $1", [
      token,
    ]);

    if (result.rows.length === 0) {
      return res.status(400).json({ msg: "Token no válido o expirado" });
    }

    // Si el token es válido
    res.json({ msg: "Token Válido" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ msg: "Error al verificar el token" });
  }
});

app.post("/api/auth/forgot-password/:token", async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  // Validar que la contraseña esté presente
  if (!password) {
    return res.status(400).json({ msg: "La nueva contraseña es obligatoria" });
  }

  try {
    // Buscar el usuario por el token en la base de datos PostgreSQL
    const result = await pool.query("SELECT * FROM users WHERE token = $1", [
      token,
    ]);

    if (result.rows.length === 0) {
      return res.status(400).json({ msg: "Hubo un error, Token no válido" });
    }

    // Si el usuario es encontrado, actualizar la contraseña
    const userId = result.rows[0].id; // Suponiendo que 'id' es el identificador del usuario en la tabla

    const hashedPassword = await bcrypt.hash(password, 10);

    // Actualizar la contraseña del usuario
    const updateResult = await pool.query(
      "UPDATE users SET password = $1, token = NULL WHERE id = $2 RETURNING *",
      [hashedPassword, userId]
    );

    // Verificar si la actualización fue exitosa
    if (updateResult.rows.length > 0) {
      return res.json({ msg: "Contraseña actualizada correctamente" });
    } else {
      return res
        .status(500)
        .json({ msg: "No se pudo actualizar la contraseña" });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ msg: "Error al procesar la solicitud" });
  }
});

// Ruta protegida con el middleware authenticateToken
app.get("/api/services", authenticateToken, async (req, res) => {
  try {
    // Consultar los servicios desde la base de datos PostgreSQL
    const result = await pool.query("SELECT * FROM services");

    // Retornar los servicios como respuesta en formato JSON
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error al obtener los servicios" });
  }
});

function formatDate(dateString) {
  const options = { year: "numeric", month: "long", day: "numeric" };
  const date = new Date(dateString);
  return date.toLocaleDateString("es-ES", options);
}

app.post("/api/appointments", authenticateToken, async (req, res) => {
  const appointment = req.body;

  // Desestructurar los valores del cuerpo de la solicitud
  const { date, time, totalAmount, user_id, services, email, name } =
    appointment;

  // Obtener el primer ID del servicio
  const service_id = services && services.length > 0 ? services[0] : null;

  function formatDate(dateString) {
    const options = { year: "numeric", month: "long", day: "numeric" };
    const date = new Date(dateString);
    return date.toLocaleDateString("es-ES", options);
  }

  try {
    // Inserción en la base de datos
    const result = await pool.query(
      "INSERT INTO appointments (date, time, user_id, total_amount, service_id) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [date, time, user_id, totalAmount, service_id]
    );

    const newAppointmentUserId = result.rows[0].user_id;

    // Llamar a la función para enviar el correo
    try {
      await sendEmailNewAppointment({
        email,
        name,
      });
    } catch (emailError) {
      console.error("Error al enviar el correo:", emailError);
      return res.status(500).json({ msg: "Error al enviar el correo" });
    }

    res.json({
      msg: "Tu Reservación se realizó correctamente",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error al crear la cita" });
  }
});

app.get(
  "/api/users/:userId/appointments",
  authenticateToken,
  async (req, res) => {
    const { userId } = req.params; // Obtener el ID del usuario de los parámetros de la URL
    const today = new Date();

    // Formatear las fechas para consultar citas del día actual
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));

    try {
      // Consulta para obtener citas del usuario del día actual
      const result = await pool.query(
        "SELECT a.id, a.date, a.time, a.total_amount, a.service_id, s.id AS service_id, s.name, s.price FROM appointments a INNER JOIN services s ON s.id = a.service_id WHERE user_id = $1",
        [userId]
      );

      // Devolver las citas al cliente
      res.json(result.rows);
    } catch (error) {
      console.error(error);
      res.status(500).json({ msg: "Error al obtener las citas del día" });
    }
  }
);

app.get("/api/appointments", authenticateToken, async (req, res) => {
  const { date } = req.query; // Obtener la fecha desde la consulta

  try {
    // Validar que el parámetro 'date' esté presente
    if (!date) {
      return res
        .status(400)
        .json({ msg: "El parámetro 'date' es obligatorio" });
    }

    // Convertir la fecha del formato `dd/MM/yyyy` a un objeto Date
    const parsedDate = parse(date, "dd/MM/yyyy", new Date());
    if (!isValid(parsedDate)) {
      return res
        .status(400)
        .json({ msg: "Fecha no válida. Use el formato dd/MM/yyyy" });
    }

    // Formatear la fecha a ISO para usarla en PostgreSQL
    const isoDate = formatISO(parsedDate, { representation: "date" });

    // Realizar la consulta a PostgreSQL
    const query = `
      SELECT * 
      FROM appointments 
      WHERE date >= CURRENT_DATE AND date <= $1
    `;
    const values = [isoDate];
    const result = await pool.query(query, values);

    // Devolver los resultados
    res.json(result.rows);
  } catch (error) {
    console.error("Error al obtener las citas:", error);
    res.status(500).json({ msg: "Error al obtener las citas" });
  }
});

app.delete("/api/appointments/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      "SELECT * FROM appointments WHERE id = $1",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ msg: "La Cita no existe" });
    }

    const appointment = result.rows[0];

    await pool.query("DELETE FROM appointments WHERE id = $1", [id]);

    res.json({ msg: "Cita Cancelada Exitosamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error al cancelar la cita" });
  }
});

app.listen(port, () => {
  console.log(`Servidor escuchando en http://localhost:${port}`);
});
